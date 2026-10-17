'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryService } = require('../src/memory-service.cjs');
const { MemoryConsolidator } = require('../src/memory-consolidator.cjs');
const { AgentTools } = require('../src/agent-tools.cjs');

function fixture(t) {
  const service = new MemoryService();
  const chat = { id: 'continuous', workspace: 'C:\\work', status: 'idle', messages: [
    { id: 'u1', role: 'user', text: 'We switched the project package manager to pnpm.' },
    { id: 'a1', role: 'assistant', text: 'Updated the project scripts.' },
  ] };
  const calls = [];
  const c = { store: { memoryService: service, data: { memory: { enabled: true }, settings: { workspace: chat.workspace, model: 'test' }, chats: [chat] }, save() {} },
    runtime: { status: 'ready' }, account: { status: 'connected' }, manualCompactions: new Map(),
    providerConfig: () => ({}), effectiveEffort: () => 'low', changed() {},
    client: { async request(method, params) {
      calls.push({ method, params });
      if (method === 'turn/interrupt') worker.notification('turn/completed', { threadId: 'extract', turn: { status: 'interrupted' } });
      return method === 'thread/start' ? { thread: { id: 'extract' } } : method === 'turn/start' ? { turn: { id: 'turn' } } : {};
    } },
  };
  const worker = new MemoryConsolidator(c, { autoStart: false });
  c.crashed = error => { c.crashError = error; if (worker.active) worker.finish(worker.active, null, error.message); };
  c.recoverUncertainTurnStart = async ({ threadId, turnId, completion, timeoutMs = 15000, owner, reason }) => {
    if (!threadId || !turnId) { if (c.runtime.status === 'ready') c.crashed(new Error(reason)); return false; }
    if (turnId && !owner?.interruptSent) {
      if (owner) owner.interruptSent = true;
      try { await c.client.request('turn/interrupt', { threadId, turnId }); }
      catch { if (owner) owner.interruptSent = false; }
    }
    let timer;
    const stopped = await Promise.race([completion.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
    clearTimeout(timer);
    if (!stopped && c.runtime.status === 'ready') c.crashed(new Error(reason));
    return stopped;
  };
  t.after(async () => { await worker.close(); service.close(); });
  service.indexChat(chat); service.enqueueExtraction(chat);
  return { service, chat, calls, c, worker };
}

test('idle extraction learns source-linked knowledge and completes a durable job', async t => {
  const { service, worker, calls } = fixture(t);
  await worker.tick();
  assert.equal(worker.state.status, 'learning');
  assert.equal(calls[1].params.outputSchema, undefined);
  assert.match(calls[1].params.input[0].text, /"memories"/);
  worker.notification('item/completed', { threadId: 'extract', item: { type: 'agentMessage', text: JSON.stringify({ memories: [
    { text: 'This project uses pnpm.', type: 'decision', scope: 'workspace', key: 'project.package-manager', sourceIds: ['u1'], supersedesId: null },
  ] }) } });
  worker.notification('turn/completed', { threadId: 'extract', turn: { id: 'turn', status: 'completed' } });
  assert.equal(service.pendingExtractions().length, 0);
  const record = service.search({ query: 'pnpm', source: 'facts', workspace: 'C:\\work' }).results[0];
  assert.equal(record.text, 'This project uses pnpm.');
  assert.match(service.sources(record.id)[0].text, /switched/);
  assert.equal(worker.state.status, 'idle');
});

test('foreground work interrupts extraction without consuming its pending job', async t => {
  const { worker, service, c, calls } = fixture(t);
  await worker.tick(); await worker.pauseForUser();
  assert.equal(c.memoryBusy, false);
  assert.equal(service.pendingExtractions().length, 1);
  assert(calls.some(call => call.method === 'turn/interrupt'));
  assert.equal(worker.notification('turn/completed', { threadId: 'extract', turn: { status: 'completed' } }), false);
});

test('extraction does not overlap a live conversation and invalid output retries', async t => {
  const { worker, service, chat } = fixture(t);
  chat.status = 'running'; assert.equal(await worker.tick(), false);
  chat.status = 'idle'; await worker.tick();
  worker.notification('item/agentMessage/delta', { threadId: 'extract', delta: 'invalid' });
  worker.notification('turn/completed', { threadId: 'extract', turn: { status: 'completed' } });
  await new Promise(resolve => setImmediate(resolve));
  worker.notification('item/completed', { threadId: 'extract', item: { type: 'agentMessage', text: 'still invalid' } });
  worker.notification('turn/completed', { threadId: 'extract', turn: { id: 'turn', status: 'completed' } });
  await new Promise(resolve => setImmediate(resolve));
  assert(worker.lastError);
  assert.equal(service.db.prepare("SELECT status FROM extraction_jobs").get().status, 'pending');
  assert.equal(service.db.prepare("SELECT attempts FROM extraction_jobs").get().attempts, 1);
});

test('interrupt RPC acknowledgement alone cannot release the execution lane', async t => {
  const { worker, c } = fixture(t);
  const original = c.client.request;
  c.client.request = async (method, params) => method === 'turn/interrupt' ? {} : original(method, params);
  await worker.tick();
  let stopped = false;
  const pending = worker.pauseForUser().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  assert.equal(c.memoryBusy, true);
  worker.notification('turn/completed', { threadId: 'extract', turn: { status: 'interrupted' } });
  await pending;
  assert.equal(c.memoryBusy, false);
});

test('stopping a memory turn with a pending start acknowledgement releases its lane', async t => {
  const { worker, c } = fixture(t);
  let entered, rejectStart, recovered = false;
  const started = new Promise(resolve => { entered = resolve; });
  c.client.request = async method => method === 'thread/start' ? { thread: { id: 'extract' } } : method === 'turn/start'
    ? (entered(), new Promise((resolve, reject) => { rejectStart = reject; })) : {};
  c.recoverUncertainTurnStart = async ({ owner }) => {
    recovered = owner.turnStartAttempted;
    worker.finish(owner, null, 'Memory work was stopped.');
    return false;
  };
  const ticking = worker.tick();
  await started;
  await worker.pauseForUser();
  assert.equal(recovered, true);
  assert.equal(c.memoryBusy, false);
  rejectStart(new Error('Engine request closed.'));
  await ticking;
});

test('a memory job that will not stop restarts the engine before the user turn continues', async t => {
  const { worker, c } = fixture(t);
  worker.stopTimeoutMs = 5;
  await worker.tick();
  c.client.request = async method => method === 'turn/interrupt' ? {} : {};
  c.client.close = async () => {};
  c.crashed = error => {
    c.crashError = error;
    worker.finish(worker.active, null, 'Engine restarted before user work.');
  };
  await worker.pauseForUser();
  assert.match(c.crashError.message, /did not stop after memory maintenance/);
  assert.equal(c.memoryBusy, false);
  assert.equal(worker.active, null);
});

test('memory tools immediately save, correct, recall and forget across model connections', async t => {
  const { c, chat, service } = fixture(t);
  const tools = new AgentTools({ store: c.store });
  const first = await tools.call('memory_save', { text: 'Use npm.', type: 'decision', key: 'package-manager', scope: 'workspace' }, { chat });
  const next = await tools.call('memory_save', { id: first.record.id, text: 'Use pnpm.', type: 'decision', key: 'package-manager', scope: 'workspace' }, { chat: { ...chat, connection: 'local' } });
  assert.equal(service.get(first.record.id).status, 'superseded');
  assert.equal((await tools.call('memory_search', { query: 'pnpm', source: 'facts' }, { chat })).results[0].id, next.record.id);
  await tools.call('memory_forget', { id: next.record.id }, { chat });
  assert.equal(service.search({ query: 'pnpm', source: 'facts', scope: 'all' }).results.length, 0);
});

test('local extraction uses constrained JSON and repairs one malformed answer', async t => {
  const { service, worker, calls, c } = fixture(t);
  c.store.data.settings.connection = 'local';
  await worker.tick();
  const turn = calls.find(call => call.method === 'turn/start').params;
  assert.equal(turn.outputSchema, undefined);
  assert.match(turn.input[0].text, /matching this schema/);
  worker.notification('item/completed', { threadId: 'extract', item: { type: 'agentMessage', text: "{'memories': [}" } });
  worker.notification('turn/completed', { threadId: 'extract', turn: { id: 'turn', status: 'completed' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call.method === 'turn/start').length, 2);
  assert.equal(calls.filter(call => call.method === 'turn/start')[1].params.outputSchema, undefined);
  const sloppy = JSON.stringify({ memories: [
    { content: 'This project uses pnpm.', category: 'Decision', scope: 'workspace', key: 'project.package-manager', sources: 'u1' },
  ] }).replace(/\]\}$/, '],}');
  worker.notification('item/completed', { threadId: 'extract', item: { type: 'agentMessage', text: '<think>pnpm is durable</think>\n```json\n' + sloppy + '\n```' } });
  worker.notification('turn/completed', { threadId: 'extract', turn: { id: 'turn', status: 'completed' } });
  assert.equal(service.pendingExtractions().length, 0);
  assert.deepEqual(service.snapshot().records.map(record => record.text), ['This project uses pnpm.']);
});

test('learning jobs that failed on the rejected response format are retried; other failures stay put', t => {
  const { service, worker } = fixture(t);
  const [job] = service.pendingExtractions();
  for (let i = 0; i < 3; i++) service.failExtraction(job.id, '{"error": {"type": "invalid_request_error", "message": "structured response_format with tools/MCP is not supported"}}');
  assert.equal(service.failedExtractions().length, 1);
  assert.equal(worker.retryFormatFailures(), 1);
  assert.equal(service.failedExtractions().length, 0);
  assert.equal(service.pendingExtractions().length, 1);
  for (let i = 0; i < 3; i++) service.failExtraction(job.id, 'Memory extraction did not match the required JSON schema.');
  assert.equal(worker.retryFormatFailures(), 1, 'Schema shapes accepted since 0.17.1 get another chance.');
  for (let i = 0; i < 3; i++) service.failExtraction(job.id, 'Memory extraction did not return readable JSON.');
  assert.equal(worker.retryFormatFailures(), 0);
  assert.equal(service.failedExtractions().length, 1);
});

test('a small model\'s near-miss memories are repaired, and only broken ones are dropped', () => {
  const { normalizeCandidates } = require('../src/memory-consolidator.cjs');
  const job = { messages: [{ id: 'u1', role: 'user', text: 'I use pnpm' }, { id: 'a1', role: 'assistant', text: 'ok' }] };
  assert.deepEqual(normalizeCandidates({ memories: [
    { text: ' Prefers short morning answers ', type: 'Preference' },
    { text: 'The project uses pnpm.', type: 'fact', scope: 'workspace', key: 'project.pm', sourceIds: ['u1'], supersedesId: null, confidence: 0.9 },
    { text: '', type: 'fact' }, { text: 'mood is good', type: 'mood' }, 'junk', null,
  ], note: 'extra' }, job), [
    { text: 'Prefers short morning answers', type: 'preference', scope: 'global', key: 'prefers-short-morning-answers', supersedesId: null, sourceIds: ['u1'] },
    { text: 'The project uses pnpm.', type: 'fact', scope: 'workspace', key: 'project.pm', supersedesId: null, sourceIds: ['u1'] },
  ]);
  assert.deepEqual(normalizeCandidates([{ text: 'Uses Windows', type: 'fact' }], job)[0].scope, 'workspace');
  assert.deepEqual(normalizeCandidates({ memories: [] }, job), []);
  // Other shapes small models return: a bare memory, the list under another name, or nothing at all.
  assert.equal(normalizeCandidates({ text: 'Uses Windows', type: 'fact', scope: 'global' }, job)[0].text, 'Uses Windows');
  assert.equal(normalizeCandidates({ memory: [{ text: 'Likes tea', type: 'preference' }] }, job)[0].key, 'likes-tea');
  assert.equal(normalizeCandidates({ memories: { text: 'Likes tea', type: 'preference' } }, job).length, 1);
  assert.deepEqual(normalizeCandidates({}, job), []);
  assert.deepEqual(normalizeCandidates({ memories: null, note: 'nothing durable' }, job), []);
  assert.throws(() => normalizeCandidates({ a: [], b: [] }, job), /required JSON schema/);
  assert.throws(() => normalizeCandidates('none', job), /required JSON schema/);
});
