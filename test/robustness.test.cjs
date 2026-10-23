'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');

function folder(t, name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `little-bot-${name}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('Stop cancels the app tools still running, and their late result cannot end the next turn', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-late-tool-'));
  const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
  const client = new EventEmitter();
  const pending = new Set();
  Object.assign(client, {
    pending: id => pending.has(id),
    respond: async id => { if (!pending.has(id)) throw new Error('This engine request is no longer pending.'); pending.delete(id); },
    reject: async () => {}, request: async () => ({}), close: async () => {},
  });
  const errors = [];
  const controller = new Controller({ store, client, onError: (source, error) => errors.push(`${source}: ${error.message}`) });
  t.after(async () => { await controller.close(); fs.rmSync(root, { recursive: true, force: true }); });
  controller.runtime = { status: 'ready' };
  let release, signal;
  controller.agentTools = { specs: () => [], call: (_name, _args, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); } };
  const chat = { id: 'c1', title: 'Conversation', threadId: 't1', workspace: root, model: 'm', status: 'running', messages: [{ id: 'u1', role: 'user', text: 'hi' }], createdAt: 1, updatedAt: 1 };
  store.data.chats.push(chat);
  controller.turns.set('c1', 'turn1');
  pending.add(5);
  client.emit('request', { id: 5, method: 'item/tool/call', params: { threadId: 't1', turnId: 'turn1', callId: 'a', tool: 'web_scrape', arguments: {} } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signal.aborted, false);

  await controller.stop({ chatId: 'c1' });
  assert.equal(signal.aborted, true, 'Stop reaches the running web read');
  pending.delete(5);
  controller.notification('turn/completed', { threadId: 't1', turn: { id: 'turn1', status: 'interrupted' } });
  chat.status = 'running'; chat.error = null; controller.turns.set('c1', 'turn2');
  release({ ok: true });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(chat.status, 'running', 'the new turn keeps running');
  assert.equal(chat.error, null);
  assert.deepEqual(errors, []);
});

test('deleting a session removes its engine transcript and nothing else', t => {
  const { removeThreadHistory } = require('../src/tool-migration.cjs');
  const home = folder(t, 'engine-home');
  const day = path.join(home, 'sessions', '2026', '10', '22');
  fs.mkdirSync(day, { recursive: true });
  const gone = '01a0f9c6-0467-7b51-a3de-4c84bbf834ca', kept = '01a0fd58-3248-79c3-a4b3-8dd07745fc0c';
  for (const name of [`rollout-2026-10-22T01-21-39-${gone}.jsonl`, `rollout-2026-10-22T01-21-39-${gone}.jsonl.tools-7771714736a0.bak`, `rollout-2026-10-22T18-00-10-${kept}.jsonl`]) fs.writeFileSync(path.join(day, name), '{}\n');
  assert.equal(removeThreadHistory(home, gone), 2);
  assert.deepEqual(fs.readdirSync(day), [`rollout-2026-10-22T18-00-10-${kept}.jsonl`]);
  assert.throws(() => removeThreadHistory(home, '../../x'), /Invalid/);
});

test('an attachment name cleaned once comes back unchanged', () => {
  const { safeName } = require('../src/attachments.cjs');
  const long = `${'a'.repeat(159)} ${'b'.repeat(20)}.pdf`;
  assert.equal(safeName(safeName(long)), safeName(long));
  assert.equal(/[ .]$/.test(safeName(long)), false);
});

test('a restore keeps the memory journal in the safety copy, and restores it from one', t => {
  const backups = require('../src/backups.cjs');
  const stateDir = folder(t, 'restore');
  const day = path.join(stateDir, 'backups', '2026-10-20');
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, 'memory.sqlite'), 'old db');
  fs.writeFileSync(path.join(stateDir, 'memory.sqlite'), 'live db');
  fs.writeFileSync(path.join(stateDir, 'memory.sqlite-wal'), 'recent memories');
  fs.writeFileSync(path.join(stateDir, 'state.json'), '{}');
  backups.requestRestore(stateDir, '2026-10-20');
  const result = backups.applyPendingRestore(stateDir, 1000);
  assert.equal(result.restored, '2026-10-20');
  const safety = path.join(stateDir, 'backups', result.safety);
  assert.equal(fs.readFileSync(path.join(safety, 'memory.sqlite-wal'), 'utf8'), 'recent memories');
  assert.equal(fs.existsSync(path.join(stateDir, 'memory.sqlite-wal')), false, 'the old journal is not applied to the restored database');
  backups.requestRestore(stateDir, result.safety);
  backups.applyPendingRestore(stateDir, 2000);
  assert.equal(fs.readFileSync(path.join(stateDir, 'memory.sqlite-wal'), 'utf8'), 'recent memories', 'undoing the restore brings the journal back');
});

test('a new clipboard capture survives the pruning of old screenshots', t => {
  const { DesktopTools } = require('../src/desktop-tools.cjs');
  const root = folder(t, 'captures');
  for (let index = 0; index < 20; index++) fs.writeFileSync(path.join(root, `screen-${1000 + index}.jpg`), '');
  fs.writeFileSync(path.join(root, 'clipboard-5000.jpg'), '');
  DesktopTools.prototype.prune.call({ root });
  assert.equal(fs.existsSync(path.join(root, 'clipboard-5000.jpg')), true);
  assert.equal(fs.existsSync(path.join(root, 'screen-1000.jpg')), false, 'the oldest one goes instead');
});

test('a calendar list that ends on a date covers that whole day', () => {
  const { listCalendarEvents } = require('../src/calendar.cjs');
  const at = (day, hour) => new Date(2026, 9, day, hour).getTime();
  const event = (id, title, day, hour) => ({ id, title, startAt: at(day, hour), endAt: at(day, hour + 1), allDay: false, location: '', notes: '', createdAt: 1, updatedAt: 1 });
  const calendar = { events: [event('a', 'Dentist', 24, 15), event('b', 'Market', 25, 9)] };
  const titles = range => listCalendarEvents(calendar, range).map(item => item.title);
  assert.deepEqual(titles({ fromLocal: '2026-10-24', toLocal: '2026-10-24' }), ['Dentist'], 'one date at both ends lists that day');
  assert.deepEqual(titles({ fromLocal: '2026-10-24', toLocal: '2026-10-25' }), ['Dentist', 'Market']);
  assert.deepEqual(titles({ fromLocal: '2026-10-24T00:00', toLocal: '2026-10-24T15:00' }), [], 'a time is still an exact end');
  assert.throws(() => titles({ fromLocal: '2026-10-25', toLocal: '2026-10-24' }), /after its start/);
});

test('every app action offered to the model has a handler in the app', () => {
  const { OPERATIONS } = require('../src/app-management.cjs');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const registered = new Set([...main.matchAll(/register\('([A-Za-z]+)'/g)].map(match => match[1]));
  const missing = Object.entries(OPERATIONS).flatMap(([tool, actions]) => Object.entries(actions)
    .filter(([, handler]) => handler && !registered.has(handler)).map(([action, handler]) => `${tool} ${action} (${handler})`));
  assert.deepEqual(missing, []);
});

test('web search and page reads reach the web tools through the agent tools, with the turn\'s Stop signal', async () => {
  const { AgentTools } = require('../src/agent-tools.cjs');
  const calls = [];
  const webServices = { specs: () => [
    { type: 'function', name: 'web_search_service', description: 'Search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: [], additionalProperties: false } },
    { type: 'function', name: 'web_scrape', description: 'Read', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: [], additionalProperties: false } },
  ], call: async (name, args, options) => { calls.push({ name, args, signal: options?.signal }); return { ok: true }; } };
  const tools = new AgentTools({ store: { data: { settings: {}, extensions: { skills: [] } } }, webServices });
  const chat = { id: 'c1', status: 'running', messages: [] };
  const controller = new AbortController();
  assert.deepEqual(await tools.call('web_scrape', { url: 'https://example.com/' }, { chat, signal: controller.signal }), { ok: true });
  assert.deepEqual(await tools.call('web_search_service', { query: 'heat pump' }, { chat }), { ok: true });
  assert.equal(calls[0].signal, controller.signal);
  assert.deepEqual(calls.map(call => call.name), ['web_scrape', 'web_search_service']);
});
