'use strict';

const { EventBus } = require('./event-bus.cjs');
const { StandingIntentStore } = require('./standing-intents.cjs');
const { advanceMissedSchedules, missedCount } = require('./missed-schedules.cjs');
const { ongoing } = require('./goal-contract.cjs');

const MINUTE = 60000;
const CALENDAR_HORIZONS = Object.freeze([1440, 60, 15]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cleanError = value => String(value?.message || value || 'Event action failed.').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 2000);

class EventRuntime {
  constructor({ store, scheduler, heartbeat, goals, controller = null, eventBus = null, now = Date.now,
    setIntervalFn = setInterval, clearIntervalFn = clearInterval, onChange = () => {}, onError = () => {} } = {}) {
    if (!store || !object(store.data) || typeof store.save !== 'function') throw new TypeError('EventRuntime needs a store.');
    if (!scheduler || !heartbeat || !goals) throw new TypeError('EventRuntime needs scheduler, heartbeat, and goal runners.');
    for (const callback of [now, setIntervalFn, clearIntervalFn, onChange, onError]) if (typeof callback !== 'function') throw new TypeError('EventRuntime callbacks must be functions.');
    this.store = store;
    this.scheduler = scheduler;
    this.heartbeat = heartbeat;
    this.goals = goals;
    this.controller = controller;
    this.now = now;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.onChange = onChange;
    this.onError = onError;
    this.bus = eventBus || new EventBus({ now, dedupeWindowMs: 10000, onError, onChange: () => this._changed(false) });
    this.intents = new StandingIntentStore({ store, now, onChange: () => this._changed(true) });
    this.timer = null;
    this.unsubscribers = [];
    this.calendarSeen = new Set();
    this.pendingGoals = new Map();
    this.pendingAutomations = new Map();
  }

  get state() {
    return {
      status: this.bus.state.started ? 'running' : 'stopped',
      bus: this.bus.state,
      standingIntentCount: this.intents.data.intents.length,
      enabledStandingIntentCount: this.intents.data.intents.filter(item => item.enabled).length,
    };
  }

  start() {
    if (this.bus.state.started) return false;
    const skipped = advanceMissedSchedules(this.store.data, this.now());
    if (missedCount(skipped)) {
      this.store.save();
      this._changed(true);
    }
    this.unsubscribers = [
      this.bus.subscribe({ id: 'runtime:automation-due', type: 'automation.due', priority: 10,
        handler: event => this._runAutomationDue(event) }),
      this.bus.subscribe({ id: 'runtime:heartbeat-due', type: 'heartbeat.due', priority: 10,
        handler: event => this._runHeartbeatDue(event) }),
      this.bus.subscribe({ id: 'runtime:presence', type: '*', priority: 9,
        filter: event => ['app.opened', 'user.returned', 'chat.completed', 'activity.app_started', 'activity.long_session'].includes(event.type), handler: event => this._wakeForPresence(event) }),
      this.bus.subscribe({ id: 'runtime:intent-action', type: 'standing_intent.action', priority: 10,
        handler: event => this._runIntentAction(event) }),
      this.bus.subscribe({ id: 'runtime:settle-goal', type: '*', priority: 8,
        filter: event => ['goal.completed', 'goal.reviewed', 'goal.blocked', 'goal.paused', 'goal.removed'].includes(event.type), handler: event => this._settleGoal(event) }),
      this.bus.subscribe({ id: 'runtime:settle-automation', type: '*', priority: 8,
        filter: event => ['automation.completed', 'automation.error'].includes(event.type), handler: event => this._settleAutomation(event) }),
      this.bus.subscribe({ id: 'runtime:standing-intents', type: '*', priority: -10,
        filter: event => !event.type.startsWith('standing_intent.'), handler: (event, context) => this._matchIntents(event, context) }),
    ];
    this._baselineCalendar();
    this.bus.start();
    this.timer = this.setIntervalFn(() => { try { this.tickCalendar(); } catch (error) { this._error(error); } }, 15000);
    this.timer?.unref?.();
    this.publish({ type: 'app.opened', source: 'app', payload: { openedAt: this.now() }, priority: 5 });
    this._changed(false);
    return true;
  }

  stop() {
    if (this.timer) this.clearIntervalFn(this.timer);
    this.timer = null;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this._cancelQueuedGoalActions();
    this.pendingGoals.clear();
    this.pendingAutomations.clear();
    const stopped = this.bus.stop({ clear: true });
    this._changed(false);
    return stopped;
  }

  publish(input, options) {
    const intentTrace = this._intentTraceFor(input);
    return this.bus.publish(intentTrace.length ? { ...input, intentTrace } : input, options);
  }

  saveIntent(input) { return this.intents.save(input); }
  removeIntent(id) { return this.intents.remove(id); }
  setIntentEnabled(id, enabled) { return this.intents.setEnabled(id, enabled); }

  calendarChanged(action, event) {
    if (!['created', 'updated', 'deleted'].includes(action) || !event?.id) throw new Error('Choose a calendar change and event.');
    this._forgetCalendar(event.id);
    if (action !== 'deleted') this._baselineCalendarEvent(event, this.now());
    return this.publish({
      type: `calendar.${action}`,
      source: 'calendar',
      payload: this._calendarPayload(event),
      dedupeKey: `calendar:${action}:${event.id}:${event.updatedAt || event.startAt || this.now()}`,
    });
  }

  tickCalendar() {
    if (!this.bus.state.started) return 0;
    const nowMs = this.now();
    let published = 0;
    const existing = new Set((this.store.data.calendar?.events || []).map(event => String(event.id)));
    for (const key of [...this.calendarSeen]) if (!existing.has(key.split(':')[0])) this.calendarSeen.delete(key);
    for (const event of this.store.data.calendar?.events || []) {
      if (!Number.isFinite(event.startAt) || event.startAt <= nowMs) continue;
      for (const horizonMinutes of CALENDAR_HORIZONS) {
        const key = this._calendarKey(event, horizonMinutes);
        if (this.calendarSeen.has(key) || nowMs < event.startAt - horizonMinutes * MINUTE) continue;
        this.calendarSeen.add(key);
        const result = this.publish({
          type: 'calendar.event_approaching',
          source: 'calendar',
          priority: horizonMinutes <= 15 ? 5 : horizonMinutes <= 60 ? 3 : 1,
          dedupeKey: key,
          payload: {
            ...this._calendarPayload(event),
            horizonMinutes,
            minutesUntil: Math.max(0, Math.ceil((event.startAt - nowMs) / MINUTE)),
          },
        });
        if (result.accepted) published++;
      }
    }
    return published;
  }

  _baselineCalendar() {
    const nowMs = this.now();
    this.calendarSeen.clear();
    for (const event of this.store.data.calendar?.events || []) this._baselineCalendarEvent(event, nowMs);
  }

  _baselineCalendarEvent(event, nowMs) {
    if (!Number.isFinite(event.startAt)) return;
    for (const horizonMinutes of CALENDAR_HORIZONS) {
      if (nowMs >= event.startAt - horizonMinutes * MINUTE) this.calendarSeen.add(this._calendarKey(event, horizonMinutes));
    }
  }

  _forgetCalendar(id) {
    const prefix = `${id}:`;
    for (const key of [...this.calendarSeen]) if (key.startsWith(prefix)) this.calendarSeen.delete(key);
  }

  _calendarKey(event, horizonMinutes) { return `${event.id}:${event.startAt}:${horizonMinutes}`; }

  _calendarPayload(event) {
    return {
      eventId: String(event.id).slice(0, 100),
      title: String(event.title || '').slice(0, 120),
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay === true,
      location: String(event.location || '').slice(0, 300),
    };
  }

  async _runAutomationDue(event) {
    const id = event.payload?.automationId;
    if (typeof id !== 'string') return;
    try { await this.scheduler.runNow(id); }
    catch (error) { this._error(error, event); }
  }

  // A wild heartbeat should speak when the user is around, not only on its timer.
  _wakeForPresence(event) {
    const wake = {
      'app.opened': ['Little Bot was just opened, so the user is at the computer now.', 2 * MINUTE, false],
      'user.returned': ['The user just came back to the computer after being away for a while.', MINUTE, false],
      'chat.completed': ['The user finished a conversation with you about ten minutes ago; consider a thoughtful follow-up on it.', 10 * MINUTE, true],
      'activity.app_started': [`The user just started using ${String(event.payload?.app || 'an app').slice(0, 60)} (open for a couple of minutes). Consider whether a short, well-timed note would help; usually stay out of the way.`, MINUTE, false],
      'activity.long_session': [`The user has been in ${String(event.payload?.app || 'the same app').slice(0, 60)} for about ${event.payload?.hours || 3} hours.`, MINUTE, false],
    }[event.type];
    if (event.type === 'chat.completed' && typeof this.goals.userReplied === 'function') {
      try { this.goals.userReplied(this.store.data.chats?.[0]); } catch (error) { this._error(error, event); }
    }
    if (!wake || typeof this.heartbeat.wakeSoon !== 'function') return;
    try { this.heartbeat.wakeSoon(wake[0], wake[1], { debounce: wake[2] }); }
    catch (error) { this._error(error, event); }
  }

  async _runHeartbeatDue(event) {
    try { await this.heartbeat.runNow(); }
    catch (error) { this._error(error, event); }
  }

  async _matchIntents(event, context) {
    const priorTrace = Array.isArray(event.intentTrace) ? event.intentTrace : [];
    for (const intent of this.intents.matches(event).filter(item => !priorTrace.includes(item.id)).slice(0, 10)) {
      this.intents.record(intent.id, { status: 'matched', event });
      const queued = context.publish({
        type: 'standing_intent.action',
        source: 'standing_intents',
        priority: intent.priority,
        intentTrace: [...priorTrace, intent.id],
        debounceKey: `standing-intent:${intent.id}`,
        debounceMs: intent.debounceMs,
        expiresAt: this.now() + Math.max(60 * MINUTE, intent.debounceMs + 60 * MINUTE),
        payload: {
          intentId: intent.id,
          action: intent.action,
          sourceEvent: { id: event.id, type: event.type, source: event.source, occurredAt: event.occurredAt, payload: event.payload },
          retryCount: 0,
        },
      });
      if (!queued.accepted) this.intents.record(intent.id, { status: 'skipped', event, error: `The action was not queued: ${queued.reason}.` });
    }
  }

  async _runIntentAction(event) {
    const id = event.payload?.intentId;
    let intent;
    try { intent = this.intents.get(id); }
    catch { return; }
    if (!intent.enabled) { this.intents.record(id, { status: 'skipped', event, error: 'The standing intent is disabled.' }); return; }
    // Resolve the current saved action at execution time. A debounced event may
    // outlive an edit; stale queued payload must not launch the old target.
    const action = intent.action;
    try {
      if (action.type === 'goal.run') {
        const goal = this.goals.goal(action.goalId);
        if (!goal.authorized) throw new Error('Run this goal once from Goals before a standing intent can start it.');
        const awaitingReview = goal.status === 'queued' && ongoing(goal) && goal.review?.lastResult
          && !this.goals.forceRuns?.has(goal.id) && !goal.needsRecoveryCheck && !goal.continueAfterAnswer
          && this.goals.activeId !== goal.id && !this.pendingGoals.has(goal.id);
        if (goal.status === 'running' || (goal.status === 'queued' && !awaitingReview)) {
          this.intents.record(id, { status: 'skipped', event, error: 'The target goal is already queued or running.' });
          return;
        }
        this._pending(this.pendingGoals, goal.id).set(id, {
          trace: event.intentTrace || [id],
          previous: {
            status: goal.status, nextRunAt: goal.nextRunAt ?? null,
            pauseReason: goal.pauseReason || null, needsEffectReview: goal.needsEffectReview === true,
          },
        });
        this.intents.record(id, { status: 'queued', event });
        this.goals.runNow(goal.id);
        return;
      }
      if (action.type === 'automation.run') {
        const automation = this.store.data.automations.find(item => item.id === action.automationId);
        if (!automation) throw new Error('The target automation no longer exists.');
        if (automation.authorized !== true) throw new Error('Run or enable this automation once before a standing intent can start it.');
        this._pending(this.pendingAutomations, automation.id).set(id, event.intentTrace || [id]);
        this.intents.record(id, { status: 'queued', event });
        await this.scheduler.runNow(automation.id);
        return;
      }
      throw new Error('Unsupported standing-intent action.');
    } catch (error) {
      const retryCount = Number.isInteger(event.payload?.retryCount) ? event.payload.retryCount : 0;
      const busy = /wait for|already running|waiting for|current task|finish or stop/i.test(cleanError(error));
      if (busy && retryCount < 20 && this.bus.state.started) {
        this.publish({
          type: 'standing_intent.action', source: 'standing_intents', priority: intent.priority,
          debounceKey: `standing-intent:${intent.id}`, debounceMs: 15000,
          correlationId: event.correlationId,
          intentTrace: event.intentTrace,
          expiresAt: this.now() + 60 * MINUTE,
          payload: { ...event.payload, retryCount: retryCount + 1 },
        });
        return;
      }
      this._removePending(this.pendingGoals, action.goalId, id);
      this._removePending(this.pendingAutomations, action.automationId, id);
      this.intents.record(id, { status: 'error', event, error: cleanError(error) });
      this._error(error, event);
    }
  }

  _cancelQueuedGoalActions() {
    let restored = false;
    for (const [goalId, pending] of this.pendingGoals) {
      let goal;
      try { goal = this.goals.goal(goalId); } catch { continue; }
      if (this.goals.activeId === goalId || goal.status !== 'queued') continue;
      const launch = [...pending.values()].find(value => object(value) && object(value.previous));
      if (!launch) continue;
      const previous = launch.previous;
      goal.status = previous.status;
      goal.nextRunAt = previous.nextRunAt;
      if (previous.pauseReason) goal.pauseReason = previous.pauseReason; else delete goal.pauseReason;
      if (previous.needsEffectReview) goal.needsEffectReview = true; else delete goal.needsEffectReview;
      this.goals.forceRuns?.delete(goalId);
      this.goals.record?.(goal, 'skipped', 'Standing-intent launch was skipped because foreground event processing stopped before the goal started.');
      for (const intentId of pending.keys()) {
        try { this.intents.record(intentId, { status: 'skipped', error: 'Foreground event processing stopped before the target goal started. The launch was not replayed.' }); }
        catch (error) { this._error(error); }
      }
      restored = true;
    }
    if (restored) {
      try { this.store.save(); } catch (error) { this._error(error); }
      this._changed(true);
    }
  }

  _settleGoal(event) {
    const goalId = event.payload?.goalId;
    if (typeof goalId !== 'string') return;
    const pending = this.pendingGoals.get(goalId);
    if (!pending) return;
    const skipped = ['goal.paused', 'goal.removed'].includes(event.type);
    for (const [intentId] of pending) this.intents.record(intentId, {
      status: ['goal.completed', 'goal.reviewed'].includes(event.type) ? 'completed' : skipped ? 'skipped' : 'error', event,
      error: event.type === 'goal.blocked'
        ? String(event.payload?.reason || 'The target goal was blocked.')
        : event.type === 'goal.paused'
          ? String(event.payload?.reason || 'The target goal was paused.')
          : event.type === 'goal.removed' ? 'The target goal was removed.' : '',
    });
    this.pendingGoals.delete(goalId);
  }

  _settleAutomation(event) {
    const automationId = event.payload?.automationId;
    if (typeof automationId !== 'string') return;
    const pending = this.pendingAutomations.get(automationId);
    if (!pending) return;
    for (const [intentId] of pending) this.intents.record(intentId, {
      status: event.type === 'automation.completed' ? 'completed' : 'error', event,
      error: event.type === 'automation.error' ? String(event.payload?.error || 'The target automation failed.') : '',
    });
    this.pendingAutomations.delete(automationId);
  }

  _intentTraceFor(input) {
    const trace = [];
    const add = values => {
      for (const value of values || []) {
        const id = typeof value === 'string' ? value.slice(0, 100) : '';
        if (id && !trace.includes(id)) trace.push(id);
      }
    };
    const addPending = (map, key) => {
      if (!key) return;
      for (const value of map.get(key)?.values() || []) add(Array.isArray(value) ? value : value?.trace);
    };
    add(input?.intentTrace);
    addPending(this.pendingGoals, input?.payload?.goalId);
    addPending(this.pendingAutomations, input?.payload?.automationId);
    addPending(this.pendingGoals, this.goals.activeId);
    addPending(this.pendingAutomations, this.scheduler.runningId);
    return trace.slice(-12);
  }

  _pending(map, key) {
    let pending = map.get(key);
    if (!pending) { pending = new Map(); map.set(key, pending); }
    return pending;
  }

  _removePending(map, key, intentId) {
    if (!key) return;
    const pending = map.get(key);
    if (!pending) return;
    pending.delete(intentId);
    if (!pending.size) map.delete(key);
  }

  _changed(persisted) {
    try { this.onChange({ persisted, state: this.state }); } catch { /* Runtime observers cannot affect events. */ }
  }

  _error(error, event = null) {
    try { this.onError(error, event); } catch { /* Error observers cannot affect events. */ }
  }
}

module.exports = { EventRuntime, CALENDAR_HORIZONS };
