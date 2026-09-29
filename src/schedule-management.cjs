'use strict';

const path = require('node:path');
const { validateAutomation, nextAutomationRunAt } = require('./scheduler.cjs');

function manageSchedule(store, action, payload, context, now = Date.now()) {
  const records = store.data.automations;
  const sameFolder = item => path.resolve(item.workspace).toLowerCase() === path.resolve(context.workspace).toLowerCase();
  if (action === 'list') return records.filter(sameFolder).map(item => ({ ...item }));
  const existing = payload.id ? records.find(item => item.id === payload.id) : null;
  if (action === 'create' && payload.id) throw new Error('A new routine cannot reuse an existing routine ID.');
  if (action !== 'create' && (!existing || !sameFolder(existing))) throw new Error('Choose a routine in this chat’s working folder.');
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
    existing.enabled = true;
    existing.authorized = true;
    existing.nextRunAt = nextAutomationRunAt(existing, now);
    record = existing;
  } else throw new Error('Unsupported routine action.');
  store.save();
  return { ...record, message: record.enabled
    ? store.data.autonomy?.paused ? 'Enabled. Runs will wait until Pause all is resumed in Goals.' : 'Enabled. The next run follows the saved schedule while Little Bot is open.'
    : 'Saved disabled. You can enable it through chat or Automations.' };
}

module.exports = { manageSchedule };
