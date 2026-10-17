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
const { AgentTools } = require(path.join(sourceRoot, 'agent-tools.cjs'));
const { compactionConfig } = require(path.join(sourceRoot, 'compaction.cjs'));
const { fakeLocalServer } = require('./fake-local-server.cjs');

test('the compaction threshold applies when a turn ends and while it is still working', () => {
  assert.deepEqual(compactionConfig({}), { model_post_turn_compact_threshold_percent: 50 });
  assert.deepEqual(compactionConfig({}, 262144), { model_post_turn_compact_threshold_percent: 50, model_auto_compact_token_limit: 124518 });
  assert.deepEqual(compactionConfig({ autoCompactPercent: 45 }, 262144), { model_post_turn_compact_threshold_percent: 45, model_auto_compact_token_limit: 112066 });
  // 0 leaves only the engine's own hard limit.
  assert.deepEqual(compactionConfig({ autoCompactPercent: 0 }, 262144), { model_post_turn_compact_threshold_percent: 0 });
});

test('conversation threads get the mid-turn compaction limit from the loaded context window', async t => {
  const { controller, chat } = await fixture(t);
  const config = controller.threadOptions(chat, chat.workspace).config;
  assert.equal(config.model_post_turn_compact_threshold_percent, 50);
  assert.equal(config.model_auto_compact_token_limit, 124518);
});
test('local thread lesson blocks are bounded and frozen for the life of a thread', async t => {
  const { controller, chat } = await fixture(t);
  chat.model = 'mock-qwen';
  chat.threadId = null;
  controller.recordLesson('mock-qwen', 'test-path', 'Verify paths with workspace_list before using file tools.');
  const first = controller.threadOptions(chat, chat.workspace);
  assert.match(first.developerInstructions, /Lessons from this PC:/);
  assert.match(first.developerInstructions, /Verify paths with workspace_list/);
  assert.ok(chat.lessonBlock.length <= 1000);
  controller.recordLesson('mock-qwen', 'later-tool', 'Use the current tool schema for this action.');
  chat.threadId = 'local-thread';
  assert.equal(controller.threadOptions(chat, chat.workspace).developerInstructions, first.developerInstructions);
});
class FakeClient extends EventEmitter {
  constructor() { super(); this.calls = []; this.responses = []; this.hooks = new Map(); this.serial = 0; this.closed = false; this.restartCount = 0; }
  async start() {}
  async close() { this.closed = true; }
  async restart() { this.closed = false; this.restartCount++; return {}; }
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (this.hooks.has(method)) return this.hooks.get(method)(params);
    switch (method) {
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
  const server = await fakeLocalServer();
  const store = new Store({ filePath, defaultWorkspace: root });
  Object.assign(store.data.settings, { connection: 'local', localBaseUrl: server.url, model: 'test-model', localModel: 'test-model', workspace: root, effort: 'low' });
  const client = new FakeClient();
  const controller = new Controller({ store, client, ...options });
  await controller.start();
  t.after(async () => { await controller.close(); await server.close(); await rm(root, { recursive: true, force: true }); });
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
  const baseUrl = store.data.settings.localBaseUrl;
  Object.assign(chat, { connection: 'local', localBaseUrl: baseUrl, model: 'qwen3.8-flash-next-iq2_xs' });
  Object.assign(store.data.settings, { connection: 'local', localBaseUrl: baseUrl, model: 'qwen3.8-flash-next-iq2_xs', localModel: 'qwen3.8-flash-next-iq3_s', effort: 'high' });
  controller.models = [{ id: store.data.settings.localModel }];
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
  assert.equal(chat.model, store.data.settings.localModel);
  assert.deepEqual(chat.messages, transcript);
  await controller.send({ text: 'Continue after switching quantization.' });
  assert.equal(chat.threadId, threadId);
  assert.equal(client.calls.at(-1).params.model, store.data.settings.localModel);
  assert.equal(client.calls.slice(before).some(call => call.method === 'thread/start'), false);
});

test('failed model reload keeps the original conversation binding and releases compaction', async t => {
  const { controller, client, chat, store } = await fixture(t);
  Object.assign(store.data.settings, { model: 'new-model', localModel: 'new-model' });
  controller.models.push({ id: 'new-model' });
  client.hooks.set('thread/resume', () => { throw new Error('Reload failed'); });
  await assert.rejects(controller.compact({ chatId: chat.id }), /Reload failed/);
  assert.equal(chat.model, 'test-model');
  assert.equal(chat.status, 'idle');
  assert.equal(client.calls.some(call => call.method === 'thread/compact/start'), false);
});

test('a missing saved engine thread is replaced with recent chat history and the current message', async t => {
  const { controller, client, chat } = await fixture(t);
  controller.resumed.clear();
  client.hooks.set('thread/resume', () => { throw new Error('The saved engine conversation is missing.'); });
  const result = await controller.send({ chatId: chat.id, text: 'Continue from the saved conversation.' });
  assert.equal(result.chatId, chat.id);
  assert.equal(chat.status, 'running');
  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 2);
  const request = client.calls.filter(call => call.method === 'turn/start').at(-1).params;
  assert.match(request.input[0].text, /Recent conversation before this engine session/);
  assert.match(request.input[0].text, /Help with the project/);
  assert.match(request.input[0].text, /Start with the README/);
  assert.match(request.input[0].text, /Continue from the saved conversation/);
});

test('agent tool sources are normalized to one engine format', () => {
  const store = { data: { settings: {}, extensions: {} } };
  const tools = new AgentTools({ store, management: { specs: () => [{ type: 'legacy', name: 'legacy_tool', description: 'Legacy source', inputSchema: { type: 'object', properties: {} } }] } }).specs();
  assert.ok(tools.length > 1);
  assert.ok(tools.every(tool => tool.type === 'function' && tool.inputSchema));
});
test('local argument normalization records one model-specific imperative lesson', async t => {
  const { controller, store, chat } = await fixture(t);
  const tools = new AgentTools({ store, controller, manageCalendar: async () => ({ events: [] }) });
  await tools.call('calendar_list', { limit: '5' }, { chat: { id: chat.id, connection: 'local', model: 'mock-qwen', workspace: chat.workspace, messages: [] } });
  const entries = store.data.lessons.models['mock-qwen'].items;
  assert.equal(entries.filter(item => item.key === 'tool-arguments:calendar_list').length, 1);
  assert.match(entries.find(item => item.key === 'tool-arguments:calendar_list').text, /Pass limit to calendar_list as a number/);
});

test('system prompt and local thinking changes apply without waiting for an active turn', async t => {
  const { controller, client, chat, store } = await fixture(t);
  await controller.send({ text: 'Keep this first turn running while settings change.' });
  const prompt = 'Use the new system prompt on the next turn.';
  controller.saveSettings({ systemPrompt: prompt, localThinking: false });
  assert.equal(store.data.settings.systemPrompt, prompt);
  assert.equal(store.data.settings.localThinking, false);
  finished(client, chat, 'completed', 'turn-2');
  const before = client.calls.length;
  await controller.send({ text: 'Use the updated prompt.' });
  const calls = client.calls.slice(before);
  assert.deepEqual(calls.map(call => call.method), ['thread/unsubscribe', 'thread/resume', 'turn/start']);
  assert.ok(calls[1].params.developerInstructions.startsWith(prompt));
});

test('conversation threads keep the engine multi-agent feature off', async t => {
  const { controller, chat } = await fixture(t);
  assert.equal(controller.threadOptions(chat, chat.workspace).config['features.multi_agent'], false);
});

test('a user message waits for a stopping goal and is sent once the lane is free', async t => {
  const { controller, client } = await fixture(t);
  let settle;
  // A realistic running goal: the state broadcast timer may read it while the goal stops (slow CI runners do).
  const operation = { goal: { id: 'goal-1' }, startedAt: Date.now(), tokens: 0, actionIds: new Set(), settled: new Promise(resolve => { settle = resolve; }) };
  controller.goalExecutor.active = operation;
  controller.goalExecutor.stop = async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    controller.state(); // what the state broadcast timer does while the goal stops
    controller.goalExecutor.active = null;
    settle();
  };
  const result = await controller.send({ text: 'Queue this while the goal stops.' });
  assert.equal(controller.chat(result.chatId).messages.at(-1).text, 'Queue this while the goal stops.');
  assert.equal(client.calls.filter(call => call.method === 'turn/start').length, 2);
});

test('engine crashes settle active chat and restart with the real client lifecycle hook', async t => {
  const { controller, client, chat } = await fixture(t);
  await controller.send({ text: 'Keep this request if the engine stops.' });
  controller.crashed(new Error('The assistant engine exited unexpectedly (code 1073807364).'));
  assert.equal(chat.status, 'idle');
  assert.match(chat.error, /saved message is safe/);
  const deadline = Date.now() + 5000;
  while ((!client.restartCount || controller.runtime.status !== 'ready') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(client.restartCount, 1);
  assert.equal(controller.runtime.status, 'ready');
});

test('a lost turn start acknowledgement interrupts the owned turn before releasing the chat', async t => {
  const { controller, client } = await fixture(t);
  client.hooks.set('turn/start', () => {
    client.notice('turn/started', { threadId: 'thread-1', turn: { id: 'uncertain-turn', status: 'inProgress' } });
    throw new Error('Engine request timed out: turn/start. The server may still be processing it.');
  });
  client.hooks.set('turn/interrupt', params => {
    client.notice('turn/completed', { threadId: 'thread-1', turn: { id: params.turnId, status: 'interrupted' } });
    return {};
  });

  const result = await controller.send({ text: 'Keep ownership if the start acknowledgement is lost.' });
  const chat = controller.chat(result.chatId);
  assert.ok(client.calls.some(call => call.method === 'turn/interrupt' && call.params.turnId === 'uncertain-turn'));
  assert.equal(chat.status, 'idle');
  assert.equal(chat.error, 'Stopped by you.');
  assert.equal(client.restartCount, 0);
});

test('a lost start acknowledgement without a turn id restarts the engine to clear uncertainty', async t => {
  const { controller, client } = await fixture(t);
  client.hooks.set('turn/start', () => { throw new Error('Engine request timed out: turn/start.'); });

  const result = await controller.send({ text: 'Do not release an unowned engine turn.' });
  const chat = controller.chat(result.chatId);
  assert.equal(chat.status, 'idle');
  assert.match(chat.error, /saved message is safe/);
  assert.equal(client.closed, true);
  assert.equal(controller.runtime.status, 'starting');
});
