'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');

class FakeCodexClient extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.responses = [];
    this.threadNumber = 0;
    this.turnNumber = 0;
  }
  async start() {}
  async close() {}
  async request(method, params = {}, timeoutMs) {
    this.calls.push({ method, params: structuredClone(params), timeoutMs });
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } };
    if (method === 'model/list') return { data: [{ id: 'gpt-6-sol', model: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] };
    if (method === 'thread/start') return { thread: { id: `thread-${++this.threadNumber}` } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'turn/start') return { turn: { id: `turn-${++this.turnNumber}`, status: 'inProgress' } };
    if (method === 'turn/interrupt') return {};
    throw new Error(`Unexpected fake request: ${method}`);
  }
  async respond(id, result) { this.responses.push({ id, result: structuredClone(result) }); }
  async reject(id, message, code = -32601) { throw new Error(`Unexpected rejection ${id}: ${message} (${code})`); }
  ask(id, method, params) { this.emit('request', { id, method, params }); }
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-full-access-'));
  const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
  Object.assign(store.data.settings, {
    connection: 'codex',
    model: 'gpt-6-sol',
    codexModel: 'gpt-6-sol',
    workspace: root,
  });
  const client = new FakeCodexClient();
  const controller = new Controller({ store, client });
  await controller.start();
  t.after(async () => {
    await controller.close();
    await rm(root, { recursive: true, force: true });
  });
  return { controller, client };
}

test('foreground chat starts and turns run with never approvals and danger full access', async t => {
  const { controller, client } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Inspect and update anything needed.' });
  const chat = controller.chat(chatId);
  const thread = client.calls.find(call => call.method === 'thread/start').params;
  const turn = client.calls.find(call => call.method === 'turn/start').params;

  assert.equal(thread.approvalPolicy, 'never');
  assert.equal(thread.sandbox, 'danger-full-access');
  assert.equal(turn.approvalPolicy, 'never');
  assert.deepEqual(turn.sandboxPolicy, { type: 'dangerFullAccess' });
  assert.equal(chat.status, 'running');
});

test('command, file, and permission approval RPCs are accepted without entering waiting state', async t => {
  const { controller, client } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Do the work.' });
  const chat = controller.chat(chatId);
  const turnId = client.calls.find(call => call.method === 'turn/start').params.threadId ? 'turn-1' : 'turn-1';
  const permissions = { network: { enabled: true }, fileSystem: { write: [chat.workspace] } };

  client.ask('command', 'item/commandExecution/requestApproval', { threadId: chat.threadId, turnId, itemId: 'cmd', command: 'whoami' });
  client.ask('file', 'item/fileChange/requestApproval', { threadId: chat.threadId, turnId, itemId: 'file', reason: 'write' });
  client.ask('permissions', 'item/permissions/requestApproval', { threadId: chat.threadId, turnId, itemId: 'perm', permissions });

  assert.deepEqual(client.responses.slice(-3), [
    { id: 'command', result: { decision: 'accept' } },
    { id: 'file', result: { decision: 'accept' } },
    { id: 'permissions', result: { permissions, scope: 'turn' } },
  ]);
  assert.equal(controller.state().approvals.length, 0);
  assert.equal(chat.status, 'running');
});

test('a real user-input question still pauses and can be answered', async t => {
  const { controller, client } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Prepare a report.' });
  const chat = controller.chat(chatId);

  client.ask('question', 'item/tool/requestUserInput', {
    threadId: chat.threadId,
    turnId: 'turn-1',
    itemId: 'question',
    questions: [{ id: 'format', question: 'Which format?' }],
  });

  assert.equal(chat.status, 'waiting');
  const approval = controller.state().approvals[0];
  assert.equal(approval.kind, 'question');
  await controller.respondApproval({
    requestId: approval.requestId,
    decision: 'accept',
    answers: { format: { answers: ['Markdown'] } },
  });
  assert.deepEqual(client.responses.at(-1), { id: 'question', result: { answers: { format: { answers: ['Markdown'] } } } });
  assert.equal(chat.status, 'running');
});
