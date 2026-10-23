'use strict';

// A small MCP client: local servers over stdio (one JSON message per line) and remote servers over Streamable HTTP,
// with OAuth sign-in (discovery, dynamic client registration, PKCE, loopback redirect, refresh). Only tools are
// used: list, call and the list-changed notification.

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'little-bot', title: 'Little Bot', version: require('../../package.json').version };
const BASE_ENV = ['PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME',
  'HOMEDRIVE', 'HOMEPATH', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
  'CommonProgramFiles', 'NUMBER_OF_PROCESSORS', 'OS', 'PROCESSOR_ARCHITECTURE', 'LANG', 'TERM'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

class AuthRequired extends Error {
  constructor(message, header = '') { super(message); this.code = 'auth_required'; this.header = header; }
}

function quoteForCmd(value) {
  return /^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${String(value).replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------------------------- transports
class StdioTransport extends EventEmitter {
  constructor({ command, args = [], envVars = [], cwd }) {
    super();
    const env = {};
    for (const key of [...BASE_ENV, ...envVars]) if (process.env[key] !== undefined) env[key] = process.env[key];
    // npx, uvx and other launchers are .cmd files on Windows; cmd.exe resolves them.
    const direct = process.platform !== 'win32' || /\.exe$/i.test(command) || path.isAbsolute(command) && fs.existsSync(command) && /\.exe$/i.test(command);
    this.child = direct
      ? spawn(command, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn([command, ...args].map(quoteForCmd).join(' '), { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
    this.buffer = '';
    this.stderr = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        try { this.emit('message', JSON.parse(line)); } catch { /* A server's stray log line is not a message. */ }
      }
      if (this.buffer.length > 16 * 1024 * 1024) this.buffer = '';
    });
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-4000); });
    this.child.stdin.on('error', () => {});
    this.child.once('error', error => this.emit('close', error));
    this.child.once('close', code => this.emit('close', new Error(`The MCP server exited (code ${code}). ${this.stderr.trim().split('\n').pop() || ''}`.trim())));
  }
  async send(message) {
    if (!this.child.stdin.writable) throw new Error('The MCP server is not running.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  async close() {
    const child = this.child;
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    const exited = new Promise(resolve => child.once('close', resolve));
    child.stdin.end();
    if (process.platform === 'win32') spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    else child.kill();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
  }
}

class HttpTransport extends EventEmitter {
  constructor({ url, token }) {
    super();
    this.url = url;
    this.token = token; // () => Promise<string|null>
    this.sessionId = null;
    this.protocolVersion = null;
    this.controllers = new Set();
  }
  async send(message) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const token = await this.token();
    if (token) headers.authorization = `Bearer ${token}`;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.protocolVersion) headers['mcp-protocol-version'] = this.protocolVersion;
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const response = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(message), signal: controller.signal });
      if (response.status === 401) throw new AuthRequired('The MCP server requires sign-in.', response.headers.get('www-authenticate') || '');
      if (response.status === 404 && this.sessionId) { this.sessionId = null; throw Object.assign(new Error('The MCP session expired.'), { code: 'session_expired' }); }
      if (!response.ok && response.status !== 202) throw new Error(`The MCP server answered HTTP ${response.status}.`);
      const session = response.headers.get('mcp-session-id');
      if (session) this.sessionId = session;
      if (response.status === 202 || !response.body) return;
      const type = response.headers.get('content-type') || '';
      if (type.includes('text/event-stream')) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '', data = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).replace(/\r$/, '');
            buffer = buffer.slice(newline + 1);
            if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
            else if (!line && data.length) {
              try { this.emit('message', JSON.parse(data.join('\n'))); } catch { /* Not JSON. */ }
              data = [];
            }
          }
          // The answer to this request ends the stream.
          if (message.id !== undefined && this.answered?.(message.id)) { reader.cancel().catch(() => {}); break; }
        }
        if (data.length) try { this.emit('message', JSON.parse(data.join('\n'))); } catch { /* Not JSON. */ }
      } else {
        const text = await response.text();
        if (!text.trim()) return;
        const parsed = JSON.parse(text);
        for (const item of Array.isArray(parsed) ? parsed : [parsed]) this.emit('message', item);
      }
    } finally { this.controllers.delete(controller); }
  }
  async close() {
    for (const controller of this.controllers) controller.abort();
    if (this.sessionId) {
      const headers = { 'mcp-session-id': this.sessionId };
      const token = await this.token().catch(() => null);
      if (token) headers.authorization = `Bearer ${token}`;
      fetch(this.url, { method: 'DELETE', headers }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------------------------- connection
class McpConnection {
  constructor({ name, config, cwd, auth }) {
    this.name = name;
    this.config = config;
    this.cwd = cwd;
    this.auth = auth;
    this.status = 'starting';
    this.tools = null;
    this.error = null;
    this.pending = new Map();
    this.nextId = 1;
  }
  async start() {
    const config = this.config;
    if (config.url) {
      this.transport = new HttpTransport({ url: config.url, token: () => this.auth.token(this.name, config) });
      this.transport.answered = id => !this.pending.has(id);
    } else {
      if (!config.command) throw new Error('The MCP server has no command.');
      this.transport = new StdioTransport({ command: config.command, args: config.args || [], envVars: config.env_vars || [], cwd: this.cwd });
    }
    this.transport.on('message', message => this._receive(message));
    this.transport.on('close', error => this._closed(error));
    const timeout = Math.max(8, Number(config.startup_timeout_sec) || 0) * 1000;
    const result = await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, timeout);
    if (this.transport instanceof HttpTransport) this.transport.protocolVersion = result?.protocolVersion || PROTOCOL_VERSION;
    await this.notify('notifications/initialized');
    this.status = 'connected';
    return this;
  }
  _receive(message) {
    if (!object(message)) return;
    if (message.method && message.id !== undefined) {
      // Requests from the server: answer pings and roots; sampling and elicitation are not offered.
      const result = message.method === 'ping' ? {} : message.method === 'roots/list' ? { roots: [] } : null;
      this.transport.send(result ? { jsonrpc: '2.0', id: message.id, result } : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Not supported by Little Bot.' } }).catch(() => {});
      return;
    }
    if (message.method === 'notifications/tools/list_changed') { this.tools = null; return; }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || 'The MCP server returned an error.'));
    else pending.resolve(message.result);
  }
  _closed(error) {
    this.status = this.status === 'authenticationRequired' ? this.status : 'failed';
    this.error = error?.message || 'The MCP server closed.';
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(this.error)); }
    this.pending.clear();
  }
  request(method, params, timeoutMs = 60000, signal) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const fail = error => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id); clearTimeout(timer); reject(error);
      };
      const timer = setTimeout(() => fail(new Error(`The MCP server did not answer ${method} in ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      signal?.addEventListener('abort', () => {
        fail(new Error('Stopped.'));
        this.notify('notifications/cancelled', { requestId: id, reason: 'Stopped by the user.' }).catch(() => {});
      }, { once: true });
      this.transport.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }).catch(error => {
        if (error.code === 'auth_required') this.status = 'authenticationRequired';
        fail(error);
      });
    });
  }
  notify(method, params) {
    return this.transport.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }
  async listTools() {
    if (this.tools) return this.tools;
    const tools = [];
    let cursor;
    for (let page = 0; page < 50; page++) {
      const result = await this.request('tools/list', cursor ? { cursor } : {}, 30000);
      for (const tool of result?.tools || []) if (object(tool) && typeof tool.name === 'string') tools.push(tool);
      if (!result?.nextCursor) break;
      cursor = result.nextCursor;
    }
    this.tools = tools;
    return tools;
  }
  callTool(name, args, { signal, timeoutMs } = {}) {
    const timeout = (Number(this.config.tool_timeout_sec) || 60) * 1000;
    return this.request('tools/call', { name, arguments: object(args) ? args : {} }, timeoutMs || timeout, signal);
  }
  async close() {
    this.status = 'failed';
    await this.transport?.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------- OAuth
function base64url(buffer) { return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'mcp-protocol-version': PROTOCOL_VERSION } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).origin}`);
  return response.json();
}

function wellKnown(base, suffix) {
  const url = new URL(base);
  const trimmed = url.pathname.replace(/\/+$/, '');
  return [`${url.origin}/.well-known/${suffix}${trimmed && trimmed !== '/' ? trimmed : ''}`, `${url.origin}/.well-known/${suffix}`];
}

class McpAuth {
  constructor({ file, protector = null, onCompleted = () => {} }) {
    this.file = file;
    this.protector = protector;
    this.onCompleted = onCompleted;
    this.data = this._load();
    this.refreshing = new Map();
  }
  _load() {
    try {
      const raw = fs.readFileSync(this.file);
      const text = this.protector ? this.protector.decryptString(raw) : raw.toString('utf8');
      const parsed = JSON.parse(text);
      return object(parsed) ? parsed : {};
    } catch { return {}; }
  }
  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const text = JSON.stringify(this.data);
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, this.protector ? this.protector.encryptString(text) : text);
    fs.renameSync(temporary, this.file);
  }
  key(name, config) { return `${name}\0${config.url || ''}`; }
  status(name, config) {
    if (!config.url) return 'unsupported';
    if (config.bearer_token_env_var) return 'bearerToken';
    if (this.data[this.key(name, config)]?.tokens?.access_token) return 'oAuth';
    return 'unknown';
  }
  async token(name, config) {
    if (config.bearer_token_env_var) return process.env[config.bearer_token_env_var] || null;
    const record = this.data[this.key(name, config)];
    if (!record?.tokens?.access_token) return null;
    if (record.tokens.expires_at && Date.now() > record.tokens.expires_at - 60000 && record.tokens.refresh_token) {
      const key = this.key(name, config);
      if (!this.refreshing.has(key)) this.refreshing.set(key, this._refresh(record).finally(() => this.refreshing.delete(key)));
      try { await this.refreshing.get(key); } catch { return null; }
    }
    return record.tokens.access_token;
  }
  async _refresh(record) {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: record.tokens.refresh_token, client_id: record.clientId, ...(record.resource ? { resource: record.resource } : {}) });
    const response = await fetch(record.tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
    if (!response.ok) throw new Error(`Token refresh failed (HTTP ${response.status}).`);
    record.tokens = this._tokens(await response.json(), record.tokens.refresh_token);
    this._save();
  }
  _tokens(value, previousRefresh = null) {
    if (!object(value) || typeof value.access_token !== 'string') throw new Error('The sign-in server returned no access token.');
    return { access_token: value.access_token, refresh_token: value.refresh_token || previousRefresh,
      expires_at: Number.isFinite(value.expires_in) ? Date.now() + value.expires_in * 1000 : null, token_type: value.token_type || 'Bearer' };
  }
  async _discover(config, header) {
    const resourceUrl = /resource_metadata="([^"]+)"/.exec(header || '')?.[1];
    let resource = null;
    for (const url of resourceUrl ? [resourceUrl] : wellKnown(config.url, 'oauth-protected-resource')) {
      try { resource = await getJson(url); break; } catch { /* Try the next location. */ }
    }
    const issuer = resource?.authorization_servers?.[0] || new URL(config.url).origin;
    let metadata = null;
    for (const url of [...wellKnown(issuer, 'oauth-authorization-server'), ...wellKnown(issuer, 'openid-configuration')]) {
      try { metadata = await getJson(url); break; } catch { /* Try the next location. */ }
    }
    metadata ||= { authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register` };
    return { resource: resource?.resource || config.url, scopes: resource?.scopes_supported || metadata.scopes_supported || [], metadata };
  }
  // Starts sign-in and returns the page to open; the result arrives later through onCompleted.
  async login({ name, config, threadId, timeoutSecs = 120, probe }) {
    if (!config.url) throw new Error('Only HTTP MCP servers sign in.');
    let header = '';
    try { await probe(); } catch (error) { header = error.header || ''; }
    const { resource, scopes, metadata } = await this._discover(config, header);
    const server = http.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
    let clientId;
    try {
      if (!metadata.registration_endpoint) throw new Error('This MCP server does not support automatic sign-in registration.');
      const response = await fetch(metadata.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ client_name: 'Little Bot', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
      if (!response.ok) throw new Error(`Sign-in registration failed (HTTP ${response.status}).`);
      clientId = (await response.json()).client_id;
      if (typeof clientId !== 'string' || !clientId) throw new Error('Sign-in registration returned no client ID.');
    } catch (error) { server.close(); throw error; }
    const verifier = base64url(crypto.randomBytes(32));
    const state = base64url(crypto.randomBytes(16));
    const authorize = new URL(metadata.authorization_endpoint);
    for (const [key, value] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, resource,
      code_challenge: base64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', ...(scopes.length ? { scope: scopes.join(' ') } : {}) })) authorize.searchParams.set(key, value);
    const finish = (success, error = null) => { server.close(); this.onCompleted({ name, threadId, success, ...(error ? { error } : {}) }); };
    const timer = setTimeout(() => finish(false, 'Sign-in timed out.'), timeoutSecs * 1000);
    timer.unref?.();
    server.on('request', async (request, response) => {
      const url = new URL(request.url, redirectUri);
      if (url.pathname !== '/callback') { response.writeHead(404); response.end(); return; }
      const done = text => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(`<!doctype html><title>Little Bot</title><p style="font-family:sans-serif">${text}</p>`); };
      clearTimeout(timer);
      if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) { done('Sign-in failed. You can close this tab.'); finish(false, url.searchParams.get('error_description') || url.searchParams.get('error') || 'Sign-in was not completed.'); return; }
      try {
        const body = new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource });
        const tokenResponse = await fetch(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
        if (!tokenResponse.ok) throw new Error(`Token exchange failed (HTTP ${tokenResponse.status}).`);
        this.data[this.key(name, config)] = { clientId, tokenEndpoint: metadata.token_endpoint, resource, tokens: this._tokens(await tokenResponse.json()) };
        this._save();
        done('Signed in. You can close this tab and return to Little Bot.');
        finish(true);
      } catch (error) { done('Sign-in failed. You can close this tab.'); finish(false, error.message); }
    });
    return { authorizationUrl: authorize.href };
  }
}

// ---------------------------------------------------------------------------------------------- manager
// Connections are shared by every thread that uses the same server settings.
class McpManager {
  constructor({ authFile, protector = null, onLoginCompleted = () => {} }) {
    this.connections = new Map();
    this.auth = new McpAuth({ file: authFile, protector, onCompleted: result => {
      for (const [key, connection] of this.connections) if (connection.name === result.name) { connection.close(); this.connections.delete(key); }
      onLoginCompleted(result);
    } });
  }
  _key(name, config) {
    const { url, command, args, env_vars: envVars, bearer_token_env_var: bearer } = config;
    return JSON.stringify([name, url, command, args, envVars, bearer]);
  }
  async connect(name, config, cwd) {
    const key = this._key(name, config);
    let entry = this.connections.get(key);
    if (entry && ['failed', 'authenticationRequired'].includes(entry.status)) { this.connections.delete(key); entry = null; }
    if (!entry) {
      entry = new McpConnection({ name, config, cwd, auth: this.auth });
      entry.ready = entry.start().catch(error => {
        entry.status = error.code === 'auth_required' ? 'authenticationRequired' : 'failed';
        entry.error = error.message;
        entry.transport?.close().catch(() => {});
        throw error;
      });
      this.connections.set(key, entry);
    }
    await entry.ready;
    return entry;
  }
  // One row per configured server, in the shape the app shows: status, sign-in state and tools after filters.
  async status(servers, cwd) {
    const rows = [];
    for (const [name, config] of Object.entries(servers || {})) {
      if (!object(config)) continue;
      const row = { name, runtimeStatus: 'disabled', authStatus: this.auth.status(name, config), tools: {} };
      if (config.enabled !== false) {
        try {
          const connection = await this.connect(name, config, cwd);
          row.runtimeStatus = 'connected';
          for (const tool of filterTools(await connection.listTools(), config)) row.tools[tool.name] = tool;
          if (row.authStatus === 'unknown') row.authStatus = 'unsupported';
        } catch (error) {
          row.runtimeStatus = error.code === 'auth_required' ? 'authenticationRequired' : 'failed';
          if (error.code === 'auth_required') row.authStatus = 'notLoggedIn';
          row.toolsError = error.message;
        }
      }
      rows.push(row);
    }
    return rows;
  }
  async login({ name, config, cwd, threadId, timeoutSecs }) {
    return this.auth.login({ name, config, threadId, timeoutSecs, probe: async () => {
      const probe = new McpConnection({ name, config, cwd, auth: { token: async () => null } });
      try { await probe.start(); } finally { await probe.close(); }
    } });
  }
  async closeAll() {
    const connections = [...this.connections.values()];
    this.connections.clear();
    await Promise.allSettled(connections.map(connection => connection.close()));
  }
}

function filterTools(tools, config) {
  const enabled = Array.isArray(config.enabled_tools) ? new Set(config.enabled_tools) : null;
  const disabled = new Set(Array.isArray(config.disabled_tools) ? config.disabled_tools : []);
  return tools.filter(tool => (!enabled || enabled.has(tool.name)) && !disabled.has(tool.name));
}

module.exports = { McpManager, McpConnection, filterTools, AuthRequired, PROTOCOL_VERSION };
