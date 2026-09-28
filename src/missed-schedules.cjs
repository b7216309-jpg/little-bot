'use strict';

const { nextAutomationRunAt } = require('./scheduler.cjs');

const MINUTE = 60000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function advanceMissedSchedules(data, nowMs = Date.now()) {
  if (!object(data) || !Number.isFinite(nowMs) || nowMs < 0) throw new TypeError('Saved state and a valid current time are required.');
  const result = { automations: [], heartbeat: false, goals: [] };

  for (const automation of Array.isArray(data.automations) ? data.automations : []) {
    if (!automation?.enabled || !Number.isFinite(automation.nextRunAt) || automation.nextRunAt > nowMs) continue;
    const dueAt = automation.nextRunAt;
    automation.nextRunAt = nextAutomationRunAt(automation, nowMs);
    result.automations.push({ id: automation.id, dueAt, nextRunAt: automation.nextRunAt });
  }

  const heartbeat = data.heartbeat;
  if (object(heartbeat) && heartbeat.enabled === true && typeof heartbeat.checklist === 'string' && heartbeat.checklist.trim()
    && Number.isFinite(heartbeat.nextRunAt) && heartbeat.nextRunAt <= nowMs) {
    const dueAt = heartbeat.nextRunAt;
    const intervalMinutes = Number.isInteger(heartbeat.intervalMinutes) && heartbeat.intervalMinutes > 0 ? heartbeat.intervalMinutes : 30;
    heartbeat.nextRunAt = nowMs + intervalMinutes * MINUTE;
    result.heartbeat = { dueAt, nextRunAt: heartbeat.nextRunAt };
  }

  for (const goal of Array.isArray(data.autonomy?.goals) ? data.autonomy.goals : []) {
    if (!goal?.authorized || goal.status !== 'queued' || goal.trigger?.type !== 'interval'
      || !Number.isFinite(goal.nextRunAt) || goal.nextRunAt > nowMs) continue;
    const dueAt = goal.nextRunAt;
    const intervalMinutes = Number.isInteger(goal.trigger.intervalMinutes) && goal.trigger.intervalMinutes > 0
      ? goal.trigger.intervalMinutes : 30;
    goal.nextRunAt = nowMs + intervalMinutes * MINUTE;
    result.goals.push({ id: goal.id, dueAt, nextRunAt: goal.nextRunAt });
  }

  return result;
}

function missedCount(result) {
  if (!object(result)) return 0;
  return (Array.isArray(result.automations) ? result.automations.length : 0)
    + (result.heartbeat ? 1 : 0)
    + (Array.isArray(result.goals) ? result.goals.length : 0);
}

module.exports = { advanceMissedSchedules, missedCount };
