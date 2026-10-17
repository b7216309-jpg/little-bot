'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');
const { fakeLocalServer } = require('./fake-local-server.cjs');

class FakeClient extends EventEmitter {
  constructor() { super(); this.calls = []; this.turns = 0; this.threads = 0; }
  async start() {} async close() {} async restart() {}
  async request(method, params = {}) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: `thread-${++this.threads}` } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'turn/start') return { turn: { id: `turn-${++this.turns}` } };
    return {};
  }
  async respond() {} async reject() {}
  answer(chat, text) {
    const turnId = `turn-${this.turns}`;
    this.emit('notification', 'item/completed', { threadId: chat.threadId, turnId, item: { type: 'agentMessage', id: `answer-${turnId}`, text, phase: 'final_answer' } });
    this.emit('notification', 'turn/completed', { threadId: chat.threadId, turn: { id: turnId, status: 'completed' } });
  }
}

test('saved sessions live beside the conversation, persist, rename, and leave no history when deleted', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-sessions-'));
  const server = await fakeLocalServer();
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  Object.assign(store.data.settings, { localBaseUrl: server.url, localModel: 'test-model', model: 'test-model', workspace: root });
  const client = new FakeClient();
  const controller = new Controller({ store, client });
  await controller.start();
  t.after(async () => { await controller.close(); await server.close(); await rm(root, { recursive: true, force: true }); });

  const main = controller.chat((await controller.send({ text: 'Hello main' })).chatId);
  client.answer(main, 'Hi');
  const trip = controller.chat((await controller.send({ session: true, text: 'Plan the Lisbon trip\nwith details' })).chatId);
  assert.equal(trip.session, true);
  assert.equal(trip.title, 'Plan the Lisbon trip');
  assert.notEqual(trip.threadId, main.threadId);
  assert.match(client.calls.filter(call => call.method === 'turn/start').at(-1).params.input[0].text, /separate saved session, "Plan the Lisbon trip"/);
  client.answer(trip, 'Plan ready');
  const printer = controller.chat((await controller.send({ session: true, text: 'Fix the printer' })).chatId);
  client.answer(printer, 'Printer fixed');
  await controller.send({ chatId: trip.id, text: 'Add a museum day' });
  client.answer(trip, 'Museum added');
  assert.equal(trip.messages.filter(message => message.role === 'user').length, 2);
  await controller.send({ text: 'Back in the conversation' });
  client.answer(main, 'Welcome back');
  assert.equal(main.messages.filter(message => message.role === 'user').length, 2);

  controller.renameChat({ chatId: printer.id, title: 'Printer saga' });
  assert.throws(() => controller.renameChat({ chatId: main.id, title: 'x' }), /Only saved sessions/);
  await assert.rejects(controller.deleteChat({ chatId: main.id }), /cannot be deleted/);
  const quick = controller.chat((await controller.send({ quick: true, text: 'Quick sum' })).chatId);
  client.answer(quick, '42');
  store.save();
  const reloaded = new Store({ filePath, defaultWorkspace: root });
  assert.deepEqual(reloaded.data.chats.map(chat => [chat.title, chat.session === true]), [['Conversation', false], ['Plan the Lisbon trip', true], ['Printer saga', true]]);
  reloaded.close();

  const printerHistory = () => store.memoryService.search({ query: 'Printer', source: 'history', scope: 'all', limit: 20 }).results.length;
  assert.ok(printerHistory() > 0);
  await controller.deleteChat({ chatId: printer.id });
  assert.equal(printerHistory(), 0);
  assert.deepEqual(store.data.chats.filter(chat => chat.session).map(chat => chat.title), ['Plan the Lisbon trip']);
  await assert.rejects(controller.send({ session: true, chatId: printer.id, text: 'Still there?' }), /no longer exists/);
});
