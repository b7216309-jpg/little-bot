'use strict';

const { validateAutomation, nextAutomationRunAt } = require('./scheduler.cjs');

function manageSchedule(store, action, payload, context, now = Date.now()) {
  const records = store.data.automations;
  if (action === 'list') return records.map(item => ({ ...item }));
  const existing = payload.id ? records.find(item => item.id === payload.id) : null;
  if (action === 'create' && payload.id) throw new Error('A new routine cannot reuse an existing routine ID.');
  if (action !== 'create' && !existing) throw new Error('Choose an existing routine. List them to find its id.');
  if (existing?.lastStatus === 'running') throw new Error('Stop this routine before changing it.');
  let record;
  if (action === 'create' || action === 'update') {
    const enabled = payload.enabled ?? existing?.enabled ?? false;
    record = validateAutomation({ ...existing, ...payload, enabled }, existing, { ...store.data.settings, workspace: context.workspace }, now);
    record.authorized = enabled || existing?.authorized === true;
    if (existing) Object.assign(existing, record); else records.push(record);
  } else if (action === 'pause') {
    existing.authorized = existing.authorized === true || existing.enabled || Number.isFinite(existing.lastRunAt);
    existing.enabled = false;
    record = existing;
  } else if (action === 'resume') {
    existing.nextRunAt = nextAutomationRunAt(existing, now);
    existing.enabled = true;
    existing.authorized = true;
    record = existing;
  } else throw new Error('Unsupported routine action.');
  store.save();
  return { ...record, message: record.enabled
    ? store.data.autonomy?.paused ? 'Enabled. Runs will wait until the Background switch is turned back on.' : 'Enabled. The next run follows the saved schedule while Little Bot is open.'
    : 'Saved disabled. You can enable it through chat or Automations.' };
}

module.exports = { manageSchedule };
