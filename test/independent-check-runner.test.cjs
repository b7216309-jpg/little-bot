'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { IndependentCheckRunner } = require('../src/independent-check-runner.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ request = 'This design is obviously correct, right?', answer = 'Yes, it is unquestionably correct.', mode = 'selective' } = {}) {
  const chat = {
    id: 'chat-1', threadId: 'chat-thread', workspace: 'C:\\workspace', model: 'test-model', connection: 'codex',
    status: 'running', taskRun: { messageStart: 0, independentCheckMode: mode },
    messages: [
      { id: 'user-1', role: 'user', text: request, status: 'completed' },
      { id: 'answer-1', role: 'assistant', text: answer, status: 'completed' },
    ],
  };
  const calls = [];
  const client = {
    async request(method, params, timeoutMs) {
      calls.push({ method, params: structuredClone(params), timeoutMs });
      if (method === 'thread/start') return { thread: { id: 'review-thread' } };
      if (method === 'turn/start') return { turn: { id: 'review-turn' } };
      if (['thread/unsubscribe', 'turn/interrupt'].includes(method)) return {};
      throw new Error(`Unexpected request: ${method}`);
    },
  };
  const controller = {
    store: { data: { settings: { independentCheckMode: mode }, chats: [chat] } },
    client,
    runtime: { status: 'ready' },
    closing: false,
    extensionRuntime: {
      async heartbeatConfig() { return { mcp_servers: {} }; },
      async verifyHeartbeat() {},
    },
    outcomes: new Map(),
    manualCompactions: new Map(),
    extensionsBusy: false,
    goalChat: null,
    heartbeatChat: null,
    changedCalls: 0,
    persistCalls: 0,
    finishCalls: 0,
    chat(id) { return id === chat.id ? chat : null; },
    ensureReady() {},
    providerConfig() { return { model_provider: 'test' }; },
    effectiveEffort() { return 'low'; },
    changed() { this.changedCalls += 1; },
    persistNow() { this.persistCalls += 1; },
    finish(target, error) { this.finishCalls += 1; target.status = 'idle'; target.error = error; this.outcomes.get(target.id)?.finish({ error }); },
    state() { return { settings: this.store.data.settings, chats: this.store.data.chats }; },
  };
  const runner = new IndependentCheckRunner(controller);
  return { runner, controller, client, chat, calls };
}

function result(overrides = {}) {
  return JSON.stringify({
    claimType: 'strategy', pressureDetected: true, assessment: 'mixed', conclusionStable: true,
    strongestCounterpoint: 'The available evidence is incomplete.', revisedAnswer: '',
    wouldChangeConclusion: ['A measured failure'], confidence: 0.75, ...overrides,
  });
}

test('the runner starts one read-only tool-free sequential review and keeps the parent chat busy', async () => {
  const { runner, chat, calls } = fixture();
  assert.equal(runner.startForTurn(chat, { turnId: 'original-turn' }), true);
  assert.equal(chat.status, 'running');
  assert.equal(chat.messages[1].independentCheck.status, 'running');
  await tick();
  const thread = calls.find(call => call.method === 'thread/start').params;
  const turn = calls.find(call => call.method === 'turn/start').params;
  assert.equal(thread.ephemeral, true);
  assert.equal(thread.sandbox, 'read-only');
  assert.equal(thread.config['features.multi_agent'], false);
  assert.equal(thread.config['features.shell_tool'], false);
  assert.equal(thread.config.web_search, 'disabled');
  assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly' });
  assert.equal(turn.threadId, 'review-thread');
  assert.equal(runner.state.status, 'running');
});

test('a stable review preserves the answer and stores bounded transparent metadata', async () => {
  const { runner, controller, chat } = fixture();
  runner.startForTurn(chat, { turnId: 'original-turn' });
  await tick();
  runner.notification('item/completed', { threadId: 'review-thread', turnId: 'review-turn', item: { type: 'agentMessage', text: result() } });
  runner.notification('turn/completed', { threadId: 'review-thread', turn: { id: 'review-turn', status: 'completed' } });
  assert.equal(chat.messages[1].text, 'Yes, it is unquestionably correct.');
  assert.equal(chat.messages[1].independentCheck.status, 'completed');
  assert.equal(chat.messages[1].independentCheck.revisionApplied, false);
  assert.equal(chat.status, 'idle');
  assert.equal(controller.finishCalls, 1);
  assert.equal(runner.state.status, 'idle');
});

test('a material correction replaces the visible answer but retains the prior draft for inspection', async () => {
  const { runner, chat } = fixture({ answer: 'Rewrite everything immediately.' });
  runner.startForTurn(chat, { turnId: 'original-turn' });
  await tick();
  const revised = result({
    assessment: 'unsupported', conclusionStable: false,
    strongestCounterpoint: 'No measured problem justifies a rewrite.',
    revisedAnswer: 'Keep the current design until an observed problem justifies migration.',
  });
  runner.notification('item/completed', { threadId: 'review-thread', turnId: 'review-turn', item: { type: 'agentMessage', text: revised } });
  runner.notification('turn/completed', { threadId: 'review-thread', turn: { id: 'review-turn', status: 'completed' } });
  assert.equal(chat.messages[1].text, 'Keep the current design until an observed problem justifies migration.');
  assert.equal(chat.messages[1].independentCheck.originalAnswer, 'Rewrite everything immediately.');
  assert.equal(chat.messages[1].independentCheck.revisionApplied, true);
});

test('malformed review output fails open to the completed draft', async () => {
  const { runner, chat } = fixture();
  runner.startForTurn(chat, { turnId: 'original-turn' });
  await tick();
  runner.notification('item/completed', { threadId: 'review-thread', turnId: 'review-turn', item: { type: 'agentMessage', text: 'not json' } });
  runner.notification('turn/completed', { threadId: 'review-thread', turn: { id: 'review-turn', status: 'completed' } });
  assert.equal(chat.messages[1].text, 'Yes, it is unquestionably correct.');
  assert.equal(chat.messages[1].independentCheck.status, 'failed');
  assert.match(chat.messages[1].independentCheck.error, /unreadable JSON/);
  assert.equal(chat.status, 'idle');
});

test('Stop interrupts only the review and preserves the already completed answer', async () => {
  const { runner, chat, calls } = fixture();
  runner.startForTurn(chat, { turnId: 'original-turn' });
  await tick();
  await runner.stop('Stopped by you.');
  assert.equal(calls.filter(call => call.method === 'turn/interrupt').length, 1);
  assert.equal(chat.messages[1].text, 'Yes, it is unquestionably correct.');
  assert.equal(chat.messages[1].independentCheck.status, 'interrupted');
  assert.equal(chat.status, 'idle');
});

test('manual Challenge works even when automatic review is Off', async () => {
  const { runner, controller, chat } = fixture({ request: 'Hello', answer: 'Hello there.', mode: 'off' });
  chat.status = 'idle';
  const state = await runner.challenge({ chatId: chat.id, messageId: 'answer-1' });
  assert.equal(state.chats[0].status, 'running');
  assert.equal(runner.active.mode, 'forced');
  assert.equal(chat.messages[1].independentCheck.status, 'running');
  assert.equal(controller.outcomes.has(chat.id), true);
  await runner.stop();
});
