'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');
const { fakeLocalServer } = require('./fake-local-server.cjs');

class FakeClient extends EventEmitter {
  constructor() { super(); this.calls = []; this.turns = 0; this.threads = 0; }
  async start() {} async close() {} async restart() {} async respond() {} async reject() {}
  async request(method, params = {}) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: `thread-${++this.threads}` } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'turn/start') return { turn: { id: `turn-${++this.turns}` } };
    return {};
  }
  answer(chat, { error } = {}) {
    const turnId = `turn-${this.turns}`;
    if (!error) this.emit('notification', 'item/completed', { threadId: chat.threadId, turnId, item: { type: 'agentMessage', id: `answer-${turnId}`, text: 'Done.', phase: 'final_answer' } });
    this.emit('notification', 'turn/completed', { threadId: chat.threadId, turn: { id: turnId, status: error ? 'failed' : 'completed', ...(error ? { error: { message: error } } : {}) } });
  }
  compacted(chat) {
    const turnId = `turn-${this.turns}`;
    this.emit('notification', 'item/started', { threadId: chat.threadId, turnId, item: { type: 'contextCompaction', id: 'squeeze' } });
    this.emit('notification', 'item/completed', { threadId: chat.threadId, turnId, item: { type: 'contextCompaction', id: 'squeeze' } });
  }
}

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-context-'));
  const server = await fakeLocalServer();
  const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
  Object.assign(store.data.settings, { localBaseUrl: server.url, localModel: 'test-model', model: 'test-model', workspace: root });
  const client = new FakeClient();
  const controller = new Controller({ store, client });
  await controller.start();
  let profile = 'PROFILE ONE';
  controller.profileFiles = { getState: () => ({ user: '', soul: '' }), buildContext: () => profile };
  t.after(async () => { await controller.close(); await server.close(); await rm(root, { recursive: true, force: true }); });
  const lastInput = () => client.calls.filter(call => call.method === 'turn/start').at(-1).params;
  const say = async (text, options = {}) => {
    const { chatId } = await controller.send({ text });
    const chat = controller.chat(chatId);
    client.answer(chat, options);
    return chat;
  };
  return { root, store, client, controller, lastInput, say, setProfile: value => { profile = value; } };
}

test('the profile and shell rules go once per thread, and the engine is told what to keep', async t => {
  const { say, lastInput, setProfile, controller } = await setup(t);
  const first = await say('Plan my garden');
  assert.match(lastInput().input[0].text, /PROFILE ONE/);
  assert.match(lastInput().input[0].text, /Shell conduct for Windows/);
  assert.match(lastInput().standing, /Shell conduct[^]*PROFILE ONE/);

  await say('What about the roses');
  assert.doesNotMatch(lastInput().input[0].text, /PROFILE ONE|Shell conduct/);
  assert.match(lastInput().input[0].text, /What about the roses/);
  assert.match(lastInput().standing, /PROFILE ONE/, 'the engine can still put it back after a compaction');
  assert.deepEqual(controller.contextUsedFor(first.id).alreadyInContext, ['Shell conduct', 'Profile']);

  setProfile('PROFILE TWO');
  await say('And the tulips');
  assert.match(lastInput().input[0].text, /PROFILE TWO/, 'a change goes straight away');
  await say('And the lilies');
  assert.doesNotMatch(lastInput().input[0].text, /PROFILE TWO/);
});

test('a new thread gets everything again', async t => {
  const { say, lastInput, store, root } = await setup(t);
  await say('First message');
  store.data.settings.workspace = path.join(root);
  const chat = store.data.chats[0];
  chat.threadId = null;
  await say('After the thread changed');
  assert.match(lastInput().input[0].text, /PROFILE ONE/);
  assert.equal(chat.contextSent.threadId, chat.threadId);
});

test('a failed turn took its message out of the thread, so what it carried goes again', async t => {
  const { say, lastInput } = await setup(t);
  await say('First message', { error: 'The model stopped.' });
  await say('Second message');
  assert.match(lastInput().input[0].text, /PROFILE ONE/);
});

test('recalled memory is not repeated until a compaction removes it', async t => {
  const { say, lastInput, store, client, controller } = await setup(t);
  const service = store.memoryService;
  const saved = service.save({ text: 'The user prefers metric units.', type: 'preference', scope: 'global' });
  const chat = await say('Convert this recipe to grams');
  assert.match(lastInput().input[0].text, /prefers metric units/);
  assert.ok(chat.contextSent.memory.includes(saved.id));

  await say('Now the oven temperature');
  assert.doesNotMatch(lastInput().input[0].text, /prefers metric units/);

  await controller.send({ text: 'And the baking time' });
  client.compacted(chat);
  assert.deepEqual(chat.contextSent.memory, []);
  client.answer(chat);
  await say('And the cooling time');
  assert.match(lastInput().input[0].text, /prefers metric units/);
  assert.doesNotMatch(lastInput().input[0].text, /PROFILE ONE/, 'the engine put the standing context back itself');
});

test('the app guide is added once per context', async t => {
  const { say, lastInput, store, client, controller } = await setup(t);
  store.data.extensions.skills.push({ id: 'guide', name: 'little-bot', description: 'Guide.', content: 'HOW SCHEDULES WORK', enabled: true, bundled: true, createdAt: 1, updatedAt: 1 });
  const chat = await say('Set a reminder for my dentist');
  assert.match(lastInput().input[0].text, /HOW SCHEDULES WORK/);
  await say('Make that a schedule');
  assert.doesNotMatch(lastInput().input[0].text, /HOW SCHEDULES WORK/);
  await controller.send({ text: 'Something else' });
  client.compacted(chat);
  client.answer(chat);
  await say('Change the schedule');
  assert.match(lastInput().input[0].text, /HOW SCHEDULES WORK/);
});

test('a compaction that failed changes nothing about what the context holds', async t => {
  const { say, client, store, controller } = await setup(t);
  const chat = await say('Plan my garden');
  store.memoryService.save({ text: 'The user prefers metric units.', type: 'preference', scope: 'global' });
  await say('Grams please');
  const held = [...chat.contextSent.memory];
  await controller.send({ text: 'One more' });
  const turnId = `turn-${client.turns}`;
  client.emit('notification', 'item/started', { threadId: chat.threadId, turnId, item: { type: 'contextCompaction', id: 'fails' } });
  client.emit('notification', 'item/completed', { threadId: chat.threadId, turnId, item: { type: 'contextCompaction', id: 'fails', error: 'No summary.' } });
  assert.deepEqual(chat.contextSent.memory, held);
  assert.equal(chat.compaction.lastError, 'No summary.');
  assert.equal(chat.compaction.status, 'idle');
  assert.equal(chat.compaction.lastAt, null);
  client.answer(chat);
});
