'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LocalEmbeddings } = require('../src/local-embeddings.cjs');
const { MemoryService } = require('../src/memory-service.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('bundled CPU model embeds offline and distinguishes paraphrases from unrelated text', async t => {
  const encoder = new LocalEmbeddings(); t.after(() => encoder.close());
  const vectors = await encoder.embed(['Keep answers short and direct.', 'I prefer concise replies.', 'Bananas are yellow tropical fruit.']);
  const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
  for (const v of vectors) { assert.equal(v.length, 768); assert.ok(v.every(Number.isFinite)); assert.ok(Math.abs(dot(v, v) - 1) < 1e-5); }
  assert.ok(dot(vectors[0], vectors[1]) > 0.45);
  assert.ok(dot(vectors[0], vectors[1]) > dot(vectors[0], vectors[2]) + 0.3);
  const long = await encoder.embed(['Neutral filler. '.repeat(180) + ' I prefer concise replies. '.repeat(180), 'Neutral filler. '.repeat(180)]);
  assert.ok(dot(long[0], vectors[1]) > dot(long[1], vectors[1]) + 0.15, 'Later token windows affect the embedding.');
});

test('local hybrid recall indexes useful text, excludes trace noise and supports disabling', async t => {
  const m = new MemoryService(); t.after(() => m.close());
  const preference = m.save({ text: 'Keep answers short and direct.', scope: 'global', type: 'preference' });
  m.save({ text: 'Bananas are yellow tropical fruit.', scope: 'global' });
  m.indexChat({ id: 'chat', messages: [{ id: 'trace', role: 'tool', kind: 'agent', text: 'Concise replies tool completed' }, { id: 'user', role: 'user', text: 'Working on a garden project.' }] });
  assert.equal(await m.refreshEmbeddings(), 3);
  assert.equal(await m.prepareQuery('I prefer concise replies.'), true);
  const results = m.search({ query: 'I prefer concise replies.', scope: 'all' }).results;
  assert.equal(results[0].id, preference.id);
  assert.ok(!results.some(r => r.messageId === 'trace'));
  assert.ok(!results.some(r => r.text.includes('Bananas')));
  assert.equal(m.readSession({ sessionId: 'chat' }).messages[0].id, 'trace');
  assert.equal(m.snapshot().stats.archivedTraceCount, 1);
  m.configureEmbedding(null);
  assert.equal(await m.prepareQuery('short'), false);
  assert.equal(m.snapshot().stats.embeddingCount, 0);
  assert.equal(m.search({ query: 'short', scope: 'all' }).results[0].id, preference.id);
});

test('existing databases archive trace noise on upgrade without deleting transcripts or custom settings', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-embedding-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = path.join(root, 'memory.sqlite');
  let m = new MemoryService({ filename });
  m.indexChat({ id: 'old', messages: [{ id: 'tool', role: 'tool', text: 'web_search completed' }, { id: 'user', role: 'user', text: 'Use short answers.' }] });
  m.configureEmbedding({ baseUrl: 'http://localhost:1234/v1', model: 'custom' });
  m.db.exec('ALTER TABLE records DROP COLUMN recallable');
  m.close();
  m = new MemoryService({ filename });
  try {
    assert.equal(m.embedding.model, 'custom');
    assert.equal(m.search({ scope: 'all' }).results.length, 1);
    assert.equal(m.readSession({ sessionId: 'old' }).messages.length, 2);
    assert.equal(m.snapshot().stats.archivedTraceCount, 1);
  } finally { m.close(); }
});
