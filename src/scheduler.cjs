'use strict';

const { randomUUID } = require('node:crypto');
const { connectionBinding, isConnectionSelected, requireSelectedConnection } = require('./connections.cjs');
const { parseLocalDateTime } = require('./calendar.cjs');

const MINUTE_MS = 60 * 1000;
const ALL_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
const MAX_DELAY_MINUTES = 525600;
// A one-time run this far past its time tells the model it is late.
const LATE_MS = 5 * MINUTE_MS;

function validInterval(value) {
  if (!Number.isInteger(value) || value < 1 || value > 525600) {
    throw new RangeError('The interval must be a whole number from 1 to 525600 minutes (one year).');
  }
  return value;
}

function validClockTime(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new RangeError('Choose an exact local time in HH:MM format.');
  }
  return value;
}

function validDaysOfWeek(value) {
  const input = value == null ? ALL_DAYS : value;
  if (!Array.isArray(input) || !input.length || input.length > 7
    || input.some(day => !Number.isInteger(day) || day < 0 || day > 6)
    || new Set(input).size !== input.length) {
    throw new RangeError('Choose one or more unique weekdays.');
  }
  return [...input].sort((left, right) => left - right);
}

// A date and time on this PC's clock, as text or as a timestamp already saved.
function validRunAt(value) {
  return parseLocalDateTime(typeof value === 'string' ? value.trim().replace(' ', 'T') : value, { label: 'date and time' });
}

// Whole minutes, so the saved time is the one the editor shows.
function delayedRunAt(nowMs, delayMinutes) {
  if (!Number.isInteger(delayMinutes) || delayMinutes < 1 || delayMinutes > MAX_DELAY_MINUTES) {
    throw new RangeError(`The delay must be a whole number from 1 to ${MAX_DELAY_MINUTES} minutes.`);
  }
  return Math.ceil((nowMs + delayMinutes * MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
}

function nextRunAt(nowMs, intervalMinutes) {
  if (!Number.isFinite(nowMs)) throw new TypeError('A valid current timestamp is required.');
  return nowMs + validInterval(intervalMinutes) * MINUTE_MS;
}

function nextClockRunAt(nowMs, clockTime, daysOfWeek = ALL_DAYS) {
  if (!Number.isFinite(nowMs)) throw new TypeError('A valid current timestamp is required.');
  const [hour, minute] = validClockTime(clockTime).split(':').map(Number);
  const days = validDaysOfWeek(daysOfWeek);
  const allowed = new Set(days);
  const now = new Date(nowMs);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, minute, 0, 0);
    if (allowed.has(candidate.getDay()) && candidate.getTime() > nowMs) return candidate.getTime();
  }
  throw new Error('Could not calculate the next exact-time run.');
}

function scheduleTypeOf(value) {
  return ['clock', 'once'].includes(value?.scheduleType) ? value.scheduleType : 'interval';
}

function scheduleFields(input, existing = null, nowMs = Date.now()) {
  const scheduleType = input.scheduleType === undefined ? scheduleTypeOf(existing) : input.scheduleType;
  if (!['interval', 'clock', 'once'].includes(scheduleType)) throw new Error('Choose an interval, exact-time or one-time schedule.');
  if (scheduleType === 'once') {
    if (input.delayMinutes !== undefined) return { scheduleType, runAt: delayedRunAt(nowMs, input.delayMinutes) };
    return { scheduleType, runAt: validRunAt(input.runAt === undefined ? existing?.runAt : input.runAt) };
  }
  if (scheduleType === 'clock') {
    const clockTime = validClockTime(input.clockTime === undefined ? existing?.clockTime : input.clockTime);
    const daysOfWeek = validDaysOfWeek(input.daysOfWeek === undefined ? existing?.daysOfWeek : input.daysOfWeek);
    return { scheduleType, clockTime, daysOfWeek };
  }
  const intervalMinutes = validInterval(input.intervalMinutes === undefined ? (existing?.intervalMinutes ?? 60) : input.intervalMinutes);
  return { scheduleType, intervalMinutes };
}

function scheduleSignature(value) {
  const type = scheduleTypeOf(value);
  if (type === 'once') return JSON.stringify(['once', value.runAt]);
  return type === 'clock'
    ? JSON.stringify(['clock', value.clockTime, validDaysOfWeek(value.daysOfWeek)])
    : JSON.stringify(['interval', validInterval(value.intervalMinutes)]);
}

function nextAutomationRunAt(automation, nowMs) {
  const type = scheduleTypeOf(automation);
  if (type === 'once') {
    if (!(automation.runAt > nowMs)) throw new RangeError('Choose a date and time in the future for this one-time task.');
    return automation.runAt;
  }
  return type === 'clock'
    ? nextClockRunAt(nowMs, automation.clockTime, automation.daysOfWeek)
    : nextRunAt(nowMs, automation.intervalMinutes);
}

function validateAutomation(input, existing = null, settings = {}, nowMs = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('An automation is required.');
  if (!Number.isFinite(nowMs)) throw new TypeError('A valid current timestamp is required.');
  if (input.id != null && !existing) throw new Error('This automation no longer exists.');
  if (existing && input.id != null && input.id !== existing.id) throw new Error('Automation IDs must match.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!name || name.length > 80) throw new Error('Give the automation a name of 1 to 80 characters.');
  if (!prompt || prompt.length > 32000) throw new Error('The task must contain 1 to 32000 characters.');
  const schedule = scheduleFields(input, existing, nowMs);
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new TypeError('Enabled must be true or false.');
  }
  const enabled = input.enabled === undefined ? (existing ? existing.enabled : true) : input.enabled;
  const candidate = { ...existing, ...schedule };
  const resetSchedule = !existing || scheduleSignature(existing) !== scheduleSignature(candidate)
    || (enabled && !existing.enabled) || !Number.isFinite(existing.nextRunAt);
  return {
    id: existing ? existing.id : randomUUID(),
    name,
    prompt,
    ...schedule,
    enabled,
    // A finished one-time task can still be renamed; only a new time or switching it back on needs a future time.
    nextRunAt: !resetSchedule ? existing.nextRunAt
      : !enabled && scheduleTypeOf(candidate) === 'once' && existing && scheduleSignature(existing) === scheduleSignature(candidate) ? null
        : nextAutomationRunAt(candidate, nowMs),
    lastRunAt: existing && Number.isFinite(existing.lastRunAt) ? existing.lastRunAt : null,
    lastStatus: existing && ['running', 'completed', 'error'].includes(existing.lastStatus) ? existing.lastStatus : 'never',
    ...(existing && typeof existing.lastError === 'string' ? { lastError: existing.lastError } : {}),
    workspace: existing ? existing.workspace : settings.workspace,
    model: existing ? existing.model : (settings.model || ''),
    ...connectionBinding(existing || settings),
    effort: existing ? (existing.effort || 'low') : (settings.effort || 'low'),
  };
}

class Scheduler {
  constructor({ store, run, canRun = () => true, checkReady = () => {}, onChange = () => {}, now = Date.now, publish = null }) {
    if (!store || typeof store.save !== 'function') throw new TypeError('A store is required.');
    if (typeof run !== 'function') throw new TypeError('A task runner is required.');
    if (publish !== null && typeof publish !== 'function') throw new TypeError('Scheduler publish must be a function.');
    this.store = store;
    this.canRun = canRun;
    this.checkReady = checkReady;
    this.run = run;
    this.onChange = onChange;
    this.now = now;
    this.publish = publish;
    this.timer = null;
    this.runningId = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, 15000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.runningId || !this.canRun()) return null;
    const nowMs = this.now();
    const due = this.store.data.automations
      .filter(automation => automation.enabled && Number.isFinite(automation.nextRunAt) && automation.nextRunAt <= nowMs)
      .filter(automation => isConnectionSelected(automation, this.store.data.settings))
      .filter(automation => scheduleTypeOf(automation) !== 'once' || this._ready(automation))
      .sort((left, right) => left.nextRunAt - right.nextRunAt)[0];
    if (!due) return null;
    if (this.publish) return this.publish({
      type: 'automation.due', source: 'scheduler', priority: 4,
      dedupeKey: `automation:due:${due.id}:${due.nextRunAt}`,
      expiresAt: nowMs + Math.max(MINUTE_MS, scheduleTypeOf(due) === 'interval' ? due.intervalMinutes * MINUTE_MS : 60 * MINUTE_MS),
      payload: { automationId: due.id, name: due.name, workspace: due.workspace, dueAt: due.nextRunAt },
    });
    try {
      return await this.runNow(due.id);
    } catch {
      // The failure is saved on the record; periodic calls must never reject.
      return null;
    }
  }

  async runNow(id) {
    if (this.runningId) throw new Error('Another automation is already running.');
    if (!this.canRun()) throw new Error('Wait for the current conversation, goal, or heartbeat to finish, or stop it first.');
    const automation = this.store.data.automations.find(item => item.id === id);
    if (!automation) throw new Error('This automation no longer exists.');
    requireSelectedConnection(automation, this.store.data.settings);
    const once = scheduleTypeOf(automation) === 'once';
    // Starting uses a one-time task up, so a stopped engine or model must leave it waiting.
    if (once) this.checkReady(automation);
    this.runningId = id;
    try {
      const startedAt = this.now();
      const lateFrom = once && automation.enabled && startedAt - automation.nextRunAt > LATE_MS ? automation.nextRunAt : null;
      automation.lastRunAt = startedAt;
      automation.lastStatus = 'running';
      if (once) { automation.enabled = false; automation.nextRunAt = null; }
      else automation.nextRunAt = nextAutomationRunAt(automation, startedAt);
      delete automation.lastError;
      this.store.save();
      this.onChange();
      this.publish?.({ type: 'automation.started', source: 'scheduler',
        payload: { automationId: automation.id, name: automation.name, workspace: automation.workspace, startedAt } });
      // The runner resolves only after its task finishes, including any user-input wait.
      const result = await this.run({ ...automation, ...(lateFrom ? { lateFrom } : {}) });
      if (result === false) throw new Error('The automation could not start.');
      this._finish(id, 'completed');
      return result;
    } catch (error) {
      this._finish(id, 'error', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.runningId = null;
    }
  }

  _ready(automation) {
    try { this.checkReady(automation); return true; } catch { return false; }
  }

  _finish(id, status, error) {
    const automation = this.store.data.automations.find(item => item.id === id);
    if (!automation) return;
    automation.lastStatus = status;
    if (error) automation.lastError = error;
    else delete automation.lastError;
    const nowMs = this.now();
    if (scheduleTypeOf(automation) !== 'once' && (!Number.isFinite(automation.nextRunAt) || automation.nextRunAt <= nowMs)) {
      automation.nextRunAt = nextAutomationRunAt(automation, nowMs);
    }
    this.store.save();
    this.onChange();
    this.publish?.({
      type: status === 'completed' ? 'automation.completed' : 'automation.error',
      source: 'scheduler',
      payload: { automationId: automation.id, name: automation.name, workspace: automation.workspace,
        finishedAt: nowMs, ...(error ? { error: String(error).slice(0, 2000) } : {}) },
    });
  }
}

module.exports = {
  Scheduler,
  validateAutomation,
  nextRunAt,
  nextClockRunAt,
  nextAutomationRunAt,
  validClockTime,
  validDaysOfWeek,
};
