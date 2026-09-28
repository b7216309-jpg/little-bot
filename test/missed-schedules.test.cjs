'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceMissedSchedules, missedCount } = require('../src/missed-schedules.cjs');

const HOUR = 60 * 60 * 1000;

test('reopening advances overdue intervals without dispatching catch-up work', () => {
  const now = new Date(2026, 8, 28, 9, 0, 0, 0).getTime();
  const data = {
    automations: [{ id: 'automation-1', enabled: true, scheduleType: 'interval', intervalMinutes: 60, nextRunAt: now - HOUR }],
    heartbeat: { enabled: true, checklist: 'Check notes', intervalMinutes: 30, nextRunAt: now - 1 },
    autonomy: { goals: [{ id: 'goal-1', authorized: true, status: 'queued', trigger: { type: 'interval', intervalMinutes: 45 }, nextRunAt: now - HOUR }] },
  };
  const skipped = advanceMissedSchedules(data, now);
  assert.equal(missedCount(skipped), 3);
  assert.equal(data.automations[0].nextRunAt, now + HOUR);
  assert.equal(data.heartbeat.nextRunAt, now + 30 * 60000);
  assert.equal(data.autonomy.goals[0].nextRunAt, now + 45 * 60000);
  assert.deepEqual(skipped.automations.map(item => item.id), ['automation-1']);
  assert.deepEqual(skipped.goals.map(item => item.id), ['goal-1']);
});

test('exact-time automations advance to the next selected future occurrence', () => {
  const now = new Date(2026, 8, 28, 10, 30, 0, 0).getTime();
  const data = {
    automations: [{ id: 'clock-1', enabled: true, scheduleType: 'clock', clockTime: '09:00', daysOfWeek: [1, 2, 3, 4, 5], nextRunAt: now - HOUR }],
    heartbeat: {}, autonomy: { goals: [] },
  };
  const skipped = advanceMissedSchedules(data, now);
  const next = new Date(data.automations[0].nextRunAt);
  assert.equal(missedCount(skipped), 1);
  assert.ok(data.automations[0].nextRunAt > now);
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 0);
  assert.ok([1, 2, 3, 4, 5].includes(next.getDay()));
});

test('disabled, paused, blocked, manual, and future work remains unchanged', () => {
  const now = 1000000;
  const data = {
    automations: [
      { id: 'disabled', enabled: false, scheduleType: 'interval', intervalMinutes: 60, nextRunAt: now - 1 },
      { id: 'future', enabled: true, scheduleType: 'interval', intervalMinutes: 60, nextRunAt: now + 1 },
    ],
    heartbeat: { enabled: false, checklist: 'Check', intervalMinutes: 30, nextRunAt: now - 1 },
    autonomy: { goals: [
      { id: 'paused', authorized: true, status: 'paused', trigger: { type: 'interval', intervalMinutes: 30 }, nextRunAt: now - 1 },
      { id: 'blocked', authorized: true, status: 'blocked', trigger: { type: 'interval', intervalMinutes: 30 }, nextRunAt: now - 1 },
      { id: 'manual', authorized: true, status: 'queued', trigger: { type: 'manual', intervalMinutes: 30 }, nextRunAt: now - 1 },
    ] },
  };
  const before = structuredClone(data);
  const skipped = advanceMissedSchedules(data, now);
  assert.equal(missedCount(skipped), 0);
  assert.deepEqual(data, before);
});
