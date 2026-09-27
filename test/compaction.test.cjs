'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { CompactionTracker } = require('../src/compaction.cjs');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
const usage = (last = 150, total = 9999, window = 200000) => ({ last: { totalTokens: last, inputTokens: last - 20, outputTokens: 20, cachedInputTokens: 50, reasoningOutputTokens: 0 }, total: { totalTokens: total }, modelContextWindow: window });

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

test('context usage uses the latest total, preserves unknown windows, and rejects invalid counts', () => {
  const tracker = new CompactionTracker();
  const chat = {};
  assert.equal(tracker.usage(chat, usage(), 1), true);
  assert.deepEqual(chat.context, { usedTokens: 150, windowTokens: 200000, updatedAt: 1, stale: false });
  assert.equal(tracker.usage(chat, usage(0, 999999, null), 2), true);
  assert.deepEqual(chat.context, { usedTokens: 0, windowTokens: null, updatedAt: 2, stale: false });
  for (const value of [-1, Infinity, '12', Number.MAX_SAFE_INTEGER + 1, 2.5, null]) assert.equal(tracker.usage(chat, usage(value)), false);
  assert.equal(chat.context.updatedAt, 2);
});

test('manual compaction acknowledges promptly, keeps chat locked through turn completion, and preserves transcript and memory', async t => {
  const { controller, client, chat, store, filePath, root } = await fixture(t);
  const transcript = structuredClone(chat.messages);
  const memory = structuredClone(store.data.memory);
  assert.deepEqual(await controller.compact({ chatId: chat.id }), { chatId: chat.id });
  assert.equal(chat.status, 'running');
  assert.equal(chat.compaction.status, 'running');
  assert.equal(chat.context.stale, true);
  assert.deepEqual(client.calls.at(-1), { method: 'thread/compact/start', params: { threadId: chat.threadId } });
  await assert.rejects(controller.send({ chatId: chat.id, text: 'Continue' }), /Wait for this reply/);
  await assert.rejects(controller.compact({ chatId: chat.id }), /Wait for this reply/);
  started(client, chat);
  item(client, chat);
  client.notice('thread/tokenUsage/updated', { threadId: chat.threadId, turnId: 'compact-1', tokenUsage: usage(300, 50000) });
  item(client, chat, true);
  assert.equal(chat.compaction.count, 0);
  assert.equal(chat.compaction.status, 'running');
  assert.equal(chat.context.stale, false);
  assert.equal(chat.context.usedTokens, 300);
  const completion = controller.waitForChat(chat.id);
  finished(client, chat);
  assert.deepEqual(await completion, { error: null });
  assert.equal(chat.status, 'idle');
  assert.equal(chat.compaction.status, 'idle');
  assert.equal(chat.compaction.count, 1);
  assert.equal(chat.compaction.lastError, null);
  assert.deepEqual(chat.messages, transcript);
  assert.deepEqual(store.data.memory, memory);
  assert.equal(client.calls.filter(call => call.method === 'turn/start').length, 1);
  store.flush();
  const restored = new Store({ filePath, defaultWorkspace: root }).data.chats[0];
  assert.equal(restored.compaction.count, 1);
  assert.equal(restored.context.usedTokens, 300);
  assert.deepEqual(restored.messages, JSON.parse(JSON.stringify(transcript)));
});

test('manual compaction resumes a saved thread with the normal permission, instruction, and extension config', async t => {
  const { controller, client, chat, root } = await fixture(t);
  controller.resumed.clear();
  controller.extensionRuntime = { config: () => ({ 'mcp_servers.safe': { enabled: false }, 'features.apps': false }), close: async () => {} };
  await controller.compact({ chatId: chat.id });
  const resume = client.calls.find(call => call.method === 'thread/resume').params;
  assert.equal(resume.threadId, chat.threadId);
  assert.equal(resume.cwd, root);
  assert.equal(resume.model, 'test-model');
  assert.equal(resume.approvalPolicy, 'never');
  assert.equal(resume.sandbox, 'danger-full-access');
  assert.equal(resume.approvalsReviewer, 'user');
  assert.match(resume.developerInstructions, /You are Little Bot/);
  assert.deepEqual(resume.config['mcp_servers.safe'], { enabled: false });
  assert.equal(Object.hasOwn(resume.config, 'sandbox_workspace_write.network_access'), false);
  assert.ok(!Object.keys(resume.config).some(key => key.includes('auto_compact')));
});

test('automatic compaction deduplicates native items without finishing the normal turn or recapturing memory', async t => {
  const { controller, client, chat, store } = await fixture(t);
  await controller.send({ chatId: chat.id, text: 'Now implement it' });
  const memoryBefore = structuredClone(store.data.memory);
  const messagesBefore = structuredClone(chat.messages);
  item(client, chat, false, 'auto', 'turn-2');
  item(client, chat, false, 'auto', 'turn-2');
  assert.equal(chat.compaction.status, 'running');
  client.notice('thread/tokenUsage/updated', { threadId: chat.threadId, turnId: 'turn-2', tokenUsage: usage(400, 80000) });
  item(client, chat, true, 'auto', 'turn-2');
  item(client, chat, true, 'auto', 'turn-2');
  assert.equal(chat.status, 'running');
  assert.equal(chat.compaction.status, 'idle');
  assert.equal(chat.compaction.count, 1);
  assert.equal(chat.context.stale, false);
  assert.deepEqual(chat.messages, messagesBefore);
  assert.deepEqual(store.data.memory, memoryBefore);
  client.notice('item/completed', { threadId: chat.threadId, turnId: 'turn-2', item: { type: 'agentMessage', id: 'final-2', text: 'Implemented.', phase: 'final_answer' } });
  finished(client, chat, 'completed', 'turn-2');
  assert.equal(chat.status, 'idle');
  assert.notDeepEqual(store.data.memory, memoryBefore);
  item(client, chat, true, 'auto', 'turn-2');
  assert.equal(chat.compaction.count, 1);
});

test('manual summary items and deltas never become fake visible replies or memory', async t => {
  const { controller, client, chat, store } = await fixture(t);
  const before = JSON.stringify({ messages: chat.messages, memory: store.data.memory });
  await controller.compact({ chatId: chat.id });
  started(client, chat);
  item(client, chat);
  client.notice('item/agentMessage/delta', { threadId: chat.threadId, turnId: 'compact-1', itemId: 'summary', delta: 'INTERNAL_SUMMARY' });
  client.notice('item/completed', { threadId: chat.threadId, turnId: 'compact-1', item: { id: 'summary', type: 'agentMessage', text: 'INTERNAL_SUMMARY', phase: 'final_answer' } });
  item(client, chat, true);
  finished(client, chat);
  assert.equal(JSON.stringify({ messages: chat.messages, memory: store.data.memory }), before);
});

test('Stop during resume prevents the manual request and releases the chat after resume returns', async t => {
  const { controller, client, chat } = await fixture(t);
  const pending = deferred();
  controller.resumed.clear();
  client.hooks.set('thread/resume', () => pending.promise);
  const compacting = controller.compact({ chatId: chat.id });
  await tick();
  await controller.stop({ chatId: chat.id });
  assert.equal(chat.status, 'running');
  pending.resolve({ thread: { id: chat.threadId } });
  await compacting;
  assert.equal(client.calls.some(call => call.method === 'thread/compact/start'), false);
  assert.equal(chat.status, 'idle');
  assert.equal(chat.compaction.lastError, 'Stopped by you.');
  assert.equal(chat.compaction.count, 0);
});

test('Stop before turn/started is queued, sends one scoped interrupt, and waits for terminal acknowledgement', async t => {
  const { controller, client, chat } = await fixture(t);
  const pending = deferred();
  client.hooks.set('thread/compact/start', () => pending.promise);
  const compacting = controller.compact({ chatId: chat.id });
  await controller.stop({ chatId: chat.id });
  assert.equal(client.calls.some(call => call.method === 'turn/interrupt'), false);
  started(client, chat);
  await tick();
  await controller.stop({ chatId: chat.id });
  pending.resolve({});
  await compacting;
  const interrupts = client.calls.filter(call => call.method === 'turn/interrupt');
  assert.deepEqual(interrupts, [{ method: 'turn/interrupt', params: { threadId: chat.threadId, turnId: 'compact-1' } }]);
  assert.equal(chat.status, 'running');
  finished(client, chat, 'interrupted');
  assert.equal(chat.status, 'idle');
  assert.equal(chat.compaction.count, 0);
  assert.equal(chat.compaction.lastError, 'Stopped by you.');
});

test('foreign and old turn events cannot complete a compaction or a subsequent reply', async t => {
  const { controller, client, chat } = await fixture(t);
  await controller.compact({ chatId: chat.id });
  started(client, chat);
  item(client, chat, true, 'foreign', 'unrelated-turn');
  finished(client, chat, 'completed', 'turn-1');
  assert.equal(chat.compaction.count, 0);
  assert.equal(chat.status, 'running');
  item(client, chat);
  item(client, chat, true);
  finished(client, chat);
  await controller.send({ chatId: chat.id, text: 'Continue after compaction' });
  finished(client, chat);
  assert.equal(chat.status, 'running');
  assert.equal(controller.turns.get(chat.id), 'turn-2');
  assert.equal(chat.compaction.count, 1);
});

test('native errors wait for manual turn completion and cannot report a false compaction success', async t => {
  const { controller, client, chat } = await fixture(t);
  await controller.compact({ chatId: chat.id });
  started(client, chat);
  item(client, chat);
  client.notice('error', { threadId: chat.threadId, turnId: 'compact-1', willRetry: true, error: { message: 'Retrying' } });
  assert.equal(chat.compaction.lastError, null);
  client.notice('error', { threadId: chat.threadId, turnId: 'compact-1', willRetry: false, error: { message: 'api_key=private-key Compaction failed' } });
  assert.equal(chat.status, 'running');
  assert.match(chat.compaction.lastError, /redacted/);
  finished(client, chat); // The pinned core can return a nominal completion after an error.
  assert.equal(chat.status, 'idle');
  assert.equal(chat.compaction.count, 0);
  assert.match(chat.error, /Compaction failed/);
  assert.equal(chat.context.stale, true);
});

test('unattributable pre-start completion, error, item, and usage cannot affect a manual operation', async t => {
  const { controller, client, chat } = await fixture(t);
  client.notice('thread/tokenUsage/updated', { threadId: chat.threadId, turnId: 'turn-1', tokenUsage: usage(900) });
  controller.completedTurns.clear(); // Old process IDs are unavailable after restart.
  controller.latestTurns.clear();
  await controller.compact({ chatId: chat.id });
  item(client, chat, true, 'old-item', 'old');
  finished(client, chat, 'completed', 'old');
  client.notice('error', { threadId: chat.threadId, turnId: 'old', willRetry: false, error: { message: 'Old error' } });
  client.notice('thread/tokenUsage/updated', { threadId: chat.threadId, turnId: 'old', tokenUsage: usage(1) });
  assert.equal(chat.status, 'running');
  assert.equal(chat.compaction.count, 0);
  assert.equal(chat.compaction.lastError, null);
  assert.equal(chat.context.usedTokens, 900);
  assert.equal(chat.context.stale, true);
  assert.equal(controller.manualCompactions.get(chat.id).turnId, null);
  started(client, chat);
  item(client, chat);
  item(client, chat, true);
  finished(client, chat);
  assert.equal(chat.compaction.count, 1);
});

test('late usage from an old completed turn cannot replace postcompaction usage, while latest-turn usage remains valid', async t => {
  const { controller, client, chat } = await fixture(t);
  await controller.compact({ chatId: chat.id });
  started(client, chat);
  item(client, chat);
  client.notice('thread/tokenUsage/updated', { threadId: chat.threadId, turnId: 'compact-1', tokenUsage: usage(2000) });
  item(client, chat, true);
  finished(client, chat);
  const fresh = structuredClone(chat.context);
  for (const turnId of ['turn-1', 'unknown-old-turn']) {
    client.notice('thread/tokenUsage/updated', { threadId: chat.threadId, turnId, tokenUsage: usage(190000) });
    assert.deepEqual(chat.context, fresh);
  }
  client.notice('thread/tokenUsage/updated', { threadId: chat.threadId, turnId: 'compact-1', tokenUsage: usage(2100) });
  assert.equal(chat.context.usedTokens, 2100);
  assert.equal(chat.context.stale, false);
  await controller.send({ chatId: chat.id, text: 'Continue' });
  finished(client, chat, 'completed', 'turn-2');
  client.notice('thread/tokenUsage/updated', { threadId: chat.threadId, turnId: 'turn-2', tokenUsage: usage(2300) });
  assert.equal(chat.context.usedTokens, 2300);
  client.notice('thread/tokenUsage/updated', { threadId: chat.threadId, turnId: 'compact-1', tokenUsage: usage(2100) });
  assert.equal(chat.context.usedTokens, 2300);
});

test('a completed manual item followed by failed or interrupted turn never increments successful count', async t => {
  const { controller, client, chat } = await fixture(t);
  for (const [index, status] of ['failed', 'interrupted'].entries()) {
    const turnId = `compact-${index + 1}`;
    await controller.compact({ chatId: chat.id });
    started(client, chat, turnId);
    item(client, chat, false, `item-${index}`, turnId);
    item(client, chat, true, `item-${index}`, turnId);
    assert.equal(chat.compaction.count, 0);
    assert.equal(chat.compaction.lastAt, null);
    finished(client, chat, status, turnId);
    assert.equal(chat.compaction.count, 0);
    assert.equal(chat.compaction.lastAt, null);
    assert.ok(chat.compaction.lastError);
    assert.equal(chat.context.stale, true);
  }
});

test('terminal completion without a compaction item is an error, while an RPC rejection immediately releases the lock', async t => {
  const { controller, client, chat } = await fixture(t);
  await controller.compact({ chatId: chat.id });
  started(client, chat);
  finished(client, chat);
  assert.match(chat.compaction.lastError, /without a completion event/);
  assert.equal(chat.compaction.count, 0);
  client.hooks.set('thread/compact/start', () => { throw Object.assign(new Error('Invalid thread'), { code: -32600 }); });
  await assert.rejects(controller.compact({ chatId: chat.id }), /Invalid thread/);
  assert.equal(chat.status, 'idle');
  assert.equal(chat.compaction.lastError, 'Invalid thread');
});

test('timeouts interrupt the correct turn and keep the chat locked until acknowledgement', async t => {
  const { controller, client, chat } = await fixture(t, { compactionTimeoutMs: 20, compactionStopTimeoutMs: 1000 });
  await controller.compact({ chatId: chat.id });
  started(client, chat);
  await pause(35);
  assert.equal(client.calls.at(-1).method, 'turn/interrupt');
  assert.equal(chat.status, 'running');
  finished(client, chat, 'interrupted');
  assert.equal(chat.status, 'idle');
  assert.match(chat.compaction.lastError, /time limit/);
  assert.equal(client.closed, false);
});

test('a lost start acknowledgement cannot unlock still-running compaction', async t => {
  const { controller, client, chat } = await fixture(t, { compactionStopTimeoutMs: 1000 });
  client.hooks.set('thread/compact/start', () => { throw new Error('Codex request timed out: thread/compact/start. The server may still be processing it.'); });
  await assert.rejects(controller.compact({ chatId: chat.id }), /timed out/);
  assert.equal(chat.status, 'running');
  started(client, chat);
  await tick();
  assert.equal(client.calls.at(-1).method, 'turn/interrupt');
  finished(client, chat, 'interrupted');
  assert.equal(chat.status, 'idle');
  assert.match(chat.compaction.lastError, /timed out/);
});

test('an unacknowledged Stop closes the engine and late events cannot resurrect compaction', async t => {
  const { controller, client, chat } = await fixture(t, { compactionStopTimeoutMs: 15 });
  await controller.compact({ chatId: chat.id });
  await controller.stop({ chatId: chat.id });
  await pause(30);
  assert.equal(client.closed, true);
  assert.equal(controller.runtime.status, 'error');
  assert.equal(chat.status, 'idle');
  assert.equal(chat.compaction.status, 'idle');
  started(client, chat);
  item(client, chat, true);
  finished(client, chat);
  assert.equal(chat.status, 'idle');
  assert.equal(chat.compaction.count, 0);
});

test('engine crashes and close during resume do not send compaction after shutdown', async t => {
  const { controller, client, chat } = await fixture(t);
  controller.resumed.clear();
  const pending = deferred();
  client.hooks.set('thread/resume', () => pending.promise);
  const compacting = controller.compact({ chatId: chat.id });
  client.emit('crash', new Error('Engine stopped'));
  pending.resolve({ thread: { id: chat.threadId } });
  await compacting;
  assert.equal(client.calls.some(call => call.method === 'thread/compact/start'), false);
  assert.equal(chat.compaction.status, 'idle');
  assert.match(chat.compaction.lastError, /engine stopped/i);
  assert.equal(controller.manualCompactions.size, 0);
});

test('manual compaction rejects tools and cannot create an approval or external action', async t => {
  const { controller, client, chat } = await fixture(t);
  await controller.compact({ chatId: chat.id });
  await controller.serverRequest({ id: 42, method: 'mcpServer/elicitation/request', params: { threadId: chat.threadId, mode: 'form', requestedSchema: { type: 'object', properties: {} } } });
  assert.deepEqual(client.responses, [{ id: 42, result: { action: 'decline', content: null } }]);
  assert.equal(controller.approvals.size, 0);
});

test('busy extensions, heartbeat, signed-out state, and missing chat cannot start compaction', async t => {
  const { controller, client, chat } = await fixture(t);
  const before = client.calls.length;
  await assert.rejects(controller.compact({ chatId: 'missing' }), /Start a conversation/);
  controller.extensionsBusy = true;
  assert.equal(controller.state().extensionsBusy, true);
  await assert.rejects(controller.compact({ chatId: chat.id }), /Extensions/);
  controller.extensionsBusy = false;
  controller.heartbeatChat = { id: 'hidden' };
  await assert.rejects(controller.compact({ chatId: chat.id }), /heartbeat/);
  controller.heartbeatChat = null;
  controller.account.status = 'signedOut';
  await assert.rejects(controller.compact({ chatId: chat.id }), /Connect Codex|Sign in/);
  assert.equal(client.calls.length, before);
  assert.equal(chat.compaction, undefined);
  assert.equal(controller.state().appVersion, require('../package.json').version);
});
