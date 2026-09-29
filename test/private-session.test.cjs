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
  store.memoryService.save({ text: 'PRIVATE MEMORY SENTINEL 94731', scope: 'global', pinned: true });
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

test('obsolete private-session requests fail before sending or persisting', async t => {
  const { controller, client, store } = await fixture(t);
  await assert.rejects(controller.send({ text: 'Do not persist this', privateSession: true }), /one persistent conversation/);
  assert.equal(store.data.chats.length, 0);
  assert.equal(client.calls.some(call => call.method === 'turn/start'), false);
});

test('the continuous conversation persists and uses shared memory', async t => {
  const { controller, client, store, filePath } = await fixture(t);
  const { chatId } = await controller.send({ text: 'What do you remember about the sentinel?' });
  const chat = controller.chat(chatId);
  assert.match(client.calls.find(call => call.method === 'turn/start').params.input[0].text, /PRIVATE MEMORY SENTINEL 94731/);
  assert.equal(client.calls.find(call => call.method === 'thread/start').params.ephemeral, undefined);
  finish(client, chat); store.flush();
  assert.ok((await readFile(filePath, 'utf8')).includes(chatId));
  assert.throws(() => controller.deleteChat({ chatId }), /continuous conversation/);
});

test('renderer exposes one Conversation with no private or new-chat toggle', () => {
  const html = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /id="private-session-toggle"/);
  assert.doesNotMatch(html, /id="new-chat"/);
  assert.match(html, /id="nav-conversation"/);
});
