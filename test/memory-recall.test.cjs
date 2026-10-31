'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryService, significantTerms } = require('../src/memory-service.cjs');
const { automaticRemember, attachMemoryService } = require('../src/memory.cjs');
const { recallSearch } = require('../src/recall.cjs');
const { AgentTools } = require('../src/agent-tools.cjs');
const dreaming = require('../src/dreaming.cjs');

const workspace = 'C:\\work';
function fixture(t) {
  const service = new MemoryService();
  t.after(() => service.close());
  return service;
}
const learned = { chatId: 'c', messageIds: ['m'], label: 'Automatic extraction' };
const vector = (...values) => { const norm = Math.hypot(...values); return values.map(value => value / norm); };
// Gives a record a stored vector and the query a vector of its own, so similarity can be set by hand.
function embed(service, record, values) {
  service.db.prepare('UPDATE records SET embedding=?,embedding_model=? WHERE id=?').run(JSON.stringify(vector(...values)), service.embeddingIdentity(), record.id);
}

test('a message of common words recalls nothing and teaches nothing', t => {
  const service = fixture(t);
  assert.deepEqual(significantTerms('ok thanks'), []);
  assert.deepEqual(significantTerms('oui vas-y, merci'), []);
  assert.deepEqual(significantTerms('continue'), []);
  assert.deepEqual(significantTerms('Use pnpm here'), ['pnpm']);
  assert.deepEqual(significantTerms('port 80'), ['port', '80']);

  service.save({ text: 'The thanks page is at /thanks and it is ok.', type: 'fact', scope: 'global' });
  assert.equal(service.buildContext({ workspace, query: 'ok thanks' }), '');

  const chat = id => ({ id, workspace, status: 'idle', messages: [{ id: `${id}-u`, role: 'user', text: id === 'small' ? 'ok thanks' : 'We moved the database to Postgres.' }, { id: `${id}-a`, role: 'assistant', text: 'Noted.' }] });
  assert.equal(service.enqueueExtraction(chat('small')), null);
  assert.equal(service.captureTurn(chat('small')), null);
  assert.ok(service.enqueueExtraction(chat('real')));
  assert.ok(service.captureTurn(chat('real')));
});

test('preferences and pins come first, in a short form, and each only once per context', t => {
  const service = fixture(t);
  const preference = service.save({ text: 'The user prefers short answers.', type: 'preference', scope: 'global' });
  const pin = service.save({ text: 'The dog is called Rex.', type: 'fact', scope: 'global', pinned: true });
  const seen = new Set();
  const text = service.buildContext({ workspace, query: 'hello there friend', seen });
  assert.match(text, /^Memory that may help/);
  assert.match(text, new RegExp(`- preference \\(${preference.id.slice(0, 8)}, \\d{4}-\\d{2}-\\d{2}\\): The user prefers short answers\\.`));
  assert.match(text, /The dog is called Rex/);
  assert.doesNotMatch(text, new RegExp(preference.id), 'the whole id is left out');
  assert.doesNotMatch(text, /"source"|chatId|messageIds/);
  assert.ok(seen.has(preference.id) && seen.has(pin.id));
  assert.equal(service.buildContext({ workspace, query: 'hello there friend', seen }), '', 'nothing new to say');
});

test('only what clearly relates to the message is recalled, within the budget', t => {
  const service = fixture(t);
  service.save({ text: 'The project uses pnpm for installing packages.', type: 'decision', scope: 'global' });
  service.save({ text: 'The cat is allergic to chicken.', type: 'fact', scope: 'global' });
  const text = service.buildContext({ workspace, query: 'install the packages with pnpm' });
  assert.match(text, /uses pnpm/);
  assert.doesNotMatch(text, /allergic/);
  // One shared word among many is not enough without a close meaning.
  assert.equal(service.buildContext({ workspace, query: 'the project budget review meeting schedule tomorrow morning' }), '');

  for (let index = 0; index < 40; index++) service.save({ text: `Printer note ${index}: the nozzle is 0.${index} mm wide and the printer sits by the window.`, type: 'fact', scope: 'global' });
  const lines = service.buildContext({ workspace, query: 'printer nozzle window', budget: 500 }).split('\n').slice(1);
  assert.ok(lines.length >= 1 && lines.length <= 6);
  assert.ok(lines.join('\n').length <= 500);
});

test('similarity counts when it is high, shares a word, or stands clear of the rest', t => {
  const service = fixture(t);
  const close = service.save({ text: 'Backups of the photo library go out on Fridays.', type: 'fact', scope: 'global' });
  const near = service.save({ text: 'The website is hosted on a small server in Germany.', type: 'fact', scope: 'global' });
  const far = service.save({ text: 'The piano is tuned every spring.', type: 'fact', scope: 'global' });
  embed(service, close, [1, 0, 0, 0]);
  embed(service, near, [0, 1, 0, 0]);
  embed(service, far, [0, 0, 1, 0]);
  // The first three numbers are the similarity to each record; the fourth is the rest of a unit vector.
  const ask = (query, a, b, c) => {
    service.semantic.set(query, [a, b, c, Math.sqrt(1 - a * a - b * b - c * c)]);
    return service.buildContext({ workspace, query });
  };

  // High enough on its own.
  assert.match(ask('did the snapshots get saved', 0.7, 0.2, 0.1), /Backups of the photo/);
  // Lower, with no shared word, but well clear of everything else.
  assert.match(ask('where do we deploy things', 0.3, 0.5, 0.1), /website is hosted/);
  // The same score beside a close second is not clear, as for French text, which scores high whatever it says.
  assert.equal(ask('quelle heure dehors maintenant', 0.55, 0.54, 0.1), '');
  // The same score with a shared word is enough: "piano".
  assert.match(ask('find my piano teacher please', 0.3, 0.2, 0.46), /piano is tuned/);
  // Nothing close: nothing recalled.
  assert.equal(ask('explain photosynthesis to me', 0.3, 0.35, 0.3), '');
});

test('raw history is never recalled, past work needs a strong match, and what the context still holds is left out', t => {
  const service = fixture(t);
  const chat = { id: 'chat', workspace, status: 'idle', messages: [
    { id: 'u', role: 'user', text: 'Repair the garden irrigation timer', createdAt: 100 },
    { id: 'a', role: 'assistant', text: 'Replaced the irrigation timer battery.', createdAt: 200 },
  ] };
  service.indexChat(chat);
  const episode = service.captureTurn(chat);
  assert.doesNotMatch(service.buildContext({ workspace, query: 'garden irrigation timer' }), /Request|Replaced/, 'no similarity: not recalled');
  embed(service, episode, [1, 0]);
  service.semantic.set('garden irrigation timer', vector(1, 0));
  assert.match(service.buildContext({ workspace, query: 'garden irrigation timer', sessionId: 'elsewhere' }), /Earlier work:\n- \d{4}-\d{2}-\d{2}: Request: Repair the garden/);
  assert.equal(service.buildContext({ workspace, query: 'garden irrigation timer', sessionId: 'chat', since: 0 }), '', 'still in this context');
});

test('a learned memory that rewords one already kept is dropped, and one that adds to it replaces it', t => {
  const service = fixture(t);
  const base = service.save({ text: 'The user prefers dark theme in editors.', type: 'preference', scope: 'global', source: learned });
  assert.equal(service.save({ text: 'User prefers editors with dark theme!', type: 'preference', scope: 'global', automatic: true, source: learned }), null);
  const fuller = service.save({ text: 'The user prefers dark theme in editors, terminals and browsers on every machine.', type: 'preference', scope: 'global', automatic: true, source: learned });
  assert.equal(fuller.supersedes, base.id);
  assert.equal(service.get(base.id).status, 'superseded');
  // The opposite is not a rewording.
  const opposite = service.save({ text: 'The user does not prefer dark theme in editors, terminals and browsers on every machine.', type: 'preference', scope: 'global', automatic: true, source: learned });
  assert.ok(opposite);
  // A pin is left alone.
  const pinned = service.save({ text: 'Invoices go to the accounting folder on the NAS.', type: 'fact', scope: 'global', pinned: true });
  const extended = service.save({ text: 'Invoices go to the accounting folder on the NAS every month.', type: 'fact', scope: 'global', automatic: true, source: learned });
  assert.equal(service.get(pinned.id).status, 'active');
  assert.ok(extended);
  // One different word can be the whole correction, however long the fact is.
  assert.ok(service.save({ text: 'The local model server listens on port 8080.', type: 'fact', scope: 'global', automatic: true, source: learned }));
  assert.ok(service.save({ text: 'The local model server listens on port 8081.', type: 'fact', scope: 'global', automatic: true, source: learned }));
  assert.ok(service.save({ text: 'Weekly backups of the family photo library copy to the external garage drive on Fridays.', type: 'fact', scope: 'global', automatic: true, source: learned }));
  assert.ok(service.save({ text: 'Weekly backups of the family photo library copy to the external garage drive on Mondays.', type: 'fact', scope: 'global', automatic: true, source: learned }));
  // Taking a negation away is a correction too, though every word is already there.
  assert.ok(service.save({ text: 'The user does not enjoy spicy Thai curry dishes.', type: 'fact', scope: 'global', automatic: true, source: learned }));
  assert.ok(service.save({ text: 'The user does enjoy spicy Thai curry dishes.', type: 'fact', scope: 'global', automatic: true, source: learned }));
});

test('recall and memory tools work with the short id', async t => {
  const service = fixture(t);
  const store = { memoryService: service, data: { memory: { enabled: true }, settings: { workspace }, chats: [] }, save() {} };
  attachMemoryService(store.data.memory, service);
  const tools = new AgentTools({ store });
  const chat = { id: 'chat', workspace, messages: [] };
  const record = service.save({ text: 'The boat is moored at dock seven.', type: 'fact', scope: 'global' });
  const updated = await tools.call('memory_save', { id: record.id.slice(0, 8), text: 'The boat is moored at dock nine.' }, { chat });
  assert.equal(updated.record.supersedes, record.id);
  assert.equal((await tools.call('memory_forget', { id: updated.record.id.slice(0, 8) }, { chat })).forgotten, true);
  assert.equal(service.get(updated.record.id).status, 'forgotten');
});

test('search results carry what the model needs and not their bookkeeping twice', t => {
  const service = fixture(t);
  const store = { memoryService: service, data: { memory: { enabled: true }, settings: { workspace } } };
  service.save({ text: `The harbour fees are ${'long '.repeat(500)}`, type: 'fact', scope: 'global', pinned: true });
  const [result] = recallSearch(store, { query: 'harbour fees' }, { chat: { workspace } }).results;
  assert.deepEqual(Object.keys(result).sort(), ['clipped', 'date', 'id', 'pinned', 'source', 'text', 'type']);
  assert.ok(result.text.length <= 1600);
  assert.match(result.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('asking to remember works in French too, and holds in every folder', t => {
  const service = fixture(t);
  const memory = attachMemoryService({ enabled: true }, service);
  const settings = { workspace };
  assert.equal(automaticRemember(memory, 'Remember that the gate code changes in May', settings, 'c', 'm').scope, 'global');
  assert.equal(automaticRemember(memory, 'Souviens-toi que ma soeur arrive en mai', settings, 'c', 'm').text, 'ma soeur arrive en mai');
  assert.equal(automaticRemember(memory, 'retiens : le garage ferme à midi', settings, 'c', 'm').text, 'le garage ferme à midi');
  assert.equal(automaticRemember(memory, "N'oublie pas que le dentiste a déménagé", settings, 'c', 'm').text, 'le dentiste a déménagé');
  assert.equal(automaticRemember(memory, 'Remember to buy milk', settings, 'c', 'm'), null);
});

test('the nightly tidy merges and retires only what Little Bot learned by itself', t => {
  const service = fixture(t);
  const a = service.save({ text: 'The user likes hiking in the Alps.', type: 'fact', scope: 'global', source: learned });
  const b = service.save({ text: 'The user goes walking in the mountains on holiday.', type: 'fact', scope: 'global', source: learned });
  const c = service.save({ text: 'The user is training for a marathon in April.', type: 'issue', scope: 'global', source: learned });
  const own = service.save({ text: 'My blood type is O positive.', type: 'fact', scope: 'global', source: { sessionId: 'c', messageId: 'm', label: 'Explicit remember request' } });
  const pinned = service.save({ text: 'The user owns a red bicycle.', type: 'fact', scope: 'global', pinned: true, source: learned });
  const data = { memory: attachMemoryService({ enabled: true }, service), companion: { dreams: [], intentions: [], lastDreamAt: null }, chats: [] };
  const controller = { store: { data, memoryService: service } };
  const material = { chatId: 'c', messages: [{ id: 'u1', role: 'user', text: 'I gave up on the marathon.' }, { id: 'a1', role: 'assistant', text: 'Sorry.' }],
    facts: [a, b, c, own, pinned].map(({ id, key, type, text }) => ({ id, key, type, text })) };

  const { tidied } = dreaming.applyDream(controller, {
    diary: 'A quiet day.', memories: [], intentions: [],
    tidy: [{ ids: [a.id, b.id], text: 'The user likes hiking in the Alps and the mountains on holiday.' },
      { ids: [own.id, pinned.id], text: 'Should not happen.' },
      { ids: [a.id, 'invented'], text: 'Should not happen either.' }],
    outdated: [{ id: c.id, sourceIds: ['u1'] }, { id: own.id, sourceIds: ['u1'] }, { id: pinned.id, sourceIds: ['a1'] }],
  }, material);

  assert.equal(tidied, 2);
  assert.equal(service.get(a.id).status, 'superseded');
  assert.equal(service.get(b.id).status, 'superseded');
  assert.equal(service.get(c.id).status, 'superseded');
  assert.equal(service.get(own.id).status, 'active');
  assert.equal(service.get(pinned.id).status, 'active');
  const merged = service.search({ query: 'hiking Alps', source: 'facts', workspace }).results[0];
  assert.match(merged.text, /Alps and the mountains/);
  assert.equal(merged.supersedes, a.id);
  assert.equal(data.companion.dreams.at(-1).tidied, 2);
  assert.ok(service.search({ query: 'marathon', source: 'facts', workspace, includeSuperseded: true }).results.length, 'a retired fact can still be found');
});

test('a model that leaves the tidy lists out still dreams', () => {
  const dream = dreaming.normalizeDream({ diary: 'Hello.', memories: [], intentions: [] });
  assert.deepEqual(dream.tidy, []);
  assert.deepEqual(dream.outdated, []);
});

test('the old working state is gone, and stored vectors are smaller', async t => {
  const service = fixture(t);
  assert.equal(service.db.prepare("SELECT name FROM sqlite_master WHERE name='working_state'").get(), undefined);
  const record = service.save({ text: 'A fact to embed.', type: 'fact', scope: 'global' });
  service.embed = async () => [[0.123456789012, -0.987654321098]];
  await service.refreshEmbeddings();
  assert.equal(service.db.prepare('SELECT embedding FROM records WHERE id=?').get(record.id).embedding, '[0.12346,-0.98765]');
});
