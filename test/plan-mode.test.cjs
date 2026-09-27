'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.responses = [];
    this.thread = 0;
    this.turn = 0;
  }
  async start() {}
  async close() {}
  async request(method, params = {}, timeoutMs) {
    this.calls.push({ method, params: structuredClone(params), timeoutMs });
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } };
    if (method === 'model/list') return { data: [{
      id: 'gpt-test', model: 'gpt-test', displayName: 'Test', isDefault: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
    }] };
    if (method === 'thread/start') return { thread: { id: `thread-${++this.thread}` } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'thread/unsubscribe') return {};
    if (method === 'turn/start') return { turn: { id: `turn-${++this.turn}`, status: 'inProgress' } };
    if (method === 'turn/interrupt') return {};
    throw new Error(`Unexpected request: ${method}`);
  }
  async respond(id, result) { this.responses.push({ id, result: structuredClone(result) }); }
  async reject(id, message, code = -32601) { throw new Error(`Unexpected reject ${id}: ${message} (${code})`); }
  notice(method, params) { this.emit('notification', method, params); }
  ask(id, method, params) { this.emit('request', { id, method, params }); }
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-plan-mode-'));
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  Object.assign(store.data.settings, {
    connection: 'codex',
    model: 'gpt-test',
    codexModel: 'gpt-test',
    workspace: root,
    effort: 'low',
  });
  const client = new FakeClient();
  const controller = new Controller({ store, client });
  await controller.start();
  t.after(async () => {
    await controller.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, filePath, store, client, controller };
}

function finish(client, chat, id = 'turn-1') {
  client.notice('turn/completed', { threadId: chat.threadId, turn: { id, status: 'completed' } });
}

test('Plan mode wraps the editable prompt and runs read-only with no approval interruptions', async t => {
  const { controller, client } = await fixture(t);
  const custom = 'My exact custom assistant prompt.';
  controller.saveSettings({ systemPrompt: custom });

  let readOnlySpecs = null;
  controller.agentTools = {
    specs(options) { readOnlySpecs = options?.readOnly; return []; },
    async call() { throw new Error('Plan test should not call a mutating app tool.'); },
  };

  const { chatId } = await controller.send({ text: 'Plan a refactor.', mode: 'plan' });
  const chat = controller.chat(chatId);
  const thread = client.calls.find(call => call.method === 'thread/start').params;
  const turn = client.calls.find(call => call.method === 'turn/start').params;

  assert.equal(chat.mode, 'plan');
  assert.equal(readOnlySpecs, true);
  assert.equal(thread.approvalPolicy, 'never');
  assert.equal(thread.sandbox, 'read-only');
  assert.ok(thread.developerInstructions.startsWith(custom));
  assert.match(thread.developerInstructions, /<collaboration_mode>Plan<\/collaboration_mode>/);
  assert.match(thread.developerInstructions, /Do not edit files/);
  assert.equal(turn.approvalPolicy, 'never');
  assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly' });
  assert.match(turn.input[0].text, /Shell conduct for Windows CMD and PowerShell/);
});

test('Plan mode rejects unexpected mutation and external-interaction requests without showing approval UI', async t => {
  const { controller, client } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Plan only.', mode: 'plan' });
  const chat = controller.chat(chatId);

  client.ask('command', 'item/commandExecution/requestApproval', { threadId: chat.threadId, turnId: 'turn-1', itemId: 'cmd', command: 'echo hi > file.txt' });
  client.ask('file', 'item/fileChange/requestApproval', { threadId: chat.threadId, turnId: 'turn-1', itemId: 'file', reason: 'write' });
  client.ask('perm', 'item/permissions/requestApproval', { threadId: chat.threadId, turnId: 'turn-1', itemId: 'perm', permissions: { network: { enabled: true } } });
  client.ask('mcp', 'mcpServer/elicitation/request', { threadId: chat.threadId, serverName: 'external', message: 'Need input' });
  client.ask('tool', 'item/tool/call', { threadId: chat.threadId, turnId: 'turn-1', callId: 'call-1', tool: 'attachment_send', arguments: { path: 'x.txt' } });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(client.responses.slice(-5), [
    { id: 'command', result: { decision: 'decline' } },
    { id: 'file', result: { decision: 'decline' } },
    { id: 'perm', result: { permissions: {}, scope: 'turn' } },
    { id: 'mcp', result: { action: 'decline', content: null } },
    { id: 'tool', result: { success: false, contentItems: [{ type: 'inputText', text: 'This app tool is unavailable in Plan mode.' }] } },
  ]);
  assert.equal(controller.state().approvals.length, 0);
  assert.equal(chat.status, 'running');
});

test('switching from Plan back to Execute restores exact custom prompt and unrestricted execution', async t => {
  const { controller, client } = await fixture(t);
  const custom = 'My execute-mode custom prompt stays exact.';
  controller.saveSettings({ systemPrompt: custom });

  const { chatId } = await controller.send({ text: 'Plan it.', mode: 'plan' });
  const chat = controller.chat(chatId);
  finish(client, chat);

  await controller.send({ chatId, text: 'Now execute it.', mode: 'execute' });

  const unsubscribe = client.calls.find(call => call.method === 'thread/unsubscribe');
  const resume = client.calls.find(call => call.method === 'thread/resume');
  const turns = client.calls.filter(call => call.method === 'turn/start');

  assert.ok(unsubscribe);
  assert.ok(resume);
  assert.equal(resume.params.sandbox, 'danger-full-access');
  assert.equal(resume.params.approvalPolicy, 'never');
  assert.equal(resume.params.developerInstructions, custom);
  assert.equal(turns.at(-1).params.approvalPolicy, 'never');
  assert.deepEqual(turns.at(-1).params.sandboxPolicy, { type: 'dangerFullAccess' });
  assert.match(turns.at(-1).params.input[0].text, /Shell conduct for Windows CMD and PowerShell/);
  assert.equal(controller.chat(chatId).mode, 'execute');
});

test('conversation Plan mode persists and current renderer exposes the toggle without dropping merged UI features', async t => {
  const { controller, client, store, filePath, root } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Plan this.', mode: 'plan' });
  const chat = controller.chat(chatId);
  finish(client, chat);
  store.flush();

  const restored = new Store({ filePath, defaultWorkspace: root }).data.chats.find(item => item.id === chatId);
  assert.equal(restored.mode, 'plan');

  const html = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(html, /id="plan-mode-toggle"/);
  assert.match(app, /const mode = currentPlanMode\(\) \? 'plan' : 'execute'/);
  assert.match(app, /attachmentIds, mode/);
  assert.match(app, /message\.kind === 'plan'/);
  assert.match(app, /LittleBotActionGroups\.groupConversation/);
  assert.match(app, /captureChatScroll/);
  assert.match(app, /taskSummaryNode/);
  assert.match(app, /renderSystemPromptSettings/);
  assert.match(app, /reportRendererError/);
});

test('Execute mode still auto-accepts routine command approvals after leaving Plan', async t => {
  const { controller, client } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Plan first.', mode: 'plan' });
  const chat = controller.chat(chatId);
  finish(client, chat);
  await controller.send({ chatId, text: 'Execute now.', mode: 'execute' });

  client.ask('command', 'item/commandExecution/requestApproval', {
    threadId: chat.threadId, turnId: 'turn-2', itemId: 'cmd', command: 'whoami',
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(client.responses.at(-1), { id: 'command', result: { decision: 'accept' } });
  assert.equal(controller.state().approvals.length, 0);
});
