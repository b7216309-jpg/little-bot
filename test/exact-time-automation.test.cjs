'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../src/store.cjs');
const { validateAutomation } = require('../src/scheduler.cjs');

test('exact clock schedule survives a Store round trip', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-clock-schedule-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  const now = new Date(2026, 8, 28, 8, 0, 0, 0).getTime();
  const automation = validateAutomation({
    name: 'Weekday morning',
    prompt: 'Review the workspace',
    scheduleType: 'clock',
    clockTime: '08:30',
    daysOfWeek: [1, 2, 3, 4, 5],
    enabled: true,
  }, null, { ...store.data.settings, workspace: root }, now);
  store.data.automations.push(automation);
  store.flush();

  const restored = new Store({ filePath, defaultWorkspace: root }).data.automations[0];
  assert.equal(restored.scheduleType, 'clock');
  assert.equal(restored.clockTime, '08:30');
  assert.deepEqual(restored.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(Object.hasOwn(restored, 'intervalMinutes'), false);
});

test('legacy interval records normalize to the interval schedule type', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-interval-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
  store.data.automations.push({
    id: 'legacy',
    name: 'Legacy',
    prompt: 'Work',
    intervalMinutes: 45,
    enabled: false,
    nextRunAt: Date.now() + 45000,
    workspace: root,
  });
  store.flush();
  const restored = new Store({ filePath: store.filePath, defaultWorkspace: root }).data.automations[0];
  assert.equal(restored.scheduleType, 'interval');
  assert.equal(restored.intervalMinutes, 45);
});

test('renderer exposes interval and exact-time scheduling controls', () => {
  const root = path.join(__dirname, '..');
  const html = readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const app = readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(html, /id="automation-schedule-type"/);
  assert.match(html, /id="automation-clock-time"/);
  assert.match(html, /data-automation-day/);
  assert.match(app, /scheduleLabel\(routine\)/);
  assert.match(app, /scheduleType: 'clock'/);
  assert.match(app, /daysOfWeek/);
});

test('agent scheduling tool and built-in guidance advertise exact local schedules', () => {
  const root = path.join(__dirname, '..');
  const tools = readFileSync(path.join(root, 'src', 'agent-tools.cjs'), 'utf8');
  const controller = readFileSync(path.join(root, 'src', 'controller.cjs'), 'utf8');
  const skill = readFileSync(path.join(root, 'resources', 'skills', 'little-bot', 'SKILL.md'), 'utf8');
  assert.match(tools, /clockTime/);
  assert.match(tools, /daysOfWeek/);
  assert.match(tools, /scheduleType/);
  assert.match(controller, /exact PC-local clock times on selected weekdays/);
  assert.doesNotMatch(controller, /Automations support elapsed intervals only/);
  assert.match(skill, /Exact local time/);
  assert.match(skill, /0=Sunday/);
  assert.doesNotMatch(skill, /no cron-expression parser, weekday schedule, exact clock-time schedule/i);
});

test('automation management resumes using the saved schedule rather than interval arithmetic', () => {
  const main = readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(main, /nextAutomationRunAt\(existing, Date\.now\(\)\)/);
  assert.doesNotMatch(main, /Date\.now\(\) \+ existing\.intervalMinutes \* 60000/);
});
