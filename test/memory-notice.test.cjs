'use strict';

// What automatic learning saved is shown as a short line in the chat (and on the phone), while the model keeps the
// full notice with the ids; forgetting a memory marks it in every notice that announced it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const proactive = require('../src/proactive-chat.cjs');
const { slimMessage } = require('../src/relay-view.cjs');
const { Store } = require('../src/store.cjs');

const OLD_NOTICE = 'I\'ll remember:\n📌 Savinien\'s usual gaming handle is Aezaror (matches his Windows username). (fact · id 103e48a6-ae9f-4a4d-bdd5-d3561a7c382f)\n'
  + '📌 He plays a priest (preference · id p-2)\nTell me if any of this is wrong and I\'ll correct or forget it.';

test('a notice keeps what it learned as a list, and the model text keeps the ids', () => {
  const data = { chats: [], settings: {} };
  const message = proactive.deliverLearned(data, [{ id: 'm1', text: ' Handle is Aezaror ', type: 'fact' }, { id: 'm2', text: 'Plays a priest', type: 'preference' }, { id: '', text: 'no id' }]);
  assert.deepEqual(message.memories, [{ id: 'm1', text: 'Handle is Aezaror', type: 'fact' }, { id: 'm2', text: 'Plays a priest', type: 'preference' }]);
  assert.match(message.text, /📌 Handle is Aezaror \(fact · id m1\)/);
  assert.match(message.text, /Tell me if any of this is wrong/);
  // What the model is shown on the next turn is unchanged.
  assert.match(proactive.bridgeText ? proactive.bridgeText([message]) : message.text, /id m2/);
});

test('older notices are read from their text', () => {
  assert.deepEqual(proactive.memoryItems({ kind: 'memory', text: OLD_NOTICE }), [
    { id: '103e48a6-ae9f-4a4d-bdd5-d3561a7c382f', text: 'Savinien\'s usual gaming handle is Aezaror (matches his Windows username).', type: 'fact' },
    { id: 'p-2', text: 'He plays a priest', type: 'preference' },
  ]);
  assert.deepEqual(proactive.memoryItems({ kind: 'memory', text: 'Something else entirely' }), []);
});

test('forgetting marks the memory in new and older notices, delivered or still waiting', () => {
  const fresh = { id: 'n1', kind: 'memory', memories: [{ id: 'm1', text: 'Handle is Aezaror', type: 'fact' }], text: '…' };
  const old = { id: 'n2', kind: 'memory', text: OLD_NOTICE };
  const waiting = { id: 'n3', kind: 'memory', memories: [{ id: 'p-2', text: 'Plays a priest', type: 'preference' }], text: '…' };
  const data = { chats: [{ id: 'c', messages: [fresh, old, { id: 'x', kind: 'heartbeat', text: 'id m1' }], pendingProactive: [waiting] }] };
  assert.equal(proactive.markForgotten(data, 'm1'), true);
  assert.equal(fresh.memories[0].forgotten, true);
  assert.equal(proactive.markForgotten(data, 'm1'), false, 'already marked');
  assert.equal(proactive.markForgotten(data, 'p-2'), true);
  assert.deepEqual(old.memories.map(item => [item.id, Boolean(item.forgotten)]), [['103e48a6-ae9f-4a4d-bdd5-d3561a7c382f', false], ['p-2', true]]);
  assert.equal(waiting.memories[0].forgotten, true);
  assert.equal(proactive.markForgotten(data, 'nothing'), false);
});

test('the phone shows the memories alone, without ids or the footer', () => {
  const entry = slimMessage({ id: 'n', role: 'assistant', kind: 'memory', text: OLD_NOTICE, memories: [
    { id: 'a', text: 'Handle is Aezaror', type: 'fact' }, { id: 'b', text: 'Plays a priest', type: 'fact', forgotten: true }] });
  assert.equal(entry.label, 'Little Bot · remembered');
  assert.equal(entry.text, '📌 Handle is Aezaror\n📌 Plays a priest (forgotten)');
  assert.equal(slimMessage({ id: 'o', role: 'assistant', kind: 'memory', text: OLD_NOTICE }).text.includes('id '), false);
});

test('the store keeps the list and what was forgotten, in the chat and in the outbox', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-memory-notice-'));
  try {
    const store = new Store({ filePath: path.join(dir, 'state.json'), defaultWorkspace: dir });
    const memories = [{ id: 'm1', text: 'Handle is Aezaror', type: 'fact', forgotten: true }, { id: 'm2', text: 'Plays a priest', type: 'fact', extra: 'dropped' }, { id: 3, text: 'bad' }];
    store.data.chats.push({ id: 'c1', title: 'x', status: 'running', messages: [{ id: 'n1', role: 'assistant', kind: 'memory', text: 'I\'ll remember', memories }],
      pendingProactive: [{ id: 'n2', kind: 'memory', text: 'I\'ll remember', memories }] });
    store.save();
    const again = new Store({ filePath: path.join(dir, 'state.json'), defaultWorkspace: dir });
    const chat = again.data.chats.find(item => item.id === 'c1');
    const expected = [{ id: 'm1', text: 'Handle is Aezaror', type: 'fact', forgotten: true }, { id: 'm2', text: 'Plays a priest', type: 'fact' }];
    assert.deepEqual(chat.messages[0].memories, expected);
    assert.deepEqual(chat.pendingProactive[0].memories, expected);
    store.close(); again.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
