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

test('chat delivery posts one labelled assistant message and never interrupts active work', () => {
  const item = { id: 'h1', status: 'alert', source: 'heartbeat', summary: '  Booked nothing, but tonight looks free for Ace Combat.  ', topic: 'Leisure' };
  const data = { chats: [{ status: 'idle', messages: [], updatedAt: 0 }] };
  const message = deliverHeartbeat(data, item, 123);
  assert.equal(message.role, 'assistant');
  assert.equal(message.kind, 'heartbeat');
  assert.equal(message.text, 'Booked nothing, but tonight looks free for Ace Combat.');
  assert.equal(message.heartbeatTopic, 'Leisure');
  assert.equal(data.chats[0].updatedAt, 123);
  assert.equal(deliverHeartbeat(data, item), null);
  assert.equal(data.chats[0].messages.length, 1);
  for (const status of ['running', 'waiting']) assert.equal(deliverHeartbeat({ chats: [{ status, messages: [] }] }, item), null);
  assert.equal(deliverHeartbeat({ chats: [] }, item), null);
  assert.equal(deliverHeartbeat(data, { ...item, id: 'g', source: 'goal' }), null);
  assert.equal(deliverHeartbeat(data, { ...item, id: 'e', status: 'error' }), null);
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
