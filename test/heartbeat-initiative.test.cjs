'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHeartbeat, validateHeartbeat, Heartbeat } = require('../src/heartbeat.cjs');
const { deliverHeartbeat } = require('../src/proactive-chat.cjs');

const MINUTE = 60000;
const settings = { workspace: 'C:\\work', model: 'test-model', effort: 'low' };
const localTime = (day = 26, hour = 10, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();
const input = overrides => ({ enabled: true, checklist: 'Find something useful to do for me.', intervalMinutes: 60, startHour: 0, endHour: 0, maxRunsPerDay: 100, ...overrides });

function fixture(results, overrides = {}) {
  let nowMs = localTime();
  const queue = [...results];
  const records = [];
  const config = validateHeartbeat(input(overrides), null, settings, nowMs);
  const store = { data: { settings, heartbeat: config }, save() {} };
  const service = new Heartbeat({ store, run: async () => queue.shift(), now: () => nowMs,
    onRecord: (item, context) => records.push({ item, context }) });
  return { service, store, records, setNow(value) { nowMs = value; }, get now() { return nowMs; } };
}

test('initiative defaults to calm, rejects unknown levels, and turning wild schedules a check within a minute', () => {
  const calm = validateHeartbeat(input(), null, settings, localTime());
  assert.equal(calm.initiative, 'calm');
  assert.equal(calm.nextRunAt, localTime() + 60 * MINUTE);
  assert.throws(() => validateHeartbeat(input({ initiative: 'chaos' }), null, settings), /calm or wild/);
  calm.quietStreak = 7;
  const wild = validateHeartbeat({ initiative: 'wild' }, calm, settings, localTime(26, 11));
  assert.equal(wild.initiative, 'wild');
  assert.equal(wild.quietStreak, 0);
  assert.equal(wild.nextRunAt, localTime(26, 11) + MINUTE);
  const edited = validateHeartbeat({ checklist: 'Something else.' }, wild, settings, localTime(26, 12));
  assert.equal(edited.initiative, 'wild');
  assert.equal(edited.nextRunAt, wild.nextRunAt);
  assert.equal(normalizeHeartbeat({ ...wild, initiative: 'unsafe' }, settings).initiative, 'calm');
});

test('a wild heartbeat chooses its own bounded next wake-up; calm keeps the fixed interval', async () => {
  const wild = fixture([
    { status: 'quiet', summary: '', reason: 'Waiting for the build.', wakeInMinutes: 15 },
    { status: 'quiet', summary: '', wakeInMinutes: 1 },
    { status: 'quiet', summary: '', wakeInMinutes: 10000 },
    { status: 'quiet', summary: '' },
  ], { initiative: 'wild' });
  await wild.service.runNow();
  assert.equal(wild.store.data.heartbeat.nextRunAt, wild.now + 15 * MINUTE);
  await wild.service.runNow();
  assert.equal(wild.store.data.heartbeat.nextRunAt, wild.now + 5 * MINUTE);
  await wild.service.runNow();
  assert.equal(wild.store.data.heartbeat.nextRunAt, wild.now + 240 * MINUTE);
  await wild.service.runNow();
  assert.equal(wild.store.data.heartbeat.nextRunAt, wild.now + 60 * MINUTE);

  const calm = fixture([{ status: 'quiet', summary: '', wakeInMinutes: 5 }]);
  await calm.service.runNow();
  assert.equal(calm.store.data.heartbeat.nextRunAt, calm.now + 60 * MINUTE);
});

test('quiet streaks and the pulse make silent checks visible, and alerts reset the streak', async () => {
  const f = fixture([
    { status: 'quiet', summary: '', reason: 'Nothing new since the last check.', wakeInMinutes: 30 },
    { status: 'quiet', summary: '', reason: 'Still nothing new.' },
    { status: 'alert', summary: 'Drafted a weekend plan in plans.md.', topic: 'Weekend', wakeInMinutes: 120 },
  ], { initiative: 'wild' });
  await f.service.runNow();
  await f.service.runNow();
  assert.equal(f.store.data.heartbeat.quietStreak, 2);
  await f.service.runNow();
  const config = f.store.data.heartbeat;
  assert.equal(config.quietStreak, 0);
  assert.deepEqual(config.pulse.map(item => [item.status, item.note, item.wakeInMinutes]), [
    ['quiet', 'Nothing new since the last check.', 30],
    ['quiet', 'Still nothing new.', undefined],
    ['alert', 'Drafted a weekend plan in plans.md.', 120],
  ]);
  const many = normalizeHeartbeat({ ...config, pulse: Array.from({ length: 50 }, (_, index) => ({ at: index, status: 'quiet', note: 'x'.repeat(500) })) }, settings);
  assert.equal(many.pulse.length, 30);
  assert.equal(many.pulse[0].note.length, 300);
});

test('new alerts are offered for chat delivery once, with the current initiative', async () => {
  const f = fixture([
    { status: 'quiet', summary: '' },
    { status: 'alert', summary: 'Found a free evening for the film you mentioned.', topic: 'Leisure' },
    { status: 'alert', summary: 'Found a free evening for the film you mentioned.', topic: 'Leisure' },
  ], { initiative: 'wild' });
  await f.service.runNow();
  await f.service.runNow();
  await f.service.runNow();
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].item.summary, 'Found a free evening for the film you mentioned.');
  assert.deepEqual(f.records[0].context, { initiative: 'wild' });
});


test('presence pulls a wild heartbeat forward with its reason; chat activity debounces; calm ignores it', async () => {
  const f = fixture([{ status: 'quiet', summary: '' }], { initiative: 'wild' });
  const config = f.store.data.heartbeat;
  config.nextRunAt = f.now + 60 * MINUTE;
  assert.equal(f.service.wakeSoon('The user came back.', MINUTE), true);
  assert.equal(config.nextRunAt, f.now + MINUTE);
  assert.equal(config.wakeReason, 'The user came back.');
  assert.equal(f.service.wakeSoon('Later moment.', 30 * MINUTE), false);
  assert.equal(config.nextRunAt, f.now + MINUTE);
  assert.equal(f.service.wakeSoon('Conversation ended.', 10 * MINUTE, { debounce: true }), true);
  assert.equal(config.nextRunAt, f.now + 10 * MINUTE);
  let seen;
  f.service.run = async received => { seen = received.wakeReason; return { status: 'quiet', summary: '' }; };
  await f.service.runNow();
  assert.equal(seen, 'Conversation ended.');
  assert.equal(config.wakeReason, undefined);

  const calm = fixture([], {});
  const before = calm.store.data.heartbeat.nextRunAt;
  assert.equal(calm.service.wakeSoon('The user came back.', MINUTE), false);
  assert.equal(calm.store.data.heartbeat.nextRunAt, before);
});

test('the event runtime turns app opening, returning and finished chats into heartbeat wake-ups', async () => {
  const { EventBus } = require('../src/event-bus.cjs');
  const { EventRuntime } = require('../src/event-runtime.cjs');
  let now = 10_000_000;
  const wakes = [];
  const heartbeat = { async runNow() {}, wakeSoon: (reason, delay, options) => { wakes.push([reason.split(' ')[0], delay, options.debounce]); return true; } };
  const store = { data: { calendar: { events: [] }, automations: [], autonomy: { goals: [] }, standingIntents: { intents: [] } }, save() {} };
  const bus = new EventBus({ now: () => now, dedupeWindowMs: 0 });
  const runtime = new EventRuntime({ store, scheduler: { runningId: null }, heartbeat, goals: { goal() {} }, eventBus: bus, now: () => now,
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {} });
  runtime.start();
  runtime.publish({ type: 'user.returned', source: 'app', payload: { awayMinutes: 120 } });
  runtime.publish({ type: 'chat.completed', source: 'chat', payload: { chatId: 'c' } });
  runtime.publish({ type: 'calendar.created', source: 'calendar', payload: {} });
  await bus.drain();
  assert.deepEqual(wakes, [['Little', 2 * MINUTE, false], ['The', MINUTE, false], ['The', 10 * MINUTE, true]]);
  runtime.stop();
});

test('planned follow-ups wake a wild heartbeat with their notes, once, and are bounded', async () => {
  const f = fixture([{ status: 'quiet', summary: '' }], { initiative: 'wild' });
  const config = f.store.data.heartbeat;
  config.nextRunAt = f.now + 240 * MINUTE;
  assert.throws(() => f.service.scheduleFollowup({ at: f.now - 1, note: 'x' }), /30 days/);
  assert.throws(() => f.service.scheduleFollowup({ at: f.now + 31 * 24 * 60 * MINUTE, note: 'x' }), /30 days/);
  assert.throws(() => f.service.scheduleFollowup({ at: f.now + MINUTE, note: ' ' }), /note/);
  const late = f.service.scheduleFollowup({ at: f.now + 90 * MINUTE, note: 'Ask how the interview went.' });
  const soon = f.service.scheduleFollowup({ at: f.now + 20 * MINUTE, note: 'Check whether the download finished.' });
  assert.deepEqual(f.service.listFollowups().map(item => item.id), [soon.id, late.id]);
  f.setNow(f.now + 21 * MINUTE);
  let seen;
  f.service.run = async received => { seen = received.wakeReason; return { status: 'quiet', summary: '' }; };
  await f.service.tick();
  assert.match(seen, /Follow-up you planned: Check whether the download finished\./);
  assert.deepEqual(f.service.listFollowups().map(item => item.id), [late.id]);
  assert.deepEqual(f.service.cancelFollowup(late.id), { cancelled: late.id });
  assert.throws(() => f.service.cancelFollowup(late.id), /does not exist/);
  for (let index = 0; index < 20; index++) f.service.scheduleFollowup({ at: f.now + (index + 5) * MINUTE, note: `n${index}` });
  assert.throws(() => f.service.scheduleFollowup({ at: f.now + 60 * MINUTE, note: 'one too many' }), /At most 20/);
  assert.equal(normalizeHeartbeat({ ...config, followups: [...config.followups, { at: 1, note: '' }] }, settings).followups.length, 20);

  const calm = fixture([]);
  assert.throws(() => calm.service.scheduleFollowup({ at: calm.now + 10 * MINUTE, note: 'x' }), /Wild initiative/);
});

test('the followup_manage tool converts times and is offered only where planning is allowed', async () => {
  const { AgentTools } = require('../src/agent-tools.cjs');
  const calls = [];
  const tools = new AgentTools({ store: { data: { extensions: {} } }, manageFollowup: async (action, payload) => {
    calls.push([action, payload]); return action === 'create' ? { id: 'f1', ...payload } : action === 'list' ? [] : { cancelled: payload.id };
  } });
  assert.ok(tools.specs().some(tool => tool.name === 'followup_manage'));
  assert.ok(!tools.specs({ readOnly: true }).some(tool => tool.name === 'followup_manage'));
  const chat = { id: 'c', workspace: 'C:\work', messages: [], status: 'running' };
  const before = Date.now();
  const created = await tools.call('followup_manage', { action: 'create', inMinutes: 30, note: 'Check the build.' }, { chat });
  assert.ok(created.followup.at >= before + 30 * MINUTE && created.followup.at <= Date.now() + 30 * MINUTE);
  await tools.call('followup_manage', { action: 'create', atLocal: '2026-10-03T19:30', note: 'Movie night?' }, { chat });
  assert.equal(calls[1][1].at, new Date(2026, 9, 3, 19, 30).getTime());
  await assert.rejects(tools.call('followup_manage', { action: 'create', atLocal: 'tomorrow', note: 'x' }, { chat }), /YYYY-MM-DDTHH:MM/);
  await assert.rejects(tools.call('followup_manage', { action: 'create', inMinutes: 1, note: 'x' }, { chat }), /5 to 43200/);
  await assert.rejects(tools.call('followup_manage', { action: 'create', inMinutes: 30, note: 'x' }, { chat: { ...chat, internal: true } }), /direct user conversation/);
  await tools.call('followup_manage', { action: 'create', inMinutes: 30, note: 'From heartbeat.' }, { chat: { ...chat, internal: true, wild: true } });
  assert.deepEqual(await tools.call('followup_manage', { action: 'cancel', id: 'f1' }, { chat }), { cancelled: 'f1' });
});

test('a finished chat turn lets goals check for a reply to their messages', async () => {
  const { EventBus } = require('../src/event-bus.cjs');
  const { EventRuntime } = require('../src/event-runtime.cjs');
  const chats = [{ status: 'idle', messages: [] }];
  const replies = [];
  const store = { data: { chats, calendar: { events: [] }, automations: [], autonomy: { goals: [] }, standingIntents: { intents: [] } }, save() {} };
  const bus = new EventBus({ now: () => 10_000_000, dedupeWindowMs: 0 });
  const runtime = new EventRuntime({ store, scheduler: { runningId: null }, heartbeat: { async runNow() {} },
    goals: { goal() {}, userReplied: chat => { replies.push(chat); return []; } }, eventBus: bus, now: () => 10_000_000,
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {} });
  runtime.start();
  runtime.publish({ type: 'chat.completed', source: 'chat', payload: { chatId: 'c' } });
  runtime.publish({ type: 'user.returned', source: 'app', payload: {} });
  await bus.drain();
  assert.equal(replies.length, 1);
  assert.equal(replies[0], chats[0]);
  runtime.stop();
});
