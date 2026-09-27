'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler, validateAutomation, nextRunAt } = require('../src/scheduler.cjs');

const settings = { workspace: 'C:\\work', model: 'test-model', effort: 'low' };
const input = overrides => ({ name: 'Daily task', prompt: 'List files', intervalMinutes: 1, enabled: true, ...overrides });

function fixture(run) {
  let nowMs = 1000;
  let notifications = 0;
  const automation = validateAutomation(input(), null, settings, nowMs);
  const store = { data: { automations: [automation] }, saves: 0, save() { this.saves++; } };
  const scheduler = new Scheduler({ store, run, now: () => nowMs, onChange: () => { notifications++; } });
  return { store, scheduler, automation, setNow(value) { nowMs = value; }, get notifications() { return notifications; } };
}

test('validation bounds intervals, validates inputs and captures settings', () => {
  const automation = validateAutomation(input({ name: '  Task  ' }), null, settings, 1000);
  assert.equal(automation.name, 'Task');
  assert.equal(automation.nextRunAt, 61000);
  assert.equal(automation.workspace, settings.workspace);
  assert.equal(automation.model, settings.model);
  assert.equal(automation.lastStatus, 'never');
  for (const intervalMinutes of [0, -1, 1.5, 10081, NaN, Infinity, '1']) {
    assert.throws(() => validateAutomation(input({ intervalMinutes }), null, settings, 1000), /whole number/);
  }
  assert.equal(nextRunAt(1000, 10080), 604801000);
  assert.throws(() => validateAutomation(input({ name: ' '.repeat(4) })), /name/);
  assert.throws(() => validateAutomation(input({ name: 'x'.repeat(81) })), /name/);
  assert.throws(() => validateAutomation(input({ prompt: '' })), /task/);
  assert.throws(() => validateAutomation(input({ prompt: 'x'.repeat(32001) })), /task/);
  assert.throws(() => validateAutomation(input({ enabled: 'true' })), /Enabled/);
  assert.throws(() => validateAutomation(input({ id: 'missing' })), /no longer exists/);
});

test('editing preserves the original workspace and enabling resets a stale schedule', () => {
  const original = validateAutomation(input({ enabled: false }), null, settings, 0);
  const enabled = validateAutomation(input({ id: original.id }), original, { workspace: 'C:\\other', model: 'other' }, 500000);
  assert.equal(enabled.workspace, settings.workspace);
  assert.equal(enabled.model, settings.model);
  assert.equal(enabled.nextRunAt, 560000);
  const renamed = validateAutomation(input({ id: original.id, name: 'Changed' }), enabled, settings, 510000);
  assert.equal(renamed.nextRunAt, 560000);
  const intervalChanged = validateAutomation(input({ id: original.id, intervalMinutes: 10 }), renamed, settings, 510000);
  assert.equal(intervalChanged.nextRunAt, 1110000);
});

test('a due job runs once even when ticks and manual calls overlap', async () => {
  let resolveRun;
  let calls = 0;
  const f = fixture(() => { calls++; return new Promise(resolve => { resolveRun = resolve; }); });
  f.setNow(61000);
  const firstTick = f.scheduler.tick();
  assert.equal(f.automation.lastStatus, 'running');
  await f.scheduler.tick();
  await assert.rejects(f.scheduler.runNow(f.automation.id), /already running/);
  assert.equal(calls, 1);
  resolveRun({ chatId: 'created-chat' });
  assert.deepEqual(await firstTick, { chatId: 'created-chat' });
  assert.equal(f.automation.lastStatus, 'completed');
  assert.equal(f.automation.lastRunAt, 61000);
  assert.equal(f.automation.nextRunAt, 121000);
  assert.equal(f.notifications, 2);
});

test('missed intervals produce a single attempt and a failure waits until the next future run', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; throw new Error('Runtime unavailable'); });
  f.setNow(86400000);
  await f.scheduler.tick();
  assert.equal(calls, 1);
  assert.equal(f.automation.lastStatus, 'error');
  assert.equal(f.automation.lastError, 'Runtime unavailable');
  assert.equal(f.automation.nextRunAt, 86460000);
  await f.scheduler.tick();
  await f.scheduler.tick();
  assert.equal(calls, 1);
  f.setNow(86460000);
  await f.scheduler.tick();
  assert.equal(calls, 2);
});

test('disabled jobs never run on tick but can run manually without becoming enabled', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { chatId: 'manual' }; });
  f.automation.enabled = false;
  f.setNow(100000);
  await f.scheduler.tick();
  assert.equal(calls, 0);
  assert.deepEqual(await f.scheduler.runNow(f.automation.id), { chatId: 'manual' });
  assert.equal(calls, 1);
  assert.equal(f.automation.enabled, false);
  assert.equal(f.automation.lastStatus, 'completed');
});

test('long tasks schedule into the future and deletion during a run is respected', async () => {
  let resolveRun;
  const f = fixture(() => new Promise(resolve => { resolveRun = resolve; }));
  f.setNow(61000);
  const first = f.scheduler.tick();
  f.setNow(500000);
  resolveRun({ chatId: 'long' });
  await first;
  assert.equal(f.automation.nextRunAt, 560000);
  const second = f.scheduler.runNow(f.automation.id);
  f.store.data.automations = [];
  resolveRun({ chatId: 'deleted' });
  await second;
  assert.deepEqual(f.store.data.automations, []);
  assert.equal(f.scheduler.runningId, null);
});

test('start is idempotent and stop clears the unreferenced timer', () => {
  const f = fixture(async () => {});
  f.scheduler.start();
  const timer = f.scheduler.timer;
  f.scheduler.start();
  assert.equal(f.scheduler.timer, timer);
  assert.equal(timer.hasRef(), false);
  f.scheduler.stop();
  assert.equal(f.scheduler.timer, null);
  f.scheduler.stop();
});
