'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../src/store.cjs');
const { MemoryService } = require('../src/memory-service.cjs');
const { Controller, STREAM_SAVE_MS } = require('../src/controller.cjs');
const { fakeLocalServer } = require('./fake-local-server.cjs');

const workspace = 'C:\\work';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-save-path-'));
  const open = [];
  t.after(() => { for (const item of open) item.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return {
    directory,
    store(options = {}) {
      const store = new Store({ filePath: path.join(directory, 'state.json'), defaultWorkspace: directory, ...options });
      open.push({ close: () => store.close() });
      return store;
    },
    memory(filename = path.join(directory, 'memory.sqlite')) {
      const service = new MemoryService({ filename });
      open.push({ close: () => { try { service.close(); } catch { /* Closed by the test. */ } } });
      return service;
    },
  };
}

// Stamped as the app stamps them: a record without a time gets the current one on every save.
const stamp = Date.UTC(2026, 10, 25);
const chat = (id, texts) => ({ id, title: `Chat ${id}`, workspace, createdAt: stamp, updatedAt: stamp, ...(id === 'main' ? {} : { session: true }),
  messages: texts.map((text, index) => ({ id: `${id}-${index}`, role: index % 2 ? 'assistant' : 'user', text, createdAt: stamp + index })) });
const changes = service => service.db.prepare('SELECT total_changes() AS count').get().count;
const found = (service, query) => service.search({ query, workspace }).results.map(result => result.text);
const searchIndexInStep = service => {
  const count = sql => service.db.prepare(sql).get().count;
  const records = count('SELECT COUNT(*) AS count FROM records');
  return records === count('SELECT COUNT(*) AS count FROM records_fts')
    && records === count('SELECT COUNT(*) AS count FROM records r JOIN records_fts f ON f.rowid=r.rowid WHERE f.id=r.id');
};

test('an unchanged state is neither reindexed nor written again', t => {
  const f = fixture(t);
  const store = f.store();
  store.data.chats.push(chat('main', ['plan the garden shed', 'Start with the foundation.']), chat('s1', ['tune the violin']));
  store.save();
  const written = [];
  const renameSync = fs.renameSync;
  fs.renameSync = (from, to) => { written.push(to); return renameSync(from, to); };
  t.after(() => { fs.renameSync = renameSync; });
  const before = changes(store.memoryService);
  store.save();
  store.save();
  assert.equal(changes(store.memoryService), before, 'no database row was rewritten');
  assert.deepEqual(written, [], 'the state file was not rewritten');
  store.data.chats[0].messages.push({ id: 'main-2', role: 'user', text: 'and the roof' });
  store.save();
  assert.deepEqual(written, [store.filePath]);
  assert.ok(changes(store.memoryService) > before);
});

test('a message that keeps growing is reindexed each save and only its newest text is found', t => {
  const f = fixture(t);
  const store = f.store();
  store.data.chats.push(chat('main', ['how do herons fish']));
  const reply = { id: 'reply', role: 'assistant', text: 'Herons stand' };
  store.data.chats[0].messages.push(reply);
  store.save();
  reply.text = 'Herons stand perfectly still';
  store.save();
  reply.text = 'Herons wade slowly';
  store.save();
  assert.deepEqual(found(store.memoryService, 'perfectly'), []);
  assert.deepEqual(found(store.memoryService, 'wade'), ['Herons wade slowly']);
  assert.ok(searchIndexInStep(store.memoryService));
  store.memoryService.forgetSession('main');
  assert.deepEqual(found(store.memoryService, 'herons'), []);
  assert.ok(searchIndexInStep(store.memoryService), 'deleted records leave nothing in the search index');
});

test('a reopened store keeps its history searchable without rewriting it', t => {
  const f = fixture(t);
  let store = f.store();
  store.data.chats.push(chat('main', ['the lighthouse keeper log', 'Entry one: fog.']));
  store.save();
  store.close();
  store = f.store();
  const before = changes(store.memoryService);
  store.save();
  assert.equal(changes(store.memoryService), before);
  assert.deepEqual(found(store.memoryService, 'lighthouse'), ['the lighthouse keeper log']);
});

test('a memory database from an older release moves its search index onto record rowids', t => {
  const f = fixture(t);
  const filename = path.join(f.directory, 'memory.sqlite');
  let service = f.memory(filename);
  service.indexAll([chat('main', ['amber kestrel nest', 'cobalt otter den', 'saffron moth wing'])]);
  service.close();
  // The layout releases up to 0.55 wrote: the index found records by id, with rowids of its own.
  const db = new DatabaseSync(filename);
  db.exec(`DROP TRIGGER records_ai; DROP TRIGGER records_ad; DROP TRIGGER records_au;
    DELETE FROM settings WHERE key='search_index';
    DELETE FROM records_fts; INSERT INTO records_fts(rowid,id,text) SELECT rowid+1000,id,text FROM records;
    CREATE TRIGGER records_ai AFTER INSERT ON records BEGIN INSERT INTO records_fts(id,text) VALUES(new.id,new.text); END;
    CREATE TRIGGER records_ad AFTER DELETE ON records BEGIN DELETE FROM records_fts WHERE id=old.id; END;
    CREATE TRIGGER records_au AFTER UPDATE OF text ON records BEGIN DELETE FROM records_fts WHERE id=old.id; INSERT INTO records_fts(id,text) VALUES(new.id,new.text); END;`);
  db.close();
  service = f.memory(filename);
  assert.ok(searchIndexInStep(service));
  const triggers = service.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'records_a%'").all().map(row => row.sql);
  assert.equal(triggers.length, 3);
  for (const sql of triggers) assert.match(sql, /rowid/);
  assert.deepEqual(found(service, 'kestrel'), ['amber kestrel nest']);
  service.indexAll([chat('main', ['amber kestrel nest', 'cobalt otter lodge', 'saffron moth wing'])]);
  assert.deepEqual(found(service, 'den'), []);
  assert.deepEqual(found(service, 'lodge'), ['cobalt otter lodge']);
  assert.ok(searchIndexInStep(service));
});

test('a search index that drifted from its records is rebuilt on opening', t => {
  const f = fixture(t);
  const filename = path.join(f.directory, 'memory.sqlite');
  let service = f.memory(filename);
  service.indexAll([chat('main', ['quartz canyon trail', 'basalt ridge climb'])]);
  // As after a copy that renumbered the records: one index entry no longer points at its record.
  service.db.exec("DELETE FROM records_fts WHERE rowid=(SELECT MIN(rowid) FROM records_fts)");
  assert.equal(searchIndexInStep(service), false);
  service.close();
  service = f.memory(filename);
  assert.ok(searchIndexInStep(service));
  assert.deepEqual(found(service, 'quartz'), ['quartz canyon trail']);
});

test('the memory summary is reread only after the database changed', t => {
  const f = fixture(t);
  const service = f.memory();
  service.indexAll([chat('main', ['walnut desk varnish'])]);
  const first = service.snapshot();
  first.records.push({ id: 'caller-owned' });
  assert.deepEqual(service.snapshot().records.map(record => record.id), [], 'each caller gets its own copy');
  service.save({ type: 'fact', text: 'The desk is walnut.', workspace });
  assert.deepEqual(service.snapshot().facts.map(fact => fact.text), ['The desk is walnut.']);
  const before = changes(service);
  service.enabled = true;
  assert.equal(changes(service), before, 'an unchanged setting is not written');
  service.enabled = false;
  assert.equal(service.snapshot().enabled, false);
});

class StreamingClient extends EventEmitter {
  constructor() { super(); this.turns = 0; this.threads = 0; }
  async start() {} async close() {} async restart() {}
  async request(method, params = {}) {
    if (method === 'thread/start') return { thread: { id: `thread-${++this.threads}` } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'turn/start') return { turn: { id: `turn-${++this.turns}` } };
    return {};
  }
  async respond() {} async reject() {}
}

test('a streaming reply is written every 15 seconds, and at once when it finishes', async t => {
  assert.equal(STREAM_SAVE_MS, 15000);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-stream-save-'));
  const server = await fakeLocalServer();
  const store = new Store({ filePath: path.join(directory, 'state.json'), defaultWorkspace: directory });
  Object.assign(store.data.settings, { localBaseUrl: server.url, localModel: 'test-model', model: 'test-model', workspace: directory, independentCheckMode: 'off' });
  const client = new StreamingClient();
  const controller = new Controller({ store, client });
  await controller.start();
  t.after(async () => { t.mock.timers.reset(); await controller.close(); await server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const chat = controller.chat((await controller.send({ text: 'How do tides work?' })).chatId);
  const turnId = `turn-${client.turns}`;
  let writes = 0;
  const save = store.save.bind(store);
  store.save = () => { writes++; return save(); };
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const stream = seconds => {
    for (let second = 0; second < seconds; second++) {
      client.emit('notification', 'item/agentMessage/delta', { threadId: chat.threadId, turnId, itemId: 'reply', delta: `word${second} ` });
      t.mock.timers.tick(1000);
    }
  };
  stream(14);
  assert.equal(writes, 0, 'fourteen seconds of streaming write nothing');
  stream(1);
  assert.equal(writes, 1);
  stream(14);
  assert.equal(writes, 1);
  stream(1);
  assert.equal(writes, 2);
  client.emit('notification', 'item/completed', { threadId: chat.threadId, turnId, item: { type: 'agentMessage', id: 'reply', text: 'Tides follow the moon.', phase: 'final_answer' } });
  client.emit('notification', 'turn/completed', { threadId: chat.threadId, turn: { id: turnId, status: 'completed' } });
  assert.equal(writes, 3, 'the finished reply is written without waiting');
  assert.match(JSON.stringify(JSON.parse(fs.readFileSync(store.filePath, 'utf8')).chats), /Tides follow the moon/);
});
