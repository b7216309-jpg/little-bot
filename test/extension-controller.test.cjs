'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm, readFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');
const { ExtensionRuntime } = require('../src/extension-runtime.cjs');

class FakeClient extends EventEmitter {
  constructor() { super(); this.calls = []; this.responses = []; this.rejections = []; this.hooks = new Map(); this.nextThread = 0; this.nextTurn = 0; }
  async start() {}
  async close() {}
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (this.hooks.has(method)) return this.hooks.get(method)(params);
    switch (method) {
      case 'account/read': return { account: { type: 'chatgpt' } };
      case 'model/list': return { data: [{ model: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: true }] };
      case 'thread/start': return { thread: { id: `thread-${++this.nextThread}` } };
      case 'thread/resume': return { thread: { id: params.threadId } };
      case 'thread/unsubscribe': return { status: 'unsubscribed' };
      case 'turn/start': return { turn: { id: `turn-${++this.nextTurn}`, status: 'inProgress' } };
      case 'turn/interrupt': return {};
      case 'config/read': return { config: {} };
      case 'mcpServerStatus/list': return { data: [], nextCursor: null };
      default: throw new Error(`Unexpected fake RPC: ${method}`);
    }
  }
  async respond(id, result) { this.responses.push({ id, result: structuredClone(result) }); }
  async reject(id, message) { this.rejections.push({ id, message }); }
  notice(method, params) { this.emit('notification', method, params); }
}

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-extensions-controller-'));
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  const client = new FakeClient();
  const controller = new Controller({ store, client });
  controller.extensionRuntime = new ExtensionRuntime({ store, client });
  await controller.start();
  t.after(async () => { await controller.close(); await rm(root, { recursive: true, force: true }); });
  return { root, filePath, store, client, controller };
}
function addServer(store, overrides = {}) {
  const server = { id: 'test-server', name: 'workspace_tools', transport: 'stdio', command: 'node', args: ['server.cjs'], envVars: ['WORKSPACE_TOKEN'], enabled: true, disabledTools: ['delete'], ...overrides };
  store.data.extensions.servers.push(server);
  return server;
}
function addSkill(store, overrides = {}) {
  const skill = { id: 'skill-id', name: 'inspect', description: 'Inspect a request.', content: 'First identify the inputs. Then produce a compact table.', enabled: true, ...overrides };
  store.data.extensions.skills.push(skill);
  return skill;
}
async function begin(controller, text = 'Use the connected workspace tools') { return controller.chat((await controller.send({ text })).chatId); }
async function until(predicate) {
  for (let i = 0; i < 50; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); }
  assert.fail('Expected controller event did not occur.');
}
function complete(client, threadId, text = 'Done', turnId = 'turn-1') {
  client.notice('item/completed', { threadId, item: { id: `final-${turnId}`, type: 'agentMessage', text, phase: 'final_answer' } });
  client.notice('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
}

test('normal chat uses native MCP config and injects only explicitly selected enabled skills', async t => {
  const { controller, client, store } = await setup(t);
  addServer(store);
  addSkill(store);
  addSkill(store, { id: 'unused', name: 'unused', content: 'UNSELECTED_SKILL_BODY' });
  const chat = await begin(controller, '$inspect check this request');
  const thread = client.calls.find(call => call.method === 'thread/start').params;
  assert.equal(thread.config['mcp_servers.workspace_tools'].enabled, true);
  assert.equal(thread.config['mcp_servers.workspace_tools'].default_tools_approval_mode, 'prompt');
  assert.deepEqual(thread.config['mcp_servers.workspace_tools'].disabled_tools, ['delete']);
  assert.deepEqual(thread.config['mcp_servers.workspace_tools'].env_vars, ['WORKSPACE_TOKEN']);
  assert.equal(thread.config['features.apps'], false);
  assert.equal(thread.config['features.plugins'], false);
  const input = client.calls.find(call => call.method === 'turn/start').params.input[0].text;
  assert.match(input, /First identify the inputs\. Then produce a compact table\./);
  assert.match(input, /Current user request:\n\$inspect check this request/);
  assert.ok(!input.includes('UNSELECTED_SKILL_BODY'));
  assert.equal(chat.messages[0].text, '$inspect check this request');
  assert.ok(!JSON.stringify(chat.messages).includes('First identify the inputs'));
});

test('disabled skills or plugin owners fail before creating a conversation or making engine requests', async t => {
  const { controller, client, store } = await setup(t);
  addSkill(store, { enabled: false });
  const before = client.calls.length;
  await assert.rejects(controller.send({ text: '$inspect do the review' }), /Enable the inspect skill/);
  store.data.extensions.skills[0].enabled = true;
  store.data.extensions.skills[0].pluginId = 'plugin-off';
  store.data.extensions.plugins.push({ id: 'plugin-off', enabled: false });
  await assert.rejects(controller.send({ text: '$inspect do the review' }), /Enable the inspect skill/);
  assert.equal(store.data.chats.length, 0);
  assert.equal(client.calls.length, before);
});

test('heartbeat applies effective MCP disablement and verifies the same thread before starting its turn', async t => {
  const { controller, client, store, root } = await setup(t);
  addServer(store);
  addSkill(store, { content: 'FOREGROUND_ONLY_SKILL' });
  client.hooks.set('config/read', () => ({ config: { mcp_servers: { 'foreign.with.dot': { command: 'native', enabled: true } } } }));
  client.hooks.set('mcpServerStatus/list', () => ({ data: [{ name: 'foreign.with.dot', runtimeStatus: 'disabled', tools: {} }, { name: 'workspace_tools', runtimeStatus: 'disabled', tools: {} }], nextCursor: null }));
  const run = controller.runHeartbeat({ workspace: root, checklist: '$inspect check for meaningful changes', model: 'gpt-6-sol' });
  await until(() => client.calls.some(call => call.method === 'turn/start'));
  const methods = client.calls.map(call => call.method);
  assert.ok(methods.indexOf('config/read') < methods.indexOf('thread/start'));
  assert.ok(methods.indexOf('thread/start') < methods.indexOf('mcpServerStatus/list'));
  assert.ok(methods.indexOf('mcpServerStatus/list') < methods.indexOf('turn/start'));
  const started = client.calls.find(call => call.method === 'thread/start').params;
  assert.equal(started.ephemeral, true);
  assert.equal(started.approvalPolicy, 'never');
  assert.equal(started.config.mcp_servers['foreign.with.dot'].enabled, false);
  assert.equal(started.config.mcp_servers.workspace_tools.enabled, false);
  assert.equal(started.config['features.apps'], false);
  const turn = client.calls.find(call => call.method === 'turn/start').params;
  assert.equal(client.calls.find(call => call.method === 'mcpServerStatus/list').params.threadId, turn.threadId);
  assert.ok(!turn.input[0].text.includes('FOREGROUND_ONLY_SKILL'));
  complete(client, turn.threadId, '{"status":"quiet","summary":""}');
  assert.deepEqual(await run, { status: 'quiet', summary: '', actions: [] });
  assert.equal(client.calls.at(-1).method, 'thread/unsubscribe');
  assert.equal(store.data.chats.length, 0);
});

test('heartbeat verification failure unloads context and prevents every model turn', async t => {
  const { controller, client, root, store } = await setup(t);
  client.hooks.set('mcpServerStatus/list', () => ({ data: [{ name: 'leaked', runtimeStatus: 'connected', tools: {} }], nextCursor: null }));
  await assert.rejects(controller.runHeartbeat({ workspace: root, checklist: 'Check the folder' }), /isolation failed/);
  assert.equal(client.calls.some(call => call.method === 'turn/start'), false);
  assert.equal(client.calls.at(-1).method, 'thread/unsubscribe');
  assert.equal(controller.heartbeatChat, null);
  assert.equal(store.data.chats.length, 0);
});

test('MCP form approval converts typed content, rejects invalid input, and never persists secret answers', async t => {
  const { controller, client, store, filePath } = await setup(t);
  const chat = await begin(controller);
  const params = { threadId: chat.threadId, serverName: 'workspace_tools', mode: 'form', message: 'Confirm the connection settings.', requestedSchema: {
    type: 'object', properties: {
      api_token: { type: 'string', title: 'API token' },
      enabled: { type: 'boolean' }, count: { type: 'integer', minimum: 1, maximum: 10 },
      ratio: { type: 'number' }, mode: { type: 'string', enum: ['brief', 'full'] }, tags: { type: 'array', items: { type: 'string' } },
    }, required: ['api_token', 'enabled', 'count'],
  } };
  await controller.serverRequest({ id: 44, method: 'mcpServer/elicitation/request', params });
  const approval = controller.state().approvals[0];
  assert.equal(approval.kind, 'mcp');
  assert.equal(approval.questions.find(question => question.id === 'api_token').isSecret, true);
  assert.equal(approval.rpcId, undefined);
  assert.equal(approval.params, undefined);
  const answer = value => ({ answers: [value] });
  await assert.rejects(controller.respondApproval({ requestId: approval.requestId, decision: 'accept', answers: { api_token: answer('private-user-answer'), enabled: answer('true'), count: answer('1.5') } }), /numeric range/);
  assert.equal(client.responses.length, 0);
  assert.equal(controller.approvals.size, 1);
  await controller.respondApproval({ requestId: approval.requestId, decision: 'accept', answers: {
    api_token: answer('private-user-answer'), enabled: answer('true'), count: answer('3'), ratio: answer('0.5'), mode: answer('brief'), tags: answer('["one","two"]'), unrequested: answer('ignored-answer'),
  } });
  assert.deepEqual(client.responses[0], { id: 44, result: { action: 'accept', content: { api_token: 'private-user-answer', enabled: true, count: 3, ratio: 0.5, mode: 'brief', tags: ['one', 'two'] } } });
  assert.equal(controller.approvals.size, 0);
  assert.equal(chat.status, 'running');
  complete(client, chat.threadId);
  store.flush();
  const persisted = await readFile(filePath, 'utf8');
  assert.ok(!persisted.includes('private-user-answer'));
  assert.ok(!persisted.includes('ignored-answer'));
  assert.ok(!JSON.stringify(controller.state()).includes('private-user-answer'));
});

test('MCP decline and unsupported forms return native decline without retaining a response', async t => {
  const { controller, client } = await setup(t);
  const chat = await begin(controller);
  const params = { threadId: chat.threadId, serverName: 'workspace_tools', mode: 'form', requestedSchema: { type: 'object', properties: { note: { type: 'string' } } } };
  await controller.serverRequest({ id: 1, method: 'mcpServer/elicitation/request', params });
  await controller.respondApproval({ requestId: controller.state().approvals[0].requestId, decision: 'decline', answers: { note: { answers: ['must-not-be-sent'] } } });
  assert.deepEqual(client.responses[0], { id: 1, result: { action: 'decline', content: null } });
  await controller.serverRequest({ id: 2, method: 'mcpServer/elicitation/request', params: { ...params, requestedSchema: { type: 'object', properties: { nested: { type: 'object' } } } } });
  assert.deepEqual(client.responses[1], { id: 2, result: { action: 'decline', content: null } });
  assert.equal(controller.approvals.size, 0);
  assert.ok(!JSON.stringify(chat).includes('must-not-be-sent'));
});

test('MCP tool results become bounded persisted tool messages and exclude nontext payloads', async t => {
  const { controller, client, store, root, filePath } = await setup(t);
  const chat = await begin(controller);
  client.notice('item/started', { threadId: chat.threadId, item: { id: 'mcp-1', type: 'mcpToolCall', server: 'workspace_tools', tool: 'read', arguments: { path: 'notes.txt' }, status: 'inProgress' } });
  client.notice('item/completed', { threadId: chat.threadId, item: { id: 'mcp-1', type: 'mcpToolCall', server: 'workspace_tools', tool: 'read', arguments: { path: 'notes.txt' }, result: { content: [{ type: 'text', text: 'The project has three tasks.' }, { type: 'image', data: 'RAW_IMAGE_PAYLOAD', mimeType: 'image/png' }], structuredContent: { omitted: 'RAW_STRUCTURED_PAYLOAD' } }, status: 'completed' } });
  const message = chat.messages.find(message => message.id === 'mcp-1');
  assert.equal(message.role, 'tool');
  assert.equal(message.kind, 'mcp');
  assert.equal(message.status, 'completed');
  assert.match(message.text, /workspace_tools \/ read/);
  assert.match(message.text, /notes\.txt/);
  assert.match(message.text, /The project has three tasks/);
  complete(client, chat.threadId);
  store.flush();
  const restored = new Store({ filePath, defaultWorkspace: root }).data.chats[0];
  assert.deepEqual(restored.messages.find(message => message.id === 'mcp-1'), message);
  assert.ok(!JSON.stringify(restored).includes('RAW_IMAGE_PAYLOAD'));
  assert.ok(!JSON.stringify(restored).includes('RAW_STRUCTURED_PAYLOAD'));
});

test('heartbeat MCP elicitation is declined without an approval UI or saved conversation', async t => {
  const { controller, client, root, store } = await setup(t);
  const run = controller.runHeartbeat({ workspace: root, checklist: 'Check for changes' });
  await until(() => client.calls.some(call => call.method === 'turn/start'));
  const threadId = client.calls.find(call => call.method === 'turn/start').params.threadId;
  await controller.serverRequest({ id: 99, method: 'mcpServer/elicitation/request', params: { threadId, serverName: 'unexpected', mode: 'form', requestedSchema: { type: 'object', properties: { token: { type: 'string' } } } } });
  assert.deepEqual(client.responses[0], { id: 99, result: { action: 'decline', content: null } });
  assert.equal(controller.approvals.size, 0);
  complete(client, threadId, '{"status":"quiet","summary":""}');
  await run;
  assert.equal(store.data.chats.length, 0);
});
