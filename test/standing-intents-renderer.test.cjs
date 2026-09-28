'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../src/renderer/standing-intents-ui.js');

test('standing-intent renderer helper exposes known event and operator labels', () => {
  assert.equal(ui.eventLabel('calendar.event_approaching'), 'Calendar event approaching');
  assert.equal(ui.operatorLabel('glob'), 'matches wildcard');
  assert.match(ui.eventLabel('custom.event'), /custom event/);
});

test('form values produce one deterministic filter and the selected action target', () => {
  const intent = ui.buildIntent({
    id: 'intent-1', name: 'Review reports', enabled: true,
    eventType: 'file.changed', source: 'goal.runner',
    filterPath: 'path', filterOperator: 'glob', filterValue: 'reports/*.csv',
    actionType: 'goal.run', targetId: 'goal-1', priority: '4', debounceSeconds: '30',
  });
  assert.deepEqual(intent, {
    id: 'intent-1', name: 'Review reports', enabled: true, priority: 4, debounceMs: 30000,
    when: { type: 'file.changed', source: 'goal.runner', filters: [{ path: 'payload.path', operator: 'glob', value: 'reports/*.csv' }] },
    action: { type: 'goal.run', goalId: 'goal-1' },
  });
});

test('scalar filters preserve booleans, numbers, null, and ordinary text', () => {
  assert.equal(ui.parseScalar('true'), true);
  assert.equal(ui.parseScalar('-12.5'), -12.5);
  assert.equal(ui.parseScalar('null'), null);
  assert.equal(ui.parseScalar('completed'), 'completed');
  assert.deepEqual(ui.filterFromForm({ path: 'payload.ready', operator: 'exists', value: 'false' }), { path: 'payload.ready', operator: 'exists', value: false });
});

test('descriptions resolve goal and automation names without hiding missing targets', () => {
  const state = { autonomy: { goals: [{ id: 'g1', name: 'Prepare brief' }] }, automations: [{ id: 'a1', name: 'Daily report' }] };
  const goal = ui.describe({ when: { type: 'goal.completed', filters: [] }, action: { type: 'goal.run', goalId: 'g1' }, lastStatus: 'completed' }, state);
  assert.equal(goal.action, 'Run goal · Prepare brief');
  const missing = ui.describe({ when: { type: 'chat.completed', filters: [] }, action: { type: 'automation.run', automationId: 'gone' } }, state);
  assert.match(missing.action, /gone/);
});
