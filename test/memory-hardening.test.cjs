'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const backups = require('../src/backups.cjs');
const { Store } = require('../src/store.cjs');
const { saveFact } = require('../src/memory.cjs');
const { MemoryService } = require('../src/memory-service.cjs');
const { MemoryConsolidator } = require('../src/memory-consolidator.cjs');
const proactive = require('../src/proactive-chat.cjs');

const DAY = 86400000;
// One cleanup per test: close every open database first, then delete the folder (Windows locks open files).
const closers = new WeakMap();
function own(t, closable) { closers.get(t)?.push(closable); return closable; }
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-memory-hardening-'));
  if (!closers.has(t)) {
    const list = []; closers.set(t, list);
    t.after(() => { for (const item of list.reverse()) { try { item.close(); } catch { /* already closed */ } } });
  }
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function countFacts(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare("SELECT COUNT(*) n FROM records WHERE type='fact'").get().n; } finally { db.close(); }
}

test('daily backups capture memory and state, run once per day, rotate, and restore on the next start', async t => {
  const dir = tempDir(t);
  const service = new MemoryService({ filename: path.join(dir, 'memory.sqlite') });
  own(t, service);
  service.save({ type: 'fact', text: 'The user prefers Neovim.', scope: 'global' });
  fs.writeFileSync(path.join(dir, 'state.json'), '{"version":"one"}');
  const day1 = new Date(2026, 9, 2, 10).getTime();
  const first = backups.createBackup({ stateDir: dir, memoryService: service, nowMs: day1 });
  assert.equal(first.id, '2026-10-02');
  assert.deepEqual(first.files, ['memory.sqlite', 'state.json']);
  assert.equal(countFacts(path.join(dir, 'backups', '2026-10-02', 'memory.sqlite')), 1);
  assert.equal(backups.createBackup({ stateDir: dir, memoryService: service, nowMs: day1 + 3600000 }), null, 'one per day');
  for (let index = 1; index <= 8; index++) backups.createBackup({ stateDir: dir, memoryService: service, nowMs: day1 + index * DAY });
  const listed = backups.listBackups(dir);
  assert.equal(listed.length, 7, 'keeps a week of daily backups');
  assert.equal(listed[0].id, '2026-10-10');
  assert.ok(!listed.some(item => item.id === '2026-10-02'));

  // The user's data changes after the backup, then they restore it.
  service.save({ type: 'fact', text: 'A newer fact.', scope: 'global' });
  service.close();
  fs.writeFileSync(path.join(dir, 'state.json'), '{"version":"two"}');
  assert.throws(() => backups.requestRestore(dir, '2026-10-02'), /existing backup/);
  backups.requestRestore(dir, '2026-10-10');
  const result = backups.applyPendingRestore(dir, day1 + 9 * DAY);
  assert.equal(result.restored, '2026-10-10');
  assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), '{"version":"one"}');
  assert.equal(countFacts(path.join(dir, 'memory.sqlite')), 1);
  const safety = path.join(dir, 'backups', result.safety);
  assert.equal(fs.readFileSync(path.join(safety, 'state.json'), 'utf8'), '{"version":"two"}');
  assert.equal(countFacts(path.join(safety, 'memory.sqlite')), 2, 'the replaced data survives as a safety copy');
  assert.equal(backups.applyPendingRestore(dir), null, 'the marker is consumed');
  assert.ok(backups.listBackups(dir).some(item => item.kind === 'safety'));
  fs.writeFileSync(path.join(dir, 'restore-pending.json'), JSON.stringify({ id: '2020-01-01' }));
  assert.match(backups.applyPendingRestore(dir).error, /no longer exists/);
});

test('the store notices a memory database that disappeared beside an existing conversation', async t => {
  const dir = tempDir(t);
  const filePath = path.join(dir, 'state.json');
  const first = new Store({ filePath, defaultWorkspace: dir });
  assert.equal(first.memoryWasMissing, false, 'a brand-new install is not a loss');
  first.data.chats.push({ id: 'c', title: 'Conversation', workspace: dir, status: 'idle', messages: [{ id: 'm', role: 'user', text: 'hi' }], createdAt: 1, updatedAt: 1 });
  first.save(); first.close();
  const reopened = new Store({ filePath, defaultWorkspace: dir });
  assert.equal(reopened.memoryWasMissing, false);
  reopened.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(dir, `memory.sqlite${suffix}`), { force: true });
  const afterWipe = own(t, new Store({ filePath, defaultWorkspace: dir }));
  assert.equal(afterWipe.memoryWasMissing, true);
});

test('a detached memory object re-attaches to the on-disk database instead of a throwaway one', async t => {
  const dir = tempDir(t);
  const store = own(t, new Store({ filePath: path.join(dir, 'state.json'), defaultWorkspace: dir }));
  store.data.memory = JSON.parse(JSON.stringify(store.data.memory));
  assert.equal(store.data.memory.service, undefined);
  const warnings = [];
  const warn = console.warn; console.warn = message => warnings.push(message);
  try { saveFact(store.data.memory, { text: 'Detached save still lands on disk.', scope: 'global' }, store.data.settings); }
  finally { console.warn = warn; }
  assert.equal(store.data.memory.service, store.memoryService);
  assert.ok(store.memoryService.search({ query: 'Detached save', source: 'facts', scope: 'all' }).results.length > 0);
  assert.match(warnings[0], /re-attaching/);
});

function consolidatorFixture(t) {
  const dir = tempDir(t);
  const service = new MemoryService({ filename: path.join(dir, 'memory.sqlite') });
  own(t, service);
  const chat = { id: 'chat', status: 'idle', workspace: dir, messages: [
    { id: 'u1', role: 'user', text: 'I always use Neovim and I work from Paris.' },
    { id: 'a1', role: 'assistant', text: 'Noted.' },
  ] };
  service.enqueueExtraction(chat);
  const changes = [];
  const controller = { store: { memoryService: service, data: { memory: { enabled: true }, chats: [chat] } }, changed: persisted => changes.push(persisted) };
  const consolidator = new MemoryConsolidator(controller, { autoStart: false });
  const job = service.pendingExtractions(1)[0];
  const start = output => {
    consolidator.active = { job, output: '', threadId: 'thread', turnId: 'turn', cancelled: false, resolve() {} };
    consolidator.notification('item/completed', { threadId: 'thread', item: { type: 'agentMessage', text: output } });
    consolidator.notification('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } });
  };
  return { service, chat, consolidator, changes, start };
}

const memory = (text, type = 'preference', key = text.toLowerCase().replace(/\W+/g, '.')) => ({ text, type, scope: 'global', key, supersedesId: null, sourceIds: ['u1'] });

test('learning survives reasoning tags, keeps at most three memories, and tells the user in chat', async t => {
  const f = consolidatorFixture(t);
  assert.equal(f.consolidator.hasReadyWork(), true);
  const output = JSON.stringify({ memories: [memory('Uses Neovim'), memory('Works from Paris', 'fact'), memory('Third'), memory('Fourth should be dropped')] });
  f.start(`<think>Let me pick durable facts.</think>\n${output}`);
  assert.equal(f.consolidator.lastError, null);
  const saved = f.service.search({ query: '', source: 'facts', scope: 'all', limit: 20 }).results.map(item => item.text);
  assert.deepEqual(saved.sort(), ['Third', 'Uses Neovim', 'Works from Paris']);
  const note = f.chat.messages.at(-1);
  assert.equal(note.kind, 'memory');
  assert.match(note.text, /I'll remember:\n📌 /);
  assert.match(note.text, /Works from Paris \(fact · id /);
  assert.doesNotMatch(note.text, /Fourth/);
  assert.equal(note.modelSeen, false, 'the next turn tells the model what it learned, so corrections work');
  assert.match(proactive.bridgeText(proactive.unseen(f.chat)), /memory learned/);
  assert.ok(f.changes.includes(true));
  assert.equal(f.consolidator.hasReadyWork(), false, 'no ready job remains');
});

test('an empty learning result posts nothing, and unreadable output still fails the job for retry', async t => {
  const f = consolidatorFixture(t);
  f.start('{"memories": []}');
  assert.equal(f.chat.messages.length, 2);
  const g = consolidatorFixture(t);
  g.start('I could not find anything.');
  assert.match(g.consolidator.lastError, /readable JSON/);
  assert.equal(g.service.pendingExtractions(1).length, 0, 'the failed attempt waits for its backoff');
  assert.equal(g.consolidator.hasReadyWork(), false, 'a job in backoff does not block proactive work');
});

test('learned notes are not recalled as history and are not goal evidence', async t => {
  const dir = tempDir(t);
  const service = new MemoryService({ filename: path.join(dir, 'memory.sqlite') });
  own(t, service);
  service.indexChat({ id: 'c', title: 'C', workspace: dir, messages: [{ id: 'note', role: 'assistant', kind: 'memory', text: "I'll remember: 📌 something" }] });
  const db = new DatabaseSync(path.join(dir, 'memory.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare("SELECT recallable FROM records WHERE id='history:c:note'").get().recallable, 0); } finally { db.close(); }
  const contract = require('../src/goal-contract.cjs');
  const { validateGoal } = require('../src/goals.cjs');
  const goal = validateGoal({ name: 'G', objective: 'Help', kind: 'ongoing', workspace: dir }, null, { workspace: dir });
  const evidence = await contract.collect(goal, { memory: { enabled: true }, calendar: { events: [] }, chats: [{ messages: [
    { id: 'u', role: 'user', text: 'hello' }, { id: 'note', role: 'assistant', kind: 'memory', text: "I'll remember: x", createdAt: 5 }] }] });
  assert.ok(!evidence.items.some(item => item.id === 'said:note'));
});
