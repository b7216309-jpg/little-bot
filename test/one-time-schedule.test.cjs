'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Scheduler, validateAutomation } = require('../src/scheduler.cjs');
const { manageSchedule } = require('../src/schedule-management.cjs');
const { advanceMissedSchedules } = require('../src/missed-schedules.cjs');
const { AgentTools } = require('../src/agent-tools.cjs');
const { Store } = require('../src/store.cjs');

const MINUTE = 60000;
const workspace = path.resolve(os.tmpdir());
const settings = { workspace, model: 'test-model', effort: 'low', connection: 'local', localModel: 'test-model', localBaseUrl: 'http://127.0.0.1:8080/v1' };
const local = (hour, minute = 0, day = 3) => new Date(2026, 10, day, hour, minute).getTime();
const stamp = '2026-11-03T14:30';
const once = (overrides = {}, nowMs = local(9)) => validateAutomation({ name: 'Call the bank', prompt: 'Remind me to call the bank.', scheduleType: 'once', runAt: stamp, ...overrides }, null, settings, nowMs);

function fixture(automation, { run = async () => ({ chatId: 'c' }), checkReady, nowMs = local(9) } = {}) {
  let clock = nowMs;
  const events = [];
  const runs = [];
  const store = { data: { automations: [automation], settings: { ...settings } }, save() {} };
  const scheduler = new Scheduler({ store, checkReady, now: () => clock, publish: event => events.push(event), run: async copy => { runs.push(copy); return run(copy); } });
  return { scheduler, store, events, runs, automation, at(value) { clock = value; } };
}

test('a one-time task saves the local date and time and is due then', () => {
  const task = once();
  assert.equal(task.scheduleType, 'once');
  assert.equal(task.runAt, local(14, 30));
  assert.equal(task.nextRunAt, local(14, 30));
  assert.equal(task.intervalMinutes, undefined);
  assert.equal(once({ runAt: '2026-11-03 14:30' }).runAt, local(14, 30));
});

test('a delay becomes a whole minute at least that far away', () => {
  const task = once({ runAt: undefined, delayMinutes: 5 }, local(9) + 20000);
  assert.equal(task.runAt, local(9, 6));
  assert.throws(() => once({ runAt: undefined, delayMinutes: 0 }), /delay/);
  assert.throws(() => once({ runAt: undefined, delayMinutes: 1.5 }), /delay/);
});

test('a one-time task refuses a past or missing time', () => {
  assert.throws(() => once({ runAt: '2026-11-03T08:00' }), /in the future/);
  assert.throws(() => once({ runAt: undefined }), /date and time/);
  assert.throws(() => once({ runAt: 'tomorrow' }), /YYYY-MM-DDTHH:MM/);
  assert.throws(() => once({ runAt: '2026-02-31T10:00' }), /date and time/);
});

test('it runs a single time, then turns itself off', async () => {
  const f = fixture(once());
  assert.equal(await f.scheduler.tick(), null, 'not yet');
  f.at(local(14, 30));
  await f.scheduler.tick();
  assert.equal(f.events.at(-1).type, 'automation.due');
  assert.ok(Number.isFinite(f.events.at(-1).expiresAt), 'the event has a real expiry');

  await f.scheduler.runNow(f.automation.id);
  assert.equal(f.runs.length, 1);
  assert.equal(f.runs[0].lateFrom, undefined, 'on time');
  assert.equal(f.automation.enabled, false);
  assert.equal(f.automation.nextRunAt, null, 'finishing does not arm it again');
  assert.equal(f.automation.lastStatus, 'completed');

  f.at(local(16));
  f.events.length = 0;
  await f.scheduler.tick();
  assert.equal(f.events.length, 0, 'never due again');
});

test('a failed run stays used up', async () => {
  const f = fixture(once(), { run: async () => { throw new Error('The model stopped.'); } });
  f.at(local(14, 30));
  await assert.rejects(f.scheduler.runNow(f.automation.id), /model stopped/);
  assert.equal(f.automation.enabled, false);
  assert.equal(f.automation.lastStatus, 'error');
  assert.equal(f.automation.nextRunAt, null);
});

test('it waits for the engine instead of being used up by a failed start', async () => {
  let ready = false;
  const f = fixture(once(), { checkReady: () => { if (!ready) throw new Error('Start your Qwen launcher.'); } });
  f.at(local(15));
  await f.scheduler.tick();
  assert.equal(f.events.length, 0, 'not published while the engine is down');
  await assert.rejects(f.scheduler.runNow(f.automation.id), /Qwen launcher/);
  assert.equal(f.automation.enabled, true, 'still waiting');
  assert.equal(f.automation.nextRunAt, local(14, 30));
  assert.equal(f.automation.lastStatus, 'never');
  ready = true;
  await f.scheduler.tick();
  assert.equal(f.events.length, 1);
});

test('a repeating routine does not wait for the engine', async () => {
  const routine = validateAutomation({ name: 'Hourly', prompt: 'Check.', intervalMinutes: 60 }, null, settings, local(9));
  const f = fixture(routine, { checkReady: () => { throw new Error('down'); } });
  f.at(local(10));
  await f.scheduler.tick();
  assert.equal(f.events.length, 1);
});

test('a task missed while the app was closed stays due and runs late', async () => {
  const task = once();
  const hourly = validateAutomation({ name: 'Hourly', prompt: 'Check.', intervalMinutes: 60 }, null, settings, local(9));
  const data = { automations: [task, hourly] };
  const missed = advanceMissedSchedules(data, local(10, 0, 5));
  assert.deepEqual(missed.automations.map(item => item.id), [hourly.id], 'only the repeating routine is skipped');
  assert.equal(task.nextRunAt, local(14, 30));

  const f = fixture(task);
  f.at(local(10, 0, 5));
  await f.scheduler.runNow(task.id);
  assert.equal(f.runs[0].lateFrom, local(14, 30), 'the run is told it is late');
});

test('Run now uses it up, without a late note', async () => {
  const f = fixture(once());
  await f.scheduler.runNow(f.automation.id);
  assert.equal(f.runs[0].lateFrom, undefined);
  assert.equal(f.automation.enabled, false);
  assert.equal(f.automation.nextRunAt, null);
});

test('a finished task can be renamed, and takes a new future time to run again', async () => {
  const f = fixture(once());
  f.at(local(14, 30));
  await f.scheduler.runNow(f.automation.id);
  const later = local(16);

  const renamed = validateAutomation({ ...f.automation, name: 'Bank' }, f.automation, settings, later);
  assert.equal(renamed.name, 'Bank');
  assert.equal(renamed.enabled, false);
  assert.equal(renamed.nextRunAt, null);

  assert.throws(() => validateAutomation({ ...f.automation, enabled: true }, f.automation, settings, later), /in the future/);
  const again = validateAutomation({ ...f.automation, enabled: true, runAt: '2026-11-03T18:00' }, f.automation, settings, later);
  assert.equal(again.enabled, true);
  assert.equal(again.nextRunAt, local(18));
});

test('a waiting overdue task keeps its time through an edit', () => {
  const task = once();
  const edited = validateAutomation({ ...task, name: 'Bank' }, task, settings, local(15));
  assert.equal(edited.nextRunAt, local(14, 30));
});

test('the chat tool creates timers and reminders', async () => {
  const store = { data: { automations: [], settings: { ...settings } }, save() {} };
  const chat = { id: 'chat', workspace, messages: [] };
  const tools = new AgentTools({ store, manageSchedule: async (action, payload, context) => manageSchedule(store, action, payload, context) });
  const spec = tools.specs().find(item => item.name === 'schedule_manage');
  assert.ok(spec.inputSchema.properties.scheduleType.enum.includes('once'));

  const before = Date.now();
  const timer = await tools.call('schedule_manage', { action: 'create', name: 'Tea', prompt: 'The tea is ready.', delayMinutes: 5, enabled: true }, { chat });
  assert.equal(timer.scheduleType, 'once');
  assert.equal(timer.enabled, true);
  assert.ok(timer.runAt >= before + 5 * MINUTE && timer.runAt <= before + 7 * MINUTE);
  assert.equal(timer.delayMinutes, undefined, 'only the resulting time is saved');

  const future = new Date(Date.now() + 2 * 86400000);
  const value = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T14:30`;
  const reminder = await tools.call('schedule_manage', { action: 'create', name: 'Bank', prompt: 'Call the bank.', runAt: value, enabled: true }, { chat });
  assert.equal(reminder.scheduleType, 'once');
  assert.equal(new Date(reminder.runAt).getHours(), 14);

  await assert.rejects(tools.call('schedule_manage', { action: 'create', name: 'Old', prompt: 'x', runAt: '2020-01-01T10:00' }, { chat }), /in the future/);
  assert.equal(store.data.automations.length, 2);
});

test('resuming a task whose time has passed changes nothing', () => {
  const task = once({ enabled: false });
  const store = { data: { automations: [task], settings: { ...settings } }, save() {} };
  assert.throws(() => manageSchedule(store, 'resume', { id: task.id }, { workspace }, local(15)), /in the future/);
  assert.equal(task.enabled, false);
  assert.equal(manageSchedule(store, 'resume', { id: task.id }, { workspace }, local(10)).enabled, true);
  assert.equal(task.nextRunAt, local(14, 30));
});

test('saved one-time tasks survive a restart, finished or waiting', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-once-'));
  try {
    const filePath = path.join(folder, 'state.json');
    const store = new Store({ filePath, defaultWorkspace: workspace });
    const waiting = once();
    const finished = { ...once(), id: 'finished', enabled: false, nextRunAt: null, lastRunAt: local(14, 30), lastStatus: 'completed' };
    store.data.automations.push(waiting, finished);
    store.flush();
    store.close();
    const again = new Store({ filePath, defaultWorkspace: workspace });
    const [first, second] = again.data.automations;
    assert.equal(first.scheduleType, 'once');
    assert.equal(first.runAt, local(14, 30));
    assert.equal(first.nextRunAt, local(14, 30));
    assert.equal(first.enabled, true);
    assert.equal(second.nextRunAt, null, 'a finished task is not given a new run time');
    assert.equal(second.enabled, false);
    again.close();
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
