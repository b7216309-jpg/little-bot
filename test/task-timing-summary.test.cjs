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
    this.thread = 0;
    this.turn = 0;
  }
  async start() {}
  async close() {}
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } };
    if (method === 'model/list') return { data: [{ id: 'gpt-test', model: 'gpt-test', displayName: 'Test', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] };
    if (method === 'thread/start') return { thread: { id: `thread-${++this.thread}` } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'turn/start') return { turn: { id: `turn-${++this.turn}`, status: 'inProgress' } };
    if (method === 'turn/interrupt') return {};
    throw new Error(`Unexpected request: ${method}`);
  }
  notice(method, params) { this.emit('notification', method, params); }
  async respond() {}
  async reject() {}
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-task-stats-'));
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

test('foreground task records duration and useful action counts at completion', async t => {
  const { controller, client } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Do a few things.' });
  const chat = controller.chat(chatId);
  chat.taskRun.startedAt -= 2500;

  client.notice('item/completed', {
    threadId: chat.threadId,
    item: { id: 'cmd', type: 'commandExecution', command: 'echo hi', aggregatedOutput: 'hi', status: 'completed' },
  });
  client.notice('item/completed', {
    threadId: chat.threadId,
    item: { id: 'files', type: 'fileChange', changes: [{ path: 'a.txt', diff: '+hello' }], status: 'completed' },
  });
  client.notice('item/completed', {
    threadId: chat.threadId,
    item: { id: 'search', type: 'webSearch', query: 'test', status: 'completed' },
  });
  client.notice('turn/completed', {
    threadId: chat.threadId,
    turn: { id: 'turn-1', status: 'completed' },
  });

  assert.equal(chat.status, 'idle');
  assert.equal(chat.taskRun, undefined);
  assert.equal(chat.lastTask.status, 'completed');
  assert.ok(chat.lastTask.durationMs >= 2500);
  assert.equal(chat.lastTask.actions, 3);
  assert.equal(chat.lastTask.commands, 1);
  assert.equal(chat.lastTask.files, 1);
  assert.equal(chat.lastTask.searches, 1);
  assert.equal(chat.lastTask.mcp, 0);
  assert.equal(chat.lastTask.agentTools, 0);
});

test('failed turns still record total time and failure status', async t => {
  const { controller, client } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Fail this turn.' });
  const chat = controller.chat(chatId);
  chat.taskRun.startedAt -= 1200;
  client.notice('turn/completed', {
    threadId: chat.threadId,
    turn: { id: 'turn-1', status: 'failed', error: { message: 'Synthetic failure' } },
  });
  assert.equal(chat.lastTask.status, 'failed');
  assert.ok(chat.lastTask.durationMs >= 1200);
  assert.match(chat.error, /Synthetic failure/);
});

test('last task summary survives a Store round trip', async t => {
  const { controller, client, store, filePath, root } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Persist stats.' });
  const chat = controller.chat(chatId);
  chat.taskRun.startedAt -= 800;
  client.notice('turn/completed', { threadId: chat.threadId, turn: { id: 'turn-1', status: 'completed' } });
  store.flush();

  const restored = new Store({ filePath, defaultWorkspace: root }).data.chats.find(item => item.id === chatId);
  assert.equal(restored.lastTask.status, 'completed');
  assert.ok(restored.lastTask.durationMs >= 800);
  assert.equal(restored.lastTask.actions, 0);
});
