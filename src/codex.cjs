'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { mkdir } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');

const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const MAX_DIAGNOSTIC_LINE = 2048;
const REQUEST_TIMEOUT_MS = 30000;

function defaultLaunch() {
  const entry = require.resolve('@openai/codex/bin/codex.js');
  if (process.platform !== 'win32') return { command: process.execPath, args: [entry, 'app-server'] };
  const target = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }[process.arch];
  if (!target) throw new Error('This Windows architecture is not supported by the bundled assistant engine.');
  let vendor;
  try { vendor = path.join(path.dirname(require.resolve(`@openai/codex-win32-${process.arch}/package.json`)), 'vendor'); }
  catch { vendor = path.join(path.dirname(entry), '..', 'vendor'); }
  const command = path.join(vendor, target, 'bin', 'codex.exe');
  if (!existsSync(command)) throw new Error('The bundled assistant engine is missing. Reinstall the complete Little Bot application folder.');
  // The CLI wrapper spawns another process without windowsHide, leaving a
  // console that Windows can interrupt independently of the desktop app.
  // Own the native process directly so piped I/O + windowsHide apply to it.
  return { command, args: ['app-server'] };
}

/** A local, version-pinned Codex app-server JSONL transport. No credentials are read. */
class CodexClient extends EventEmitter {
  constructor({ homeDir, cwd, env = {}, command, args } = {}) {
    super();
    if (!homeDir || !cwd || !path.isAbsolute(homeDir) || !path.isAbsolute(cwd)) {
      throw new TypeError('Codex homeDir and cwd must be absolute paths.');
    }
    this.homeDir = homeDir;
    this.cwd = cwd;
    this.env = env;
    const launch = command ? { command, args: [] } : defaultLaunch();
    this.command = launch.command;
    this.args = args || launch.args;
    this.state = 'idle';
    this.child = null;
    this._pending = new Map();
    this._serverRequests = new Set();
    this._nextId = 1;
    this._stdout = '';
    this._stderr = '';
    this._stderrOverflow = false;
    this._diagnostics = '';
    this._secrets = new Set();
    this._startPromise = null;
    this._closePromise = null;
    this._crashError = null;
    this._rememberSecrets(env);
  }

  get diagnostics() { return this._diagnostics; }
  get ready() { return this.state === 'ready'; }

  start() {
    if (this._startPromise) return this._startPromise;
    if (this.state !== 'idle') return Promise.reject(new Error('Codex client is closed.'));
    this.state = 'starting';
    this._startPromise = this._start();
    return this._startPromise;
  }

  async _start() {
    try {
      await mkdir(this.homeDir, { recursive: true, mode: 0o700 });
      if (this.state !== 'starting') throw new Error('Codex client was closed during startup.');
      const child = spawn(this.command, this.args, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env, CODEX_HOME: this.homeDir, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
      this.child = child;
      this._exited = new Promise((resolve) => { this._resolveExited = resolve; });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this._readStdout(chunk));
      child.stderr.on('data', (chunk) => this._readStderr(chunk));
      child.stdin.on('error', (error) => this._fail(new Error(`Codex input pipe failed: ${error.message}`)));
      child.stdout.on('error', (error) => this._fail(new Error(`Codex output pipe failed: ${error.message}`)));
      child.stderr.on('error', (error) => this._diagnose(`Codex diagnostic pipe failed: ${error.message}`));
      child.on('error', (error) => this._fail(new Error(`Could not start Codex: ${error.message}`)));
      child.on('close', (code, signal) => {
        if (this._stderrOverflow) this._diagnose('[Oversized diagnostic line omitted]');
        else if (this._stderr) this._diagnose(this._stderr);
        this._stderr = '';
        this._stdout = '';
        this._resolveExited();
        if (this.state !== 'closing' && this.state !== 'closed' && this.state !== 'crashed') {
          const interrupted = process.platform === 'win32' && Number.isInteger(code) && (code >>> 0) === 0xC000013A;
          this._fail(new Error(interrupted
            ? 'The assistant engine was interrupted by Windows. Reopen Little Bot to reconnect.'
            : `Codex exited unexpectedly (${signal || `code ${code}`}). Reopen Little Bot to reconnect.`));
        }
      });
      const result = await this._request('initialize', {
        clientInfo: { name: 'little_bot', title: 'Little Bot', version: require('../package.json').version },
        capabilities: { experimentalApi: true },
      }, REQUEST_TIMEOUT_MS);
      await this._write({ method: 'initialized', params: {} });
      if (this.state !== 'starting') throw this._crashError || new Error('Codex closed during startup.');
      this.state = 'ready';
      return result;
    } catch (error) {
      this._fail(error);
      await this.close();
      throw this._crashError || error;
    }
  }

  async request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (this.state === 'idle' || this.state === 'starting') await this.start();
    if (!this.ready) throw this._crashError || new Error('Codex is not running.');
    return this._request(method, params, timeoutMs);
  }

  _request(method, params, timeoutMs) {
    if (typeof method !== 'string' || !method || !Number.isFinite(timeoutMs) || timeoutMs < 1) {
      return Promise.reject(new TypeError('Codex method and positive request timeout are required.'));
    }
    this._rememberSecrets(params);
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}. The server may still be processing it.`));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._write({ id, method, params }).catch((error) => {
        const pending = this._pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this._pending.delete(id);
        reject(error);
      });
    });
  }

  async notify(method, params = {}) {
    if (this.state === 'idle' || this.state === 'starting') await this.start();
    if (!this.ready) throw this._crashError || new Error('Codex is not running.');
    if (typeof method !== 'string' || !method) throw new TypeError('A notification method is required.');
    this._rememberSecrets(params);
    await this._write({ method, params });
  }

  async respond(id, result) {
    if (!this.ready && this.state !== 'starting') throw this._crashError || new Error('Codex is not running.');
    if (!this._serverRequests.has(id)) throw new Error('This Codex request is no longer pending.');
    this._rememberSecrets(result);
    this._serverRequests.delete(id);
    await this._write({ id, result });
  }

  async reject(id, message, code = -32601) {
    if (!this._serverRequests.has(id)) throw new Error('This Codex request is no longer pending.');
    this._serverRequests.delete(id);
    await this._write({ id, error: { code, message: this._scrub(message) } });
  }

  _write(message) {
    if (!this.child || !this.child.stdin.writable || ['closing', 'closed', 'crashed'].includes(this.state)) {
      return Promise.reject(this._crashError || new Error('Codex input pipe is closed.'));
    }
    let serialized;
    try {
      serialized = `${JSON.stringify(message)}\n`;
      if (Buffer.byteLength(serialized, 'utf8') > MAX_LINE_BYTES) throw new Error('Codex request exceeds the message size limit.');
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      this.child.stdin.write(serialized, 'utf8', (error) => {
        if (error) {
          const safeError = new Error(`Could not write to Codex: ${this._scrub(error.message)}`);
          this._fail(safeError);
          reject(safeError);
        } else resolve();
      });
    });
  }

  _readStdout(chunk) {
    if (['closed', 'crashed'].includes(this.state)) return;
    this._stdout += chunk;
    let newline;
    while ((newline = this._stdout.indexOf('\n')) >= 0) {
      const line = this._stdout.slice(0, newline);
      this._stdout = this._stdout.slice(newline + 1);
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) return this._protocolFailure('Codex sent an oversized message.');
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { return this._protocolFailure('Codex sent invalid JSON.'); }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return this._protocolFailure('Codex sent an invalid protocol message.');
      this._dispatch(message);
      if (this.state === 'crashed') return;
    }
    if (Buffer.byteLength(this._stdout, 'utf8') > MAX_LINE_BYTES) this._protocolFailure('Codex sent an oversized message.');
  }

  _dispatch(message) {
    const hasId = Object.hasOwn(message, 'id');
    if (hasId && typeof message.id !== 'string' && typeof message.id !== 'number') {
      return this._protocolFailure('Codex sent an invalid request identifier.');
    }
    if (typeof message.method === 'string') {
      if (hasId) {
        this._serverRequests.add(message.id);
        this.emit('request', { id: message.id, method: message.method, params: message.params || {} });
      } else {
        if (message.method === 'serverRequest/resolved') this._serverRequests.delete(message.params?.requestId);
        this.emit('notification', message.method, message.params || {});
      }
      return;
    }
    if (!hasId || (!Object.hasOwn(message, 'result') && !Object.hasOwn(message, 'error'))) {
      return this._protocolFailure('Codex sent an invalid response.');
    }
    const pending = this._pending.get(message.id);
    if (!pending) return; // A timed-out request may still produce a late response.
    clearTimeout(pending.timer);
    this._pending.delete(message.id);
    if (message.error) {
      const error = new Error(this._scrub(message.error.message || 'Codex request failed.'));
      error.code = message.error.code;
      pending.reject(error);
    } else pending.resolve(message.result);
  }

  _readStderr(chunk) {
    this._stderr += chunk;
    let newline;
    while ((newline = this._stderr.indexOf('\n')) >= 0) {
      const line = this._stderr.slice(0, newline);
      this._stderr = this._stderr.slice(newline + 1);
      this._diagnose(this._stderrOverflow || line.length > MAX_DIAGNOSTIC_BYTES ? '[Oversized diagnostic line omitted]' : line);
      this._stderrOverflow = false;
    }
    // Never emit partial lines: credentials can straddle stream chunks.
    if (this._stderr.length > MAX_DIAGNOSTIC_BYTES) {
      this._stderr = '';
      this._stderrOverflow = true;
    }
  }

  _rememberSecrets(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6) return;
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && /(?:key|token|secret|password|authorization)/i.test(key) && item.length >= 4) {
        if (this._secrets.size < 128) this._secrets.add(item);
      } else if (item && typeof item === 'object') this._rememberSecrets(item, depth + 1);
    }
  }

  _scrub(value) {
    let text = String(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    for (const secret of this._secrets) text = text.split(secret).join('[REDACTED]');
    return text
      .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/(\bBearer\s+)[^\s"',}]+/gi, '$1[REDACTED]')
      .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[REDACTED]')
      .replace(/([?&](?:code|token|access_token|refresh_token|id_token|key|state)=)[^&\s]+/gi, '$1[REDACTED]');
  }

  _diagnose(value) {
    const safe = this._scrub(value).slice(0, MAX_DIAGNOSTIC_LINE).trim();
    if (!safe) return;
    this._diagnostics = `${this._diagnostics}${safe}\n`.slice(-MAX_DIAGNOSTIC_BYTES);
    this.emit('diagnostics', safe);
  }

  _protocolFailure(message) {
    this._stdout = '';
    this._fail(new Error(message));
    void this.close();
  }

  _fail(error) {
    if (['closing', 'closed', 'crashed'].includes(this.state)) return;
    const safeError = new Error(this._scrub(error?.message || error));
    this.state = 'crashed';
    this._crashError = safeError;
    this._rejectPending(safeError);
    this._serverRequests.clear();
    this._diagnose(safeError.message);
    this.emit('crash', safeError);
    void this.close();
  }

  _rejectPending(error) {
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this._pending.clear();
  }

  close() {
    if (this._closePromise) return this._closePromise;
    this._closePromise = this._close();
    return this._closePromise;
  }

  async _close() {
    this.state = 'closing';
    this._rejectPending(new Error('Codex client closed.'));
    this._serverRequests.clear();
    const child = this.child;
    if (child) {
      child.stdin.end(); // The owned app-server receives EOF before forced cleanup.
      let timer;
      await Promise.race([
        this._exited,
        new Promise((resolve) => { timer = setTimeout(resolve, 1500); }),
      ]);
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        if (process.platform === 'win32') {
          await new Promise((resolve) => {
            const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
            killer.once('error', resolve);
            killer.once('close', resolve);
          });
        } else child.kill('SIGTERM');
      }
    }
    this.state = 'closed';
    this._stdout = '';
    this._stderr = '';
    this._secrets.clear();
  }
}

module.exports = { CodexClient };
