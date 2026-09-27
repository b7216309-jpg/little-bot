'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ExtensionRuntime } = require('../src/extension-runtime.cjs');

const workspace = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const server = (overrides = {}) => ({ id: 'local-id', name: 'local', transport: 'stdio', command: 'node', args: ['fixture.cjs'], envVars: ['MCP_TOKEN'], disabledTools: [], enabled: true, ...overrides });
const remote = (overrides = {}) => server({ id: 'remote-id', name: 'remote', transport: 'http', url: 'https://mcp.example.test/api', bearerTokenEnvVar: 'REMOTE_TOKEN', ...overrides });

class FakeClient extends EventEmitter {
  constructor(handler = () => undefined) { super(); this.handler = handler; this.calls = []; this.serial = 0; }
  async request(method, params, timeout) {
    this.calls.push({ method, params, timeout });
    const custom = await this.handler(method, params, timeout);
    if (custom !== undefined) return custom;
    if (method === 'thread/start') return { thread: { id: `probe-${++this.serial}` } };
    if (method === 'thread/unsubscribe') return { status: 'unsubscribed' };
    if (method === 'mcpServerStatus/list') return { data: [], nextCursor: null };
    if (method === 'config/read') return { config: {} };
    if (method === 'mcpServer/oauth/login') return { authorizationUrl: 'https://identity.example.test/authorize?state=private-session' };
    throw new Error(`Unexpected RPC ${method}`);
  }
}

function fixture(t, { servers = [server()], plugins = [], handler, onChange } = {}) {
  const store = { data: { extensions: { servers, plugins } } };
  const client = new FakeClient(handler);
  const runtime = new ExtensionRuntime({ store, client, onChange });
  t.after(() => runtime.close());
  return { store, client, runtime };
}

test('thread config maps both transports, only environment names, and effective plugin enablement', t => {
  const { runtime } = fixture(t, { servers: [server({ disabledTools: ['remove'] }), remote(), server({ id: 'plugin-off', name: 'plugin_off', pluginId: 'off' }), server({ id: 'missing', name: 'missing', pluginId: 'gone' }), server({ id: 'plugin-on', name: 'plugin_on', pluginId: 'on' })], plugins: [{ id: 'off', enabled: false }, { id: 'on', enabled: true }] });
  const config = runtime.config();
  assert.deepEqual(config['mcp_servers.local'], {
    command: 'node', args: ['fixture.cjs'], env_vars: ['MCP_TOKEN'], enabled: true,
    default_tools_approval_mode: 'prompt', disabled_tools: ['remove'], required: false, startup_timeout_sec: 8, tool_timeout_sec: 60,
  });
  assert.equal(config['mcp_servers.remote'].url, 'https://mcp.example.test/api');
  assert.equal(config['mcp_servers.remote'].bearer_token_env_var, 'REMOTE_TOKEN');
  assert.equal(config['mcp_servers.remote'].command, undefined);
  assert.equal(config['mcp_servers.plugin_off'].enabled, false);
  assert.equal(config['mcp_servers.missing'].enabled, false);
  assert.equal(config['mcp_servers.plugin_on'].enabled, true);
  assert.equal(config['features.apps'], false);
  assert.equal(config['features.plugins'], false);
  assert.ok(Object.entries(runtime.config({ heartbeat: true })).filter(([key]) => key.startsWith('mcp_servers.')).every(([, value]) => value.enabled === false));
  config['mcp_servers.local'].args.push('mutated');
  assert.deepEqual(runtime.config()['mcp_servers.local'].args, ['fixture.cjs']);
});

test('disabled tool names remain visible through invalidation, filtered native discovery, and re-enable', async t => {
  const { runtime, store } = fixture(t, { servers: [server({ disabledTools: ['remove'] })], handler: method => method === 'mcpServerStatus/list' ? { data: [{ name: 'local', runtimeStatus: 'connected', authStatus: 'unsupported', tools: { read: { description: 'Read only.', inputSchema: { type: 'object' } } } }], nextCursor: null } : undefined });
  const placeholder = { name: 'remove', description: 'Disabled in Little Bot. Re-enable and refresh to inspect.' };
  assert.deepEqual(runtime.state.servers[0].tools.remove, placeholder);
  assert.deepEqual((await runtime.refresh(workspace)).servers[0].tools.remove, placeholder);
  assert.equal(runtime.state.servers[0].tools.read.description, 'Read only.');
  runtime.invalidate();
  assert.deepEqual(runtime.state.servers[0].tools, { remove: placeholder });
  store.data.extensions.servers[0].enabled = false;
  runtime.invalidate();
  assert.deepEqual((await runtime.refresh(workspace)).servers[0].tools.remove, placeholder);
  store.data.extensions.servers[0].disabledTools = [];
  runtime.invalidate();
  assert.equal(runtime.state.servers[0].tools.remove, undefined);
  assert.deepEqual(runtime.config()['mcp_servers.local'].disabled_tools, []);
});

test('heartbeat disables all effective servers including dotted names and strips native null values', async t => {
  const effective = { 'extra.with.dot': { command: 'node', args: ['native.cjs'], enabled: true, tool_timeout_sec: null, nested: { optional: null, valid: false } }, local: { command: 'old', enabled: true } };
  const { runtime, client } = fixture(t, { handler: method => method === 'config/read' ? { config: { mcp_servers: effective } } : undefined });
  const config = await runtime.heartbeatConfig(workspace);
  assert.deepEqual(client.calls, [{ method: 'config/read', params: { cwd: workspace, includeLayers: false }, timeout: undefined }]);
  assert.equal(config.mcp_servers['extra.with.dot'].enabled, false);
  assert.equal(config.mcp_servers['extra.with.dot'].tool_timeout_sec, undefined);
  assert.deepEqual(config.mcp_servers['extra.with.dot'].nested, { valid: false });
  assert.equal(config.mcp_servers.local.command, 'node');
  assert.equal(config.mcp_servers.local.enabled, false);
  assert.equal(config['features.apps'], false);
  assert.equal(effective['extra.with.dot'].enabled, true);
  assert.equal(effective['extra.with.dot'].tool_timeout_sec, null);
});

test('heartbeat effective config errors fail closed before thread or model calls', async t => {
  const { runtime, client } = fixture(t, { handler: method => method === 'config/read' ? { config: { mcp_servers: [] } } : undefined });
  await assert.rejects(runtime.heartbeatConfig(workspace), /Invalid effective/);
  assert.deepEqual(client.calls.map(call => call.method), ['config/read']);
});

test('heartbeat verification checks every page and accepts only disabled empty inventory', async t => {
  const { runtime, client } = fixture(t, { handler: (method, params) => method === 'mcpServerStatus/list' ? { data: [{ name: params.cursor || 'first', runtimeStatus: 'disabled', tools: {} }], nextCursor: params.cursor ? null : 'page-two' } : undefined });
  assert.equal(await runtime.verifyHeartbeat('heartbeat'), true);
  assert.deepEqual(client.calls.map(call => call.params.cursor), [undefined, 'page-two']);
  assert.ok(client.calls.every(call => call.params.threadId === 'heartbeat'));
});

test('heartbeat rejects connected, starting, missing-status, and hidden nonempty tools on any page', async t => {
  for (const row of [{ runtimeStatus: 'connected', tools: {} }, { runtimeStatus: 'starting', tools: {} }, { tools: {} }, { runtimeStatus: 'disabled', tools: { write: {} } }]) {
    const { runtime } = fixture(t, { handler: (method, params) => method === 'mcpServerStatus/list' ? { data: params.cursor ? [row] : [{ runtimeStatus: 'disabled', tools: {} }], nextCursor: params.cursor ? null : 'two' } : undefined });
    await assert.rejects(runtime.verifyHeartbeat('heartbeat'), /isolation failed/);
  }
});

test('refresh paginates a private ephemeral thread and exposes bounded tool interfaces only', async t => {
  const changes = [];
  const malicious = { name: 'supplied-name', description: 'Read records using sk-secret_token and Bearer tokenvalue https://user:pass@example.test/a?access_token=x', inputSchema: { type: 'object', properties: { id: { type: 'string', default: 'raw-secret-default', examples: ['raw-example'], description: 'Identifier' } }, required: ['id'], additionalProperties: false, examples: ['raw-top'], 'x-extra': { token: 'hidden' } }, annotations: { readOnlyHint: true, destructiveHint: false, title: 'raw-annotation', injected: 'hidden' }, result: 'raw-output' };
  const { runtime, client } = fixture(t, { servers: [server(), remote({ enabled: false })], onChange: state => changes.push(state.status), handler: (method, params) => {
    if (method !== 'mcpServerStatus/list') return undefined;
    return params.cursor ? { data: [{ name: 'unmanaged', tools: { ignored: malicious }, runtimeStatus: 'connected' }], nextCursor: null } : { data: [{ name: 'local', runtimeStatus: 'connected', authStatus: 'unsupported', tools: { read: malicious }, httpOrigin: 'private', serverCapabilities: { secret: 'private' } }, { name: 'remote', runtimeStatus: 'connected', authStatus: 'oAuth', tools: { should_not_show: malicious } }], nextCursor: 'more' };
  } });
  const state = await runtime.refresh(workspace);
  assert.deepEqual(changes, ['syncing', 'ready']);
  assert.equal(state.status, 'ready');
  assert.equal(state.servers.length, 2);
  assert.deepEqual(Object.keys(state.servers[0]), ['id', 'name', 'transport', 'enabled', 'runtimeStatus', 'authStatus', 'tools']);
  const tool = state.servers[0].tools.read;
  assert.equal(tool.name, 'read');
  assert.deepEqual(tool.inputSchema.properties.id, { type: 'string', description: 'Identifier' });
  assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false });
  const serialized = JSON.stringify(state);
  for (const secret of ['secret_token', 'tokenvalue', 'user:pass', 'access_token=x', 'raw-secret-default', 'raw-example', 'raw-top', 'raw-output', 'raw-annotation', 'private']) assert.ok(!serialized.includes(secret), secret);
  assert.equal(state.servers[1].runtimeStatus, 'disabled');
  assert.deepEqual(state.servers[1].tools, {});
  const started = client.calls.find(call => call.method === 'thread/start').params;
  assert.equal(started.ephemeral, true);
  assert.equal(started.approvalPolicy, 'on-request');
  assert.equal(started.sandbox, 'workspace-write');
  assert.equal(started.cwd, workspace);
  assert.equal(started.model, undefined);
  assert.deepEqual(client.calls.at(-1), { method: 'thread/unsubscribe', params: { threadId: 'probe-1' }, timeout: 10000 });
  assert.ok(client.calls.every(call => !['turn/start', 'mcpServer/tool/call', 'config/value/write'].includes(call.method)));
});

test('refresh failures clear stale metadata, scrub errors and unsubscribe', async t => {
  const { runtime, client } = fixture(t, { handler: method => { if (method === 'mcpServerStatus/list') throw new Error('access_token=secret-value at https://service.test/path?token=private'); } });
  const state = await runtime.refresh(workspace);
  assert.equal(state.status, 'error');
  assert.match(state.error, /redacted/);
  assert.ok(!state.error.includes('secret-value'));
  assert.ok(!state.error.includes('?token='));
  assert.deepEqual(state.servers[0].tools, {});
  assert.equal(client.calls.at(-1).method, 'thread/unsubscribe');
});

test('repeated pagination cursors fail without an endless loop and unload context', async t => {
  const { runtime, client } = fixture(t, { handler: method => method === 'mcpServerStatus/list' ? { data: [], nextCursor: 'again' } : undefined });
  const state = await runtime.refresh(workspace);
  assert.equal(state.status, 'error');
  assert.match(state.error, /cursor/);
  assert.equal(client.calls.filter(call => call.method === 'mcpServerStatus/list').length, 2);
  assert.equal(client.calls.at(-1).method, 'thread/unsubscribe');
});

test('concurrent refresh shares one operation; invalidate prevents an old result replacing new configuration', async t => {
  const pending = deferred();
  const { runtime, store, client } = fixture(t, { handler: method => method === 'mcpServerStatus/list' ? pending.promise : undefined });
  const first = runtime.refresh(workspace);
  assert.equal(runtime.refresh(workspace), first);
  await tick();
  store.data.extensions.servers[0].enabled = false;
  runtime.invalidate();
  const callsBefore = client.calls.length;
  pending.resolve({ data: [{ name: 'local', runtimeStatus: 'connected', tools: { stale: {} } }], nextCursor: null });
  await first;
  assert.equal(runtime.state.status, 'ready');
  assert.equal(runtime.state.updatedAt, undefined);
  assert.equal(runtime.state.servers[0].runtimeStatus, 'disabled');
  assert.deepEqual(runtime.state.servers[0].tools, {});
  assert.equal(client.calls.length, callsBefore + 1);
});

test('closing while thread/start is pending unloads the newly returned context', async t => {
  const pending = deferred();
  const { runtime, client } = fixture(t, { handler: method => method === 'thread/start' ? pending.promise : undefined });
  const refreshing = runtime.refresh(workspace);
  await runtime.close();
  pending.resolve({ thread: { id: 'late-thread' } });
  await refreshing;
  assert.equal(client.listenerCount('notification'), 0);
  assert.deepEqual(client.calls.map(call => call.method), ['thread/start', 'thread/unsubscribe']);
  assert.equal(client.calls.at(-1).params.threadId, 'late-thread');
});

test('OAuth retains a scoped temporary thread, returns URL transiently, and cleans up on matching completion', async t => {
  const { runtime, client } = fixture(t, { servers: [remote()] });
  const result = await runtime.login('remote-id', workspace);
  assert.match(result.authorizationUrl, /^https:\/\//);
  assert.ok(!JSON.stringify(runtime.state).includes('private-session'));
  assert.equal(client.calls.at(-1).method, 'mcpServer/oauth/login');
  assert.deepEqual(client.calls.at(-1).params, { name: 'remote', threadId: 'probe-1', timeoutSecs: 120 });
  await assert.rejects(runtime.login('remote-id', workspace), /already in progress/);
  client.emit('notification', 'mcpServer/oauthLogin/completed', { name: 'remote', threadId: 'wrong-thread', success: true });
  await tick();
  assert.equal(client.calls.filter(call => call.method === 'thread/unsubscribe').length, 0);
  client.emit('notification', 'mcpServer/oauthLogin/completed', { name: 'remote', threadId: 'probe-1', success: true });
  await tick();
  assert.equal(runtime.state.servers[0].authStatus, 'oAuth');
  assert.equal(client.calls.at(-1).method, 'thread/unsubscribe');
});

test('OAuth failure or non-HTTPS URL unloads thread and sanitizes errors', async t => {
  for (const authorizationUrl of ['http://identity.example.test/login', 'https://user:secret@identity.example.test/login', 'not-a-url']) {
    const { runtime, client } = fixture(t, { servers: [remote()], handler: method => method === 'mcpServer/oauth/login' ? { authorizationUrl } : undefined });
    await assert.rejects(runtime.login('remote-id', workspace));
    assert.equal(client.calls.at(-1).method, 'thread/unsubscribe');
  }
  const { runtime, client } = fixture(t, { servers: [remote()] });
  await runtime.login('remote-id', workspace);
  client.emit('notification', 'mcpServer/oauthLogin/completed', { name: 'remote', success: false, error: 'secret=private-value' });
  await tick();
  assert.equal(runtime.state.servers[0].authStatus, 'notLoggedIn');
  assert.ok(!runtime.state.servers[0].toolsError.includes('private-value'));
  assert.equal(client.calls.at(-1).method, 'thread/unsubscribe');
});

test('OAuth completion can precede login response and runtime close cleans pending sign-ins', async t => {
  const pending = deferred();
  const { runtime, client } = fixture(t, { servers: [remote()], handler: method => method === 'mcpServer/oauth/login' ? pending.promise : undefined });
  const login = runtime.login('remote-id', workspace);
  await tick();
  client.emit('notification', 'mcpServer/oauthLogin/completed', { name: 'remote', threadId: 'probe-1', success: true });
  pending.resolve({ authorizationUrl: 'https://identity.example.test/login' });
  await login;
  await tick();
  assert.equal(client.calls.filter(call => call.method === 'thread/unsubscribe').length, 1);
  assert.equal(runtime._logins.size, 0);
  const second = fixture(t, { servers: [remote()] });
  await second.runtime.login('remote-id', workspace);
  await second.runtime.close();
  assert.equal(second.client.calls.at(-1).method, 'thread/unsubscribe');
  assert.equal(second.runtime._logins.size, 0);
});

test('disabled, missing and stdio servers cannot start OAuth and relative folders are rejected', async t => {
  const { runtime, client } = fixture(t, { servers: [server(), remote({ enabled: false })] });
  for (const id of ['missing', 'local-id', 'remote-id']) await assert.rejects(runtime.login(id, workspace), /Enable an HTTP/);
  await assert.rejects(runtime.heartbeatConfig('relative'), /absolute/);
  assert.throws(() => runtime.refresh('relative'), /absolute/);
  assert.deepEqual(client.calls, []);
});
