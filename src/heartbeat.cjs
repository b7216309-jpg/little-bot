'use strict';

const { randomUUID, createHash } = require('node:crypto');
const attention = require('./attention.cjs');
const { connectionBinding, isConnectionSelected, requireSelectedConnection } = require('./connections.cjs');

const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;
const MAX_CHECKLIST = 8000;
const INTERRUPTED = 'Heartbeat was interrupted because Little Bot closed before it finished.';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max, fallback) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;
const timestamp = (value, fallback = null) => Number.isFinite(value) && value >= 0 ? value : fallback;
const effort = value => ['low', 'medium', 'high'].includes(value) ? value : 'low';
const string = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const initiative = value => value === 'wild' ? 'wild' : 'calm';
const MIN_WAKE = 5;
const MAX_WAKE = 240;
const MAX_PULSE = 30;
const MAX_FOLLOWUPS = 20;
const MAX_FOLLOWUP_AHEAD = 30 * 24 * 60 * MINUTE;

function localDay(nowMs) {
  const date = new Date(nowMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function clean(value, limit = 2000) {
  return string(value)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/(\bBearer\s+)[^\s"',}]+/gi, '$1[redacted]')
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]')
    .replace(/([?&](?:code|token|access_token|refresh_token|id_token|key|state)=)[^&\s]+/gi, '$1[redacted]')
    .trim().slice(0, limit);
}

function actions(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string')
    .map(item => clean(item, 500)).filter(Boolean).slice(0, 20) : [];
}

function wakeMinutes(value) {
  return Number.isFinite(value) ? Math.min(MAX_WAKE, Math.max(MIN_WAKE, Math.round(value))) : null;
}

// Every finished run, including quiet ones, so the user can see the bot is alive and why it stayed silent.
function pulse(value) {
  return (Array.isArray(value) ? value : []).filter(item => object(item) && timestamp(item.at) !== null
    && ['quiet', 'alert', 'error'].includes(item.status)).slice(-MAX_PULSE).map(item => ({
    at: item.at, status: item.status, note: clean(item.note, 300),
    ...(wakeMinutes(item.wakeInMinutes) ? { wakeInMinutes: wakeMinutes(item.wakeInMinutes) } : {}),
  }));
}

// One-shot check-ins the agent promised itself; each wakes a wild heartbeat with its note.
function followups(value) {
  return (Array.isArray(value) ? value : []).filter(item => object(item) && timestamp(item.at) !== null
    && typeof item.note === 'string' && item.note.trim()).slice(0, MAX_FOLLOWUPS).map(item => ({
    id: string(item.id).slice(0, 100) || randomUUID(), at: item.at, note: clean(item.note, 300),
    createdAt: timestamp(item.createdAt, item.at),
  })).sort((left, right) => left.at - right.at);
}

function retryDelay(config) {
  return Math.max(config.intervalMinutes, Math.min(240, config.intervalMinutes * (2 ** Math.max(0, config.failureCount - 1)))) * MINUTE;
}

function defaultHeartbeat(settings = {}, nowMs = Date.now()) {
  return {
    enabled: false, mode: 'act', initiative: 'calm', checklist: '', intervalMinutes: 30,
    startHour: 8, endHour: 22, maxRunsPerDay: 12, maxAlertsPerDay: 3, snoozeMinutes: 60,
    workspace: string(settings.workspace), model: string(settings.model), effort: effort(settings.effort),
    ...connectionBinding(settings),
    nextRunAt: nowMs + 30 * MINUTE, lastRunAt: null, lastStatus: 'never',
    dayKey: localDay(nowMs), runsToday: 0, failureCount: 0, quietStreak: 0, pulse: [], followups: [],
    lastFingerprint: '', lastAlertAt: null, lastActions: [], history: [], attention: attention.normalizeAttention(null),
  };
}

function normalizeHeartbeat(value, settings = {}, nowMs = Date.now(), recovering = false) {
  const defaults = defaultHeartbeat(settings, nowMs);
  if (!object(value)) return defaults;
  const checklist = string(value.checklist).trim().slice(0, MAX_CHECKLIST);
  const result = {
    enabled: value.enabled === true && Boolean(checklist), mode: 'act', initiative: initiative(value.initiative), checklist,
    intervalMinutes: integer(value.intervalMinutes, 5, 1440, 30),
    startHour: integer(value.startHour, 0, 23, 8), endHour: integer(value.endHour, 0, 23, 22),
    maxRunsPerDay: integer(value.maxRunsPerDay, 1, 100, 12),
    maxAlertsPerDay: integer(value.maxAlertsPerDay, 1, 20, 3), snoozeMinutes: integer(value.snoozeMinutes, 5, 1440, 60),
    workspace: string(value.workspace, defaults.workspace), model: string(value.model, defaults.model), effort: effort(value.effort),
    ...connectionBinding(value),
    nextRunAt: timestamp(value.nextRunAt, defaults.nextRunAt), lastRunAt: timestamp(value.lastRunAt),
    lastStatus: ['never', 'running', 'quiet', 'alert', 'error'].includes(value.lastStatus) ? value.lastStatus : 'never',
    dayKey: typeof value.dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dayKey) ? value.dayKey : defaults.dayKey,
    runsToday: integer(value.runsToday, 0, 100, 0), failureCount: integer(value.failureCount, 0, 10, 0),
    quietStreak: integer(value.quietStreak, 0, 1000, 0), pulse: pulse(value.pulse), followups: followups(value.followups),
    ...(typeof value.wakeReason === 'string' && value.wakeReason.trim() ? { wakeReason: clean(value.wakeReason, 300) } : {}),
    lastFingerprint: /^[a-f0-9]{64}$/.test(value.lastFingerprint) ? value.lastFingerprint : '',
    lastAlertAt: timestamp(value.lastAlertAt),
    lastActions: actions(value.lastActions),
    history: (Array.isArray(value.history) ? value.history : []).filter(item => object(item)
      && ['alert', 'error'].includes(item.status) && typeof item.summary === 'string' && item.summary.trim()
      && timestamp(item.at) !== null).slice(-50).map(item => ({
      id: string(item.id).slice(0, 128) || randomUUID(), at: item.at, status: item.status,
      summary: clean(item.summary), actions: actions(item.actions), workspace: string(item.workspace), unread: item.unread !== false,
      topic: clean(item.topic, 120), source: item.source === 'goal' ? 'goal' : 'heartbeat',
      ...(item.source === 'goal' && typeof item.goalId === 'string' ? { goalId: item.goalId.slice(0, 100) } : {}),
      subjectKey: /^[a-f0-9]{64}$/.test(item.subjectKey) ? item.subjectKey : '',
      delivery: ['notified', 'quiet', 'muted', 'snoozed'].includes(item.delivery) ? item.delivery : 'quiet',
      feedback: ['useful', 'later', 'dismiss'].includes(item.feedback) ? item.feedback : null,
    })),
  };
  for (const item of result.history) item.subjectKey ||= attention.keyFor(item);
  result.attention = attention.normalizeAttention(value.attention, result.history);
  if (typeof value.lastError === 'string' && value.lastError.trim()) result.lastError = clean(value.lastError);
  if (recovering && result.lastStatus === 'running') {
    result.lastStatus = 'error';
    result.lastError = INTERRUPTED;
    result.failureCount = Math.min(10, result.failureCount + 1);
    result.nextRunAt = Math.max(result.nextRunAt, nowMs + retryDelay(result));
  }
  return result;
}

function validateHeartbeat(input, existing = null, settings = {}, nowMs = Date.now()) {
  if (!object(input)) throw new TypeError('Heartbeat settings are required.');
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new TypeError('A valid current timestamp is required.');
  for (const key of ['enabled', 'useCurrentWorkspace']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new TypeError(`${key === 'enabled' ? 'Enabled' : 'Use current workspace'} must be true or false.`);
  }
  if (input.mode !== undefined && input.mode !== 'act') throw new Error('Heartbeat can only act within its working folder.');
  if (input.initiative !== undefined && !['calm', 'wild'].includes(input.initiative)) throw new Error('Initiative must be calm or wild.');
  const previous = normalizeHeartbeat(existing, settings, nowMs);
  if (input.checklist !== undefined && typeof input.checklist !== 'string') throw new TypeError('The heartbeat checklist must be text.');
  const checklist = input.checklist === undefined ? previous.checklist : input.checklist.trim();
  if (checklist.length > MAX_CHECKLIST) throw new Error('The heartbeat checklist must contain at most 8000 characters.');
  const enabled = input.enabled === undefined ? previous.enabled : input.enabled;
  if (enabled && !checklist) throw new Error('Add a checklist before enabling heartbeat.');
  const values = {};
  for (const [key, min, max, label] of [
    ['intervalMinutes', 5, 1440, 'The interval'],
    ['startHour', 0, 23, 'The start hour'], ['endHour', 0, 23, 'The end hour'],
    ['maxRunsPerDay', 1, 100, 'The daily run limit'],
    ['maxAlertsPerDay', 1, 20, 'The daily notification limit'], ['snoozeMinutes', 5, 1440, 'The Later delay'],
  ]) {
    const value = input[key] === undefined ? previous[key] : input[key];
    if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be a whole number from ${min} to ${max}.`);
    values[key] = value;
  }
  const capture = !object(existing) || (!previous.checklist && previous.lastStatus === 'never') || input.useCurrentWorkspace === true;
  const scope = capture ? { workspace: string(settings.workspace), model: string(settings.model), effort: effort(settings.effort), ...connectionBinding(settings) }
    : { workspace: previous.workspace, model: previous.model, effort: previous.effort, ...connectionBinding(previous) };
  if (checklist && !scope.workspace.trim()) throw new Error('Choose a working folder before setting up heartbeat.');
  const level = input.initiative === undefined ? previous.initiative : input.initiative;
  const turnedWild = level === 'wild' && previous.initiative !== 'wild';
  const resetSchedule = values.intervalMinutes !== previous.intervalMinutes || (enabled && !previous.enabled)
    || input.useCurrentWorkspace === true || !object(existing) || turnedWild;
  // A wild heartbeat starts within a minute instead of waiting a whole interval to show it is alive.
  const firstDelay = level === 'wild' ? MINUTE : values.intervalMinutes * MINUTE;
  return {
    ...previous, ...values, ...scope, enabled, mode: 'act', initiative: level, checklist,
    ...(turnedWild ? { quietStreak: 0 } : {}),
    nextRunAt: resetSchedule ? nowMs + firstDelay : previous.nextRunAt,
  };
}

function inActiveHours(config, nowMs) {
  const hour = new Date(nowMs).getHours();
  if (config.startHour === config.endHour) return true;
  return config.startHour < config.endHour ? hour >= config.startHour && hour < config.endHour
    : hour >= config.startHour || hour < config.endHour;
}

function fingerprint(status, summary, performedActions = [], workspace = '') {
  const normalized = [workspace, status, summary, ...performedActions].map(value => value.toLowerCase().replace(/\s+/g, ' ').trim()).join('\n');
  return createHash('sha256').update(normalized).digest('hex');
}

class Heartbeat {
  constructor({ store, run, canRun = () => true, canNotify = () => true, onChange = () => {}, onAlert = () => {}, onRecord = () => {}, now = Date.now, publish = null }) {
    if (!store || !object(store.data) || typeof store.save !== 'function') throw new TypeError('A store is required.');
    if (typeof run !== 'function') throw new TypeError('A heartbeat runner is required.');
    if (typeof canRun !== 'function' || typeof canNotify !== 'function' || typeof now !== 'function') throw new TypeError('Heartbeat availability and clock must be functions.');
    if (publish !== null && typeof publish !== 'function') throw new TypeError('Heartbeat publish must be a function.');
    this.store = store;
    this.run = run;
    this.canRun = canRun;
    this.canNotify = canNotify;
    this.onChange = onChange;
    this.onAlert = onAlert;
    this.onRecord = typeof onRecord === 'function' ? onRecord : () => {};
    this.now = now;
    this.publish = publish;
    this.running = false;
    this.timer = null;
    if (!object(store.data.heartbeat)) store.data.heartbeat = defaultHeartbeat(store.data.settings, now());
    else Object.assign(store.data.heartbeat, normalizeHeartbeat(store.data.heartbeat, store.data.settings, now()));
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

  _changed() {
    try { this.onChange(); } catch { /* Observers cannot undo a persisted run. */ }
  }

  _mutate(mutator, onlyIfChanged = false) {
    const config = this.store.data.heartbeat;
    const previous = structuredClone(config);
    try {
      const result = mutator(config);
      if (onlyIfChanged && JSON.stringify(config) === JSON.stringify(previous)) return result;
      this.store.save();
      this._changed();
      return result;
    } catch (error) {
      for (const key of Object.keys(config)) delete config[key];
      Object.assign(config, previous);
      throw error;
    }
  }

  _storageFailure(error) {
    const config = this.store.data.heartbeat;
    config.lastStatus = 'error';
    config.lastError = `Could not save heartbeat state: ${clean(error instanceof Error ? error.message : String(error))}`.slice(0, 2000);
    config.nextRunAt = Math.max(config.nextRunAt, this.now() + config.intervalMinutes * MINUTE);
    this._changed();
    return new Error(config.lastError);
  }

  async tick() {
    try {
      // Deferred notifications do not need another model run or an enabled
      // heartbeat. The host notification guard also enforces global pause.
      this.flushAttention();
      const config = this.store.data.heartbeat;
      const nowMs = this.now();
      if (!this.running) this._dueFollowups(nowMs);
      if (!isConnectionSelected(config, this.store.data.settings)) return null;
      if (this.running || !config.enabled || !config.checklist.trim() || !Number.isFinite(config.nextRunAt)
        || config.nextRunAt > nowMs || !inActiveHours(config, nowMs) || !this.canRun()) return null;
      if (config.dayKey === localDay(nowMs) && config.runsToday >= config.maxRunsPerDay) return null;
      if (this.publish) return this.publish({
        type: 'heartbeat.due', source: 'heartbeat', priority: 3,
        dedupeKey: `heartbeat:due:${config.nextRunAt}`,
        expiresAt: nowMs + Math.max(MINUTE, config.intervalMinutes * MINUTE),
        payload: { dueAt: config.nextRunAt, workspace: config.workspace },
      });
      return await this.runNow();
    } catch {
      // Manual calls receive errors. Timer calls retain the visible status and keep scheduling.
      return null;
    }
  }

  async runNow() {
    if (this.running) throw new Error('Heartbeat is already running.');
    if (!this.canRun()) throw new Error('Heartbeat is waiting for the app to be ready and other tasks to finish.');
    const config = this.store.data.heartbeat;
    requireSelectedConnection(config, this.store.data.settings);
    if (!config.checklist.trim()) throw new Error('Add a checklist before running heartbeat.');
    if (!config.workspace.trim()) throw new Error('Choose a working folder before running heartbeat.');
    const startedAt = this.now();
    const wakeReason = config.wakeReason || '';
    const dayKey = localDay(startedAt);
    if (config.dayKey === dayKey && config.runsToday >= config.maxRunsPerDay) throw new Error('Heartbeat has reached its daily run limit.');
    this.running = true;
    try {
      try {
        this._mutate(current => {
          current.runsToday = (current.dayKey === dayKey ? current.runsToday : 0) + 1;
          current.dayKey = dayKey;
          current.lastRunAt = startedAt;
          current.lastStatus = 'running';
          current.nextRunAt = startedAt + current.intervalMinutes * MINUTE;
          delete current.lastError;
          delete current.wakeReason;
        });
      } catch (error) { throw this._storageFailure(error); }
      this.publish?.({ type: 'heartbeat.started', source: 'heartbeat',
        payload: { startedAt, workspace: config.workspace } });

      let result, extra;
      try {
        const returned = await this.run({ ...structuredClone(config), wakeReason, attentionContext: attention.context(config, this.now()) });
        if (!object(returned) || !['quiet', 'alert'].includes(returned.status) || typeof returned.summary !== 'string') {
          throw new Error('Heartbeat returned an invalid result.');
        }
        result = { status: returned.status, summary: clean(returned.summary), actions: actions(returned.actions), topic: clean(returned.topic, 120) };
        extra = { reason: clean(returned.reason, 300), wakeInMinutes: wakeMinutes(returned.wakeInMinutes) };
        if (result.status === 'alert' && !result.summary) throw new Error('Heartbeat returned an empty alert.');
      } catch (error) {
        const message = clean(error instanceof Error ? error.message : String(error)) || 'Heartbeat could not complete.';
        try { this._finish('error', message, actions(error?.actions), 'Heartbeat failure'); } catch (saveError) { throw this._storageFailure(saveError); }
        throw new Error(message);
      }
      try { this._finish(result.status, result.summary, result.actions, result.topic, extra); } catch (error) { throw this._storageFailure(error); }
      return result;
    } finally {
      this.running = false;
    }
  }

  // Moments when the user is present pull a wild heartbeat forward. With debounce the check waits until
  // activity has settled for the full delay; otherwise it only ever moves earlier.
  wakeSoon(reason, delayMs, { debounce = false } = {}) {
    const config = this.store.data.heartbeat;
    if (config.initiative !== 'wild' || !config.enabled || !config.checklist.trim()) return false;
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError('A wake-up delay is required.');
    const at = this.now() + delayMs;
    if (!debounce && Number.isFinite(config.nextRunAt) && config.nextRunAt <= at) return false;
    this._mutate(current => { current.nextRunAt = at; current.wakeReason = clean(reason, 300); });
    return true;
  }

  scheduleFollowup({ at, note } = {}) {
    const config = this.store.data.heartbeat;
    if (config.initiative !== 'wild' || !config.enabled) throw new Error('Follow-ups need Heartbeat enabled with Wild initiative.');
    const nowMs = this.now();
    if (!Number.isFinite(at) || at <= nowMs || at > nowMs + MAX_FOLLOWUP_AHEAD) throw new Error('Choose a follow-up time in the next 30 days.');
    if (typeof note !== 'string' || !note.trim()) throw new Error('A follow-up needs a short note saying what to check.');
    if (config.followups.length >= MAX_FOLLOWUPS) throw new Error(`At most ${MAX_FOLLOWUPS} follow-ups can be planned. Cancel one first.`);
    const item = { id: randomUUID(), at: Math.round(at), note: clean(note, 300), createdAt: nowMs };
    this._mutate(current => { current.followups = followups([...current.followups, item]); });
    return structuredClone(item);
  }

  cancelFollowup(id) {
    if (typeof id !== 'string' || !this.store.data.heartbeat.followups.some(item => item.id === id)) throw new Error('That follow-up does not exist.');
    this._mutate(current => { current.followups = current.followups.filter(item => item.id !== id); });
    return { cancelled: id };
  }

  listFollowups() { return structuredClone(this.store.data.heartbeat.followups); }

  // Due follow-ups become an immediate wake-up carrying their notes; the regular hour and run limits still apply.
  _dueFollowups(nowMs) {
    const config = this.store.data.heartbeat;
    if (config.initiative !== 'wild' || !config.enabled) return false;
    const due = config.followups.filter(item => item.at <= nowMs);
    if (!due.length) return false;
    const reason = `Follow-up you planned: ${due.map(item => item.note).join(' | ')}`;
    this._mutate(current => {
      current.followups = current.followups.filter(item => item.at > nowMs);
      current.nextRunAt = Math.min(Number.isFinite(current.nextRunAt) ? current.nextRunAt : nowMs, nowMs);
      current.wakeReason = clean([current.wakeReason, reason].filter(Boolean).join(' '), 300);
    });
    return true;
  }

  _finish(status, summary, performedActions, topic = '', { reason = '', wakeInMinutes = null } = {}) {
    const nowMs = this.now();
    let recorded = null;
    const alert = this._mutate(config => {
      config.lastStatus = status;
      config.lastActions = [...performedActions];
      config.failureCount = status === 'error' ? Math.min(10, config.failureCount + 1) : 0;
      if (status === 'quiet') config.quietStreak = Math.min(1000, config.quietStreak + 1);
      else if (status === 'alert') config.quietStreak = 0;
      // Only a wild heartbeat may choose its own next wake-up; calm keeps the fixed interval.
      const wake = config.initiative === 'wild' && status !== 'error' ? wakeMinutes(wakeInMinutes) : null;
      if (status === 'error') {
        config.lastError = summary;
        config.nextRunAt = nowMs + retryDelay(config);
      } else {
        delete config.lastError;
        if (wake) config.nextRunAt = nowMs + wake * MINUTE;
        else if (config.nextRunAt <= nowMs) config.nextRunAt = nowMs + config.intervalMinutes * MINUTE;
      }
      config.pulse = pulse([...config.pulse, { at: nowMs, status, note: status === 'quiet' ? reason : summary || reason,
        ...(wake ? { wakeInMinutes: wake } : {}) }]);
      if (status === 'quiet') return null;
      const hash = fingerprint(status, summary, performedActions, config.workspace);
      const isRecent = at => Number.isFinite(at) && at <= nowMs && nowMs - at < DAY;
      const duplicate = (hash === config.lastFingerprint && isRecent(config.lastAlertAt))
        || config.history.some(item => item.source !== 'goal' && isRecent(item.at) && fingerprint(item.status, item.summary, item.actions || [], item.workspace || '') === hash);
      if (duplicate) return null;
      const item = { id: randomUUID(), at: nowMs, status, summary, actions: performedActions, workspace: config.workspace, unread: true,
        topic: clean(topic, 120), source: 'heartbeat', delivery: 'quiet', feedback: null };
      item.subjectKey = attention.keyFor(item);
      config.lastFingerprint = hash;
      config.lastAlertAt = nowMs;
      config.history.push(item);
      config.history = config.history.slice(-50);
      config.attention = attention.normalizeAttention(config.attention, config.history);
      recorded = item;
      return attention.prepareDelivery(config, item, nowMs, this._notificationsAvailable(config, nowMs)) ? item : null;
    });
    if (alert) this._notify(alert);
    if (recorded) {
      try { this.onRecord(structuredClone(recorded), { initiative: this.store.data.heartbeat.initiative }); }
      catch { /* Chat delivery cannot undo a persisted result. */ }
    }
    this.publish?.({ type: `heartbeat.${status}`, source: 'heartbeat',
      payload: { status, summary, topic, actions: performedActions, workspace: this.store.data.heartbeat.workspace, finishedAt: nowMs } });
  }

  _notificationsAvailable(config, nowMs) { return inActiveHours(config, nowMs) && this.canNotify() === true; }

  _notify(item) {
    try { Promise.resolve(this.onAlert(structuredClone(item))).catch(() => {}); }
    catch { /* Notification delivery does not invalidate persisted task results. */ }
  }

  feedback(payload) {
    this._mutate(config => attention.feedback(config, payload, this.now()));
    return structuredClone(this.store.data.heartbeat.attention);
  }

  flushAttention() {
    const nowMs = this.now();
    const alerts = this._mutate(config => attention.deliverPending(config, nowMs, this._notificationsAvailable(config, nowMs)), true);
    for (const item of alerts) this._notify(item);
    return alerts.map(item => structuredClone(item));
  }

  recordActivity(input) {
    if (!object(input) || !['alert', 'error'].includes(input.status) || typeof input.summary !== 'string' || !input.summary.trim()) throw new Error('Activity needs a status and a nonempty summary.');
    const nowMs = this.now();
    let shouldNotify = false;
    const item = this._mutate(config => {
      const record = { id: randomUUID(), at: nowMs, status: input.status, summary: clean(input.summary), topic: clean(input.topic, 120),
        source: input.source === 'goal' ? 'goal' : 'heartbeat', workspace: string(input.workspace, config.workspace),
        actions: actions(input.actions), unread: true, delivery: 'quiet', feedback: null };
      if (record.source === 'goal' && typeof input.goalId === 'string') record.goalId = input.goalId.slice(0, 100);
      record.subjectKey = attention.keyFor(record);
      config.history.push(record); config.history = config.history.slice(-50);
      config.attention = attention.normalizeAttention(config.attention, config.history);
      shouldNotify = attention.prepareDelivery(config, record, nowMs, this._notificationsAvailable(config, nowMs));
      return record;
    });
    if (shouldNotify) this._notify(item);
    return structuredClone(item);
  }

  markRead(id) {
    if (id !== undefined && typeof id !== 'string') throw new TypeError('An activity ID must be text.');
    this._mutate(config => {
      for (const item of config.history) if (id === undefined || item.id === id) item.unread = false;
      config.attention.pending = id === undefined ? [] : config.attention.pending.filter(entry => entry.itemId !== id);
    });
  }
}

module.exports = { defaultHeartbeat, normalizeHeartbeat, validateHeartbeat, Heartbeat, inActiveHours, MIN_WAKE, MAX_WAKE };
