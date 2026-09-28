'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const files = require('./goal-files.cjs');
const { connectionBinding, isConnectionSelected, requireSelectedConnection } = require('./connections.cjs');
const { questionInput, questionText, pendingQuestion, clarifications } = require('./user-questions.cjs');
const {
  normalizeGoalLedger, reconcileGoalLedger, applyGoalLedgerUpdate,
  recordVerificationEvidence, recordSnapshotEvidence, recordGoalBlock,
  recordGoalPause, recordUserAnswer, completeGoalLedger, recoverGoalLedger,
} = require('./goal-ledger.cjs');

const STATUSES = ['draft', 'queued', 'running', 'paused', 'blocked', 'completed'];
const DEFAULT_LIMITS = { maxTokens: 50000, maxMinutes: 30, maxActions: 50, maxRuns: 10, maxRetries: 2 };
const LIMIT_RANGES = { maxTokens: [1000, 2000000], maxMinutes: [1, 240], maxActions: [1, 500], maxRuns: [1, 100], maxRetries: [0, 5] };
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const number = value => Number.isFinite(value) && value >= 0 ? value : 0;
const clean = value => String(value?.message || value || '').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').replace(/(api_key|access_token|refresh_token)([\s"':=]+)[^\s,}]+/gi, '$1$2[redacted]').slice(0, 2000);
function text(value, label, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (required && !value.trim())) throw new Error(`${label} must contain ${required ? '1–' : 'at most '}${max} characters.`);
  return value.trim();
}
function list(value, label, max, convert) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} accepts at most ${max} entries.`);
  return value.map(convert);
}
function integer(value, fallback, min, max, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return value;
}
function usageOf(value = {}) { return Object.fromEntries(['tokens', 'elapsedMs', 'actions', 'runs', 'retries'].map(key => [key, Math.floor(number(value[key]))])); }
function historyOf(value) {
  return (Array.isArray(value) ? value : []).filter(isObject).slice(-50).map(entry => {
    const record = { id: String(entry.id || randomUUID()).slice(0, 100), at: number(entry.at), kind: String(entry.kind || 'activity').slice(0, 40), summary: clean(entry.summary) };
    for (const key of ['runId', 'status']) if (typeof entry[key] === 'string') record[key] = entry[key].slice(0, 100);
    if (isObject(entry.usage)) record.usage = usageOf(entry.usage);
    if (Array.isArray(entry.actions)) record.actions = entry.actions.slice(0, 30).map(clean);
    if (Array.isArray(entry.verification)) record.verification = entry.verification.slice(0, 20).map(check => ({ type: String(check.type || '').slice(0, 30), path: String(check.path || '').slice(0, 500), passed: check.passed === true, detail: clean(check.detail) }));
    if (isObject(entry.snapshot) && typeof entry.snapshot.runId === 'string') record.snapshot = { runId: entry.snapshot.runId.slice(0, 100), fileCount: number(entry.snapshot.fileCount), bytes: number(entry.snapshot.bytes), changes: number(entry.snapshot.changes), undoAvailable: entry.snapshot.undoAvailable === true };
    return record;
  });
}

function validateGoal(input, existing = null, settings = {}) {
  if (!isObject(input)) throw new Error('Goal details are required.');
  if (existing && input.id != null && input.id !== existing.id) throw new Error('Goal ID cannot change.');
  const now = Date.now(), p = input.permissions || {}, t = input.trigger || {};
  const workspace = text(input.workspace ?? existing?.workspace ?? settings.workspace, 'Working folder', 4000, true);
  if (!path.isAbsolute(workspace)) throw new Error('Choose an absolute working folder.');
  const permissions = {
    write: p.write === true, shell: p.shell === true, network: p.network === true,
    writePaths: [...new Set(list(p.writePaths, 'Writable folders', 20, files.relativePath))],
    mcpTools: list(p.mcpTools, 'MCP tool grants', 30, grant => ({ server: text(grant?.server, 'MCP server', 100, true), tool: text(grant?.tool, 'MCP tool', 200, true) })),
  };
  if (permissions.write && !permissions.writePaths.length) throw new Error('Choose at least one writable folder, or disable file writes.');
  const checks = list(input.checks, 'Verification checks', 20, check => {
    if (!['fileExists', 'fileContains', 'command'].includes(check?.type)) throw new Error('Choose a supported verification check.');
    if (check.type === 'command') {
      if (!permissions.shell) throw new Error('Enable terminal permission to use a command verification check.');
      return { type: check.type, command: text(check.command, 'Verification command', 4000, true) };
    }
    return { type: check.type, path: files.relativePath(check.path), ...(check.type === 'fileContains' ? { contains: text(check.contains, 'Required file text', 4000, true) } : {}) };
  });
  const limits = {};
  for (const [key, [min, max]] of Object.entries(LIMIT_RANGES)) limits[key] = integer(input.limits?.[key], DEFAULT_LIMITS[key], min, max, key);
  const trigger = { type: ['manual', 'interval', 'files'].includes(t.type) ? t.type : 'manual', intervalMinutes: integer(t.intervalMinutes, 30, 1, 10080, 'Interval'), paths: [...new Set(list(t.paths, 'Watched paths', 20, files.relativePath))] };
  if (trigger.type === 'files' && !trigger.paths.length) throw new Error('Choose at least one relative path for a file trigger.');
  const id = existing?.id || input.id || randomUUID();
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid goal ID.');
  const result = {
    id, name: text(input.name, 'Goal name', 80, true), objective: text(input.objective, 'Objective', 12000, true),
    steps: list(input.steps, 'Steps', 20, item => text(item, 'Step', 1000, true)),
    checkpoint: existing?.checkpoint || '', nextStep: existing?.nextStep || '',
    status: existing?.status === 'completed' ? 'draft' : existing?.status || 'draft', priority: integer(input.priority, 3, 1, 5, 'Priority'),
    workspace, model: text(input.model ?? existing?.model ?? settings.model, 'Model', 200), effort: ['low', 'medium', 'high'].includes(input.effort) ? input.effort : existing?.effort || settings.effort || 'low',
    ...connectionBinding(existing || { ...settings, ...input }, settings.connection || 'codex'),
    checks, permissions, limits, usage: usageOf(existing?.usage), trigger,
    dependsOn: [...new Set(list(input.dependsOn, 'Dependencies', 20, value => text(value, 'Dependency', 100, true)))],
    authorized: existing?.authorized === true, history: historyOf(existing?.history),
    createdAt: existing?.createdAt || now, updatedAt: now, nextRunAt: existing?.nextRunAt ?? null,
  };
  result.ledger = reconcileGoalLedger(input.ledger ?? existing?.ledger, existing, result, now);
  if (result.dependsOn.includes(id)) throw new Error('A goal cannot depend on itself.');
  if (existing?.triggerFingerprint) result.triggerFingerprint = existing.triggerFingerprint;
  if (existing && result.objective === existing.objective && result.workspace === existing.workspace) {
    const question = pendingQuestion(existing.pendingQuestion);
    if (question) result.pendingQuestion = question;
    result.clarifications = clarifications(existing.clarifications);
    if (existing.continueAfterAnswer === true) result.continueAfterAnswer = true;
    if (existing.needsEffectReview === true) result.needsEffectReview = true;
  }
  return result;
}

function normalizeAutonomy(value, settings = {}, recovering = false) {
  const result = { paused: value?.paused === true, goals: [] };
  for (const input of (Array.isArray(value?.goals) ? value.goals : []).slice(0, 50)) {
    try {
      const goal = validateGoal({ ...input, ...connectionBinding(input) }, null, settings);
      if (result.goals.some(item => item.id === goal.id)) continue;
      goal.status = STATUSES.includes(input.status) ? input.status : 'draft';
      goal.authorized = input.authorized === true;
      goal.usage = usageOf(input.usage); goal.history = historyOf(input.history);
      goal.checkpoint = text(input.checkpoint, 'Checkpoint', 4000); goal.nextStep = text(input.nextStep, 'Next step', 2000);
      goal.createdAt = number(input.createdAt) || Date.now(); goal.updatedAt = number(input.updatedAt) || goal.createdAt;
      goal.nextRunAt = Number.isFinite(input.nextRunAt) ? input.nextRunAt : null;
      if (typeof input.triggerFingerprint === 'string') goal.triggerFingerprint = input.triggerFingerprint.slice(0, 100);
      if (input.pauseReason === 'all') goal.pauseReason = 'all';
      if (input.needsRecoveryCheck === true) goal.needsRecoveryCheck = true;
      goal.clarifications = clarifications(input.clarifications);
      const question = pendingQuestion(input.pendingQuestion);
      if (question && !['draft', 'completed'].includes(goal.status)) goal.pendingQuestion = question;
      if (input.continueAfterAnswer === true) goal.continueAfterAnswer = true;
      if (input.needsEffectReview === true) goal.needsEffectReview = true;
      goal.ledger = normalizeGoalLedger(input.ledger ?? goal.ledger, goal, Date.now());
      if (recovering && goal.status === 'running') {
        const external = goal.permissions.network || goal.permissions.mcpTools.length > 0;
        goal.status = external ? 'blocked' : 'queued'; goal.needsRecoveryCheck = !external; goal.nextRunAt = Date.now();
        if (external && question) goal.needsEffectReview = true;
        goal.nextStep = external ? 'Review possible external effects before resuming this interrupted goal.' : 'Verify existing results before continuing the interrupted goal.';
        goal.history = historyOf([...goal.history, { at: Date.now(), kind: 'recovery', summary: goal.nextStep, status: goal.status }]);
        recoverGoalLedger(goal, goal.nextStep, { now: Date.now() });
      }
      if (goal.pendingQuestion && goal.status !== 'paused' && (recovering || goal.status !== 'running')) { goal.status = 'blocked'; goal.nextStep = question.question; }
      result.goals.push(goal);
    } catch { /* Invalid persisted goals are omitted instead of executed. */ }
  }
  return result;
}

class GoalRunner {
  constructor({ store, run, stopRun, verifyCommand, backupRoot, canRun = () => true, onChange = () => {}, onAlert = () => {}, publish = null }) {
    if (publish !== null && typeof publish !== 'function') throw new TypeError('Goal publish must be a function.');
    Object.assign(this, { store, run, stopRun, verifyCommand, backupRoot, canRun, onChange, onAlert, publish });
    store.data.autonomy ||= normalizeAutonomy(null, store.data.settings);
    this.activeId = null; this.execution = null; this.timer = null; this.closing = false; this.ticking = false;
    this.forceRuns = new Set(); this.filePending = new Map(); this.fileSessionBaselines = new Set(); this.stopReason = null;
  }
  get data() { return this.store.data.autonomy; }
  goal(id) { const goal = this.data.goals.find(item => item.id === id); if (!goal) throw new Error('Goal not found.'); return goal; }
  changed() { this.store.save(); this.onChange(); }
  record(goal, kind, summary, extra = {}) { goal.updatedAt = Date.now(); goal.history = historyOf([...goal.history, { id: randomUUID(), at: Date.now(), kind, summary, ...extra }]); }
  emit(type, goal, payload = {}, options = {}) {
    if (!this.publish) return null;
    try { return this.publish({ type, source: 'goal.runner', ...options, payload: { goalId: goal.id, name: goal.name, workspace: goal.workspace, ...payload } }); }
    catch { return null; }
  }
  save(input, { authorize = false } = {}) {
    const existing = input?.id ? this.goal(input.id) : null;
    if (existing?.id === this.activeId) throw new Error('Pause the active goal and wait for it to stop before editing.');
    if (!existing && this.data.goals.length >= 50) throw new Error('Keep at most 50 goals. Remove an old goal first.');
    const goal = validateGoal(input, existing, this.store.data.settings);
    for (const id of goal.dependsOn) if (!this.data.goals.some(item => item.id === id)) throw new Error('A selected dependency no longer exists.');
    const all = [...this.data.goals.filter(item => item.id !== goal.id), goal];
    const visit = (id, trail = new Set()) => { if (trail.has(id)) throw new Error('Goal dependencies cannot form a cycle.'); const next = new Set(trail).add(id); for (const child of all.find(item => item.id === id)?.dependsOn || []) visit(child, next); };
    visit(goal.id);
    if (authorize) { goal.authorized = true; if (goal.trigger.type !== 'manual' && goal.status === 'draft') goal.status = 'queued'; }
    if (goal.trigger.type === 'interval' && goal.nextRunAt == null) goal.nextRunAt = Date.now() + goal.trigger.intervalMinutes * 60000;
    if (existing) {
      for (const key of ['pendingQuestion', 'clarifications', 'continueAfterAnswer', 'needsEffectReview']) if (!(key in goal)) delete existing[key];
      Object.assign(existing, goal);
    } else this.data.goals.push(goal);
    this.fileSessionBaselines.delete(goal.id);
    this.changed(); return existing || goal;
  }
  runNow(id) {
    const goal = this.goal(id);
    if (goal.pendingQuestion) throw new Error('Answer this goal’s question before continuing.');
    requireSelectedConnection(goal, this.store.data.settings);
    if (id === this.activeId) throw new Error('This goal is already running.');
    goal.ledger = normalizeGoalLedger(goal.ledger, goal);
    goal.authorized = true; goal.status = 'queued'; goal.nextRunAt = Date.now(); delete goal.pauseReason; delete goal.needsEffectReview;
    this.forceRuns.add(id); this.record(goal, 'queued', 'Queued by you.'); this.changed();
    this.emit('goal.queued', goal, { queuedAt: Date.now() }, { dedupeKey: `goal:queued:${goal.id}:${goal.updatedAt}` });
    this.wake(); return goal;
  }
  async pause(id) {
    const goal = this.goal(id); goal.status = 'paused'; delete goal.pauseReason;
    recordGoalPause(goal, 'Paused by you.');
    this.record(goal, 'paused', 'Paused by you.'); this.changed();
    this.emit('goal.paused', goal, { reason: 'Paused by you.', pausedAt: Date.now() });
    if (id === this.activeId) { this.stopReason = 'Paused by you.'; await this.stopRun?.(this.stopReason); await this.execution; }
    return goal;
  }
  resume(id) { return this.runNow(id); }
  answer({ id, questionId, answer } = {}) {
    const goal = this.goal(id), question = goal.pendingQuestion;
    if (!question || question.id !== questionId) throw new Error('This question is no longer waiting for an answer.');
    if (this.activeId === id || goal.status === 'running') throw new Error('Wait for the current goal step to stop before answering.');
    if (!goal.authorized || !['blocked', 'paused'].includes(goal.status)) throw new Error('This goal cannot accept an answer right now.');
    const reply = questionText(answer, 'Answer');
    const previous = structuredClone(goal);
    recordUserAnswer(goal, question.question, reply);
    goal.clarifications = clarifications([...(goal.clarifications || []), { id: question.id, question: question.question, answer: reply, answeredAt: Date.now() }]);
    delete goal.pendingQuestion;
    this.record(goal, 'answer', `Answered: ${question.question}`);
    const exhausted = this.budgetReason(goal) || (goal.needsEffectReview ? 'Review possible external effects before retrying this interrupted goal.' : null);
    if (exhausted) { goal.status = 'blocked'; goal.nextStep = exhausted; }
    else if (goal.status !== 'paused') {
      goal.status = 'queued'; goal.nextRunAt = Date.now(); goal.continueAfterAnswer = true;
      goal.nextStep = 'Continue using your answer.';
    }
    // Do not dispatch work unless the answer and its remaining budget are durable.
    try { this.store.save(); }
    catch (error) { for (const key of Object.keys(goal)) delete goal[key]; Object.assign(goal, previous); throw error; }
    this.onChange();
    this.emit('goal.question_answered', goal, { questionId, answeredAt: Date.now() });
    this.wake(); return goal;
  }
  async pauseAll() {
    this.data.paused = true;
    if (this.activeId) { const goal = this.goal(this.activeId); goal.status = 'paused'; goal.pauseReason = 'all'; this.record(goal, 'paused', 'Paused with all goals.'); }
    this.changed();
    if (this.activeId) this.emit('goal.paused', this.goal(this.activeId), { reason: 'All goals are paused.', pausedAt: Date.now() });
    if (this.activeId) { this.stopReason = 'All goals are paused.'; await this.stopRun?.(this.stopReason); await this.execution; }
    return this.data;
  }
  resumeAll() {
    this.data.paused = false;
    for (const goal of this.data.goals) if (goal.pauseReason === 'all') { goal.status = goal.pendingQuestion ? 'blocked' : 'queued'; goal.nextRunAt = Date.now(); delete goal.pauseReason; if (!goal.pendingQuestion) this.forceRuns.add(goal.id); }
    this.changed(); this.wake(); return this.data;
  }
  async remove(id) {
    if (id === this.activeId) throw new Error('Wait for the active goal to stop before removing it.');
    const goal = this.goal(id);
    if (this.data.goals.some(item => item.dependsOn.includes(id))) throw new Error('Remove this goal from other goals’ dependencies first.');
    await files.removeGoalSnapshots(this.backupRoot, goal.id);
    this.data.goals = this.data.goals.filter(item => item.id !== id); this.forceRuns.delete(id); this.filePending.delete(id); this.fileSessionBaselines.delete(id); this.changed();
    this.emit('goal.removed', goal, { removedAt: Date.now() });
    return { ok: true };
  }
  async previewRestore(id, runId) { if (this.activeId) throw new Error('Wait for the active goal to stop before reviewing undo.'); return files.previewRestore(this.goal(id), this.backupRoot, runId); }
  async restore(id, runId) {
    if (this.activeId) throw new Error('Wait for the active goal to stop before restoring files.');
    const goal = this.goal(id);
    let result;
    try { result = await files.restoreSnapshot(goal, this.backupRoot, runId); }
    catch (error) { goal.status = 'paused'; this.record(goal, 'restore-error', clean(error), { runId }); this.changed(); throw error; }
    goal.status = 'paused';
    for (const entry of goal.history) if (entry.snapshot?.runId === runId) entry.snapshot.undoAvailable = false;
    this.record(goal, 'restored', `Restored ${result.restored} files from the selected run.`, { runId }); this.changed(); return result;
  }
  async discardSnapshot(id, runId) {
    if (this.activeId) throw new Error('Wait for the active goal to stop before removing a snapshot.');
    const goal = this.goal(id); await files.discardSnapshot(this.backupRoot, id, runId);
    for (const entry of goal.history) if (entry.snapshot?.runId === runId) entry.snapshot.undoAvailable = false;
    this.record(goal, 'snapshot-removed', 'Removed the selected backup; activity history is retained.', { runId }); this.changed(); return { ok: true };
  }
  start() { if (this.timer) return; this.closing = false; this.fileSessionBaselines.clear(); this.timer = setInterval(() => this.wake(), 5000); this.timer.unref?.(); this.wake(); }
  wake() { if (!this.closing) void this.tick().catch(error => this.onAlert({ title: 'Goal runner', message: clean(error) })); }
  async tick() {
    if (this.ticking || this.activeId || this.closing || this.data.paused) return;
    this.ticking = true;
    try {
      for (const goal of [...this.data.goals].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)) {
        if (goal.status !== 'queued' || !goal.authorized || goal.pendingQuestion) continue;
        if (!isConnectionSelected(goal, this.store.data.settings)) continue;
        if (goal.dependsOn.some(id => this.data.goals.find(item => item.id === id)?.status !== 'completed')) continue;
        let ready = this.forceRuns.has(goal.id) || goal.needsRecoveryCheck || goal.continueAfterAnswer;
        if (!ready && goal.trigger.type === 'files') {
          try {
            const fingerprint = await files.fingerprintPaths(goal);
            if (!this.fileSessionBaselines.has(goal.id)) {
              this.fileSessionBaselines.add(goal.id);
              goal.triggerFingerprint = fingerprint;
              this.filePending.delete(goal.id);
              this.changed();
              continue;
            }
            if (!goal.triggerFingerprint) { goal.triggerFingerprint = fingerprint; this.changed(); }
            else if (fingerprint !== goal.triggerFingerprint) {
              const previous = this.filePending.get(goal.id);
              if (previous?.fingerprint === fingerprint && Date.now() - previous.at >= 1000) {
                ready = true;
                this.emit('file.changed', goal, { path: goal.trigger.paths[0] || '', paths: goal.trigger.paths, fingerprint, previousFingerprint: goal.triggerFingerprint },
                  { dedupeKey: `file:${goal.id}:${fingerprint}`, debounceKey: `file:${goal.id}`, debounceMs: 1000 });
              } else this.filePending.set(goal.id, { fingerprint, at: Date.now() });
            } else this.filePending.delete(goal.id);
          } catch (error) { this.block(goal, `File trigger could not be checked: ${clean(error)}`); }
        } else if (!ready) ready = goal.nextRunAt != null && goal.nextRunAt <= Date.now();
        // File checks await I/O; a pause or shutdown may land while they run.
        if (!ready || this.closing || this.data.paused || goal.status !== 'queued' || !this.canRun()) continue;
        this.forceRuns.delete(goal.id); this.execution = this.execute(goal);
        await this.execution; this.execution = null; break;
      }
    } finally { this.ticking = false; }
  }
  block(goal, reason, extra = {}) {
    goal.status = 'blocked'; goal.nextStep = reason;
    recordGoalBlock(goal, reason, { runId: extra.runId || '', source: 'system' });
    this.record(goal, 'blocked', reason, { status: 'blocked', ...extra }); this.changed();
    this.emit('goal.blocked', goal, { reason, blockedAt: Date.now() });
    this.onAlert({ title: goal.name, message: reason, goalId: goal.id });
  }
  saveQuestion(goal, value, checkpoint, nextStep) {
    const question = questionInput(value);
    if (!goal.pendingQuestion) goal.pendingQuestion = { id: randomUUID(), ...question, createdAt: Date.now() };
    if (checkpoint) goal.checkpoint = text(checkpoint, 'Checkpoint', 4000);
    if (nextStep != null) goal.nextStep = text(nextStep, 'Next step', 2000);
  }
  budgetReason(goal) {
    if (goal.usage.tokens >= goal.limits.maxTokens) return 'The goal token budget was reached.';
    if (goal.usage.elapsedMs >= goal.limits.maxMinutes * 60000) return 'The goal time budget was reached.';
    if (goal.usage.actions >= goal.limits.maxActions) return 'The goal action budget was reached.';
    if (goal.usage.runs >= goal.limits.maxRuns) return 'The goal run limit was reached.';
    return null;
  }
  async verify(goal, charge) {
    const results = [];
    for (const check of goal.checks) {
      charge(false);
      let result;
      if (check.type === 'command') {
        if (this.stopReason || goal.usage.actions >= goal.limits.maxActions || goal.usage.elapsedMs >= goal.limits.maxMinutes * 60000) result = { passed: false, detail: 'Verification command skipped because the goal is stopped or its budget is exhausted.' };
        else {
          charge(true); this.changed();
          try { result = await this.verifyCommand?.(goal, check) || { passed: false, detail: 'Command verification is unavailable.' }; } catch (error) { result = { passed: false, detail: clean(error) }; }
          charge(false);
        }
      } else result = await files.verifyFile(goal, check);
      results.push({ type: check.type, path: check.path || '', passed: result?.passed === true, detail: clean(result?.detail) });
      if (this.stopReason) break;
    }
    return { passed: goal.checks.length > 0 && results.length === goal.checks.length && results.every(item => item.passed), results };
  }
  async completeStoppedFiles(goal, runId, reason) {
    // The last allowed native write can succeed just before the executor stops
    // at its budget. File-only checks establish completion without another
    // model request, command, or possible duplicate external effect.
    if (this.closing || goal.status === 'paused' || goal.permissions.network || goal.permissions.mcpTools.length
        || !/budget|time limit|run limit/i.test(reason || '') || !goal.checks.length || goal.checks.some(check => check.type === 'command')) return false;
    const verification = [];
    for (const check of goal.checks) {
      const result = await files.verifyFile(goal, check);
      verification.push({ type: check.type, path: check.path, passed: result.passed === true, detail: clean(result.detail) });
    }
    if (this.closing || goal.status === 'paused') return false;
    this.record(goal, 'verification', 'Checked local completion conditions after the execution budget stopped work.', { runId, verification });
    if (!verification.every(check => check.passed)) return false;
    goal.status = 'completed'; goal.nextStep = ''; delete goal.pendingQuestion;
    completeGoalLedger(goal, 'Goal completed and verified after the final allowed action.', { runId, now: Date.now() });
    this.record(goal, 'completed', 'Goal completed and verified after the final allowed action.', { runId, status: 'completed' });
    this.changed();
    this.emit('goal.completed', goal, { runId, summary: 'Goal completed and verified after the final allowed action.', completedAt: Date.now() });
    this.onAlert({ title: goal.name, message: 'Goal completed and verified.', goalId: goal.id });
    return true;
  }
  async execute(goal) {
    this.activeId = goal.id; this.stopReason = null;
    const runId = randomUUID(), startedAt = Date.now(), before = usageOf(goal.usage), checkpointBefore = `${goal.checkpoint}\n${goal.nextStep}`;
    goal.ledger = normalizeGoalLedger(goal.ledger, goal, startedAt);
    let snapshot = null, verificationActions = 0, modelUsage = { tokens: 0, actions: 0, elapsedMs: 0 }, result = null, timer;
    const updateUsage = () => { goal.usage.tokens = before.tokens + Math.floor(number(modelUsage.tokens)); goal.usage.actions = before.actions + verificationActions + Math.floor(number(modelUsage.actions)); goal.usage.elapsedMs = before.elapsedMs + Math.max(Date.now() - startedAt, Math.floor(number(modelUsage.elapsedMs))); };
    goal.status = 'running'; delete goal.needsRecoveryCheck; delete goal.continueAfterAnswer; this.record(goal, 'checking', 'Checking saved completion conditions before doing work.', { runId }); this.changed();
    try {
      let checked = await this.verify(goal, action => { if (action) verificationActions++; updateUsage(); }); updateUsage();
      recordVerificationEvidence(goal, checked.results, { runId, phase: 'preflight', now: Date.now() }); this.changed();
      if (this.stopReason || goal.status === 'paused' || this.closing) return;
      if (checked.passed) {
        goal.status = 'completed'; goal.nextStep = '';
        const summary = 'Verified: the completion conditions already pass. No model call was needed.';
        completeGoalLedger(goal, summary, { runId, now: Date.now() });
        this.record(goal, 'completed', summary, { runId, status: 'completed', verification: checked.results }); this.changed();
        this.emit('goal.completed', goal, { runId, summary, completedAt: Date.now() });
        this.onAlert({ title: goal.name, message: 'Goal completed and verified.', goalId: goal.id }); return;
      }
      const exhausted = this.budgetReason(goal); if (exhausted) { this.block(goal, exhausted, { runId, verification: checked.results }); return; }
      if (!goal.checks.length) { this.block(goal, 'Add at least one verification check before running this goal.', { runId }); return; }
      snapshot = await files.createSnapshot(goal, this.backupRoot, runId);
      if (snapshot?.retiredRunIds) for (const entry of goal.history) if (snapshot.retiredRunIds.includes(entry.snapshot?.runId)) entry.snapshot.undoAvailable = false;
      if (this.stopReason || goal.status === 'paused' || this.closing) return;
      goal.usage.runs++; this.record(goal, 'started', 'Started one bounded goal step.', { runId, snapshot }); this.changed();
      // The run limit bounds starts; reaching it does not cancel the last allowed run.
      timer = setInterval(() => { updateUsage(); if (goal.usage.elapsedMs >= goal.limits.maxMinutes * 60000 && !this.stopReason) { this.stopReason = 'The goal time budget was reached.'; void Promise.resolve(this.stopRun?.(this.stopReason)).catch(() => {}); } }, 1000); timer.unref?.();
      result = await this.run(goal, { onProgress: reported => {
        for (const key of ['tokens', 'actions', 'elapsedMs']) modelUsage[key] = Math.max(modelUsage[key], number(reported?.[key]));
        updateUsage();
        if (reported?.clarification) this.saveQuestion(goal, reported.clarification, reported.checkpoint, reported.nextStep);
        const reason = goal.usage.tokens >= goal.limits.maxTokens ? 'The goal token budget was reached.' : goal.usage.actions > goal.limits.maxActions ? 'The goal action budget was reached.' : goal.usage.elapsedMs >= goal.limits.maxMinutes * 60000 ? 'The goal time budget was reached.' : null;
        if (reason && !this.stopReason) { this.stopReason = reason; void Promise.resolve(this.stopRun?.(reason)).catch(() => {}); }
        this.changed();
      } });
      for (const key of ['tokens', 'actions', 'elapsedMs']) modelUsage[key] = Math.max(modelUsage[key], number(result?.usage?.[key])); updateUsage();
      if (result?.checkpoint) goal.checkpoint = text(result.checkpoint, 'Checkpoint', 4000);
      if (result?.nextStep != null) goal.nextStep = text(result.nextStep, 'Next step', 2000);
      if (result?.clarification) this.saveQuestion(goal, result.clarification, result.checkpoint, result.nextStep);
      applyGoalLedgerUpdate(goal, result?.ledger, { runId, now: Date.now(), status: result?.status,
        summary: result?.summary, nextStep: goal.nextStep });
      const actions = Array.isArray(result?.actions) ? result.actions.slice(0, 30).map(clean) : [];
      if (snapshot) {
        snapshot = await files.finishSnapshot(goal, this.backupRoot, runId);
        recordSnapshotEvidence(goal, snapshot, { runId, now: Date.now() });
      }
      this.record(goal, 'run', clean(result?.summary) || 'Goal step ended.', { runId, usage: { ...modelUsage, actions: modelUsage.actions + verificationActions }, actions, snapshot }); this.changed();
      if (this.stopReason || goal.status === 'paused' || this.closing) {
        if (await this.completeStoppedFiles(goal, runId, this.stopReason)) return;
        if (goal.status !== 'paused') this.block(goal, this.stopReason || 'Goal stopped.', { runId }); return;
      }
      if (goal.pendingQuestion) {
        this.block(goal, goal.pendingQuestion.question, { runId }); return;
      }
      checked = await this.verify(goal, action => { if (action) verificationActions++; updateUsage(); }); updateUsage();
      recordVerificationEvidence(goal, checked.results, { runId, phase: 'completion', now: Date.now() });
      this.record(goal, 'verification', checked.passed ? 'All completion conditions passed.' : 'Completion conditions have not all passed.', { runId, verification: checked.results });
      if (this.stopReason || goal.status === 'paused' || this.closing) return;
      if (checked.passed) {
        goal.status = 'completed'; goal.nextStep = ''; const summary = 'Goal completed and verified.';
        completeGoalLedger(goal, summary, { runId, now: Date.now() });
        this.record(goal, 'completed', summary, { runId, status: 'completed' });
        this.emit('goal.completed', goal, { runId, summary, completedAt: Date.now() });
        this.onAlert({ title: goal.name, message: summary, goalId: goal.id });
      }
      else if (result?.status === 'blocked') this.block(goal, clean(result.summary) || 'The goal needs your input.', { runId });
      else {
        const previousRuns = goal.history.filter(entry => entry.kind === 'run').slice(-3);
        const repeatedActions = previousRuns.length === 3 && previousRuns.every(entry => JSON.stringify(entry.actions || []) === JSON.stringify(actions));
        const progressed = (snapshot?.changes || 0) > 0 || (!repeatedActions && `${goal.checkpoint}\n${goal.nextStep}` !== checkpointBefore);
        if (result?.status === 'verify' || !progressed) goal.usage.retries++;
        const reason = this.budgetReason(goal) || (repeatedActions && !(snapshot?.changes > 0) ? 'The goal repeated the same actions three times without verified file progress.' : null) || (goal.usage.retries > goal.limits.maxRetries ? 'The goal stopped after repeated failed verification or no progress.' : null);
        if (reason) this.block(goal, reason, { runId });
        else { goal.status = 'queued'; goal.nextRunAt = goal.trigger.type === 'files' ? null : Date.now() + (goal.trigger.type === 'interval' ? goal.trigger.intervalMinutes * 60000 : 1000); }
      }
    } catch (error) {
      if (goal.pendingQuestion && (goal.permissions.network || goal.permissions.mcpTools.length)) goal.needsEffectReview = true;
      for (const key of ['tokens', 'actions', 'elapsedMs']) modelUsage[key] = Math.max(modelUsage[key], number(error?.usage?.[key]));
      updateUsage();
      if (Array.isArray(error.actions) && error.actions.length) this.record(goal, 'run-error', clean(error), { runId, actions: error.actions.slice(0, 30).map(clean), usage: modelUsage });
      if (snapshot) try {
        snapshot = await files.finishSnapshot(goal, this.backupRoot, runId);
        recordSnapshotEvidence(goal, snapshot, { runId, now: Date.now() });
        this.record(goal, 'snapshot', 'Saved file evidence after an interrupted or failed step.', { runId, snapshot });
      } catch (snapshotError) { this.record(goal, 'snapshot-error', `Undo is unavailable: ${clean(snapshotError)}`, { runId }); }
      if (await this.completeStoppedFiles(goal, runId, this.stopReason || clean(error))) return;
      if (goal.status !== 'paused') this.block(goal, this.stopReason || clean(error), { runId });
      else this.record(goal, 'stopped', this.stopReason || clean(error), { runId });
    } finally {
      clearInterval(timer); updateUsage();
      if (this.closing && goal.pendingQuestion && (goal.permissions.network || goal.permissions.mcpTools.length)) goal.needsEffectReview = true;
      if (goal.trigger.type === 'files') try { goal.triggerFingerprint = await files.fingerprintPaths(goal); this.filePending.delete(goal.id); } catch { /* The next trigger check surfaces the changed scope. */ }
      if (this.closing && this.stopReason === 'Little Bot is closing.' && goal.status !== 'completed' && goal.status !== 'paused' && !goal.pendingQuestion) {
        const external = goal.permissions.network || goal.permissions.mcpTools.length > 0;
        goal.status = external ? 'blocked' : 'queued'; goal.needsRecoveryCheck = !external; goal.nextRunAt = Date.now();
        goal.nextStep = external ? 'Review possible external effects before resuming.' : 'Verify existing results before continuing after restart.';
        recoverGoalLedger(goal, goal.nextStep, { now: Date.now() });
      }
      if (goal.status === 'running') {
        goal.status = 'paused';
        recordGoalPause(goal, this.stopReason || 'Goal execution ended before completion.', { source: 'system' });
        this.record(goal, 'stopped', this.stopReason || 'Goal execution ended before completion.', { runId });
      }
      goal.updatedAt = Date.now(); this.activeId = null; this.stopReason = null; this.changed();
    }
  }
  async close() { this.closing = true; clearInterval(this.timer); this.timer = null; if (this.activeId) { this.stopReason = 'Little Bot is closing.'; await this.stopRun?.(this.stopReason); await this.execution; } }
}

module.exports = { GoalRunner, validateGoal, normalizeAutonomy, DEFAULT_LIMITS };
