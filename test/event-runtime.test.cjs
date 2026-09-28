'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventBus } = require('../src/event-bus.cjs');
const { EventRuntime } = require('../src/event-runtime.cjs');

function fixture() {
  let now = 10_000_000;
  const intervalHandlers = [];
  const calls = [];
  const goalsData = [{ id: 'goal-1', name: 'Review report', authorized: true, status: 'paused' }];
  const store = {
    data: { calendar: { events: [] }, automations: [{ id: 'automation-1', authorized: true, lastStatus: 'never' }], standingIntents: { intents: [] } },
    saves: 0,
    save() { this.saves++; },
  };
  const goals = {
    goal(id) { const goal = goalsData.find(item => item.id === id); if (!goal) throw new Error('Goal not found.'); return goal; },
    runNow(id) { calls.push(['goal', id]); this.goal(id).status = 'queued'; return this.goal(id); },
  };
  const scheduler = {
    runningId: null,
    async runNow(id) { calls.push(['automation', id]); return { id }; },
  };
  const heartbeat = { async runNow() { calls.push(['heartbeat']); return { status: 'quiet' }; } };
  const bus = new EventBus({ now: () => now, dedupeWindowMs: 0 });
  const runtime = new EventRuntime({
    store, scheduler, heartbeat, goals, eventBus: bus, now: () => now,
    setIntervalFn: handler => { intervalHandlers.push(handler); return { unref() {} }; },
    clearIntervalFn: () => {},
  });
  const advance = milliseconds => { now += milliseconds; };
  return { runtime, bus, store, goalsData, calls, advance, now: () => now, intervalHandlers };
}

async function drain(bus) {
  await bus.drain();
  await new Promise(resolve => setImmediate(resolve));
  await bus.drain();
}

test('runtime exists only while the foreground app is started', async () => {
  const { runtime, bus, calls } = fixture();
  assert.equal(runtime.publish({ type: 'heartbeat.due' }).reason, 'stopped');
  runtime.start();
  runtime.publish({ type: 'heartbeat.due', source: 'heartbeat' });
  await drain(bus);
  assert.deepEqual(calls, [['heartbeat']]);
  runtime.publish({ type: 'heartbeat.due', debounceMs: 1000 });
  runtime.stop();
  assert.equal(bus.state.queued, 0);
  assert.equal(runtime.publish({ type: 'heartbeat.due' }).reason, 'stopped');
});

test('matching standing intent queues an authorized goal and settles on goal completion', async () => {
  const { runtime, bus, store, calls } = fixture();
  const intent = runtime.saveIntent({
    name: 'Review CSV changes', enabled: true,
    when: { type: 'file.changed', filters: [{ path: 'payload.path', operator: 'glob', value: 'reports/*.csv' }] },
    action: { type: 'goal.run', goalId: 'goal-1' },
  });
  runtime.start();
  runtime.publish({ type: 'file.changed', source: 'goal.watcher', payload: { path: 'reports/weekly.csv' } });
  await drain(bus);
  assert.deepEqual(calls, [['goal', 'goal-1']]);
  assert.equal(store.data.standingIntents.intents.find(item => item.id === intent.id).lastStatus, 'queued');
  runtime.publish({ type: 'goal.completed', source: 'goal.runner', payload: { goalId: 'goal-1' } });
  await drain(bus);
  assert.equal(store.data.standingIntents.intents.find(item => item.id === intent.id).lastStatus, 'completed');
  assert.equal(store.data.standingIntents.intents.find(item => item.id === intent.id).triggerCount, 1);
});

test('standing-intent action events do not recursively match standing intents', async () => {
  const { runtime, bus, store, calls } = fixture();
  runtime.saveIntent({
    name: 'Do not recurse', enabled: true,
    when: { type: 'standing_intent.action', filters: [] },
    action: { type: 'goal.run', goalId: 'goal-1' },
  });
  runtime.start();
  runtime.publish({ type: 'standing_intent.action', source: 'standing_intents', payload: { intentId: 'missing', action: { type: 'goal.run', goalId: 'goal-1' } } });
  await drain(bus);
  assert.deepEqual(calls, []);
  assert.equal(store.data.standingIntents.intents[0].triggerCount, 0);
});

test('calendar baseline prevents closed-app catch-up and emits only thresholds crossed while open', async () => {
  const { runtime, bus, store, advance, now } = fixture();
  store.data.calendar.events.push({ id: 'meeting', title: 'Review', startAt: now() + 30 * 60000, endAt: now() + 60 * 60000, allDay: false, location: '' });
  const seen = [];
  bus.subscribe({ type: 'calendar.event_approaching', handler: event => seen.push(event.payload.horizonMinutes) });
  runtime.start();
  await drain(bus);
  assert.deepEqual(seen, []);

  const later = { id: 'later', title: 'Later', startAt: now() + 70 * 60000, endAt: now() + 90 * 60000, allDay: false, location: '' };
  store.data.calendar.events.push(later);
  runtime.calendarChanged('created', later);
  await drain(bus);
  assert.deepEqual(seen, []);
  advance(11 * 60000);
  assert.equal(runtime.tickCalendar(), 1);
  await drain(bus);
  assert.deepEqual(seen, [60]);
});

test('calendar changes are normalized into in-process events', async () => {
  const { runtime, bus, now } = fixture();
  const seen = [];
  bus.subscribe({ type: 'calendar.created', handler: event => seen.push(event.payload) });
  runtime.start();
  runtime.calendarChanged('created', { id: 'event-1', title: 'Demo', startAt: now() + 2 * 3600000, endAt: now() + 3 * 3600000, allDay: false, location: 'Desk', updatedAt: now() });
  await drain(bus);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].eventId, 'event-1');
  assert.equal(seen[0].title, 'Demo');
});
