'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { manageSchedule } = require('../src/schedule-management.cjs');
const { AgentTools } = require('../src/agent-tools.cjs');
const { Scheduler } = require('../src/scheduler.cjs');

function fixture(paused = false) {
  const now = new Date(2026, 8, 29, 8, 0).getTime();
  const workspace = process.cwd();
  const store = { data: { automations: [], settings: { workspace, connection: 'codex', model: 'test' }, autonomy: { paused } }, save() {} };
  const tools = new AgentTools({ store, manageSchedule: (action, payload, context) => manageSchedule(store, action, payload, context, now) });
  const chat = { id: 'chat', workspace, messages: [{ role: 'user', text: 'Schedule this task.' }] };
  const call = args => tools.call('schedule_manage', args, { chat });
  return { store, call, now };
}

test('agent-created enabled automation becomes due and executes without a panel toggle', async () => {
  const { store, call, now } = fixture();
  const created = await call({ action: 'create', name: 'Review', prompt: 'Review notes', intervalMinutes: 1, enabled: true });
  assert.equal(created.enabled, true);
  assert.equal(created.authorized, true);
  assert.equal(created.nextRunAt, now + 60000);
  let executions = 0;
  const scheduler = new Scheduler({ store, now: () => now + 60001, run: async () => { executions++; return {}; } });
  await scheduler.tick();
  assert.equal(executions, 1);
});

test('drafts can be enabled through resume, paused, and edited while preserving activation', async () => {
  const { call, now } = fixture();
  const draft = await call({ action: 'create', name: 'Review', prompt: 'Review notes', intervalMinutes: 1 });
  assert.equal(draft.enabled, false);
  const resumed = await call({ action: 'resume', id: draft.id });
  assert.equal(resumed.enabled, true);
  assert.equal(resumed.authorized, true);
  const edited = await call({ action: 'update', id: draft.id, scheduleType: 'clock', clockTime: '09:00', daysOfWeek: [2], prompt: 'Read updated notes' });
  assert.equal(edited.enabled, true);
  assert.equal(edited.nextRunAt, now + 3600000);
  assert.equal((await call({ action: 'pause', id: draft.id })).enabled, false);
  assert.equal((await call({ action: 'update', id: draft.id, enabled: true })).enabled, true);
  assert.equal((await call({ action: 'update', id: draft.id, enabled: false })).enabled, false);
});

test('global pause remains in effect and the returned status explains it', async () => {
  const { store, call } = fixture(true);
  const record = await call({ action: 'create', name: 'Review', prompt: 'Review notes', enabled: true });
  assert.equal(record.enabled, true);
  assert.equal(store.data.autonomy.paused, true);
  assert.match(record.message, /Pause all/);
});

test('invalid activation leaves the saved schedule unchanged', async () => {
  const { store, call } = fixture();
  await assert.rejects(call({ action: 'create', name: 'Review', prompt: 'Review notes', enabled: 'yes' }), /Enabled/);
  assert.equal(store.data.automations.length, 0);
  const record = await call({ action: 'create', name: 'Review', prompt: 'Review notes', enabled: true });
  await assert.rejects(call({ action: 'update', id: record.id, clockTime: '25:00' }), /Invalid exact/);
  assert.equal(store.data.automations[0].enabled, true);
  store.data.automations[0].lastStatus = 'running';
  await assert.rejects(call({ action: 'pause', id: record.id }), /Stop this routine/);
});
