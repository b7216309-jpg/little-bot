'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const proactive = require('../src/proactive-chat.cjs');
const contract = require('../src/goal-contract.cjs');
const { validateGoal } = require('../src/goals.cjs');
const { Store } = require('../src/store.cjs');

const alert = (id, summary = 'Tonight looks free for Ace Combat.') => ({ id, status: 'alert', source: 'heartbeat', summary: `  ${summary}  `, topic: 'Leisure' });

test('heartbeat alerts post once into an idle chat as unseen assistant messages', () => {
  const data = { chats: [{ status: 'idle', messages: [], updatedAt: 0 }] };
  const message = proactive.deliverHeartbeat(data, alert('h1'), 123);
  assert.equal(message.role, 'assistant');
  assert.equal(message.kind, 'heartbeat');
  assert.equal(message.text, 'Tonight looks free for Ace Combat.');
  assert.equal(message.heartbeatTopic, 'Leisure');
  assert.equal(message.modelSeen, false);
  assert.equal(data.chats[0].updatedAt, 123);
  assert.equal(proactive.deliverHeartbeat(data, alert('h1')), null);
  assert.equal(data.chats[0].messages.length, 1);
  assert.equal(proactive.deliverHeartbeat({ chats: [] }, alert('h2')), null);
  assert.equal(proactive.deliverHeartbeat(data, { ...alert('g'), source: 'goal' }), null);
  assert.equal(proactive.deliverHeartbeat(data, { ...alert('e'), status: 'error' }), null);
});

test('a busy conversation queues proactive messages instead of dropping them, then flushes them in order', () => {
  for (const status of ['running', 'waiting']) {
    const chat = { status, messages: [{ id: 'u', role: 'user', text: 'hi' }] };
    const data = { chats: [chat] };
    proactive.deliverHeartbeat(data, alert('h1', 'First.'));
    proactive.deliverHeartbeat(data, alert('h1', 'First.'));
    proactive.deliverHeartbeat(data, alert('h2', 'Second.'));
    assert.equal(chat.messages.length, 1, 'the running turn is not interrupted');
    assert.deepEqual(chat.pendingProactive.map(item => item.text), ['First.', 'Second.']);
    assert.equal(proactive.flush(chat, 500), 0, 'nothing flushes while the chat is busy');
    chat.status = 'idle';
    assert.equal(proactive.flush(chat, 500), 2);
    assert.deepEqual(chat.messages.map(item => item.text), ['hi', 'First.', 'Second.']);
    assert.ok(chat.messages.slice(1).every(item => item.createdAt === 500));
    assert.equal(chat.pendingProactive, undefined);
    assert.equal(proactive.flush(chat), 0);
  }
  const chat = { status: 'running', messages: [] };
  for (let index = 0; index < 25; index++) proactive.deliverHeartbeat({ chats: [chat] }, alert(`h${index}`, `n${index}`));
  assert.equal(chat.pendingProactive.length, 20);
  assert.equal(chat.pendingProactive[0].text, 'n5');
});

test('goal results use the same outbox and are not lost when the chat is busy', () => {
  const goal = validateGoal({ name: 'Growth', objective: 'Help me act', kind: 'ongoing', workspace: process.cwd(), permissions: { write: false },
    trigger: { type: 'interval', intervalMinutes: 1440 } }, null, { workspace: process.cwd() });
  const chat = { status: 'running', messages: [] };
  const data = { chats: [chat] };
  contract.deliver(goal, data, { runId: 'r1', summary: 'Try one PR description in English this week.' });
  contract.deliver(goal, data, { runId: 'r1', summary: 'Duplicate' });
  assert.equal(contract.deliver(goal, data, { runId: 'r2', summary: '' }), null);
  assert.equal(chat.pendingProactive.length, 1);
  chat.status = 'idle';
  proactive.flush(chat);
  contract.deliver(goal, data, { runId: 'r1', summary: 'Duplicate after delivery' });
  assert.deepEqual(chat.messages.map(item => [item.kind, item.goalName, item.text]), [['goal', 'Growth', 'Try one PR description in English this week.']]);
  assert.equal(contract.deliver({ ...goal, sources: { ...goal.sources, chat: false } }, data, { runId: 'r3', summary: 'x' }), null);
});

test('the next user turn sees unseen proactive messages exactly once', () => {
  const chat = { status: 'idle', messages: [] };
  const data = { chats: [chat] };
  proactive.deliverHeartbeat(data, alert('h1'));
  proactive.post(data, { kind: 'goal', goalId: 'g', goalName: 'Growth', goalRunId: 'r', text: 'A recommendation.' });
  chat.messages.push({ id: 'a', role: 'assistant', text: 'Normal reply' });
  const pending = proactive.unseen(chat);
  assert.equal(pending.length, 2);
  const bridge = proactive.bridgeText(pending);
  assert.match(bridge, /may be replying to them/);
  assert.match(bridge, /heartbeat · Leisure\] Tonight looks free for Ace Combat\./);
  assert.match(bridge, /goal "Growth"\] A recommendation\./);
  proactive.markSeen(pending);
  assert.deepEqual(proactive.unseen(chat), []);
  assert.equal(proactive.bridgeText([]), '');
});

test('queued messages and unseen flags survive a restart', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-proactive-'));
  let reopened;
  t.after(async () => { reopened?.close(); await fs.rm(root, { recursive: true, force: true }); });
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  store.data.chats.push({ id: 'c', title: 'Conversation', workspace: root, status: 'idle', messages: [], createdAt: 1, updatedAt: 1 });
  proactive.deliverHeartbeat(store.data, alert('h1', 'Delivered.'));
  store.data.chats[0].status = 'running';
  proactive.deliverHeartbeat(store.data, alert('h2', 'Queued.'));
  store.save(); store.close();
  reopened = new Store({ filePath, defaultWorkspace: root });
  const chat = reopened.data.chats[0];
  assert.equal(chat.status, 'idle');
  assert.equal(chat.messages[0].modelSeen, false);
  assert.deepEqual(chat.pendingProactive.map(item => [item.kind, item.text, item.heartbeatId]), [['heartbeat', 'Queued.', 'h2']]);
  proactive.flush(chat);
  assert.deepEqual(proactive.unseen(chat).map(item => item.text), ['Delivered.', 'Queued.']);
});
