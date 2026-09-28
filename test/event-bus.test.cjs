'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventBus, normalizeEvent, MAX_EVENT_DEPTH } = require('../src/event-bus.cjs');

function fixture(options = {}) {
  let now = options.startAt || 1000;
  const timers = [];
  const drops = [];
  const errors = [];
  const bus = new EventBus({
    now: () => now,
    setTimer: (handler, delay) => { const timer = { handler, at: now + delay, unref() {} }; timers.push(timer); return timer; },
    clearTimer: timer => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
    defer: handler => queueMicrotask(handler),
    onDrop: entry => drops.push(entry),
    onError: (...entry) => errors.push(entry),
    ...options,
  });
  const advance = async milliseconds => {
    now += milliseconds;
    const due = timers.filter(timer => timer.at <= now);
    for (const timer of due) { timers.splice(timers.indexOf(timer), 1); timer.handler(); }
    await bus.drain();
  };
  return { bus, drops, errors, timers, advance, now: () => now };
}

test('normalizes bounded events with correlation and causation metadata', () => {
  const parent = normalizeEvent({ id: 'parent', type: 'goal.completed', source: 'goal.runner', payload: { goalId: 'g1' }, intentTrace: ['intent-a'] }, 1000);
  const child = normalizeEvent({ type: 'artifact.created', source: 'goal.runner', payload: { path: 'report.md' }, intentTrace: ['intent-b'] }, 1001, parent);
  assert.equal(child.correlationId, 'parent');
  assert.equal(child.causationId, 'parent');
  assert.equal(child.depth, 1);
  assert.deepEqual(child.intentTrace, ['intent-a', 'intent-b']);
  assert.deepEqual(child.payload, { path: 'report.md' });
  assert.throws(() => normalizeEvent({ type: 'Goal Completed' }, 1000), /lowercase/);
  assert.throws(() => normalizeEvent({ type: 'goal.completed', payload: 'text' }, 1000), /payload/);
  assert.throws(() => normalizeEvent({ type: 'goal.completed', intentTrace: 'intent-a' }, 1000), /intentTrace/);
});

test('dispatches subscriptions sequentially by priority and preserves publication order', async () => {
  const { bus } = fixture();
  const order = [];
  bus.subscribe({ type: 'goal.completed', priority: 1, handler: async event => { order.push(`low:${event.payload.id}`); } });
  bus.subscribe({ type: 'goal.completed', priority: 5, handler: async event => { order.push(`high:${event.payload.id}`); } });
  bus.start();
  bus.publish({ type: 'goal.completed', payload: { id: 1 } });
  bus.publish({ type: 'goal.completed', payload: { id: 2 } });
  await bus.drain();
  assert.deepEqual(order, ['high:1', 'low:1', 'high:2', 'low:2']);
  assert.equal(bus.state.dispatching, false);
  assert.equal(bus.state.queued, 0);
});

test('debounces matching events by replacing the queued observation', async () => {
  const { bus, advance, drops } = fixture();
  const seen = [];
  bus.subscribe({ type: 'file.changed', handler: event => { seen.push(event.payload.version); } });
  bus.start();
  bus.publish({ type: 'file.changed', debounceKey: 'report.csv', debounceMs: 500, payload: { version: 1 } });
  bus.publish({ type: 'file.changed', debounceKey: 'report.csv', debounceMs: 500, payload: { version: 2 } });
  assert.equal(bus.state.queued, 1);
  assert.ok(drops.some(entry => entry.reason === 'debounced'));
  await advance(499);
  assert.deepEqual(seen, []);
  await advance(1);
  assert.deepEqual(seen, [2]);
});

test('deduplicates recent events and accepts them after the window expires', async () => {
  const { bus, advance } = fixture({ dedupeWindowMs: 100 });
  const seen = [];
  bus.subscribe({ type: 'calendar.event_approaching', handler: event => seen.push(event.id) });
  bus.start();
  assert.equal(bus.publish({ type: 'calendar.event_approaching', dedupeKey: 'event-1' }).accepted, true);
  assert.equal(bus.publish({ type: 'calendar.event_approaching', dedupeKey: 'event-1' }).reason, 'duplicate');
  await bus.drain();
  await advance(101);
  assert.equal(bus.publish({ type: 'calendar.event_approaching', dedupeKey: 'event-1' }).accepted, true);
  await bus.drain();
  assert.equal(seen.length, 2);
});

test('bounds the queue and lets a higher-priority event evict the weakest event', async () => {
  const { bus, drops } = fixture({ maxQueue: 2 });
  const seen = [];
  bus.subscribe({ type: '*', handler: event => seen.push(event.type) });
  bus.start();
  bus.publish({ type: 'event.low', priority: -1, debounceMs: 1000 });
  bus.publish({ type: 'event.normal', priority: 0, debounceMs: 1000 });
  assert.equal(bus.publish({ type: 'event.rejected', priority: -2, debounceMs: 1000 }).reason, 'overflow');
  assert.equal(bus.publish({ type: 'event.urgent', priority: 5 }).accepted, true);
  await bus.drain();
  assert.deepEqual(seen, ['event.urgent']);
  assert.ok(drops.some(entry => entry.reason === 'evicted' && entry.event.type === 'event.low'));
});

test('child publications remain sequential and repeated causal cycles are dropped', async () => {
  const { bus, drops } = fixture();
  const seen = [];
  bus.subscribe({ type: 'loop.a', handler: async (event, context) => {
    seen.push(`a:${event.depth}`);
    context.publish({ type: 'loop.b', payload: {} });
  } });
  bus.subscribe({ type: 'loop.b', handler: async (event, context) => {
    seen.push(`b:${event.depth}`);
    context.publish({ type: 'loop.a', payload: {} });
  } });
  bus.start();
  bus.publish({ type: 'loop.a', payload: {} });
  await bus.drain();
  assert.deepEqual(seen, ['a:0', 'b:1', 'a:2', 'b:3']);
  assert.ok(drops.some(entry => entry.reason === 'cycle'));
});

test('handler failures are reported without blocking remaining subscriptions', async () => {
  const { bus, errors } = fixture();
  const seen = [];
  bus.subscribe({ type: 'chat.completed', priority: 2, handler: () => { throw new Error('broken observer'); } });
  bus.subscribe({ type: 'chat.completed', handler: () => { seen.push('continued'); } });
  bus.start();
  bus.publish({ type: 'chat.completed' });
  await bus.drain();
  assert.equal(errors.length, 1);
  assert.deepEqual(seen, ['continued']);
});

test('stop drops queued work and prevents any processing while the app is closed', async () => {
  const { bus, advance } = fixture();
  const seen = [];
  bus.subscribe({ type: '*', handler: event => seen.push(event.type) });
  assert.equal(bus.publish({ type: 'app.opened' }).reason, 'stopped');
  bus.start();
  bus.publish({ type: 'automation.due', debounceMs: 100 });
  bus.stop();
  await advance(200);
  assert.deepEqual(seen, []);
  assert.equal(bus.state.queued, 0);
  assert.equal(bus.publish({ type: 'automation.due' }).reason, 'stopped');
});

test('depth protection rejects children beyond the causal limit', () => {
  let parent = normalizeEvent({ type: 'root.event' }, 1000);
  for (let depth = 0; depth < MAX_EVENT_DEPTH; depth++) parent = normalizeEvent({ type: `child.${depth}` }, 1000 + depth, parent);
  assert.deepEqual(normalizeEvent({ type: 'child.too_deep' }, 2000, parent), { dropped: 'depth' });
});
