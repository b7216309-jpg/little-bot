'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sourceRoot = process.env.LITTLE_BOT_TEST_SOURCE_ROOT || path.join(__dirname, '..', 'src');
const { Controller } = require(path.join(sourceRoot, 'controller.cjs'));
const { Store } = require(path.join(sourceRoot, 'store.cjs'));
class FakeClient extends EventEmitter {
  constructor() { super(); this.calls = []; this.responses = []; this.hooks = new Map(); this.serial = 0; this.closed = false; }
  async start() {}
  async close() { this.closed = true; }
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (this.hooks.has(method)) return this.hooks.get(method)(params);
    switch (method) {
      case 'account/read': return { account: { type: 'chatgpt' } };
      case 'model/list': return { data: [{ model: 'test-model', displayName: 'Test model', isDefault: true }] };
      case 'thread/start': return { thread: { id: 'thread-1' } };
      case 'thread/resume': return { thread: { id: params.threadId } };
      case 'turn/start': return { turn: { id: `turn-${++this.serial}`, status: 'inProgress' } };
      case 'thread/compact/start': case 'turn/interrupt': case 'thread/unsubscribe': return {};
      default: throw new Error(`Unexpected fake RPC: ${method}`);
    }
  }
  async respond(id, result) { this.responses.push({ id, result }); }
  async reject() {}
  notice(method, params) { this.emit('notification', method, params); }
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-compaction-'));
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  Object.assign(store.data.settings, { connection: 'codex', model: 'test-model', codexModel: 'test-model', workspace: root, effort: 'low' });
  const client = new FakeClient();
  const controller = new Controller({ store, client, ...options });
  await controller.start();
  t.after(async () => { await controller.close(); await rm(root, { recursive: true, force: true }); });
  const chat = controller.chat((await controller.send({ text: 'Help with the project' })).chatId);
  client.notice('item/completed', { threadId: chat.threadId, turnId: 'turn-1', item: { type: 'agentMessage', id: 'answer', text: 'Start with the README.', phase: 'final_answer' } });
  client.notice('turn/completed', { threadId: chat.threadId, turn: { id: 'turn-1', status: 'completed' } });
  return { root, filePath, store, client, controller, chat };
}
function started(client, chat, turnId = 'compact-1') { client.notice('turn/started', { threadId: chat.threadId, turn: { id: turnId, status: 'inProgress' } }); }
function item(client, chat, completed = false, id = 'compaction-item', turnId = 'compact-1') { client.notice(completed ? 'item/completed' : 'item/started', { threadId: chat.threadId, turnId, item: { type: 'contextCompaction', id } }); }
function finished(client, chat, status = 'completed', turnId = 'compact-1', error = undefined) { client.notice('turn/completed', { threadId: chat.threadId, turn: { id: turnId, status, error } }); }

for (const subscribed of [true, false]) test(`compaction switches IQ2_XS to IQ3_S with full native history (${subscribed ? 'subscribed' : 'after restart'})`, async t => {
  const { controller, client, chat, store } = await fixture(t);
  const baseUrl = 'http://127.0.0.1:8080/v1';
  Object.assign(chat, { connection: 'local', localBaseUrl: baseUrl, model: 'qwen3.8-flash-next-iq2_xs' });
  Object.assign(store.data.settings, { connection: 'local', localBaseUrl: baseUrl, model: 'qwen3.8-flash-next-iq3_s', localModel: 'qwen3.8-flash-next-iq3_s', effort: 'high' });
  controller.models = [{ id: store.data.settings.model }];
  controller.connection = { adapter: 'strata', contextWindow: 262144 };
  await controller.localModelRelay.start();
  if (!subscribed) controller.resumed.clear();
  const threadId = chat.threadId, transcript = structuredClone(chat.messages);
  const before = client.calls.length;
  await controller.compact({ chatId: chat.id });
  const calls = client.calls.slice(before);
  assert.deepEqual(calls.map(call => call.method), [...(subscribed ? ['thread/unsubscribe'] : []), 'thread/resume', 'thread/compact/start']);
  const resume = calls.find(call => call.method === 'thread/resume').params;
  assert.equal(resume.threadId, threadId);
  assert.equal(resume.model, 'qwen3.8-flash-next-iq3_s');
  assert.equal(resume.config.model_reasoning_effort, 'high');
  assert.equal(resume.config.model_context_window, 262144);
  started(client, chat); item(client, chat, true); finished(client, chat);
  assert.equal(chat.compaction.count, 1);
  assert.equal(chat.threadId, threadId);
  assert.equal(chat.model, store.data.settings.model);
  assert.deepEqual(chat.messages, transcript);
  await controller.send({ text: 'Continue after switching quantization.' });
  assert.equal(chat.threadId, threadId);
  assert.equal(client.calls.at(-1).params.model, store.data.settings.model);
  assert.equal(client.calls.slice(before).some(call => call.method === 'thread/start'), false);
});

test('failed model reload keeps the original conversation binding and releases compaction', async t => {
  const { controller, client, chat, store } = await fixture(t);
  store.data.settings.model = 'new-model';
  client.hooks.set('thread/resume', () => { throw new Error('Reload failed'); });
  await assert.rejects(controller.compact({ chatId: chat.id }), /Reload failed/);
  assert.equal(chat.model, 'test-model');
  assert.equal(chat.status, 'idle');
  assert.equal(client.calls.some(call => call.method === 'thread/compact/start'), false);
});
