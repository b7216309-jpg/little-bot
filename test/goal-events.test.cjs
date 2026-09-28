'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GoalRunner } = require('../src/goals.cjs');

test('pausing a goal publishes its foreground lifecycle event', async () => {
  const events = [];
  const goal = { id: 'goal-1', name: 'Demo', workspace: 'C:\\Work', status: 'queued', history: [], dependsOn: [] };
  const store = { data: { autonomy: { paused: false, goals: [goal] }, settings: {} }, save() {} };
  const runner = new GoalRunner({ store, backupRoot: 'C:\\Backups', publish: event => { events.push(event); return { accepted: true }; } });

  await runner.pause(goal.id);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'goal.paused');
  assert.equal(events[0].payload.goalId, goal.id);
  assert.equal(events[0].payload.reason, 'Paused by you.');
});
