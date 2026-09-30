'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { migrateTools } = require('../src/tool-migration.cjs');

for (const scenario of ['relocated', 'wrong identity', 'missing local', 'windows casing']) {
  test(`tool migration history path: ${scenario}`, { skip: scenario === 'windows casing' && process.platform !== 'win32' }, t => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-path-'));
    let db;
    t.after(() => { db?.close(); fs.rmSync(base, { recursive: true, force: true }); });
    const home = path.join(base, 'current'), old = path.join(base, 'previous');
    fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(old, 'sessions'), { recursive: true });
    const id = '11111111-1111-1111-1111-111111111111';
    const local = path.join(home, 'sessions', 'rollout.jsonl');
    const previous = path.join(old, 'sessions', 'rollout.jsonl');
    const tail = '\n{"type":"response_item","payload":{"text":"preserve me"}}\n';
    const header = { type: 'session_meta', payload: { id } };
    const original = JSON.stringify(header) + tail;
    fs.writeFileSync(previous, original);
    if (scenario === 'wrong identity') header.payload.id = '22222222-2222-2222-2222-222222222222';
    if (scenario !== 'missing local') fs.writeFileSync(local, JSON.stringify(header) + tail);
    db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
    db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT);CREATE TABLE thread_dynamic_tools(thread_id TEXT,position INTEGER,name TEXT,description TEXT,input_schema TEXT,defer_loading INTEGER,namespace TEXT)');
    const saved = scenario === 'windows casing' ? local.toUpperCase() : previous;
    db.prepare('INSERT INTO threads VALUES(?,?)').run(id, saved);
    const tools = [{ name: 'example', description: 'example', inputSchema: { type: 'object' } }];
    if (scenario === 'wrong identity' || scenario === 'missing local') {
      assert.throws(() => migrateTools(home, id, tools), scenario === 'wrong identity' ? /identity mismatch/ : /outside its data folder/);
      assert.equal(db.prepare('SELECT rollout_path FROM threads').get().rollout_path, saved);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM thread_dynamic_tools').get().count, 0);
    } else {
      migrateTools(home, id, tools);
      const result = fs.readFileSync(local, 'utf8');
      assert.equal(result.slice(result.indexOf('\n')), tail);
      assert.equal(path.relative(local, db.prepare('SELECT rollout_path FROM threads').get().rollout_path), '');
      assert.equal(db.prepare('SELECT name FROM thread_dynamic_tools').get().name, 'example');
    }
    assert.equal(fs.readFileSync(previous, 'utf8'), original);
  });
}
