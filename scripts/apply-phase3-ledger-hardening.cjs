'use strict';

const fs = require('node:fs');

function source(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function replaceOnce(file, before, after, label) {
  const input = source(file);
  const count = input.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, input.replace(before, after), 'utf8');
}

replaceOnce('src/goal-ledger.cjs',
`    } else {
      const last = plan.steps[plan.steps.length - 1];
      last.status = 'active'; last.activatedAt ||= now; delete last.completedAt;
    }`,
`    } else {
      const version = Math.max(0, ...ledger.plans.map(item => item.version)) + 1;
      ledger.plans.push(createPlan(version, [fallbackStep(goal)], {
        now, source: 'system', reason: 'Added a fresh step because the prior plan had no remaining work.',
      }));
      ledger.plans = ledger.plans.slice(-MAX_PLAN_VERSIONS);
      ledger.updatedAt = now;
    }`,
'full plan repair');

replaceOnce('src/goal-ledger.cjs',
`function revisePlan(ledger, steps, { now = Date.now(), source: planSource = 'agent', reason = 'Plan revised.', runId = '', goal = {} } = {}) {`,
`function revisePlan(ledger, steps, { now = Date.now(), source: planSource = 'agent', reason = 'Plan revised.', runId = '', goal = {}, force = false } = {}) {`,
'force plan revision signature');

replaceOnce('src/goal-ledger.cjs',
`  if (current && JSON.stringify(current.steps.map(step => step.text)) === JSON.stringify(texts)) return current;`,
`  if (!force && current && JSON.stringify(current.steps.map(step => step.text)) === JSON.stringify(texts)) return current;`,
'force plan revision condition');

replaceOnce('src/goal-ledger.cjs',
`  const changed = clean(previousGoal.objective, 12000) !== clean(nextGoal.objective, 12000)
    || JSON.stringify(uniqueTexts(previousGoal.steps)) !== JSON.stringify(uniqueTexts(nextGoal.steps));
  if (changed) {
    revisePlan(ledger, definitionSteps(nextGoal), { now, source: 'user', reason: 'Goal definition updated by the user.', goal: nextGoal });
    addDecision(ledger, { at: now, source: 'user', text: 'Revised the goal plan.', rationale: 'The saved objective or suggested steps changed.' });
  }`,
`  const changed = clean(previousGoal.objective, 12000) !== clean(nextGoal.objective, 12000)
    || JSON.stringify(uniqueTexts(previousGoal.steps)) !== JSON.stringify(uniqueTexts(nextGoal.steps));
  const reopened = previousGoal.status === 'completed' && nextGoal.status !== 'completed';
  if (changed || reopened) {
    const reason = reopened && !changed ? 'The completed goal was reopened by the user.' : 'Goal definition updated by the user.';
    revisePlan(ledger, definitionSteps(nextGoal), { now, source: 'user', reason, goal: nextGoal, force: true });
    addDecision(ledger, { at: now, source: 'user', text: reopened ? 'Reopened the goal with a fresh plan version.' : 'Revised the goal plan.',
      rationale: changed ? 'The saved objective or suggested steps changed.' : 'The completed goal was prepared for another run.' });
  }`,
'goal definition revision');

replaceOnce('src/goal-ledger.cjs',
`function normalizeExecutorLedgerUpdate(value, { status = 'continue', summary = '' } = {}) {`,
`function restartGoalLedger(goal, { now = Date.now(), source: recordSource = 'user' } = {}) {
  const ledger = normalizeGoalLedger(goal.ledger, { ...goal, status: 'completed' }, now);
  revisePlan(ledger, definitionSteps(goal), {
    now, source: recordSource, reason: 'Started a new run after verified completion.',
    goal: { ...goal, status: 'queued' }, force: true,
  });
  addDecision(ledger, { at: now, source: recordSource, text: 'Started a new plan version for another run.',
    rationale: 'The previous plan ended in verified completion.' });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}

function normalizeExecutorLedgerUpdate(value, { status = 'continue', summary = '' } = {}) {`,
'restart goal ledger');

replaceOnce('src/goal-ledger.cjs',
`function recordUserAnswer(goal, question, answer, { now = Date.now() } = {}) {`,
`function recordGoalRestore(goal, result, { runId = '', now = Date.now() } = {}) {
  const ledger = normalizeGoalLedger(goal.ledger, goal, now);
  const restored = Number.isSafeInteger(result?.restored) && result.restored >= 0 ? result.restored : 0;
  addObservation(ledger, {
    at: now, source: 'system', runId,
    text: \`Restored ${'${restored}'} path${'${restored === 1 ? \'\' : \'s\'}'} from saved file evidence.\`,
    evidence: { type: 'restore', changes: restored },
  });
  addDecision(ledger, { at: now, source: 'user', runId, text: 'Applied Review undo.',
    rationale: \`Restored ${'${restored}'} path${'${restored === 1 ? \'\' : \'s\'}'} from the selected run.\` });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}

function recordUserAnswer(goal, question, answer, { now = Date.now() } = {}) {`,
'restore ledger evidence');

replaceOnce('src/goal-ledger.cjs',
`function completeGoalLedger(goal, summary, { runId = '', now = Date.now() } = {}) {
  const ledger = normalizeGoalLedger(goal.ledger, { ...goal, status: 'completed' }, now);
  const plan = currentPlan(ledger);
  for (const step of plan?.steps || []) {
    if (step.status === 'active') {
      step.status = 'completed'; step.completedAt = now; step.updatedAt = now;
      step.summary = clean(summary, 2000) || step.summary || 'Goal completion was verified.';
    } else if (step.status === 'pending') step.status = 'skipped';
  }
  addDecision(ledger, { at: now, source: 'verification', runId, text: 'Marked the goal complete.', rationale: clean(summary, 3000) || 'All saved completion checks passed.' });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}`,
`function completeGoalLedger(goal, summary, { runId = '', now = Date.now() } = {}) {
  const rawPlan = currentPlan(goal.ledger);
  const unfinished = rawPlan?.steps?.some(step => ['active', 'pending'].includes(step.status)) === true;
  const ledger = normalizeGoalLedger(goal.ledger, { ...goal, status: unfinished ? 'running' : 'completed' }, now);
  const plan = currentPlan(ledger);
  for (const step of plan?.steps || []) {
    if (step.status === 'active') {
      step.status = 'completed'; step.completedAt = now; step.updatedAt = now;
      step.summary = clean(summary, 2000) || step.summary || 'Goal completion was verified.';
    } else if (step.status === 'pending') step.status = 'skipped';
  }
  addDecision(ledger, { at: now, source: 'verification', runId, text: 'Marked the goal complete.', rationale: clean(summary, 3000) || 'All saved completion checks passed.' });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}`,
'completion summary preservation');

replaceOnce('src/goal-ledger.cjs',
`    assumptions: latestAssumptions(ledger).filter(item => item.status === 'open').slice(-20).map(({ text, status, source }) => ({ text, status, source })),`,
`    assumptions: latestAssumptions(ledger).slice(-20).map(({ text, status, source }) => ({ text, status, source })),`,
'complete assumption context');

replaceOnce('src/goal-ledger.cjs',
`  reconcileGoalLedger,
  normalizeExecutorLedgerUpdate,`,
`  reconcileGoalLedger,
  restartGoalLedger,
  normalizeExecutorLedgerUpdate,`,
'export restart helper');

replaceOnce('src/goal-ledger.cjs',
`  recordGoalPause,
  recordUserAnswer,`,
`  recordGoalPause,
  recordGoalRestore,
  recordUserAnswer,`,
'export restore helper');

replaceOnce('src/goals.cjs',
`  normalizeGoalLedger, reconcileGoalLedger, applyGoalLedgerUpdate,
  recordVerificationEvidence, recordSnapshotEvidence, recordGoalBlock,
  recordGoalPause, recordUserAnswer, completeGoalLedger, recoverGoalLedger,`,
`  normalizeGoalLedger, reconcileGoalLedger, restartGoalLedger, applyGoalLedgerUpdate,
  recordVerificationEvidence, recordSnapshotEvidence, recordGoalBlock,
  recordGoalPause, recordGoalRestore, recordUserAnswer, completeGoalLedger, recoverGoalLedger,`,
'goal lifecycle imports');

replaceOnce('src/goals.cjs',
`    goal.ledger = normalizeGoalLedger(goal.ledger, goal);
    goal.authorized = true; goal.status = 'queued'; goal.nextRunAt = Date.now(); delete goal.pauseReason; delete goal.needsEffectReview;`,
`    const restarting = goal.status === 'completed';
    goal.status = 'queued';
    goal.ledger = restarting ? restartGoalLedger(goal, { now: Date.now(), source: 'user' }) : normalizeGoalLedger(goal.ledger, goal);
    goal.authorized = true; goal.nextRunAt = Date.now(); delete goal.pauseReason; delete goal.needsEffectReview;`,
'completed goal rerun');

replaceOnce('src/goals.cjs',
`    if (this.activeId) { const goal = this.goal(this.activeId); goal.status = 'paused'; goal.pauseReason = 'all'; this.record(goal, 'paused', 'Paused with all goals.'); }`,
`    if (this.activeId) {
      const goal = this.goal(this.activeId); goal.status = 'paused'; goal.pauseReason = 'all';
      recordGoalPause(goal, 'Paused with all goals.', { source: 'user' });
      this.record(goal, 'paused', 'Paused with all goals.');
    }`,
'pause all ledger');

replaceOnce('src/goals.cjs',
`    goal.status = 'paused';
    for (const entry of goal.history) if (entry.snapshot?.runId === runId) entry.snapshot.undoAvailable = false;
    this.record(goal, 'restored', \`Restored ${'${result.restored}'} files from the selected run.\`, { runId }); this.changed(); return result;`,
`    goal.status = 'paused';
    recordGoalRestore(goal, result, { runId, now: Date.now() });
    for (const entry of goal.history) if (entry.snapshot?.runId === runId) entry.snapshot.undoAvailable = false;
    this.record(goal, 'restored', \`Restored ${'${result.restored}'} files from the selected run.\`, { runId }); this.changed(); return result;`,
'undo ledger evidence');

replaceOnce('src/goals.cjs',
`    if (this.closing || goal.status === 'paused') return false;
    this.record(goal, 'verification', 'Checked local completion conditions after the execution budget stopped work.', { runId, verification });`,
`    if (this.closing || goal.status === 'paused') return false;
    recordVerificationEvidence(goal, verification, { runId, phase: 'completion', now: Date.now() });
    this.record(goal, 'verification', 'Checked local completion conditions after the execution budget stopped work.', { runId, verification });`,
'budget completion evidence');

replaceOnce('src/renderer/goal-ledger-ui.js',
`    if (value.type === 'snapshot') {
      const changes = Number.isSafeInteger(value.changes) && value.changes >= 0 ? value.changes : 0;
      return \`${'${changes}'} changed path${'${changes === 1 ? \'\' : \'s\'}'}\`;
    }`,
`    if (['snapshot', 'restore'].includes(value.type)) {
      const changes = Number.isSafeInteger(value.changes) && value.changes >= 0 ? value.changes : 0;
      const verb = value.type === 'restore' ? 'restored' : 'changed';
      return \`${'${changes}'} ${'${verb}'} path${'${changes === 1 ? \'\' : \'s\'}'}\`;
    }`,
'restore evidence label');

fs.writeFileSync('test/goal-ledger-lifecycle.test.cjs', String.raw`'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  MAX_PLAN_STEPS,
  normalizeGoalLedger, reconcileGoalLedger, restartGoalLedger,
  currentPlan, activeStep, completeGoalLedger, goalLedgerContext,
  recordGoalRestore,
} = require('../src/goal-ledger.cjs');
const { GoalRunner, validateGoal } = require('../src/goals.cjs');
const ui = require('../src/renderer/goal-ledger-ui.js');

function basicGoal(overrides = {}) {
  return {
    id: 'goal-1', name: 'Report', objective: 'Build the report.', steps: ['Collect', 'Write', 'Verify'],
    status: 'queued', nextStep: '', ...overrides,
  };
}

function settings(workspace) { return { workspace, model: '', connection: 'codex', effort: 'low' }; }
function draft(workspace) {
  return {
    name: 'Report', objective: 'Create done.txt', steps: ['Create done.txt'], workspace,
    model: '', connection: 'codex', effort: 'low', priority: 3,
    checks: [{ type: 'fileExists', path: 'done.txt' }],
    permissions: { write: true, writePaths: ['.'], shell: false, network: false, mcpTools: [] },
    limits: { maxTokens: 50000, maxMinutes: 30, maxActions: 50, maxRuns: 10, maxRetries: 2 },
    trigger: { type: 'manual', intervalMinutes: 30, paths: [] }, dependsOn: [],
  };
}

test('an objective-only user edit always creates a new plan version', () => {
  const previous = basicGoal();
  const ledger = normalizeGoalLedger(null, previous, 1000);
  const next = { ...previous, objective: 'Build and publish the report.' };
  const revised = reconcileGoalLedger(ledger, previous, next, 2000);
  assert.equal(revised.plans.length, 2);
  assert.equal(currentPlan(revised).version, 2);
  assert.equal(currentPlan(revised).source, 'user');
});

test('restarting a completed goal creates a fresh version even with identical steps', () => {
  const goal = basicGoal({ status: 'completed' });
  goal.ledger = normalizeGoalLedger(null, goal, 1000);
  restartGoalLedger(goal, { now: 2000 });
  assert.equal(currentPlan(goal.ledger).version, 2);
  assert.equal(activeStep(goal.ledger).text, 'Collect');
  assert.equal(currentPlan(goal.ledger).steps.filter(step => step.status === 'active').length, 1);
  assert.match(goal.ledger.decisions.at(-1).text, /new plan version/i);
});

test('completion records its final summary on the active step', () => {
  const goal = basicGoal();
  goal.ledger = normalizeGoalLedger(null, goal, 1000);
  completeGoalLedger(goal, 'All saved checks passed.', { runId: 'run-1', now: 2000 });
  assert.equal(currentPlan(goal.ledger).steps[0].status, 'completed');
  assert.equal(currentPlan(goal.ledger).steps[0].summary, 'All saved checks passed.');
  assert.equal(activeStep(goal.ledger), null);
});

test('repairing a full exhausted plan creates a new version instead of reopening history', () => {
  const steps = Array.from({ length: MAX_PLAN_STEPS }, (_, index) => ({ id: `s-${index}`, text: `Step ${index}`, status: 'completed' }));
  const goal = basicGoal({ steps: [], status: 'queued', nextStep: 'Fresh work' });
  const ledger = normalizeGoalLedger({ plans: [{ version: 4, steps }] }, goal, 2000);
  assert.equal(currentPlan(ledger).version, 5);
  assert.equal(activeStep(ledger).text, 'Fresh work');
  assert.ok(ledger.plans[0].steps.every(step => step.status === 'completed'));
});

test('model context retains confirmed and rejected assumptions', () => {
  const goal = basicGoal();
  goal.ledger = normalizeGoalLedger({
    plans: [{ version: 1, steps: [{ text: 'Collect', status: 'active' }] }],
    assumptions: [
      { id: 'a', at: 1, text: 'UTF-8', status: 'confirmed', source: 'verification' },
      { id: 'b', at: 2, text: 'Cached totals are current', status: 'rejected', source: 'agent' },
    ],
  }, goal, 1000);
  assert.deepEqual(goalLedgerContext(goal.ledger, goal).assumptions.map(item => item.status), ['confirmed', 'rejected']);
});

test('Review undo records restored evidence and a user decision', () => {
  const goal = basicGoal({ status: 'paused' });
  goal.ledger = normalizeGoalLedger(null, goal, 1000);
  recordGoalRestore(goal, { restored: 2 }, { runId: 'run-2', now: 2000 });
  assert.equal(goal.ledger.observations.at(-1).evidence.type, 'restore');
  assert.equal(goal.ledger.observations.at(-1).evidence.changes, 2);
  assert.match(goal.ledger.decisions.at(-1).text, /Review undo/);
  assert.equal(ui.evidenceLabel(goal.ledger.observations.at(-1).evidence), '2 restored paths');
});

test('GoalRunner reruns a completed goal with a new active plan version', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-ledger-rerun-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const goal = validateGoal(draft(workspace), null, settings(workspace));
  goal.status = 'completed'; goal.authorized = true;
  goal.ledger = normalizeGoalLedger(goal.ledger, goal, 1000);
  const store = { data: { settings: settings(workspace), autonomy: { paused: false, goals: [goal] } }, save() {} };
  const runner = new GoalRunner({ store, backupRoot: path.join(workspace, '.backups'), canRun: () => false, onChange() {}, onAlert() {}, run: async () => ({}), verifyCommand: async () => ({ passed: false }) });
  runner.runNow(goal.id);
  assert.equal(goal.status, 'queued');
  assert.equal(currentPlan(goal.ledger).version, 2);
  assert.equal(activeStep(goal.ledger).text, 'Create done.txt');
});

test('Pause all records why the active goal was paused', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-ledger-pause-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const goal = validateGoal(draft(workspace), null, settings(workspace));
  goal.status = 'running'; goal.authorized = true;
  const store = { data: { settings: settings(workspace), autonomy: { paused: false, goals: [goal] } }, save() {} };
  const runner = new GoalRunner({ store, backupRoot: path.join(workspace, '.backups'), canRun: () => false, onChange() {}, onAlert() {}, run: async () => ({}), verifyCommand: async () => ({ passed: false }), stopRun: async () => {} });
  runner.activeId = goal.id;
  runner.execution = Promise.resolve();
  await runner.pauseAll();
  assert.equal(goal.status, 'paused');
  assert.match(goal.ledger.decisions.at(-1).rationale, /Paused with all goals/);
});

test('budget-stop completion records verification evidence before closing the ledger', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-ledger-budget-complete-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  await fs.writeFile(path.join(workspace, 'done.txt'), 'done');
  const goal = validateGoal(draft(workspace), null, settings(workspace));
  goal.status = 'running'; goal.authorized = true;
  const store = { data: { settings: settings(workspace), autonomy: { paused: false, goals: [goal] } }, save() {} };
  const runner = new GoalRunner({ store, backupRoot: path.join(workspace, '.backups'), canRun: () => false, onChange() {}, onAlert() {}, run: async () => ({}), verifyCommand: async () => ({ passed: false }) });
  assert.equal(await runner.completeStoppedFiles(goal, 'run-3', 'The goal action budget was reached.'), true);
  assert.equal(goal.status, 'completed');
  assert.ok(goal.ledger.observations.some(item => item.source === 'verification' && item.evidence?.passed === true));
  assert.equal(activeStep(goal.ledger), null);
});
`, 'utf8');
