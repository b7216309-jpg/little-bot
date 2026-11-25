'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store.cjs');
const { ChatJournal } = require('../src/chat-journal.cjs');
const backups = require('../src/backups.cjs');

// Reverses the bytes: enough to tell encrypted lines from plain ones, and to fail like another Windows account.
const protector = {
  encryptString: text => Buffer.from([...Buffer.from(text, 'utf8')].reverse()),
  decryptString: buffer => Buffer.from([...buffer].reverse()).toString('utf8'),
};
const otherAccount = { encryptString: protector.encryptString, decryptString: () => { throw new Error('wrong key'); } };

const stamp = Date.UTC(2026, 10, 25);
const message = (id, text, extra = {}) => ({ id, role: 'user', text, createdAt: stamp, ...extra });
const chat = (id, messages, extra = {}) => ({ id, title: `Chat ${id}`, createdAt: stamp, updatedAt: stamp, ...(id === 'main' ? {} : { session: true }), messages, ...extra });

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-journal-'));
  const open = [];
  t.after(() => { for (const store of open) store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const filePath = path.join(directory, 'state.json');
  return {
    directory, filePath,
    journal: path.join(directory, 'chats.journal'),
    store(options = {}) { const store = new Store({ filePath, defaultWorkspace: directory, ...options }); open.push(store); return store; },
  };
}
const lines = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
const texts = store => store.data.chats.map(item => [item.id, item.messages.map(entry => entry.text)]);

test('a state file from 0.56 moves its conversations into the journal on the first save', t => {
  const f = fixture(t);
  fs.writeFileSync(f.filePath, JSON.stringify({ chats: [chat('main', [message('a', 'tide tables'), message('b', 'moon phases')]), chat('s1', [message('c', 'harbour map')])] }));
  const store = f.store();
  assert.deepEqual(texts(store), [['main', ['tide tables', 'moon phases']], ['s1', ['harbour map']]]);
  store.save();
  const saved = JSON.parse(fs.readFileSync(f.filePath, 'utf8'));
  assert.equal(saved.chatJournal, 1);
  assert.deepEqual(saved.chats, []);
  assert.equal(JSON.parse(lines(f.journal)[0].slice(1)).t, 'journal');
  store.close();
  assert.deepEqual(texts(f.store()), [['main', ['tide tables', 'moon phases']], ['s1', ['harbour map']]]);
});

test('saves append only what changed, and the latest record wins', t => {
  const f = fixture(t);
  const store = f.store();
  store.data.chats.push(chat('main', [message('a', 'first question')]));
  store.save();
  const before = lines(f.journal).length;
  store.save();
  assert.equal(lines(f.journal).length, before, 'an unchanged save appends nothing');
  const reply = message('r', 'Draft', { role: 'assistant' });
  store.data.chats[0].messages.push(reply);
  store.save();
  reply.text = 'Draft, then more';
  store.save();
  reply.text = 'Draft, then more, then the end';
  store.save();
  assert.equal(lines(f.journal).length, before + 3, 'one line per changed message per save');
  store.data.chats[0].title = 'Renamed';
  store.save();
  assert.equal(lines(f.journal).length, before + 4);
  store.close();
  const reopened = f.store();
  assert.equal(reopened.data.chats[0].title, 'Renamed');
  assert.deepEqual(texts(reopened), [['main', ['first question', 'Draft, then more, then the end']]]);
});

test('removed messages and deleted sessions stay removed after reopening', t => {
  const f = fixture(t);
  const store = f.store();
  store.data.chats.push(chat('main', [message('a', 'keep'), message('b', 'drop'), message('c', 'keep too')]), chat('s1', [message('d', 'session')]), chat('s2', [message('e', 'other')]));
  store.save();
  store.data.chats[0].messages = store.data.chats[0].messages.filter(entry => entry.id !== 'b');
  store.data.chats = store.data.chats.filter(item => item.id !== 's1');
  store.save();
  store.close();
  assert.deepEqual(texts(f.store()), [['main', ['keep', 'keep too']], ['s2', ['other']]]);
});

test('the journal is rewritten once superseded lines outweigh the live ones', t => {
  const f = fixture(t);
  const journal = new ChatJournal({ filePath: f.journal, rewriteSlackBytes: 0 });
  const chats = [chat('main', [message('a', 'x'.repeat(200)), message('b', 'streaming')])];
  assert.equal(journal.write(chats).rewritten, true, 'the first save writes the whole file');
  const results = [];
  for (let step = 0; step < 12; step++) {
    chats[0].messages[1].text += ` more ${step}`;
    results.push(journal.write(chats));
  }
  assert.ok(results.some(result => result.rewritten), 'growing junk triggered a rewrite');
  assert.ok(fs.statSync(f.journal).size <= 2 * journal.liveBytes() + 1, 'the file stays within twice what it holds');
  const reread = new ChatJournal({ filePath: f.journal });
  assert.deepEqual(reread.read().map(item => item.messages.map(entry => entry.text)), [chats[0].messages.map(entry => entry.text)]);
});

test('a torn last line from a crash is dropped and the next save rewrites a clean file', t => {
  const f = fixture(t);
  let store = f.store();
  store.data.chats.push(chat('main', [message('a', 'safe line')]));
  store.save();
  store.close();
  fs.appendFileSync(f.journal, 'j{"t":"m","c":"main","m":{"id":"b","role":"user","te');
  store = f.store();
  assert.equal(store.warning, null);
  assert.deepEqual(texts(store), [['main', ['safe line']]]);
  store.data.chats[0].messages.push(message('c', 'after the crash'));
  store.save();
  assert.ok(fs.readFileSync(f.journal, 'utf8').endsWith('\n'));
  store.close();
  assert.deepEqual(texts(f.store()), [['main', ['safe line', 'after the crash']]]);
});

test('an unreadable line in the middle is skipped with a warning and the original is kept', t => {
  const f = fixture(t);
  let store = f.store();
  store.data.chats.push(chat('main', [message('a', 'one'), message('b', 'two'), message('c', 'three')]));
  store.save();
  store.close();
  const original = lines(f.journal);
  const damaged = original.map(line => line.includes('"two"') ? 'j{not json' : line);
  fs.writeFileSync(f.journal, `${damaged.join('\n')}\n`);
  store = f.store();
  assert.match(store.warning, /1 saved conversation record was unreadable/);
  assert.deepEqual(texts(store), [['main', ['one', 'three']]]);
  store.save();
  const copies = fs.readdirSync(f.directory).filter(name => name.startsWith('chats.journal.corrupt-'));
  assert.equal(copies.length, 1);
  assert.match(fs.readFileSync(path.join(f.directory, copies[0]), 'utf8'), /j\{not json/);
  assert.doesNotMatch(fs.readFileSync(f.journal, 'utf8'), /not json/);
});

test('with secure storage every line is encrypted, and another account cannot overwrite them', t => {
  const f = fixture(t);
  let store = f.store({ protector });
  store.data.chats.push(chat('main', [message('a', 'private harbour notes')]));
  store.save();
  store.close();
  const text = fs.readFileSync(f.journal, 'utf8');
  assert.doesNotMatch(text, /harbour/);
  for (const line of lines(f.journal)) assert.equal(line[0], 'e');
  assert.deepEqual(texts(f.store({ protector })), [['main', ['private harbour notes']]]);
  const locked = f.store({ protector: otherAccount });
  assert.equal(locked.locked, true);
  assert.match(locked.warning, /could not be decrypted/);
  assert.throws(() => locked.save(), /locked/);
  assert.equal(fs.readFileSync(f.journal, 'utf8'), text, 'the journal is untouched');
});

test('a state file written again by an older version wins over the journal', t => {
  const f = fixture(t);
  let store = f.store();
  store.data.chats.push(chat('main', [message('a', 'before the downgrade')]));
  store.save();
  store.close();
  // 0.56 rewrites state.json with the conversations inside and drops the marker it does not know.
  fs.writeFileSync(f.filePath, JSON.stringify({ chats: [chat('main', [message('a', 'before the downgrade'), message('b', 'during the downgrade')])] }));
  store = f.store();
  assert.deepEqual(texts(store), [['main', ['before the downgrade', 'during the downgrade']]]);
  store.save();
  store.close();
  assert.deepEqual(texts(f.store()), [['main', ['before the downgrade', 'during the downgrade']]]);
});

test('conversations survive a missing state file, and a missing journal is reported', t => {
  const f = fixture(t);
  let store = f.store();
  store.data.chats.push(chat('main', [message('a', 'still here')]));
  store.save();
  store.close();
  fs.rmSync(f.filePath);
  store = f.store();
  assert.deepEqual(texts(store), [['main', ['still here']]]);
  store.save();
  store.close();
  fs.rmSync(f.journal);
  store = f.store();
  assert.match(store.warning, /chats\.journal\) is missing/);
  assert.deepEqual(store.data.chats, []);
});

test('a failed append is not half-kept: the next save rewrites the journal whole', t => {
  const f = fixture(t);
  const store = f.store();
  store.data.chats.push(chat('main', [message('a', 'kept')]));
  store.save();
  const writeSync = fs.writeSync;
  fs.writeSync = (descriptor, data, ...rest) => {
    if (typeof data === 'string' && data.includes('lost in the failure')) { writeSync(descriptor, data.slice(0, 12)); throw new Error('disk full'); }
    return writeSync(descriptor, data, ...rest);
  };
  store.data.chats[0].messages.push(message('b', 'lost in the failure'));
  try { assert.throws(() => store.save(), /disk full/); }
  finally { fs.writeSync = writeSync; }
  store.data.chats[0].messages.push(message('c', 'after'));
  store.save();
  store.close();
  assert.deepEqual(texts(f.store()), [['main', ['kept', 'lost in the failure', 'after']]]);
});

test('restore points carry the journal, and an older one without it brings its own conversations back', t => {
  const f = fixture(t);
  const store = f.store();
  store.data.chats.push(chat('main', [message('a', 'in the backup')]));
  store.save();
  const created = backups.createBackup({ stateDir: f.directory, memoryService: store.memoryService, nowMs: stamp });
  assert.ok(created.files.includes('chats.journal'));
  // An older restore point: conversations inside state.json, no journal.
  const older = path.join(f.directory, 'backups', '2026-11-20');
  fs.mkdirSync(older, { recursive: true });
  fs.copyFileSync(path.join(f.directory, 'backups', created.id, 'memory.sqlite'), path.join(older, 'memory.sqlite'));
  fs.writeFileSync(path.join(older, 'state.json'), JSON.stringify({ chats: [chat('main', [message('z', 'from 0.56')])] }));
  store.data.chats[0].messages.push(message('b', 'after the backup'));
  store.save();
  store.close();
  backups.requestRestore(f.directory, created.id);
  backups.applyPendingRestore(f.directory, stamp + 1);
  let reopened = f.store();
  assert.deepEqual(texts(reopened), [['main', ['in the backup']]]);
  reopened.close();
  backups.requestRestore(f.directory, '2026-11-20');
  backups.applyPendingRestore(f.directory, stamp + 2);
  reopened = f.store();
  assert.deepEqual(texts(reopened), [['main', ['from 0.56']]]);
});
