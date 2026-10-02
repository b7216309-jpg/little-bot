'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultHeartbeat, normalizeHeartbeat, validateHeartbeat, Heartbeat } = require('../src/heartbeat.cjs');

const MINUTE = 60000;
const settings = { workspace: 'C:\\work', model: 'test-model', effort: 'low' };
const localTime = (day = 26, hour = 10, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();
const input = overrides => ({ enabled: true, checklist: 'Check the build results. Fix failed outputs in this folder.', intervalMinutes: 5, startHour: 8, endHour: 22, maxRunsPerDay: 12, ...overrides });

function fixture(run = async () => ({ status: 'quiet', summary: '' }), overrides = {}) {
  let nowMs = localTime();
  let available = true;
  let changes = 0;
  const alerts = [];
  const config = validateHeartbeat(input(overrides), null, settings, nowMs);
  const store = { data: { settings, heartbeat: config }, saves: 0, save() { this.saves++; } };
  const service = new Heartbeat({ store, run, now: () => nowMs, canRun: () => available,
    onChange: () => { changes++; }, onAlert: item => alerts.push(item) });
  return { service, store, config, alerts, setNow(value) { nowMs = value; }, setAvailable(value) { available = value; }, get changes() { return changes; } };
}

test('defaults are disabled and validation captures a bounded explicit checklist and folder', () => {
  const defaults = defaultHeartbeat(settings, localTime());
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.mode, 'act');
  assert.equal(defaults.checklist, '');
  assert.equal(defaults.intervalMinutes, 30);
  assert.equal(defaults.nextRunAt, localTime() + 30 * MINUTE);
  const configured = validateHeartbeat(input({ checklist: '  Check files  ' }), defaults, settings, localTime());
  assert.equal(configured.checklist, 'Check files');
  assert.equal(configured.workspace, settings.workspace);
  assert.equal(configured.lastStatus, 'never');
  for (const intervalMinutes of [0, 4, 1441, 5.5, '5', NaN, Infinity]) {
    assert.throws(() => validateHeartbeat(input({ intervalMinutes }), null, settings), /interval/);
  }
  for (const bad of [null, [], 'settings']) assert.throws(() => validateHeartbeat(bad), /settings/);
  assert.throws(() => validateHeartbeat(input({ checklist: ' ' }), null, settings), /checklist/);
  assert.throws(() => validateHeartbeat(input({ checklist: 'x'.repeat(8001) }), null, settings), /8000/);
  assert.throws(() => validateHeartbeat(input({ checklist: 2 }), null, settings), /text/);
  assert.throws(() => validateHeartbeat(input({ enabled: 'true' }), null, settings), /true or false/);
  assert.throws(() => validateHeartbeat(input({ mode: 'unsafe' }), null, settings), /working folder/);
  assert.throws(() => validateHeartbeat(input(), null, {}), /working folder/);
  assert.throws(() => validateHeartbeat(input({ startHour: 24 }), null, settings), /start hour/);
  assert.throws(() => validateHeartbeat(input({ endHour: -1 }), null, settings), /end hour/);
  assert.throws(() => validateHeartbeat(input({ maxRunsPerDay: 101 }), null, settings), /daily run limit/);
  assert.equal(validateHeartbeat({ enabled: false, checklist: '' }, defaults, settings).enabled, false);
});

test('editing preserves captured scope and prior counters; explicit recapture and enabling reset the schedule', () => {
  const old = validateHeartbeat(input({ enabled: false }), null, settings, localTime());
  old.runsToday = 4;
  const otherSettings = { workspace: 'D:\\other', model: 'other-model', effort: 'high' };
  const edited = validateHeartbeat({ checklist: 'Check a different file.' }, old, otherSettings, localTime(26, 11));
  assert.equal(edited.workspace, settings.workspace);
  assert.equal(edited.model, settings.model);
  assert.equal(edited.nextRunAt, old.nextRunAt);
  assert.equal(edited.runsToday, 4);
  const enabled = validateHeartbeat({ enabled: true }, edited, otherSettings, localTime(26, 11));
  assert.equal(enabled.nextRunAt, localTime(26, 11, 5));
  const recaptured = validateHeartbeat({ useCurrentWorkspace: true }, enabled, otherSettings, localTime(26, 12));
  assert.equal(recaptured.workspace, otherSettings.workspace);
  assert.equal(recaptured.model, otherSettings.model);
  assert.equal(recaptured.effort, 'high');
  assert.equal(recaptured.nextRunAt, localTime(26, 12, 5));
  assert.equal(recaptured.runsToday, 4);
});

test('ticks skip disabled, empty, not due, busy, and outside-hours states without calling the model', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { status: 'quiet', summary: '' }; });
  await f.service.tick();
  const baselineSaves = f.store.saves;
  f.setNow(localTime(26, 10, 5));
  f.config.enabled = false;
  await f.service.tick();
  f.config.enabled = true;
  const checklist = f.config.checklist;
  f.config.checklist = '';
  await f.service.tick();
  f.config.checklist = checklist;
  f.setAvailable(false);
  await f.service.tick();
  await assert.rejects(f.service.runNow(), /other tasks/);
  f.setAvailable(true);
  f.setNow(localTime(26, 22));
  await f.service.tick();
  assert.equal(calls, 0);
  assert.equal(f.store.saves, baselineSaves);
  f.setNow(localTime(27, 8));
  assert.deepEqual(await f.service.tick(), { status: 'quiet', summary: '', actions: [], topic: '' });
  assert.equal(calls, 1);
  assert.equal(f.config.lastStatus, 'quiet');
  assert.equal(f.config.history.length, 0);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.config.nextRunAt, localTime(27, 8, 5));
});

test('overnight active hours and equal hours work with local calendar boundaries', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { status: 'quiet', summary: '' }; }, { startHour: 22, endHour: 6 });
  f.setNow(localTime(26, 21));
  await f.service.tick();
  assert.equal(calls, 0);
  f.setNow(localTime(26, 22));
  await f.service.tick();
  f.setNow(localTime(27, 0));
  await f.service.tick();
  assert.equal(calls, 2);
  assert.equal(f.config.runsToday, 1);
  f.setNow(localTime(27, 6));
  await f.service.tick();
  assert.equal(calls, 2);
  f.config.startHour = f.config.endHour = 8;
  await f.service.tick();
  assert.equal(calls, 3);
});

test('one run owns the slot until completion, and missed intervals never form a backlog', async () => {
  let finish;
  let calls = 0;
  const f = fixture(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  f.setNow(localTime(27, 10));
  const first = f.service.tick();
  assert.equal(f.service.running, true);
  assert.equal(f.config.lastStatus, 'running');
  assert.equal(f.config.runsToday, 1);
  await f.service.tick();
  await assert.rejects(f.service.runNow(), /already running/);
  f.setNow(localTime(27, 12));
  finish({ status: 'quiet', summary: 'Nothing needed.' });
  await first;
  await f.service.tick();
  assert.equal(calls, 1);
  assert.equal(f.service.running, false);
  assert.equal(f.config.nextRunAt, localTime(27, 12, 5));
});

test('manual checks bypass enabled and hours, but honor limits across restart and reset at local midnight', async () => {
  const f = fixture(undefined, { enabled: false, maxRunsPerDay: 1 });
  f.setNow(localTime(26, 23));
  await f.service.runNow();
  assert.equal(f.config.enabled, false);
  assert.equal(f.config.runsToday, 1);
  f.store.data.heartbeat = normalizeHeartbeat(JSON.parse(JSON.stringify(f.config)), settings, localTime(26, 23, 30), true);
  const restarted = new Heartbeat({ store: f.store, run: async () => ({ status: 'quiet', summary: '' }), now: () => localTime(26, 23, 30) });
  await assert.rejects(restarted.runNow(), /daily run limit/);
  f.setNow(localTime(27, 0));
  await f.service.runNow();
  assert.equal(f.store.data.heartbeat.runsToday, 1);
  assert.equal(f.store.data.heartbeat.dayKey, '2026-09-27');
  f.store.data.heartbeat.checklist = '';
  await assert.rejects(f.service.runNow(), /checklist/);
});

test('alerts carry bounded actions, stay unread until marked, and dedupe across quiet checks and restart for 24 hours', async () => {
  let returned = { status: 'alert', summary: '  Build repaired.  ', actions: ['write: output.txt'] };
  const f = fixture(async () => returned);
  await f.service.runNow();
  assert.equal(f.alerts.length, 1);
  assert.equal(f.config.history[0].unread, true);
  assert.deepEqual(f.config.history[0].actions, ['write: output.txt']);
  assert.equal(f.config.history[0].workspace, settings.workspace);
  returned = { status: 'quiet', summary: '' };
  f.setNow(localTime(26, 11));
  await f.service.runNow();
  returned = { status: 'alert', summary: 'BUILD   repaired.', actions: ['write: output.txt'] };
  f.store.data.heartbeat = normalizeHeartbeat(JSON.parse(JSON.stringify(f.config)), settings, localTime(26, 12), true);
  assert.equal(f.store.data.heartbeat.history[0].workspace, settings.workspace);
  f.setNow(localTime(26, 12));
  await f.service.runNow();
  assert.equal(f.alerts.length, 1);
  returned = { status: 'alert', summary: 'Build repaired.', actions: ['write: different.txt'] };
  await f.service.runNow();
  assert.equal(f.alerts.length, 2);
  f.service.markRead(f.alerts[0].id);
  assert.equal(f.store.data.heartbeat.history[0].unread, false);
  assert.equal(f.store.data.heartbeat.history[1].unread, true);
  f.service.markRead();
  assert.ok(f.store.data.heartbeat.history.every(item => !item.unread));
  returned = { status: 'alert', summary: 'Build repaired.', actions: ['write: output.txt'] };
  f.setNow(localTime(27, 10));
  await f.service.runNow();
  assert.equal(f.alerts.length, 3);
});

test('errors are scrubbed, deduplicated and exponentially backed off; success resets the counter', async () => {
  let failure = true;
  const f = fixture(async () => {
    if (failure) throw new Error('Failed with api_key=private-secret and Bearer private-token sk-abc123');
    return { status: 'quiet', summary: '' };
  });
  for (const [index, delay] of [5, 10, 20, 40, 80, 160, 240, 240].entries()) {
    const now = localTime(26, 10) + index * MINUTE;
    f.setNow(now);
    await assert.rejects(f.service.runNow(), /Failed with/);
    assert.equal(f.config.nextRunAt, now + delay * MINUTE);
  }
  assert.equal(f.alerts.length, 1);
  assert.equal(f.config.failureCount, 8);
  assert.ok(!JSON.stringify(f.config).includes('private-secret'));
  assert.ok(!JSON.stringify(f.config).includes('private-token'));
  assert.ok(!JSON.stringify(f.config).includes('sk-abc123'));
  assert.equal(f.config.runsToday, 0, 'Failed runs do not use up the daily limit.');
  failure = false;
  await f.service.runNow();
  assert.equal(f.config.failureCount, 0);
  assert.equal(f.config.lastError, undefined);
  assert.equal(f.config.lastStatus, 'quiet');
});

test('identical alerts from different captured folders remain separate audit events', async () => {
  const f = fixture(async () => ({ status: 'alert', summary: 'Build repaired.', actions: ['Write: report.txt'] }));
  await f.service.runNow();
  const other = { ...settings, workspace: 'D:\\other' };
  f.store.data.heartbeat = validateHeartbeat({ useCurrentWorkspace: true }, f.config, other, localTime());
  await f.service.runNow();
  assert.equal(f.alerts.length, 2);
  assert.deepEqual(f.store.data.heartbeat.history.map(item => item.workspace), [settings.workspace, other.workspace]);
});

test('malformed model results become failures and failures cannot retry before a longer configured cadence', async () => {
  const f = fixture(async () => ({ status: 'okay', summary: 'wrong' }), { intervalMinutes: 1440 });
  await assert.rejects(f.service.runNow(), /invalid result/);
  assert.equal(f.config.lastStatus, 'error');
  assert.equal(f.config.nextRunAt, localTime() + 1440 * MINUTE);
  f.service.run = async () => ({ status: 'alert', summary: ' ' });
  await assert.rejects(f.service.runNow(), /empty alert/);
});

test('quiet checks retain recent actions without notifications, and failed actions remain in the audit history', async () => {
  const f = fixture(async () => ({ status: 'quiet', summary: '', actions: ['Read: package.json'] }));
  await f.service.runNow();
  assert.deepEqual(f.config.lastActions, ['Read: package.json']);
  assert.equal(f.alerts.length, 0);
  f.service.run = async () => { throw Object.assign(new Error('A command failed.'), { actions: ['Command: repair.ps1 api_key=private-key', 'Write: report.txt'] }); };
  await assert.rejects(f.service.runNow(), /command failed/);
  assert.deepEqual(f.config.lastActions, ['Command: repair.ps1 api_key=[redacted]', 'Write: report.txt']);
  assert.deepEqual(f.config.history[0].actions, f.config.lastActions);
  const recovered = normalizeHeartbeat(JSON.parse(JSON.stringify(f.config)), settings, localTime(), true);
  assert.deepEqual(recovered.lastActions, f.config.lastActions);
});

test('normalization whitelists state, caps audit data and recovers interrupted runs conservatively', () => {
  const config = normalizeHeartbeat({
    ...defaultHeartbeat(settings, localTime()), enabled: true, checklist: 'x'.repeat(9000),
    intervalMinutes: 2, startHour: 24, endHour: -1, maxRunsPerDay: 999, runsToday: 11,
    lastStatus: 'running', nextRunAt: localTime() - MINUTE, failureCount: 2,
    lastError: 'password=bad-secret', unknown: 'omit me',
    history: Array.from({ length: 70 }, (_, index) => ({ id: `event-${index}`, at: localTime() + index,
      status: 'alert', summary: 's'.repeat(3000), actions: ['api_key=action-secret', ...Array(30).fill('x'.repeat(600))], unread: index === 0, ignored: true })),
  }, settings, localTime(), true);
  assert.equal(config.intervalMinutes, 30);
  assert.equal(config.startHour, 8);
  assert.equal(config.endHour, 22);
  assert.equal(config.maxRunsPerDay, 12);
  assert.equal(config.runsToday, 11);
  assert.equal(config.lastStatus, 'error');
  assert.match(config.lastError, /interrupted/);
  assert.equal(config.failureCount, 3);
  assert.equal(config.nextRunAt, localTime() + 120 * MINUTE);
  assert.equal(config.checklist.length, 8000);
  assert.equal(config.history.length, 50);
  assert.equal(config.history[0].id, 'event-20');
  assert.equal(config.history[0].summary.length, 2000);
  assert.equal(config.history[0].actions.length, 20);
  assert.ok(config.history[0].actions.every(value => value.length <= 500));
  assert.ok(!JSON.stringify(config).includes('action-secret'));
  assert.equal(config.unknown, undefined);
  assert.equal(config.history[0].ignored, undefined);
  assert.equal(config.history[0].workspace, '');
  assert.equal(normalizeHeartbeat({ enabled: true, checklist: '' }, settings).enabled, false);
  assert.equal(normalizeHeartbeat({ history: [null, {}, { status: 'alert', at: 1, summary: '' }] }, settings).history.length, 0);
});

test('audit history stays bounded during use and observer failures do not fail a completed run', async () => {
  let count = 0;
  const f = fixture(async () => ({ status: 'alert', summary: `Result ${++count}` }), { maxRunsPerDay: 100 });
  f.service.onAlert = () => { throw new Error('Notification service unavailable'); };
  f.service.onChange = () => { throw new Error('Window closed'); };
  for (let i = 0; i < 55; i++) await f.service.runNow();
  assert.equal(f.config.history.length, 50);
  assert.equal(f.config.history[0].summary, 'Result 6');
  assert.equal(f.config.lastStatus, 'alert');
});

test('storage failure before starting does not run or consume a quota, and failed completion is not reported as success', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { status: 'alert', summary: 'Done.' }; });
  f.store.save = () => { throw new Error('Disk full'); };
  await assert.rejects(f.service.runNow(), /Could not save heartbeat state: Disk full/);
  assert.equal(calls, 0);
  assert.equal(f.config.runsToday, 0);
  assert.equal(f.config.lastStatus, 'error');
  assert.equal(f.service.running, false);
  assert.equal(f.alerts.length, 0);
  let saves = 0;
  f.store.save = () => { if (++saves === 2) throw new Error('Write failed'); };
  await assert.rejects(f.service.runNow(), /Could not save heartbeat state: Write failed/);
  assert.equal(calls, 1);
  assert.equal(f.config.runsToday, 1);
  assert.equal(f.config.lastStatus, 'error');
  assert.equal(f.config.history.length, 0);
  assert.equal(f.alerts.length, 0);
});

test('a timer failure is contained and updated configuration survives an in-flight run', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.service.runNow();
  f.store.data.heartbeat = validateHeartbeat({ enabled: false, intervalMinutes: 60 }, f.config, settings, localTime(26, 11));
  f.setNow(localTime(26, 13));
  finish({ status: 'quiet', summary: '' });
  await pending;
  assert.equal(f.store.data.heartbeat.enabled, false);
  assert.equal(f.store.data.heartbeat.nextRunAt, localTime(26, 14));
  f.store.data.heartbeat.enabled = true;
  f.setNow(localTime(26, 15));
  f.service.run = async () => { throw new Error('Runner failed'); };
  assert.equal(await f.service.tick(), null);
  assert.equal(f.store.data.heartbeat.lastStatus, 'error');
});

test('start is idempotent and stop clears the unreferenced timer', () => {
  const f = fixture();
  f.service.start();
  const timer = f.service.timer;
  f.service.start();
  assert.equal(f.service.timer, timer);
  assert.equal(timer.hasRef(), false);
  f.service.stop();
  assert.equal(f.service.timer, null);
  f.service.stop();
});

test('failed runs give their daily slot back, so a broken morning cannot silence the rest of the day', async () => {
  let fail = true;
  const f = fixture(async () => { if (fail) throw new Error('local model offline'); return { status: 'quiet', summary: 'Nothing needed.' }; });
  f.setNow(localTime(27, 10));
  await f.service.runNow().catch(() => {});
  assert.equal(f.config.lastStatus, 'error');
  assert.equal(f.config.runsToday, 0);
  fail = false;
  f.setNow(localTime(27, 11));
  await f.service.runNow();
  assert.equal(f.config.lastStatus, 'quiet');
  assert.equal(f.config.runsToday, 1);
});
