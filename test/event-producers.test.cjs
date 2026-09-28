'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler } = require('../src/scheduler.cjs');
const { Heartbeat } = require('../src/heartbeat.cjs');

test('scheduler publishes due and lifecycle events when connected to the event runtime', async () => {
  let now = 1000;
  const events = [];
  const automation = { id: 'a1', name: 'Report', prompt: 'Run', enabled: true, nextRunAt: 900, lastStatus: 'never',
    workspace: 'C:\\Work', model: '', connection: 'codex', effort: 'low', scheduleType: 'interval', intervalMinutes: 60 };
  const store = { data: { automations: [automation], settings: { connection: 'codex' } }, save() {} };
  const scheduler = new Scheduler({ store, now: () => now, run: async () => true, publish: event => { events.push(event); return { accepted: true }; } });
  await scheduler.tick();
  assert.equal(events[0].type, 'automation.due');
  events.length = 0;
  await scheduler.runNow('a1');
  assert.deepEqual(events.map(event => event.type), ['automation.started', 'automation.completed']);
});

test('heartbeat publishes due and lifecycle events while retaining direct manual execution', async () => {
  let now = Date.now();
  const events = [];
  const settings = { workspace: 'C:\\Work', model: '', connection: 'codex', effort: 'low' };
  const store = { data: { settings, heartbeat: { enabled: true, mode: 'act', checklist: 'Check files', intervalMinutes: 30,
    startHour: 0, endHour: 0, maxRunsPerDay: 12, maxAlertsPerDay: 3, snoozeMinutes: 60, workspace: settings.workspace,
    model: '', connection: 'codex', effort: 'low', nextRunAt: now - 1, lastRunAt: null, lastStatus: 'never',
    dayKey: '', runsToday: 0, failureCount: 0, lastFingerprint: '', lastAlertAt: null, lastActions: [], history: [], attention: {} } }, save() {} };
  const heartbeat = new Heartbeat({ store, now: () => now, run: async () => ({ status: 'quiet', summary: '', actions: [], topic: '' }),
    publish: event => { events.push(event); return { accepted: true }; } });
  await heartbeat.tick();
  assert.equal(events[0].type, 'heartbeat.due');
  events.length = 0;
  await heartbeat.runNow();
  assert.deepEqual(events.map(event => event.type), ['heartbeat.started', 'heartbeat.quiet']);
});
