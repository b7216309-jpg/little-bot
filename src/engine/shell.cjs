'use strict';

// Runs the model's terminal commands: Windows PowerShell on Windows, sh elsewhere. A command that is still running
// after its wait becomes a session the model can poll or type into (write_stdin). No sandbox: what may run is decided
// before this, by the thread's tools and the app's approval of each command.

const { spawn } = require('node:child_process');

const MAX_SESSIONS = 8;
const DEFAULT_YIELD_MS = 10000;
const MAX_YIELD_MS = 300000;
const DEFAULT_OUTPUT_CHARS = 30000;
const BUFFER_CHARS = 2 * 1024 * 1024;
const PREAMBLE = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8;";

function childEnv() {
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  for (const key of Object.keys(env)) if (/^(?:ELECTRON_|CHROME_)/i.test(key)) delete env[key];
  return env;
}

// PowerShell writes errors as CLIXML when its output is redirected; keep only their text.
function decodeClixml(text) {
  if (!text.includes('#< CLIXML') && !text.includes('<Objs Version=')) return text;
  return text.replace(/#< CLIXML\r?\n?/g, '').replace(/<Objs Version=[\s\S]*?<\/Objs>/g, xml => [...xml.matchAll(/<S S="(?:Error|Warning)">([\s\S]*?)<\/S>/g)]
    .map(match => match[1].replace(/_x([0-9A-F]{4})_/gi, (__, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'))
    .join(''));
}

function capOutput(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.floor(maxChars * 0.4), tail = maxChars - head;
  return { text: `${text.slice(0, head)}\n[... ${text.length - maxChars} characters omitted ...]\n${text.slice(-tail)}`, truncated: true };
}

function killTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } return Promise.resolve(); }
  return new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', resolve);
    killer.once('close', resolve);
  });
}

function launch(command, cwd) {
  if (process.platform === 'win32') {
    // The command runs as its own script block, so errors quote and locate only the model's command.
    const body = Buffer.from(command, 'utf8').toString('base64');
    // Exit code: the command's own `exit`, else a failing native program's code, else 1 if PowerShell reported an error.
    const script = `${PREAMBLE}$__lb=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${body}'));`
      + '$global:LASTEXITCODE=0;$__e=$Error.Count;Invoke-Expression $__lb;if($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0){exit $LASTEXITCODE};if($Error.Count -gt $__e){exit 1};exit 0';
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { cwd, env: childEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  return spawn('/bin/sh', ['-c', command], { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
}

class ShellSessions {
  constructor() {
    this.sessions = new Map();
    this.nextId = 1000;
  }

  _session(child) {
    const session = { id: this.nextId++, child, unread: '', exited: false, exitCode: null, startedAt: Date.now(), onOutput: null };
    const append = chunk => {
      session.unread += chunk;
      if (session.unread.length > BUFFER_CHARS) session.unread = session.unread.slice(-BUFFER_CHARS);
      // Live output for the timeline; CLIXML is left to the decoded result.
      if (session.onOutput && !/#< CLIXML|<\/?Objs|<S S=/.test(chunk)) session.onOutput(chunk);
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.stdin.on('error', () => {});
    session.closed = new Promise(resolve => {
      child.once('error', error => { append(`\n${error.message}\n`); session.exited = true; session.exitCode = -1; resolve(); });
      child.once('close', code => { session.exited = true; session.exitCode = Number.isInteger(code) ? code : -1; resolve(); });
    });
    return session;
  }

  // Waits until the session exits, the wait ends or the turn stops, then returns what it printed since last read.
  async _collect(session, { yieldMs, maxChars, signal, onOutput }) {
    const wait = Math.min(MAX_YIELD_MS, Math.max(250, Number.isFinite(yieldMs) ? yieldMs : DEFAULT_YIELD_MS));
    session.onOutput = onOutput || null;
    let stopped = Boolean(signal?.aborted), timer, onAbort;
    if (!stopped) await new Promise(resolve => {
      timer = setTimeout(resolve, wait);
      onAbort = () => { stopped = true; resolve(); };
      signal?.addEventListener('abort', onAbort, { once: true });
      session.closed.then(resolve);
    });
    clearTimeout(timer);
    session.onOutput = null;
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (stopped && !session.exited) {
      await killTree(session.child);
      await Promise.race([session.closed, new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    const raw = decodeClixml(session.unread);
    session.unread = '';
    const { text, truncated } = capOutput(raw, Number.isFinite(maxChars) && maxChars > 0 ? maxChars : DEFAULT_OUTPUT_CHARS);
    const wallMs = Date.now() - session.startedAt;
    if (session.exited) this.sessions.delete(session.id);
    return { sessionId: session.exited ? null : session.id, exitCode: session.exited ? session.exitCode : null, output: text, truncated, wallMs, stopped };
  }

  async exec({ command, cwd, yieldMs, maxChars, signal, onOutput }) {
    if (typeof command !== 'string' || !command.trim()) throw new Error('Give the command to run.');
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.values().next().value;
      await this.kill(oldest.id);
    }
    const session = this._session(launch(command, cwd));
    this.sessions.set(session.id, session);
    return this._collect(session, { yieldMs, maxChars, signal, onOutput });
  }

  async write({ sessionId, chars = '', yieldMs, maxChars, signal, onOutput }) {
    const session = this.sessions.get(Number(sessionId));
    if (!session) throw new Error(`No running session ${sessionId}. It finished or was stopped; run the command again.`);
    if (chars) {
      if (!session.child.stdin.writable) throw new Error('This session no longer accepts input.');
      session.child.stdin.write(chars);
    }
    return this._collect(session, { yieldMs: yieldMs ?? (chars ? 2000 : DEFAULT_YIELD_MS), maxChars, signal, onOutput });
  }

  async kill(sessionId) {
    const session = this.sessions.get(Number(sessionId));
    if (!session) return;
    this.sessions.delete(session.id);
    await killTree(session.child);
  }

  async killAll() {
    await Promise.all([...this.sessions.keys()].map(id => this.kill(id)));
  }
}

// One command to completion, for checks (no session, no model).
async function runOnce({ argv, cwd, timeoutMs = 20000 }) {
  if (!Array.isArray(argv) || !argv.length || argv.some(item => typeof item !== 'string')) throw new Error('A command is required.');
  const child = spawn(argv[0], argv.slice(1), { cwd, env: childEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { if (stdout.length < BUFFER_CHARS) stdout += chunk; });
  child.stderr.on('data', chunk => { if (stderr.length < BUFFER_CHARS) stderr += chunk; });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
  const exitCode = await new Promise(resolve => {
    child.once('error', error => { stderr += error.message; resolve(-1); });
    child.once('close', code => resolve(Number.isInteger(code) ? code : -1));
  });
  clearTimeout(timer);
  return { exitCode: timedOut ? 124 : exitCode, stdout: decodeClixml(stdout), stderr: decodeClixml(stderr) + (timedOut ? '\nThe command timed out.' : ''), timedOut };
}

module.exports = { ShellSessions, runOnce, decodeClixml, capOutput, killTree, PREAMBLE };
