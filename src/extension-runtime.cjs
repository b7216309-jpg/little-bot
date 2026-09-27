'use strict';

const path = require('node:path');

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key, value) => Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
const CONNECTIONS = new Set(['notStarted', 'starting', 'connected', 'authenticationRequired', 'failed', 'cancelled', 'disabled']);
const AUTH = new Set(['unknown', 'unsupported', 'notLoggedIn', 'bearerToken', 'oAuth']);

function safeText(value, max = 1000) {
  return String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|password|secret)["'\s:=]+)[^\s,}"']+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, value => {
      try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; } catch { return '[URL omitted]'; }
    }).slice(0, max);
}

// Show an interface, never server-provided examples/defaults, arbitrary extensions, or large payloads.
function safeSchema(schema) {
  let remaining = 1200;
  const visit = (value, depth) => {
    if (--remaining < 0 || depth > 10) return undefined;
    if (typeof value === 'boolean') return value;
    if (!object(value)) return undefined;
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      if (['type', 'title', 'description', 'format', '$ref'].includes(key)) {
        if (typeof item === 'string') own(out, key, safeText(item, key === 'description' ? 1000 : 300));
        else if (key === 'type' && Array.isArray(item)) out.type = item.filter(v => typeof v === 'string').slice(0, 10).map(v => safeText(v, 30));
      } else if (['properties', '$defs', 'definitions', 'patternProperties'].includes(key) && object(item)) {
        const children = {};
        for (const [name, child] of Object.entries(item).slice(0, 100)) {
          const filtered = visit(child, depth + 1);
          if (filtered !== undefined) own(children, safeText(name, 200), filtered);
        }
        own(out, key, children);
      } else if (['items', 'additionalProperties', 'not', 'contains'].includes(key)) {
        const filtered = visit(item, depth + 1);
        if (filtered !== undefined) own(out, key, filtered);
      } else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key) && Array.isArray(item)) {
        own(out, key, item.slice(0, 30).map(v => visit(v, depth + 1)).filter(v => v !== undefined));
      } else if (key === 'required' && Array.isArray(item)) {
        out.required = item.filter(v => typeof v === 'string').slice(0, 100).map(v => safeText(v, 200));
      } else if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'multipleOf'].includes(key) && Number.isFinite(item)) {
        own(out, key, item);
      } else if (['uniqueItems', 'readOnly', 'writeOnly', 'deprecated'].includes(key) && typeof item === 'boolean') {
        own(out, key, item);
      } else if (key === 'enum' && Array.isArray(item)) {
        out.enum = item.slice(0, 30).filter(v => v === null || ['boolean', 'number', 'string'].includes(typeof v))
          .map(v => typeof v === 'string' ? safeText(v, 200) : v);
      }
    }
    return out;
  };
  return visit(schema, 0);
}

function safeTools(value) {
  const tools = {};
  if (!object(value)) return tools;
  for (const [key, source] of Object.entries(value).slice(0, 500)) {
    if (!object(source)) continue;
    const name = safeText(key, 200);
    const tool = { name, description: safeText(source.description, 2000) };
    const schema = safeSchema(source.inputSchema);
    if (schema !== undefined) tool.inputSchema = schema;
    if (object(source.annotations)) {
      const annotations = {};
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        if (typeof source.annotations[hint] === 'boolean') annotations[hint] = source.annotations[hint];
      }
      if (Object.keys(annotations).length) tool.annotations = annotations;
    }
    own(tools, name, tool);
  }
  return tools;
}

function nativeConfigValue(value) {
  // config/read materializes optional fields as null; the JSON-to-TOML
  // thread override converter turns null into an invalid empty string.
  if (Array.isArray(value)) return value.filter(item => item != null).map(nativeConfigValue);
  if (!object(value)) return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) if (item != null) own(result, key, nativeConfigValue(item));
  return result;
}

class ExtensionRuntime {
  constructor({ store, client, onChange = () => {} }) {
    this.store = store;
    this.client = client;
    this.onChange = onChange;
    this._generation = 0;
    this._closed = false;
    this._refresh = null;
    this._threads = new Set();
    this._logins = new Map();
    this._onNotification = (method, params) => {
      if (method === 'mcpServer/oauthLogin/completed') this._completeLogin(params).catch(() => {});
    };
    client.on('notification', this._onNotification);
    this.state = { status: 'ready', servers: this._baseServers() };
  }

  _records() { return this.store.data.extensions?.servers || []; }
  _enabled(server) {
    return server.enabled === true && (!server.pluginId || (this.store.data.extensions?.plugins || []).some(plugin => plugin.id === server.pluginId && plugin.enabled === true));
  }
  _baseServers() {
    return this._records().map(server => {
      const tools = {};
      for (const name of server.disabledTools || []) own(tools, name, {
        name, description: 'Disabled in Little Bot. Re-enable and refresh to inspect.',
      });
      return {
        id: server.id, name: server.name, transport: server.transport, enabled: this._enabled(server),
        runtimeStatus: this._enabled(server) ? 'notStarted' : 'disabled', authStatus: 'unknown', tools,
      };
    });
  }
  _changed() { this.onChange(this.state); }
  _assertOpen() { if (this._closed) throw new Error('Extension runtime is closed.'); }
  _workspace(workspace) {
    if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new Error('An absolute workspace folder is required.');
    return workspace;
  }
  _native(server, heartbeat = false) {
    const record = {
      enabled: this._enabled(server) && !heartbeat,
      default_tools_approval_mode: 'auto', disabled_tools: [...(server.disabledTools || [])],
      required: false, startup_timeout_sec: 8, tool_timeout_sec: 60,
    };
    if (server.transport === 'http') {
      record.url = server.url;
      if (server.bearerTokenEnvVar) record.bearer_token_env_var = server.bearerTokenEnvVar;
    } else {
      record.command = server.command;
      record.args = [...(server.args || [])];
      record.env_vars = [...(server.envVars || [])];
    }
    return record;
  }
  config({ heartbeat = false } = {}) {
    const config = { 'features.apps': false, 'features.plugins': false };
    for (const server of this._records()) own(config, `mcp_servers.${server.name}`, this._native(server, heartbeat));
    return config;
  }

  async heartbeatConfig(workspace) {
    this._assertOpen();
    const response = await this.client.request('config/read', { cwd: this._workspace(workspace), includeLayers: false });
    if (!object(response?.config)) throw new Error('Could not verify the effective MCP configuration.');
    const effective = response.config.mcp_servers;
    if (effective != null && !object(effective)) throw new Error('Invalid effective MCP configuration.');
    const servers = {};
    for (const [name, record] of Object.entries(effective || {})) {
      if (!object(record)) throw new Error('Invalid effective MCP server configuration.');
      own(servers, name, { ...nativeConfigValue(record), enabled: false, required: false });
    }
    for (const server of this._records()) own(servers, server.name, this._native(server, true));
    // A complete table handles even native server names containing dots safely.
    return { 'features.apps': false, 'features.plugins': false, mcp_servers: servers };
  }

  async _inventory(threadId) {
    const rows = [];
    const seen = new Set();
    let cursor;
    for (let page = 0; page < 100; page++) {
      const result = await this.client.request('mcpServerStatus/list', {
        threadId, detail: 'toolsAndAuthOnly', limit: 100, ...(cursor ? { cursor } : {}),
      }, 20000);
      if (!Array.isArray(result?.data)) throw new Error('The engine returned an invalid MCP inventory.');
      rows.push(...result.data);
      if (rows.length > 10000) throw new Error('The MCP inventory exceeds the supported size.');
      if (result.nextCursor == null) return rows;
      if (typeof result.nextCursor !== 'string' || !result.nextCursor || seen.has(result.nextCursor)) throw new Error('The engine returned an invalid MCP inventory cursor.');
      seen.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error('The MCP inventory exceeds the supported page limit.');
  }

  async verifyHeartbeat(threadId) {
    this._assertOpen();
    for (const server of await this._inventory(threadId)) {
      if (!object(server) || !object(server.tools) || server.runtimeStatus !== 'disabled' || Object.keys(server.tools).length) {
        throw new Error('Heartbeat isolation failed: an MCP server was not fully disabled.');
      }
    }
    return true;
  }

  async _startThread(workspace, config) {
    this._assertOpen();
    const result = await this.client.request('thread/start', {
      cwd: this._workspace(workspace), ephemeral: true, approvalPolicy: 'never', sandbox: 'danger-full-access', config,
    });
    const threadId = result?.thread?.id;
    if (typeof threadId !== 'string' || !threadId) throw new Error('The engine did not return an extension thread.');
    this._threads.add(threadId);
    if (this._closed) { await this._unsubscribe(threadId); throw new Error('Extension runtime is closed.'); }
    return threadId;
  }
  async _unsubscribe(threadId) {
    if (!this._threads.delete(threadId)) return;
    try { await this.client.request('thread/unsubscribe', { threadId }, 10000); } catch { /* Engine shutdown also unloads these contexts. */ }
  }

  refresh(workspace) {
    this._assertOpen();
    this._workspace(workspace);
    if (this._refresh) return this._refresh;
    const generation = this._generation;
    this.state = { status: 'syncing', servers: this._baseServers() };
    this._changed();
    const operation = this._refreshInventory(workspace, generation);
    this._refresh = operation;
    operation.finally(() => { if (this._refresh === operation) this._refresh = null; }).catch(() => {});
    return operation;
  }
  async _refreshInventory(workspace, generation) {
    let threadId;
    try {
      threadId = await this._startThread(workspace, this.config());
      const rows = await this._inventory(threadId);
      const byName = new Map(rows.filter(object).map(row => [row.name, row]));
      const servers = this._baseServers().map(server => {
        const row = byName.get(server.name);
        if (!row || !server.enabled) return server;
        return {
          ...server, runtimeStatus: CONNECTIONS.has(row.runtimeStatus) ? row.runtimeStatus : 'notStarted',
          authStatus: AUTH.has(row.authStatus) ? row.authStatus : 'unknown', tools: { ...safeTools(row.tools), ...server.tools },
          ...(row.toolsError ? { toolsError: safeText(row.toolsError) } : {}),
        };
      });
      if (!this._closed && generation === this._generation) {
        this.state = { status: 'ready', servers, updatedAt: Date.now() };
        this._changed();
      }
    } catch (error) {
      if (!this._closed && generation === this._generation) {
        this.state = { status: 'error', servers: this._baseServers(), error: safeText(error?.message || 'Could not inspect MCP servers.'), updatedAt: Date.now() };
        this._changed();
      }
    } finally { if (threadId) await this._unsubscribe(threadId); }
    return this.state;
  }

  invalidate() {
    if (this._closed) return;
    this._generation++;
    this._refresh = null;
    this.state = { status: 'ready', servers: this._baseServers() };
    this._changed();
  }

  async login(id, workspace) {
    this._assertOpen();
    const server = this._records().find(server => server.id === id);
    if (!server || server.transport !== 'http' || !this._enabled(server)) throw new Error('Enable an HTTP MCP server before signing in.');
    if (this._logins.has(server.name)) throw new Error('Sign-in is already in progress for this MCP server.');
    const login = { name: server.name, threadId: null, timer: null };
    this._logins.set(server.name, login);
    try {
      login.threadId = await this._startThread(workspace, this.config());
      const response = await this.client.request('mcpServer/oauth/login', { name: server.name, threadId: login.threadId, timeoutSecs: 120 }, 30000);
      const url = new URL(response?.authorizationUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The MCP server returned an invalid HTTPS sign-in URL.');
      if (this._closed) throw new Error('Extension runtime is closed.');
      if (this._logins.get(server.name) === login) {
        login.timer = setTimeout(() => {
          if (this._logins.get(server.name) === login) this._logins.delete(server.name);
          this._unsubscribe(login.threadId).catch(() => {});
        }, 130000);
        login.timer.unref?.();
      }
      return { authorizationUrl: url.href };
    } catch (error) {
      if (this._logins.get(server.name) === login) this._logins.delete(server.name);
      clearTimeout(login.timer);
      if (login.threadId) await this._unsubscribe(login.threadId);
      throw new Error(safeText(error?.message || 'MCP sign-in failed.'));
    }
  }
  async _completeLogin(params) {
    const login = this._logins.get(params?.name);
    if (!login || !login.threadId || (params.threadId && params.threadId !== login.threadId)) return;
    this._logins.delete(login.name);
    clearTimeout(login.timer);
    if (!this._closed) {
      this.state = { ...this.state, servers: this.state.servers.map(server => {
        if (server.name !== login.name) return server;
        const next = { ...server, authStatus: params.success === true ? 'oAuth' : 'notLoggedIn' };
        delete next.toolsError;
        if (params.success !== true && params.error) next.toolsError = safeText(params.error);
        return next;
      }), updatedAt: Date.now() };
      this._changed();
    }
    await this._unsubscribe(login.threadId);
  }
  async close() {
    if (this._closed) return;
    this._closed = true;
    this._generation++;
    this.client.removeListener('notification', this._onNotification);
    for (const login of this._logins.values()) clearTimeout(login.timer);
    this._logins.clear();
    await Promise.all([...this._threads].map(threadId => this._unsubscribe(threadId)));
  }
}

module.exports = { ExtensionRuntime };
