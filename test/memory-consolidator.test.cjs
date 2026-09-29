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
  t.after(async () => { await worker.close(); service.close(); });
  service.indexChat(chat); service.enqueueExtraction(chat);
  return { service, chat, calls, c, worker };
}

test('idle extraction learns source-linked knowledge and completes a durable job', async t => {
  const { service, worker, calls } = fixture(t);
  await worker.tick();
  assert.equal(worker.state.status, 'learning');
  assert.equal(calls[1].params.outputSchema.required[0], 'memories');
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
