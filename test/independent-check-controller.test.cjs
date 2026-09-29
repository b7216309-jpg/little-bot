'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.rejections = [];
    this.threadNumber = 0;
    this.turnNumber = 0;
  }
  async start() {}
  async close() {}
  async request(method, params = {}, timeoutMs) {
    this.calls.push({ method, params: structuredClone(params), timeoutMs });
    switch (method) {
      case 'account/read': return { account: { type: 'chatgpt', planType: 'plus' } };
      case 'model/list': return { data: [{ id: 'test-model', model: 'test-model', displayName: 'Test model', isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] };
      case 'thread/start': return { thread: { id: `thread-${++this.threadNumber}` } };
      case 'thread/resume': return { thread: { id: params.threadId } };
      case 'turn/start': return { turn: { id: `turn-${++this.turnNumber}`, status: 'inProgress' } };
      case 'turn/interrupt':
      case 'thread/unsubscribe': return {};
      default: throw new Error(`Unexpected fake request: ${method}`);
    }
  }
  async respond() {}
  async reject(id, message, code = -32601) { this.rejections.push({ id, message, code }); }
  notice(method, params) { this.emit('notification', method, params); }
  ask(id, method, params) { this.emit('request', { id, method, params }); }
}

async function setup(t, mode = 'selective') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-independent-check-'));
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  Object.assign(store.data.settings, {
    connection: 'codex', model: 'test-model', codexModel: 'test-model', workspace: root,
    effort: 'low', independentCheckMode: mode,
  });
  const client = new FakeClient();
  const controller = new Controller({ store, client });
  await controller.start();
  t.after(async () => { await controller.close(); await rm(root, { recursive: true, force: true }); });
  return { root, filePath, store, client, controller };
}

async function waitFor(predicate, label, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function begin(controller, text) {
  const { chatId } = await controller.send({ text });
  return controller.chat(chatId);
}

function finishOriginal(client, controller, chat, answer, messageId = 'answer-1') {
  const turnId = controller.turns.get(chat.id);
  client.notice('item/completed', {
    threadId: chat.threadId, turnId,
    item: { id: messageId, type: 'agentMessage', text: answer, status: 'completed' },
  });
  client.notice('turn/completed', { threadId: chat.threadId, turn: { id: turnId, status: 'completed' } });
  return messageId;
}

async function activeReview(controller) {
  return waitFor(() => controller.independentCheck.active?.threadId && controller.independentCheck.active?.turnId
    ? controller.independentCheck.active : null, 'Independent Check review turn');
}

function reviewResult(overrides = {}) {
  return JSON.stringify({
    claimType: 'strategy', pressureDetected: true, assessment: 'mixed', conclusionStable: true,
    strongestCounterpoint: 'The available evidence does not justify a stronger conclusion.',
    revisedAnswer: '', wouldChangeConclusion: ['Measured evidence that changes the trade-off'],
    confidence: 0.77, ...overrides,
  });
}

function finishReview(client, operation, result = reviewResult()) {
  client.notice('item/completed', {
    threadId: operation.threadId, turnId: operation.turnId,
    item: { id: 'review-answer', type: 'agentMessage', text: result, status: 'completed' },
  });
  client.notice('turn/completed', {
    threadId: operation.threadId,
    turn: { id: operation.turnId, status: 'completed' },
  });
}

test('Selective review delays completion, rejects tools, and preserves a supported draft', async (t) => {
  const { controller, client } = await setup(t);
  const chat = await begin(controller, 'This architecture is obviously correct, right?');
  const outcome = controller.waitForChat(chat.id);
  finishOriginal(client, controller, chat, 'It is correct without qualification.');

  const operation = await activeReview(controller);
  assert.equal(chat.status, 'running');
  assert.equal(chat.messages.find(message => message.id === 'answer-1').independentCheck.status, 'running');

  client.ask('review-tool', 'item/tool/call', {
    threadId: operation.threadId, turnId: operation.turnId, callId: 'call-1', tool: 'memory_search', arguments: {},
  });
  await waitFor(() => client.rejections.find(entry => entry.id === 'review-tool'), 'review tool rejection');
  assert.match(client.rejections.at(-1).message, /does not use tools/);

  finishReview(client, operation);
  assert.deepEqual(await outcome, { error: null });
  const answer = chat.messages.find(message => message.id === 'answer-1');
  assert.equal(answer.text, 'It is correct without qualification.');
  assert.equal(answer.independentCheck.status, 'completed');
  assert.equal(answer.independentCheck.revisionApplied, false);
  assert.equal(chat.status, 'idle');
});

test('a material Independent Check revision survives a Store round trip with its prior draft', async (t) => {
  const { controller, client, store, filePath, root } = await setup(t);
  const chat = await begin(controller, 'Should we rewrite the store now?');
  const outcome = controller.waitForChat(chat.id);
  finishOriginal(client, controller, chat, 'Rewrite everything immediately.');
  const operation = await activeReview(controller);
  finishReview(client, operation, reviewResult({
    assessment: 'unsupported', conclusionStable: false,
    strongestCounterpoint: 'No observed problem currently requires a rewrite.',
    revisedAnswer: 'Keep the current store until measured failures justify a migration.',
  }));
  assert.deepEqual(await outcome, { error: null });
  store.flush();

  const restoredStore = new Store({ filePath, defaultWorkspace: root });
  const restored = restoredStore.data.chats[0];
  restoredStore.close();
  const answer = restored.messages.find(message => message.id === 'answer-1');
  assert.equal(answer.text, 'Keep the current store until measured failures justify a migration.');
  assert.equal(answer.independentCheck.revisionApplied, true);
  assert.equal(answer.independentCheck.originalAnswer, 'Rewrite everything immediately.');
});

test('Selective mode skips operational and factual recall prompts', async (t) => {
  const { controller, client } = await setup(t);
  for (const [request, answer] of [
    ['List the files in this folder.', 'There are three files.'],
    ['What units should reports use?', 'Reports use metric units.'],
    ['Remember that reports use metric units.', 'I will remember that.'],
  ]) {
    const chat = await begin(controller, request);
    const outcome = controller.waitForChat(chat.id);
    finishOriginal(client, controller, chat, answer, `answer-${client.turnNumber}`);
    assert.deepEqual(await outcome, { error: null });
    assert.equal(chat.status, 'idle');
    assert.equal(controller.independentCheck.active, null);
  }
  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 1);
  assert.equal(client.calls.filter(call => call.method === 'turn/start').length, 3);
});

test('the per-turn mode is snapshotted while Off and Always remain distinct', async (t) => {
  const { controller, client } = await setup(t, 'off');
  const first = await begin(controller, 'This is obviously right, correct?');
  const firstOutcome = controller.waitForChat(first.id);
  controller.saveSettings({ independentCheckMode: 'always' });
  finishOriginal(client, controller, first, 'Yes.');
  assert.deepEqual(await firstOutcome, { error: null });
  assert.equal(controller.independentCheck.active, null);

  const second = await begin(controller, 'Hello there.');
  const secondOutcome = controller.waitForChat(second.id);
  finishOriginal(client, controller, second, 'Hello.');
  const operation = await activeReview(controller);
  finishReview(client, operation, reviewResult({ claimType: 'none', pressureDetected: false, assessment: 'not_applicable' }));
  assert.deepEqual(await secondOutcome, { error: null });
});

test('Stop during Independent Check keeps the completed draft and releases the chat', async (t) => {
  const { controller, client } = await setup(t);
  const chat = await begin(controller, 'Is this strategy a good idea?');
  const outcome = controller.waitForChat(chat.id);
  finishOriginal(client, controller, chat, 'It is a good idea.');
  const operation = await activeReview(controller);

  await controller.stop({ chatId: chat.id });
  assert.deepEqual(await outcome, { error: null });
  assert.ok(client.calls.some(call => call.method === 'turn/interrupt'
    && call.params.threadId === operation.threadId && call.params.turnId === operation.turnId));
  const answer = chat.messages.find(message => message.id === 'answer-1');
  assert.equal(answer.text, 'It is a good idea.');
  assert.equal(answer.independentCheck.status, 'interrupted');
  assert.equal(chat.status, 'idle');
});

test('manual Challenge forces a sequential check while automatic review is Off', async (t) => {
  const { controller, client } = await setup(t, 'off');
  const chat = await begin(controller, 'Hello.');
  const firstOutcome = controller.waitForChat(chat.id);
  finishOriginal(client, controller, chat, 'Hello there.');
  assert.deepEqual(await firstOutcome, { error: null });

  await controller.challengeIndependentCheck({ chatId: chat.id, messageId: 'answer-1' });
  const operation = await activeReview(controller);
  assert.equal(operation.mode, 'forced');
  assert.equal(chat.status, 'running');
  finishReview(client, operation, reviewResult({ claimType: 'none', pressureDetected: false, assessment: 'not_applicable' }));
  await waitFor(() => chat.status === 'idle', 'manual challenge completion');
  assert.equal(chat.messages.find(message => message.id === 'answer-1').independentCheck.mode, 'forced');
});
