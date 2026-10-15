'use strict';

const { randomUUID } = require('node:crypto');
const companion = require('./companion.cjs');
const { connectionBinding, isConnectionSelected } = require('./connections.cjs');

const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const AWAY_MS = 10 * MINUTE, INTENTION_NEAR_MS = 6 * HOUR, FOLLOWUP_NEAR_MS = 2 * HOUR, EVENT_NEAR_MS = DAY;
const clean = (value, max = 2000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ids = value => [...new Set((Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && item).map(item => item.slice(0, 128)))].slice(-200);
const number = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? value : fallback;
const listOfText = (value, max, itemMax) => (Array.isArray(value) ? value : []).filter(item => typeof item === 'string').slice(-max).map(item => item.slice(0, itemMax));
const runCount = goal => (goal?.history || []).filter(item => item.kind === 'run').length;
const marker = /\b(?:later|tomorrow|when you have time|when there's time|when there is time|pick this up|come back to this|follow up|todo|to-do|unfinished)\b/i;
// Only requests addressed to Little Bot: "I'll fix it tomorrow" is the owner's own plan, not an assignment.
const assigned = /\b(?:can you|could you|would you|will you|please|you can|you could)\b/i;
const resolved = /\b(?:done|finished|completed|created|updated|fixed|ready|here(?:'s| is)|already did)\b/i;

function normalizeResult(value) {
  if (!object(value) || !['goal', 'task'].includes(value.type)) return null;
  const result = { type: value.type, title: clean(value.title, 160), summary: clean(value.summary), at: number(value.at, Date.now()),
    actions: listOfText(value.actions, 12, 500), needsOwner: value.needsOwner === true };
  for (const key of ['goalId', 'sourceId']) if (typeof value[key] === 'string' && value[key]) result[key] = value[key].slice(0, 128);
  return result.title && result.summary ? result : null;
}

function normalizeSession(value) {
  if (!object(value) || !Number.isFinite(value.startedAt)) return null;
  const results = (Array.isArray(value.results) ? value.results : []).map(normalizeResult).filter(Boolean).slice(-80);
  return { id: clean(value.id, 128) || randomUUID(), startedAt: number(value.startedAt), workedMs: Math.min(DAY * 365, number(value.workedMs)),
    results, goalIds: ids(value.goalIds), intentionIds: ids(value.intentionIds), followupIds: ids(value.followupIds),
    attemptedChats: ids(value.attemptedChats), attemptedEvents: ids(value.attemptedEvents), chainGoalId: clean(value.chainGoalId, 128), currentGoalId: clean(value.currentGoalId, 128),
    failedGoalId: clean(value.failedGoalId, 128), failedTaskIds: ids(value.failedTaskIds), deliveredGoalIds: ids(value.deliveredGoalIds), taskSteps: Math.min(10000, Math.floor(number(value.taskSteps))),
    processedGoalRuns: object(value.processedGoalRuns) ? Object.fromEntries(Object.entries(value.processedGoalRuns).filter(([id, count]) => typeof id === 'string' && Number.isInteger(count) && count >= 0).slice(-50)) : {} };
}

function normalizeNightShift(value) {
  const input = object(value) ? value : {};
  const lastSession = object(input.lastSession) ? { id: clean(input.lastSession.id, 128), endedAt: number(input.lastSession.endedAt),
    workedMs: Math.min(DAY * 365, number(input.lastSession.workedMs)), steps: Math.min(10000, Math.floor(number(input.lastSession.steps))),
    goals: Math.min(50, Math.floor(number(input.lastSession.goals))), summaryPosted: input.lastSession.summaryPosted === true } : null;
  return { session: normalizeSession(input.session), lastSession,
    processedChats: ids(input.processedChats), processedEvents: ids(input.processedEvents) };
}

class NightShift {
  constructor({ store, controller, goals, canRun = () => true, idleSeconds = () => 0, post, notify = () => {}, onChange = () => {}, now = Date.now } = {}) {
    if (!store?.data || !controller || !goals || typeof canRun !== 'function' || typeof idleSeconds !== 'function' || typeof post !== 'function') throw new TypeError('Night shift needs the app work runners and presence callbacks.');
    Object.assign(this, { store, controller, goals, canRun, idleSeconds, post, notify, onChange, now });
    store.data.nightShift = normalizeNightShift(store.data.nightShift);
    if (store.data.settings.nightShiftEnabled !== true) store.data.settings.nightShiftEnabled = false;
    this.timer = null; this.pumping = false; this.active = false; this.away = false; this.locked = false;
    this.closing = false; this.generation = 0; this.segmentAt = 0; this.lastIdle = null; this.sawActivity = false; this.yielding = false; this.lastPumpAt = 0; this.lastStatusUpdate = 0;
    this.returning = null; this.inFlight = null;
  }

  get data() { return this.store.data.nightShift; }
  get session() { return this.data.session; }
  enabled() { return this.store.data.settings.nightShiftEnabled === true; }

  state() {
    const session = this.session, last = this.data.lastSession;
    const workedMs = session ? session.workedMs + (this.active && this.segmentAt ? Math.max(0, this.now() - this.segmentAt) : 0) : last?.workedMs || 0;
    const goals = session ? new Set([...session.goalIds, ...this.store.data.autonomy.goals.filter(goal => (goal.history || []).some(item => item.kind === 'run' && item.at >= session.startedAt)).map(goal => goal.id)]).size : last?.goals || 0;
    const steps = session ? session.taskSteps + this.store.data.autonomy.goals.reduce((sum, goal) => sum + (goal.history || []).filter(item => item.kind === 'run' && item.at >= session.startedAt).length, 0) : last?.steps || 0;
    const status = !this.enabled() ? 'Night shift: off' : this.active ? this.segmentAt ? `Night shift: working · ${this.formatDuration(workedMs)}` : `Night shift: away · ${this.formatDuration(workedMs)} worked`
      : session ? `Night shift: ready to report · ${this.formatDuration(workedMs)}, ${steps} steps on ${goals} goals`
        : last ? `Night shift: worked ${this.formatDuration(workedMs)}, ${steps} steps on ${goals} goals` : 'Night shift: waiting for you to be away';
    return { enabled: this.enabled(), active: this.active, away: this.away, workedMs, steps, goals, status };
  }

  formatDuration(ms) {
    const minutes = Math.max(0, Math.round(ms / MINUTE));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
  }

  start() {
    if (this.timer) return;
    this.closing = false;
    const idle = Math.max(0, Number(this.idleSeconds()) || 0);
    this.lastIdle = idle;
    this.sawActivity = idle < AWAY_MS / 1000;
    this.timer = setInterval(() => this.observe(), 1000);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  observe() {
    const idle = Math.max(0, Number(this.idleSeconds()) || 0), previous = this.lastIdle;
    this.lastIdle = idle;
    if (previous !== null && idle < previous) {
      this.sawActivity = true;
      if (this.away || this.session) this.background(this.ownerReturned('input'));
      return;
    }
    if (idle < AWAY_MS / 1000) { this.sawActivity = true; return; }
    if (this.sawActivity && !this.away && !this.locked) void this.ownerAway('idle');
    else if (this.away && !this.active && this.canStart()) this.begin('idle');
    else if (this.away && this.now() - this.lastPumpAt >= 15000) this.background(this.pump());
    if (this.active && this.segmentAt && this.now() - this.lastStatusUpdate >= MINUTE) {
      const now = this.now(); this.session.workedMs += now - this.segmentAt; this.segmentAt = now; this.lastStatusUpdate = now;
      this.save(); this.changed();
    }
  }

  ownerAway(source = 'presence') {
    if (this.closing || !this.enabled()) return false;
    this.away = true;
    return this.begin(source);
  }

  async ownerReturned(source = 'presence') {
    if (this.returning) return this.returning;
    const returning = (async () => {
    this.away = false; this.locked = false; this.sawActivity = true; this.generation++;
    const wasActive = this.active;
    this.active = false;
    if (this.session && this.segmentAt) {
      this.session.workedMs += Math.max(0, this.now() - this.segmentAt);
      this.segmentAt = 0;
      this.save();
    }
    if (wasActive) {
      this.yielding = true;
      try {
        if (this.goals.activeId) await this.goals.yieldForNightShift?.('Night shift yielded as you returned.');
        const chat = this.controller.heartbeatChat;
        if (chat) { await this.controller.stopHeartbeat('Night shift yielded as you returned.').catch(() => {}); await chat.settled; }
        if (this.inFlight) await Promise.allSettled([this.inFlight]);
      } finally { this.yielding = false; }
    }
    this.refreshSignals(this.now(), true);
    this.deliver(source);
    this.changed();
    return true;
    })();
    this.returning = returning;
    try { return await returning; }
    finally { if (this.returning === returning) this.returning = null; }
  }

  setLocked(locked) {
    if (locked) { this.locked = true; this.ownerAway('lock'); }
    else { this.locked = false; this.background(this.ownerReturned('unlock')); }
  }

  async setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Night shift must be on or off.');
    await this.ownerReturned('setting');
    this.store.data.settings.nightShiftEnabled = enabled;
    this.save();
    return this.state();
  }

  begin() {
    if (this.active || !this.away || this.closing || !this.canStart()) return false;
    const now = this.now();
    this.ensureSession(now);
    const session = this.session;
    session.attemptedChats = []; session.attemptedEvents = []; session.failedGoalId = ''; session.failedTaskIds = [];
    for (const goal of this.store.data.autonomy.goals) session.processedGoalRuns[goal.id] ??= runCount(goal);
    this.active = true; this.segmentAt = 0; this.generation++;
    this.lastPumpAt = now;
    this.refreshSignals(now);
    this.save(); this.changed();
    this.background(this.pump());
    return true;
  }

  canStart() {
    const settings = this.store.data.settings;
    return this.enabled() && !this.store.data.autonomy?.paused && settings.connection === 'local'
      && this.controller.runtime?.status === 'ready' && this.controller.account?.status === 'connected'
      && !this.controller.userSendPending && !this.controller.goalChat && !this.controller.chatGoal?.holding?.()
      && !this.controller.extensionsBusy && !this.controller.memoryBusy && !this.controller.heartbeatChat
      && !this.controller.store.data.chats.some(chat => chat.status !== 'idle') && !this.goals.activeId
      && this.canRun() === true;
  }

  canContinue(generation) { return generation === this.generation && this.active && this.away && this.canStart(); }
  sessionContinues(generation) {
    return generation === this.generation && this.active && this.away && this.enabled()
      && !this.store.data.autonomy?.paused && this.store.data.settings.connection === 'local' && !this.controller.userSendPending;
  }

  refreshSignals(now = this.now(), returning = false) {
    const session = this.session;
    if (!session) return;
    const horizon = now + INTENTION_NEAR_MS;
    const due = [...companion.forHeartbeat(this.store.data.companion, { now, event: '' }), ...companion.forHeartbeat(this.store.data.companion, { now: horizon, event: '' })];
    if (returning) due.push(...companion.forHeartbeat(this.store.data.companion, { now, event: 'user.returned' }));
    for (const item of due) if (!session.intentionIds.includes(item.id)) session.intentionIds.push(item.id);
    for (const item of this.store.data.heartbeat.followups || []) if (item.at <= now + FOLLOWUP_NEAR_MS && !session.followupIds.includes(item.id)) session.followupIds.push(item.id);
    session.intentionIds = ids(session.intentionIds); session.followupIds = ids(session.followupIds);
  }

  chatAssignments() {
    const messages = this.store.data.chats.find(chat => !chat.private)?.messages || [];
    const recent = messages.filter(message => message.role === 'user' && !message.kind && typeof message.text === 'string'
      && this.now() - number(message.createdAt, 0) <= 14 * DAY && marker.test(message.text) && assigned.test(message.text)
      && !this.data.processedChats.includes(message.id) && !this.session.attemptedChats.includes(message.id));
    return recent.map(message => {
      const index = messages.indexOf(message), nextUser = messages.findIndex((item, at) => at > index && item.role === 'user' && !item.kind);
      const reply = messages.slice(index + 1, nextUser < 0 ? messages.length : nextUser).filter(item => item.role === 'assistant' && !item.kind).map(item => item.text).join('\n');
      if (resolved.test(reply)) return null;
      const request = message.text.trim().replace(/\s+/g, ' ');
      return { type: 'task', source: 'chat', id: message.id, title: `Your request “${request.length > 60 ? `${request.slice(0, 60).replace(/\s+\S*$/, '')}…` : request}”`,
        text: `The owner explicitly assigned this in chat and said it could wait. Do one bounded, useful step on only this request.\n\nOriginal request: ${message.text.slice(0, 3000)}\n\nUse local workspace context only. Do not invent adjacent work, use the network, contact anyone, access credentials, or change unrelated files. If it is already complete or no useful step is clear, stay quiet. If the owner must decide something, return one concise question.` };
    }).filter(Boolean);
  }

  candidates(now = this.now()) {
    const settings = this.store.data.settings, session = this.session;
    const result = [];
    for (const goal of this.store.data.autonomy.goals) {
      const chained = session.chainGoalId === goal.id;
      if (goal.status !== 'queued' || !goal.authorized || goal.pendingQuestion || goal.needsEffectReview
        || session.failedGoalId === goal.id || goal.connection !== 'local' || !isConnectionSelected(goal, settings) || !this.goals.awake(goal, now)) continue;
      const due = goal.nextRunAt == null ? goal.needsRecoveryCheck === true || goal.continueAfterAnswer === true : goal.nextRunAt <= now;
      if (!chained && !due) continue;
      result.push({ type: 'goal', id: goal.id, title: goal.name, score: (chained ? 250 : 210) - (goal.priority || 3) * 10, at: goal.nextRunAt || 0 });
    }
    for (const task of this.chatAssignments()) if (!session.failedTaskIds.includes(task.id)) result.push({ ...task, score: 115, at: this.now() });
    for (const event of this.store.data.calendar.events || []) {
      if (event.startAt <= now || event.startAt > now + EVENT_NEAR_MS || this.data.processedEvents.includes(event.id) || session.attemptedEvents.includes(event.id) || session.failedTaskIds.includes(event.id)) continue;
      const hours = (event.startAt - now) / HOUR;
      result.push({ type: 'task', source: 'calendar', id: event.id, title: `Prepare for ${event.title}`,
        score: 135 - Math.min(24, hours), at: event.startAt,
        text: `Prepare the owner for this upcoming local calendar event. Read only relevant local workspace files and use the event details below. Make one useful, concise prep note in the workspace only if the local context supports it; name the file in your result. Do not use the network, contact anyone, access credentials, or modify unrelated files. If key information is missing, leave one concise question for the owner.\n\nEvent: ${event.title}\nWhen: ${new Date(event.startAt).toLocaleString()}\nLocation: ${event.location || 'not set'}\nNotes: ${event.notes || 'none'}` });
    }
    return result.sort((a, b) => b.score - a.score || a.at - b.at);
  }

  async pump() {
    if (this.pumping || !this.active) return;
    this.pumping = true;
    this.lastPumpAt = this.now();
    const generation = this.generation;
    try {
      while (this.canContinue(generation)) {
        this.refreshSignals();
        const item = this.candidates()[0];
        if (!item) break;
        this.segmentAt = this.now(); this.lastStatusUpdate = this.segmentAt;
        if (item.type === 'goal') {
          const goal = this.store.data.autonomy.goals.find(entry => entry.id === item.id);
          if (!goal || !this.canContinue(generation)) break;
          this.session.currentGoalId = goal.id; this.save();
          const before = runCount(goal);
          try { await this.runGoal(goal, generation); } catch (error) {
            if (generation !== this.generation) break;
            this.session.failedGoalId = goal.id; this.session.chainGoalId = ''; this.save();
            this.controller.onError?.('night-shift:goal', error, { goalId: goal.id });
            break;
          } finally {
            this.finishWork();
          }
          if (generation !== this.generation) break;
          this.session.currentGoalId = '';
          const count = Math.max(0, runCount(goal) - before);
          if (count) {
            this.session.goalIds = ids([...this.session.goalIds, goal.id]);
            this.session.processedGoalRuns[goal.id] = runCount(goal);
            this.session.chainGoalId = this.canChain(goal) ? goal.id : '';
            this.save(); this.changed();
          } else { this.session.chainGoalId = ''; break; }
        } else {
          this.session.chainGoalId = '';
          let ok;
          try { ok = await this.runTask(item, generation); }
          finally { this.finishWork(); }
          if (generation !== this.generation || !ok) break;
        }
      }
    } finally { this.pumping = false; }
  }

  finishWork() {
    if (!this.session || !this.segmentAt) return;
    this.session.workedMs += Math.max(0, this.now() - this.segmentAt);
    this.segmentAt = 0;
    this.save(); this.changed();
  }

  async runGoal(goal, generation) {
    if (!this.canContinue(generation) || !this.goals.awake(goal, this.now())) return false;
    // A step that needs no model call can finish between two polls; a new history entry marks it done.
    const last = goal.history.at(-1);
    if (!this.goals.runEarly(goal.id)) return false;
    while (generation === this.generation && this.active) {
      if (this.goals.activeId === goal.id && this.goals.execution) { await this.goals.execution; return true; }
      if (this.goals.activeId && this.goals.activeId !== goal.id && this.goals.execution) await this.goals.execution;
      else if (goal.status !== 'queued' || goal.history.at(-1) !== last) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
  }

  canChain(goal) {
    if (goal.status !== 'queued' || goal.pendingQuestion || goal.needsEffectReview || !this.goals.awake(goal, this.now())) return false;
    const result = goal.review?.lastResult;
    if (result) return result.outcome === 'progress' || result.outcome === 'update';
    const last = [...(goal.history || [])].reverse().find(item => item.kind === 'run');
    return Boolean(last && ((last.snapshot?.changes || 0) > 0 || last.actions?.length));
  }

  async runTask(item, generation) {
    if (!this.canContinue(generation)) return false;
    if (item.source === 'chat') this.session.attemptedChats = ids([...this.session.attemptedChats, item.id]);
    else this.session.attemptedEvents = ids([...this.session.attemptedEvents, item.id]);
    this.save();
    const settings = this.store.data.settings;
    const config = { ...connectionBinding(settings), workspace: settings.workspace, model: settings.localModel || settings.model,
      effort: settings.effort || 'low', initiative: 'calm', checklist: '', history: [], pulse: [], followups: [], wakeEvent: '' };
    let request;
    try {
      request = this.controller.runHeartbeat(config, { nightShiftTask: item.text, shouldContinue: () => this.sessionContinues(generation) });
      this.inFlight = request;
      const result = await request;
      if (generation !== this.generation) return false;
      if (item.source === 'chat') this.data.processedChats = ids([...this.data.processedChats, item.id]);
      else this.data.processedEvents = ids([...this.data.processedEvents, item.id]);
      const actions = Array.isArray(result.actions) ? result.actions.map(action => clean(action, 500)).filter(Boolean) : [];
      if (result.status === 'alert' && result.summary) {
        this.session.results.push({ type: 'task', sourceId: item.id, title: item.title,
          summary: result.summary, actions, needsOwner: /\?|need you|please choose|requires? (?:your )?decision/i.test(result.summary), at: this.now() });
        this.session.results = this.session.results.slice(-80); this.session.taskSteps++;
      }
      this.save(); this.changed();
      return true;
    } catch (error) {
      if (generation !== this.generation) {
        const actions = Array.isArray(error.actions) ? error.actions.map(action => clean(action, 500)).filter(Boolean) : [];
        if (actions.length && this.session) {
          this.session.results.push({ type: 'task', sourceId: item.id, title: item.title, summary: 'Interrupted when you returned; these local changes were recorded.', actions, needsOwner: false, at: this.now() });
          this.session.results = this.session.results.slice(-80); this.session.taskSteps++; this.save();
        }
        return false;
      }
      if (item.source === 'chat') this.session.attemptedChats = this.session.attemptedChats.filter(id => id !== item.id);
      else this.session.attemptedEvents = this.session.attemptedEvents.filter(id => id !== item.id);
        this.session.failedTaskIds = ids([...this.session.failedTaskIds, item.id]);
      this.controller.onError?.('night-shift:task', error, { source: item.source, sourceId: item.id });
      this.save(); this.changed();
      return false;
    } finally { if (this.inFlight === request) this.inFlight = null; }
  }

  refreshGoalResult(goalId, summary, needsOwner = false) {
    const goal = this.store.data.autonomy.goals.find(item => item.id === goalId);
    if (!goal || !this.session) return;
    this.session.goalIds = ids([...this.session.goalIds, goalId]);
    // The delivered message speaks to the owner; the work log stays on the goal card.
    const result = summary || goal.review?.lastResult?.summary || goal.nextStep;
    const previous = this.session.results.find(item => item.type === 'goal' && item.goalId === goalId);
    const value = { type: 'goal', goalId, title: goal.name, summary: clean(result), needsOwner: needsOwner || goal.status === 'blocked', at: this.now(), actions: [] };
    if (previous) Object.assign(previous, value); else this.session.results.push(value);
    this.session.results = this.session.results.slice(-80);
    this.save();
  }

  ensureSession(now = this.now()) {
    this.data.session ||= { id: randomUUID(), startedAt: now, workedMs: 0, results: [], goalIds: [], intentionIds: [], followupIds: [], attemptedChats: [], attemptedEvents: [], chainGoalId: '', currentGoalId: '', failedGoalId: '', failedTaskIds: [], deliveredGoalIds: [], taskSteps: 0, processedGoalRuns: {} };
    return this.data.session;
  }

  // From the moment the owner is away, goal posts wait for the return summary, even a step that began before night shift did.
  holding() { return this.active || this.yielding || (this.away && this.enabled() && this.store.data.settings.connection === 'local'); }

  deferGoalDelivery(goal, _data, details = {}) {
    if (!this.holding()) return undefined;
    const session = this.ensureSession();
    // An empty message means nothing is for the owner; it still settles this goal's line.
    session.deliveredGoalIds = ids([...session.deliveredGoalIds, goal.id]);
    const text = details.summary || details.question?.question;
    if (text) this.refreshGoalResult(goal.id, text, Boolean(details.question));
    return null;
  }

  // Goal alerts carry the work log and would notify while the owner is away. They are held, and only reach the
  // summary for a blocked goal or a goal that sent no message of its own.
  captureGoalAlert(item) {
    if (!this.holding() || !item?.goalId) return false;
    const session = this.ensureSession();
    const goal = this.store.data.autonomy.goals.find(entry => entry.id === item.goalId);
    if (goal?.status === 'blocked' || !session.deliveredGoalIds.includes(item.goalId)) this.refreshGoalResult(item.goalId, item.message, false);
    return true;
  }

  // Timer-driven work has no caller to report to; an error goes to the app log instead of an unhandled rejection.
  background(promise) { promise.catch(error => this.controller.onError?.('night-shift', error)); }

  save() { this.store.save(); }
  changed() { this.onChange(); }

  summary() {
    const session = this.session;
    if (!session) return '';
    const lines = ['While you were away'];
    const resultLines = [];
    const label = item => item.type === 'goal' ? `Goal · ${this.store.data.autonomy.goals.find(entry => entry.id === item.goalId)?.name || item.title}` : item.title;
    // A result that needs the owner is listed once, under "Needs you".
    for (const item of session.results.filter(entry => !entry.needsOwner)) {
      const goal = item.goalId && this.store.data.autonomy.goals.find(entry => entry.id === item.goalId);
      const title = label(item);
      // A run's snapshot keeps only a count of changed paths; the paths themselves are in its actions.
      const paths = (goal?.history || []).filter(entry => entry.kind === 'run' && entry.at >= session.startedAt)
        .flatMap(entry => entry.actions || []).filter(Boolean);
      // Only written paths; reads and shell commands stay in the goal card's log.
      const files = [...new Set([...paths, ...item.actions].flatMap(text => /^(?:Files \(completed\)|workspace_write):\s*(.+)$/i.exec(text)?.[1].split(', ') || []))].slice(-4);
      resultLines.push(`- ${title}: ${item.summary}${files.length ? `\n  Files: ${files.join(', ')}` : ''}`);
    }
    if (resultLines.length) lines.push('', 'Done', ...resultLines);
    const now = this.now();
    const intentions = session.intentionIds.map(id => this.store.data.companion.intentions.find(item => item.id === id))
      .filter(item => item?.status === 'active' && item.expiresAt > now && item.fires < 3);
    const followups = session.followupIds.map(id => (this.store.data.heartbeat.followups || []).find(item => item.id === id)).filter(Boolean);
    const questions = session.results.filter(item => item.needsOwner).map(item => `${label(item)}: ${item.summary}`);
    if (intentions.length || followups.length || questions.length) {
      lines.push('', 'Needs you');
      for (const item of intentions) lines.push(`- ${item.text}`);
      for (const item of followups) lines.push(`- Follow-up: ${item.note}`);
      for (const question of questions) lines.push(`- ${question}`);
    }
    // Goal next steps are the goal's own plan; they stay on its card, out of the message.
    return resultLines.length || intentions.length || followups.length
      ? lines.join('\n').slice(0, 12000) : '';
  }

  deliver(source = 'return') {
    const session = this.session;
    if (!session) return null;
    this.refreshSignals(this.now(), true);
    const message = this.summary();
    let posted = null;
    if (message) {
      posted = this.post({ kind: 'heartbeat', heartbeatId: `night-shift:${session.id}`, heartbeatTopic: 'While you were away', text: message });
      const alreadyPosted = this.store.data.chats.some(chat => [...(chat.messages || []), ...(chat.pendingProactive || [])].some(item => item.heartbeatId === `night-shift:${session.id}`));
      if (posted || alreadyPosted) {
        const intended = session.intentionIds.filter(id => this.store.data.companion.intentions.some(item => item.id === id && item.status === 'active'));
        if (intended.length) companion.markOffered(this.store.data.companion, intended, this.now());
        this.store.data.heartbeat.followups = this.store.data.heartbeat.followups.filter(item => !session.followupIds.includes(item.id));
      }
    }
    const workedMs = session.workedMs, steps = session.taskSteps + this.store.data.autonomy.goals.reduce((sum, goal) => sum + (goal.history || []).filter(item => item.kind === 'run' && item.at >= session.startedAt).length, 0);
    const goals = new Set([...session.goalIds, ...this.store.data.autonomy.goals.filter(goal => (goal.history || []).some(item => item.kind === 'run' && item.at >= session.startedAt)).map(goal => goal.id)]).size;
    this.data.lastSession = { id: session.id, endedAt: this.now(), workedMs, steps, goals, summaryPosted: Boolean(posted), source: clean(source, 40) };
    this.data.session = null;
    this.save(); this.changed();
    if (posted) this.notify(message);
    return posted;
  }

  async close() {
    const wasActive = this.active;
    this.closing = true; this.away = false; this.active = false; this.generation++;
    this.stop();
    if (this.session && this.segmentAt) { this.session.workedMs += Math.max(0, this.now() - this.segmentAt); this.segmentAt = 0; this.save(); }
    if (wasActive && this.goals.activeId) await this.goals.yieldForNightShift?.('Night shift stopped because Little Bot is closing.');
    const chat = wasActive ? this.controller.heartbeatChat : null;
    if (chat) { await this.controller.stopHeartbeat('Night shift stopped because Little Bot is closing.').catch(() => {}); await chat.settled; }
  }
}

module.exports = { NightShift, normalizeNightShift, AWAY_MS };
