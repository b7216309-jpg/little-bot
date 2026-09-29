'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');
class Client extends EventEmitter {
  calls = []; n = 0;
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: `engine-${++this.n}` } };
    if (method === 'turn/start') return { turn: { id: `turn-${this.calls.length}` } };
    return {};
  }
  async close() {}
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-one-'));
  const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
  Object.assign(store.data.settings, { connection: 'codex', model: 'one', workspace: root });
  const client = new Client();
  const controller = new Controller({ store, client });
  controller.runtime = { status: 'ready' }; controller.account = { status: 'connected' };
  t.after(async () => { await controller.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, client, controller };
}
test('one timeline survives omitted and stale IDs, model/workspace rotations, schedules and restart', async t => {
  const { root, store, client, controller } = await fixture(t);
  const first = await controller.send({ text: 'My favorite color is green.' });
  let chat = controller.chat(first.chatId);
  chat.messages.push({ id: 'answer-1', role: 'assistant', text: 'I will remember green.' });
  controller.finish(chat);
  assert.equal(store.memoryService.getWorkingState(chat.id).latestAnswer, 'I will remember green.');
  const initialThread = chat.threadId;
  const second = await controller.send({ text: 'Continue.', chatId: 'obsolete-id' });
  assert.equal(second.chatId, first.chatId); assert.equal(chat.threadId, initialThread);
  controller.finish(chat);
  const folder = path.join(root, 'project-two'); fs.mkdirSync(folder);
  controller.setWorkspace(folder); store.data.settings.model = 'two';
  await controller.send({ text: 'What color do I like?' });
  assert.notEqual(chat.threadId, initialThread); assert.equal(chat.workspace, folder);
  assert.ok(client.calls.some(call => call.method === 'thread/unsubscribe' && call.params.threadId === initialThread));
  assert.match(client.calls.filter(x => x.method === 'turn/start').at(-1).params.input[0].text, /favorite color is green/);
  controller.finish(chat);
  await controller.send({ text: 'Scheduled check' }, { ...store.data.settings, automationId: 'schedule-one' });
  assert.equal(store.data.chats.length, 1); assert.equal(chat.messages.at(-1).automationId, 'schedule-one');
  controller.finish(chat);
  const restored = new Store({ filePath: store.filePath, defaultWorkspace: root });
  assert.equal(restored.data.chats.length, 1); assert.equal(restored.data.chats[0].id, first.chatId);
  assert.equal(restored.data.chats[0].messages[0].workspace, root);
  assert.equal(restored.data.chats[0].messages.at(-1).workspace, folder);
  assert.equal(restored.memoryService.getWorkingState(chat.id).objective, 'What color do I like?');
  assert.equal(restored.memoryService.getWorkingState(chat.id).status, 'completed');
  restored.close();
});
test('overlapping sends cannot create parallel conversations', async t => {
  const { store, controller } = await fixture(t);
  await controller.send({ text: 'First request' });
  await assert.rejects(controller.send({ text: 'Second request' }), /Wait for this reply/);
  assert.equal(store.data.chats.length, 1); assert.equal(store.data.chats[0].messages.length, 1);
});

test('provider and tool-catalog changes release engine sessions without splitting history', async t => {
  const { store, client, controller } = await fixture(t);
  controller.agentTools = { specs: ({ readOnly }) => [{ name: readOnly ? 'memory_search' : 'memory_save' }] };
  const { chatId } = await controller.send({ text: 'Plan our project.', mode: 'plan' });
  const chat = controller.chat(chatId), planThread = chat.threadId;
  controller.finish(chat);
  await controller.send({ text: 'Execute our project.', mode: 'execute' });
  const executeThread = chat.threadId;
  assert.notEqual(executeThread, planThread);
  assert.equal(client.calls.filter(c => c.method === 'thread/start').at(-1).params.dynamicTools[0].name, 'memory_save');
  controller.finish(chat);
  await controller.localModelRelay.start();
  Object.assign(store.data.settings, { connection: 'local', localBaseUrl: 'http://localhost:8080/v1', model: 'local-model' });
  await controller.send({ text: 'Continue on my local model.' });
  assert.notEqual(chat.threadId, executeThread);
  assert.equal(store.data.chats.length, 1);
  assert.equal(chat.id, chatId);
  assert.equal(chat.messages[0].connection, 'codex');
  assert.equal(chat.messages.at(-1).connection, 'local');
  assert.ok(client.calls.some(c => c.method === 'thread/unsubscribe' && c.params.threadId === executeThread));
  assert.match(client.calls.filter(c => c.method === 'turn/start').at(-1).params.input[0].text, /Plan our project/);
});

test('memory lookup failure releases the foreground lane and preserves the existing timeline', async t => {
  const { store, controller } = await fixture(t);
  const { chatId } = await controller.send({ text: 'First saved turn' });
  const chat = controller.chat(chatId); controller.finish(chat);
  store.memoryService.prepareQuery = async () => { throw new Error('embedding lookup failed'); };
  await assert.rejects(controller.send({ text: 'Next request' }), /embedding lookup failed/);
  assert.equal(chat.status, 'idle');
  assert.equal(store.data.chats.length, 1);
  assert.equal(chat.messages.length, 1);
});
test('clarification replies remain attached to the original request in working state and extraction', async t => {
  const { root, store, controller } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Create a presentation using my favorite color.' });
  const chat = controller.chat(chatId), originalId = chat.messages[0].id;
  const answerPromise = controller.askUser(chat, { turnId: controller.turns.get(chatId), callId: 'question-one', arguments: { question: 'Which color?', options: ['Blue', 'Green'] } }, 'question-rpc', 'question-call');
  const requestId = [...controller.approvals.keys()][0];
  await controller.respondApproval({ requestId, decision: 'accept', answers: { answer: { answers: ['Blue'] } } });
  assert.deepEqual(await answerPromise, { answer: 'Blue' });
  chat.messages.push({ id: 'presentation-result', role: 'assistant', text: 'Created the presentation in blue.' });
  controller.finish(chat);
  const working = store.memoryService.getWorkingState(chatId);
  assert.equal(working.objective, 'Create a presentation using my favorite color.');
  assert.equal(working.source.messageId, originalId);
  const job = store.memoryService.pendingExtractions(10).find(item => item.chatId === chatId);
  assert.equal(job.messages[0].id, originalId);
  assert.ok(job.messages.some(message => message.text === 'Blue' && message.role === 'user'));
  const episode = store.memoryService.snapshot().episodes[0];
  assert.match(episode.text, /Request: Create a presentation/);
  assert.match(episode.text, /Clarification: Blue/);
  assert.equal(episode.sources[0].messageId, originalId);
  const reopened = new Store({ filePath: store.filePath, defaultWorkspace: root });
  assert.equal(reopened.data.chats[0].lastTurnRequestId, originalId);
  reopened.close();
});
test('explicit remember records link to the original message', async t => {
  const { store, controller } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Remember that I prefer blue.' });
  const chat = controller.chat(chatId);
  const fact = store.memoryService.snapshot().facts[0];
  assert.equal(fact.sources[0].messageId, chat.messages[0].id);
  assert.equal(fact.sources[0].chatId, chatId);
});


test('automations keep one timeline without replacing foreground mode, objective, or user events', async t => {
  const { root, store, client, controller } = await fixture(t);
  const events = []; controller.eventRuntime = { publish: event => events.push(event), stop() {} };
  const { chatId } = await controller.send({ text: 'Plan my project.', mode: 'plan' });
  const chat = controller.chat(chatId);
  chat.messages.push({ id: 'plan-answer', role: 'assistant', text: 'First, inspect the inputs.' });
  controller.finish(chat);
  const before = store.memoryService.getWorkingState(chatId);
  const directEvents = events.length;
  await controller.send({ text: 'Remember that I prefer daily reports.' }, { ...store.data.settings, automationId: 'daily', name: 'Daily review' });
  assert.deepEqual(store.memoryService.getWorkingState(chatId), before);
  const input = client.calls.filter(c => c.method === 'turn/start').at(-1).params.input[0].text;
  assert.match(input, /Scheduled task: Daily review/);
  assert.doesNotMatch(input, /Current user request:/);
  const answer = controller.message(chat, 'daily-answer', 'assistant'); answer.text = 'Scheduled report: no new changes.';
  controller.finish(chat);
  assert.equal(chat.mode, 'plan'); assert.equal(chat.title, 'Conversation');
  assert.equal(chat.automationId, undefined); assert.equal(chat.automationPreviousMode, undefined);
  assert.equal(answer.automationId, 'daily'); assert.equal(answer.automationName, 'Daily review');
  assert.deepEqual(store.memoryService.getWorkingState(chatId), before);
  assert.equal(events.length, directEvents, 'scheduler owns automation completion; no recursive chat.completed event');
  const request = chat.messages.find(m => m.kind === 'automation');
  assert.equal(store.memoryService.pendingExtractions(100).some(job => job.sourceIds.includes(request.id)), false);
  const row = store.memoryService.db.prepare('SELECT recallable FROM records WHERE id=?').get(`history:${chatId}:${request.id}`);
  assert.equal(row.recallable, 0, 'scheduled instructions are archived without being personal recall');
  assert.ok(store.memoryService.snapshot().episodes.some(e => e.text.startsWith('Scheduled task (Daily review):')));
  const restored = new Store({ filePath: store.filePath, defaultWorkspace: root });
  assert.equal(restored.data.chats[0].messages.at(-1).automationName, 'Daily review'); restored.close();
  await controller.send({ text: 'Continue my plan.' });
  assert.equal(chat.mode, 'plan'); assert.equal(store.data.chats.length, 1);
  assert.equal(chat.messages.at(-1).automationId, undefined);
});

test('automation failure and interrupted restart preserve the conversation Plan preference', async t => {
  const { root, store, controller } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Plan the work.', mode: 'plan' });
  const chat = controller.chat(chatId); controller.finish(chat);
  await controller.send({ text: 'Scheduled work' }, { ...store.data.settings, automationId: 'routine', name: 'Routine' });
  const restored = new Store({ filePath: store.filePath, defaultWorkspace: root });
  assert.equal(restored.data.chats[0].mode, 'plan'); restored.close();
  controller.finish(chat, 'Stopped by you.');
  assert.equal(chat.mode, 'plan'); assert.equal(chat.automationId, undefined);
  assert.equal(store.memoryService.getWorkingState(chatId).objective, 'Plan the work.');
});
