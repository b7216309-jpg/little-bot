'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { parseVdf, listGames } = require('../src/steam-library.cjs');
const { ActivityMonitor } = require('../src/activity.cjs');
const { WebWatcher, safeUrl, pageText, addedLines } = require('../src/web-watch.cjs');
const proactive = require('../src/proactive-chat.cjs');
const contract = require('../src/goal-contract.cjs');
const { validateGoal } = require('../src/goals.cjs');
const { AgentTools } = require('../src/agent-tools.cjs');

const MINUTE = 60000;
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-proactive-tools-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the Steam library lists installed games by last played, with playtime, and skips tools', t => {
  assert.deepEqual(parseVdf('"A" { "b" "1" "C" { "d" "two \\"x\\"" } }'), { A: { b: '1', C: { d: 'two "x"' } } });
  const root = tempDir(t);
  const second = path.join(root, 'Library2');
  fs.mkdirSync(path.join(root, 'steamapps'), { recursive: true });
  fs.mkdirSync(path.join(second, 'steamapps'), { recursive: true });
  fs.writeFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "0" { "path" "${root.replace(/\\/g, '\\\\')}" } "1" { "path" "${second.replace(/\\/g, '\\\\')}" } }`);
  fs.writeFileSync(path.join(root, 'steamapps', 'appmanifest_100.acf'), '"AppState" { "appid" "100" "name" "Ace Combat 8" }');
  fs.writeFileSync(path.join(second, 'steamapps', 'appmanifest_200.acf'), '"AppState" { "appid" "200" "name" "Soulash 2" }');
  fs.writeFileSync(path.join(root, 'steamapps', 'appmanifest_228980.acf'), '"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" }');
  fs.mkdirSync(path.join(root, 'userdata', '42', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'userdata', '42', 'config', 'localconfig.vdf'),
    '"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" { "200" { "LastPlayed" "1790000000" "Playtime" "125" } "100" { "LastPlayed" "1790500000" "Playtime" "600" } } } } } }');
  const result = listGames({ root, limit: 10 });
  assert.equal(result.steamFound, true);
  assert.deepEqual(result.games.map(game => [game.name, game.playtimeHours]), [['Ace Combat 8', 10], ['Soulash 2', 2.1]]);
  assert.equal(result.games[0].lastPlayed, new Date(1790500000 * 1000).toISOString());
});

function fakeProbe() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => { child.killed = true; };
  return child;
}

test('activity awareness announces settled apps once, long sessions and returns, and stays in memory', () => {
  let now = 1_000_000, idle = 0;
  const events = [];
  const probe = fakeProbe();
  const monitor = new ActivityMonitor({ publish: event => events.push(event), idleSeconds: () => idle, now: () => now, spawnProbe: () => probe });
  assert.equal(monitor.snapshot(), null);
  monitor.start();
  const sample = (app, title = '') => probe.stdout.emit('data', Buffer.from(`${JSON.stringify({ app, title })}\n`));
  sample('code', 'little-bot');
  now += MINUTE; sample('AceCombat8', 'ACE COMBAT 8');
  now += MINUTE; sample('AceCombat8', 'ACE COMBAT 8');
  assert.equal(events.length, 0, 'not announced before two minutes');
  now += MINUTE; sample('AceCombat8', 'ACE COMBAT 8');
  assert.deepEqual(events.map(event => [event.type, event.payload.app]), [['activity.app_started', 'AceCombat8']]);
  now += MINUTE; sample('explorer'); sample('code');
  now += 3 * MINUTE; sample('code');
  now += MINUTE; sample('AceCombat8'); now += 3 * MINUTE; sample('AceCombat8');
  assert.equal(events.filter(event => event.payload.app === 'AceCombat8').length, 1, 'restarting within 30 minutes is not announced again');
  now += 3 * 3600000; sample('AceCombat8');
  assert.equal(events.at(-1).type, 'activity.long_session');
  idle = 2 * 3600; now += MINUTE; sample('AceCombat8');
  idle = 5; now += MINUTE; sample('AceCombat8');
  assert.equal(events.at(-1).type, 'user.returned');
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.app, 'AceCombat8');
  assert.ok(snapshot.minutesInApp >= 180);
  monitor.stop();
  assert.equal(probe.killed, true);
  assert.equal(monitor.snapshot(), null);
});

test('web watches accept only public pages, keep a baseline, then report the new text', async t => {
  for (const bad of ['file:///C:/x', 'http://localhost:3000', 'http://127.0.0.1', 'http://192.168.1.1/', 'http://10.0.0.5', 'http://172.20.1.1', 'https://user:pw@example.com', 'http://router.local/']) {
    assert.throws(() => safeUrl(bad), /http|private|credentials|Local/, bad);
  }
  assert.equal(pageText('<html><head><title>x</title></head><body><script>bad()</script><p>Patch 1.2</p><p>Fixes &amp; tweaks</p></body></html>'), 'Patch 1.2\nFixes & tweaks');
  assert.equal(addedLines('a\nb', 'a\nb\nc'), 'c');
  const dir = tempDir(t);
  let body = '<p>Patch 1.1 notes</p>';
  const responses = [];
  const fetchImpl = async url => {
    responses.push(url);
    if (url.includes('redirect')) return { status: 302, ok: false, headers: new Map([['location', 'http://127.0.0.1/admin']]), text: async () => '' };
    return { status: 200, ok: true, headers: new Map(), text: async () => body };
  };
  const store = { data: { webWatches: [] }, save() { fs.writeFileSync(path.join(dir, 'saved'), 'x'); } };
  const changes = [];
  let now = 1_000;
  const watcher = new WebWatcher({ store, fetchImpl, onChanged: change => changes.push(change), now: () => now });
  const added = watcher.add({ url: 'https://example.com/patch-notes', label: 'Game patch notes', intervalHours: 6 });
  assert.equal(added.intervalHours, 6);
  assert.throws(() => watcher.add({ url: 'https://example.com/patch-notes' }), /already/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(changes.length, 0, 'the first check is only a baseline');
  body = '<p>Patch 1.1 notes</p><p>Patch 1.2: new campaign mission</p>';
  assert.equal(await watcher.tick(), null, 'not due yet');
  now += 6 * 3600000;
  const result = await watcher.tick();
  assert.equal(result.changed, true);
  assert.deepEqual(changes.map(change => [change.label, change.added]), [['Game patch notes', 'Patch 1.2: new campaign mission']]);
  watcher.add({ url: 'https://example.com/redirect' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(watcher.list().find(item => item.url.includes('redirect')).lastError, /private/);
  assert.ok(!responses.some(url => url.includes('127.0.0.1')), 'a redirect to a private address is never fetched');
  assert.deepEqual(watcher.remove(added.id), { removed: added.id });
  assert.equal(watcher.list().length, 1);
});

test('proactive suggestions carry one-click answers that are recorded once', () => {
  const chat = { status: 'idle', messages: [] };
  const data = { chats: [chat] };
  const suggestion = proactive.deliverHeartbeat(data, { id: 'h1', status: 'alert', source: 'heartbeat', summary: 'Try the new Ace Combat mission tonight?', topic: 'Leisure' });
  assert.deepEqual(suggestion.actions.map(action => action.id), ['do', 'later', 'no']);
  assert.equal(proactive.post(data, { kind: 'goal', goalId: 'g', goalRunId: 'q', goalQuestionId: 'q1', text: 'Which day?' }).actions, undefined, 'goal questions keep their own answer form');
  assert.equal(proactive.deliverLearned(data, [{ id: 'm', text: 'x', type: 'fact' }]).actions, undefined);
  assert.throws(() => proactive.answer(data, { messageId: suggestion.id, choice: 'launch' }), /offered buttons/);
  const { entry } = proactive.answer(data, { messageId: suggestion.id, choice: 'no' }, 500);
  assert.deepEqual([entry.choice, entry.source, entry.topic], ['no', 'heartbeat', 'Leisure']);
  assert.deepEqual(suggestion.answer, { choice: 'no', at: 500 });
  assert.throws(() => proactive.answer(data, { messageId: suggestion.id, choice: 'do' }), /already answered/);
  assert.equal(data.feedbackLog.length, 1);
  const offer = proactive.deliverOffer(data, { appid: '100', name: 'Ace Combat 8', note: 'Free evening, one sortie?' });
  assert.deepEqual(offer.actions[0], { id: 'launch', label: '▶ Launch Ace Combat 8', target: 'steam://rungameid/100' });
  assert.throws(() => proactive.deliverOffer(data, { appid: 'calc.exe', name: 'x' }), /Steam game/);
  assert.deepEqual(proactive.normalizeActions([{ id: 'launch', label: 'x', target: 'file:///C:/evil.exe' }]), [], 'only Steam launch targets survive');
  const watch = proactive.deliverWatch(data, { id: 'w', label: 'Patch notes', url: 'https://example.com', added: 'Patch 1.2' });
  assert.match(watch.text, /🔎 Patch notes changed: https:\/\/example.com\nNew text:\nPatch 1.2/);
  assert.equal(watch.actions.length, 3);
});

test('a self-review goal reads reactions and the heartbeat log, and re-reviews only after a new reaction', async () => {
  const goal = validateGoal({ name: 'Self-review', objective: 'Tune my suggestions', kind: 'ongoing', workspace: process.cwd(),
    sources: { chat: false, calendar: false, files: [], feedback: true }, trigger: { type: 'interval', intervalMinutes: 10080 } }, null, { workspace: process.cwd() });
  assert.equal(goal.sources.feedback, true);
  const data = { memory: { enabled: true }, calendar: { events: [] }, chats: [],
    feedbackLog: [{ id: 'r1', at: 10, choice: 'no', source: 'heartbeat', topic: 'Leisure', excerpt: 'Play X before noon?' }],
    heartbeat: { pulse: [{ at: 11, status: 'quiet', note: 'Nothing new.' }] } };
  const first = await contract.collect(goal, data);
  assert.deepEqual(first.items.filter(item => item.kind === 'feedback').map(item => item.id), ['feedback:reactions', 'feedback:heartbeat-log']);
  assert.equal(first.changed, true);
  contract.consume(goal, first, 'recommendation', 'Suggest games only in the evening.', ['feedback:reactions']);
  goal.review.lastResult.at = 20;
  assert.equal((await contract.collect(goal, data)).changed, false, 'moving the review window alone does not re-trigger');
  data.feedbackLog.push({ id: 'r2', at: 30, choice: 'do', source: 'heartbeat', topic: 'Leisure', excerpt: 'Evening sortie?' });
  const third = await contract.collect(goal, data);
  assert.equal(third.changed, true);
  assert.match(third.items.find(item => item.id === 'feedback:reactions').text, /Evening sortie/);
  assert.doesNotMatch(third.items.find(item => item.id === 'feedback:reactions').text, /before noon/);
});

test('new tools are offered where they are safe: games_list everywhere, watch and launch only to direct chat or a wild heartbeat', async () => {
  const offers = [];
  const tools = new AgentTools({ store: { data: { extensions: {} } }, manageWatch: async (action, payload) => ({ action, payload }), proposeLaunch: async input => { offers.push(input); return { offered: true }; } });
  assert.ok(tools.specs({ readOnly: true }).some(tool => tool.name === 'games_list'));
  assert.ok(!tools.specs({ readOnly: true }).some(tool => ['web_watch', 'launch_propose'].includes(tool.name)));
  assert.ok(tools.specs().some(tool => tool.name === 'web_watch') && tools.specs().some(tool => tool.name === 'launch_propose'));
  const direct = { id: 'c', workspace: process.cwd(), messages: [], status: 'running' };
  assert.deepEqual(await tools.call('web_watch', { action: 'add', url: 'https://example.com', intervalHours: 24 }, { chat: direct }), { action: 'add', payload: { url: 'https://example.com', label: undefined, intervalHours: 24 } });
  await tools.call('launch_propose', { appid: '100', note: 'One sortie?' }, { chat: { ...direct, internal: true, wild: true } });
  assert.deepEqual(offers, [{ appid: '100', note: 'One sortie?' }]);
  await assert.rejects(tools.call('launch_propose', { appid: '100' }, { chat: { ...direct, internal: true } }), /direct user conversation/);
  await assert.rejects(tools.call('games_list', { limit: 0 }, { chat: direct }), /limit/);
  const { AppManagement } = require('../src/app-management.cjs');
  assert.equal(typeof AppManagement, 'function');
});

test('prompts mention activity only when the user enabled it, and summarize recent reactions', () => {
  const { Controller } = require('../src/controller.cjs');
  const fake = { store: { data: { settings: { activityAwareness: false }, feedbackLog: [
    { id: 'a', at: Date.UTC(2026, 9, 2, 20), choice: 'no', source: 'heartbeat', topic: 'Leisure', excerpt: 'Play Tarkov before noon?' },
    { id: 'b', at: Date.UTC(2026, 9, 2, 21), choice: 'do', source: 'goal', topic: 'Enjoyment', excerpt: 'One evening sortie' }] } },
    activity: { snapshot: () => ({ app: 'EscapeFromTarkov', minutesInApp: 42 }) } };
  assert.equal(Controller.prototype.activityContext.call(fake), '');
  fake.store.data.settings.activityAwareness = true;
  assert.match(Controller.prototype.activityContext.call(fake), /EscapeFromTarkov/);
  const reactions = Controller.prototype.reactionContext.call(fake);
  assert.match(reactions, /✖ not interested · heartbeat · Leisure: Play Tarkov before noon\?/);
  assert.match(reactions, /✅ did it · goal · Enjoyment/);
  fake.store.data.feedbackLog = [];
  assert.equal(Controller.prototype.reactionContext.call(fake), '');
});
