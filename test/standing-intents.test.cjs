'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateStandingIntent,
  normalizeStandingIntents,
  matchStandingIntent,
  StandingIntentStore,
} = require('../src/standing-intents.cjs');

function input(overrides = {}) {
  return {
    name: 'Inspect changed reports',
    enabled: true,
    priority: 2,
    debounceMs: 30000,
    when: {
      type: 'file.changed',
      source: 'goal.watcher',
      filters: [{ path: 'payload.path', operator: 'glob', value: 'reports/*.csv' }],
    },
    action: { type: 'goal.run', goalId: 'review-report' },
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: 'event-1', type: 'file.changed', source: 'goal.watcher',
    payload: { path: 'reports/weekly.csv', workspace: 'C:\\Reports' },
    ...overrides,
  };
}

test('validates deterministic event filters and target actions', () => {
  const intent = validateStandingIntent(input(), null, 1000);
  assert.equal(intent.name, 'Inspect changed reports');
  assert.equal(intent.when.filters[0].operator, 'glob');
  assert.deepEqual(intent.action, { type: 'goal.run', goalId: 'review-report' });
  assert.throws(() => validateStandingIntent(input({ when: { type: 'File Changed', filters: [] } })), /lowercase/);
  assert.throws(() => validateStandingIntent(input({ when: { type: 'file.changed', filters: [{ path: 'workspace', value: 'x' }] } })), /payload/);
  assert.throws(() => validateStandingIntent(input({ action: { type: 'goal.run' } })), /Choose a goal/);
});

test('matches event type, source, and all payload filters', () => {
  const intent = validateStandingIntent(input(), null, 1000);
  assert.equal(matchStandingIntent(intent, event()), true);
  assert.equal(matchStandingIntent(intent, event({ source: 'calendar' })), false);
  assert.equal(matchStandingIntent(intent, event({ payload: { path: 'reports/readme.md' } })), false);
  assert.equal(matchStandingIntent({ ...intent, enabled: false }, event()), false);
});

test('supports equals, notEquals, contains, startsWith, exists, and glob matching', () => {
  const base = input({
    when: {
      type: 'goal.completed', filters: [
        { path: 'payload.status', operator: 'equals', value: 'completed' },
        { path: 'payload.retry', operator: 'notEquals', value: true },
        { path: 'payload.summary', operator: 'contains', value: 'report' },
        { path: 'payload.workspace', operator: 'startsWith', value: 'C:\\Work' },
        { path: 'payload.artifact', operator: 'exists', value: true },
        { path: 'payload.artifact', operator: 'glob', value: '*.md' },
      ],
    },
  });
  const intent = validateStandingIntent(base, null, 1000);
  assert.equal(matchStandingIntent(intent, {
    type: 'goal.completed', source: 'goal.runner', payload: {
      status: 'completed', retry: false, summary: 'Weekly report ready', workspace: 'C:\\Work\\Atlas', artifact: 'report.md',
    },
  }), true);
});

test('normalization omits invalid and duplicate persisted records and skips queued work after restart', () => {
  const first = validateStandingIntent(input(), null, 1000);
  first.lastStatus = 'queued';
  const restored = normalizeStandingIntents({ intents: [first, { ...first }, { name: '' }] }, 2000, true);
  assert.equal(restored.intents.length, 1);
  assert.equal(restored.intents[0].lastStatus, 'skipped');
  assert.match(restored.intents[0].lastError, /not replayed/);
});

test('StandingIntentStore persists edits, ordering, results, and removal', () => {
  let saves = 0;
  let changes = 0;
  let now = 1000;
  const store = { data: {}, save() { saves++; } };
  const records = new StandingIntentStore({ store, now: () => now, onChange: () => changes++ });
  const low = records.save(input({ name: 'Low', priority: -1 }));
  now++;
  const high = records.save(input({ name: 'High', priority: 8, action: { type: 'automation.run', automationId: 'routine-1' } }));
  assert.deepEqual(records.matches(event()).map(item => item.id), [high.id, low.id]);
  records.record(high.id, { status: 'matched', event: event() });
  assert.equal(records.get(high.id).triggerCount, 1);
  assert.equal(records.get(high.id).lastEventId, 'event-1');
  records.setEnabled(low.id, false);
  assert.equal(records.matches(event()).length, 1);
  records.remove(low.id);
  assert.equal(records.list().length, 1);
  assert.equal(saves, 5);
  assert.equal(changes, 5);
});
