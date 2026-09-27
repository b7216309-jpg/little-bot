'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm, readFile } = require('node:fs/promises');
const { readFileSync } = require('node:fs');
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
  notice(method, params) { this.emit('notification', method, params); }
  async respond() {}
  async reject() {}
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-private-'));
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  Object.assign(store.data.settings, {
    connection: 'codex',
    model: 'gpt-test',
    codexModel: 'gpt-test',
    workspace: root,
    effort: 'low',
  });
  store.data.memory.facts.push({
    id: 'fact-private-test',
    text: 'PRIVATE MEMORY SENTINEL 94731',
    scope: 'global',
    workspace: '',
    source: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
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

test('private session uses an ephemeral engine thread and excludes saved memory context', async t => {
  const { controller, client } = await fixture(t);
  const { chatId } = await controller.send({
    text: 'remember that private-session-secret-421 should stay only here',
    privateSession: true,
  });
  const chat = controller.chat(chatId);
  const thread = client.calls.find(call => call.method === 'thread/start').params;
  const turn = client.calls.find(call => call.method === 'turn/start').params;

  assert.equal(chat.private, true);
  assert.equal(thread.ephemeral, true);
  assert.equal(thread.approvalPolicy, 'never');
  assert.equal(thread.sandbox, 'danger-full-access');
  assert.equal(turn.input[0].text.includes('PRIVATE MEMORY SENTINEL 94731'), false);
  assert.equal(controller.store.data.memory.facts.some(fact => fact.text.includes('private-session-secret-421')), false);

  finish(client, chat);
  assert.equal(controller.store.data.memory.episodes.some(item => item.chatId === chatId), false);
});

test('private conversation is visible at runtime but never serialized to state.json', async t => {
  const { controller, client, store, filePath } = await fixture(t);
  const { chatId } = await controller.send({ text: 'runtime only secret 88311', privateSession: true });
  const chat = controller.chat(chatId);
  finish(client, chat);
  store.flush();

  assert.ok(controller.state().chats.some(item => item.id === chatId && item.private === true));
  const persisted = await readFile(filePath, 'utf8');
  assert.equal(persisted.includes(chatId), false);
  assert.equal(persisted.includes('runtime only secret 88311'), false);
});

test('ordinary conversations still persist and may use saved memory', async t => {
  const { controller, client, store, filePath } = await fixture(t);
  const { chatId } = await controller.send({ text: 'What do you remember about the sentinel?', privateSession: false });
  const chat = controller.chat(chatId);
  const turn = client.calls.find(call => call.method === 'turn/start').params;
  assert.match(turn.input[0].text, /PRIVATE MEMORY SENTINEL 94731/);
  finish(client, chat);
  store.flush();

  const persisted = await readFile(filePath, 'utf8');
  assert.ok(persisted.includes(chatId));
});

test('private mode cannot be retroactively changed after a conversation starts', async t => {
  const { controller, client } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Private start', privateSession: true });
  const chat = controller.chat(chatId);
  finish(client, chat);

  await assert.rejects(
    controller.send({ chatId, text: 'Try to make it normal', privateSession: false }),
    /Private mode is fixed/,
  );
});

test('renderer exposes private toggle and preserves merged chat features', () => {
  const html = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

  assert.match(html, /id="private-session-toggle"/);
  assert.match(app, /privateSessionDrafts/);
  assert.match(app, /privateSession \}\)/);
  assert.match(app, /LittleBotActionGroups\.groupConversation/);
  assert.match(app, /taskSummaryNode/);
  assert.match(app, /renderSystemPromptSettings/);
  assert.match(app, /currentPlanMode/);
});
