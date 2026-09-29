'use strict';

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
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-test-backups-'));
  t.after(() => fs.rm(backupRoot, { recursive: true, force: true }));
  const goal = validateGoal(draft(workspace), null, settings(workspace));
  goal.status = 'completed'; goal.authorized = true;
  goal.ledger = normalizeGoalLedger(goal.ledger, goal, 1000);
  const store = { data: { settings: settings(workspace), autonomy: { paused: false, goals: [goal] } }, save() {} };
  const runner = new GoalRunner({ store, backupRoot, canRun: () => false, onChange() {}, onAlert() {}, run: async () => ({}), verifyCommand: async () => ({ passed: false }) });
  runner.runNow(goal.id);
  assert.equal(goal.status, 'queued');
  assert.equal(currentPlan(goal.ledger).version, 2);
  assert.equal(activeStep(goal.ledger).text, 'Create done.txt');
});

test('rerunning a completed goal does fresh work even when its old checks still pass', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-ledger-rerun-work-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-test-backups-'));
  t.after(() => fs.rm(backupRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(workspace, 'done.txt'), 'old');
  const goal = validateGoal(draft(workspace), null, settings(workspace));
  goal.status = 'completed'; goal.authorized = true;
  goal.usage = { tokens: 4000, elapsedMs: 2000, actions: 3, runs: goal.limits.maxRuns, retries: 1 };
  goal.ledger = normalizeGoalLedger(goal.ledger, goal, 1000);
  const store = { data: { settings: settings(workspace), autonomy: { paused: false, goals: [goal] } }, save() {} };
  let runs = 0;
  const runner = new GoalRunner({
    store, backupRoot, canRun: () => true, onChange() {}, onAlert() {},
    run: async () => {
      runs++;
      await fs.writeFile(path.join(workspace, 'done.txt'), 'fresh');
      return { status: 'verify', summary: 'Refreshed the output.', checkpoint: 'Fresh output saved.', nextStep: '',
        usage: { tokens: 12, actions: 1, elapsedMs: 5 }, actions: ['Wrote done.txt'] };
    },
  });

  runner.runNow(goal.id);
  assert.equal(goal.usage.runs, 0, 'Run again starts with a fresh cycle budget');
  await runner.tick();
  await runner.execution;

  assert.equal(runs, 1, 'A passing check from the previous cycle must not skip the rerun');
  assert.equal(goal.status, 'completed');
  assert.equal(goal.freshRun, undefined);
  assert.equal(await fs.readFile(path.join(workspace, 'done.txt'), 'utf8'), 'fresh');
});

test('interval goals stay active and reset their budget after each verified cycle', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-ledger-recurring-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-test-backups-'));
  t.after(() => fs.rm(backupRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(workspace, 'done.txt'), 'already valid');
  const input = draft(workspace);
  input.trigger = { type: 'interval', intervalMinutes: 30, paths: [] };
  input.limits = { ...input.limits, maxRuns: 1 };
  const goal = validateGoal(input, null, settings(workspace));
  goal.status = 'queued'; goal.authorized = true; goal.nextRunAt = Date.now() - 1;
  const store = { data: { settings: settings(workspace), autonomy: { paused: false, goals: [goal] } }, save() {} };
  let runs = 0;
  const runner = new GoalRunner({
    store, backupRoot, canRun: () => true, onChange() {}, onAlert() {},
    run: async () => {
      runs++;
      return { status: 'verify', summary: `Completed cycle ${runs}.`, checkpoint: `Cycle ${runs} checked.`, nextStep: '',
        usage: { tokens: 10, actions: 0, elapsedMs: 5 }, actions: [] };
    },
  });

  await runner.tick();
  assert.equal(runs, 1, 'A recurring goal must run even when the prior verification still passes');
  assert.equal(goal.status, 'queued');
  assert.equal(goal.usage.runs, 0, 'Recurring work limits are per verified cycle');
  assert.ok(Number.isFinite(goal.lastCompletedAt));
  assert.ok(goal.nextRunAt > Date.now());
  assert.equal(goal.history.filter(entry => entry.kind === 'cycle-completed').length, 1);

  goal.nextRunAt = Date.now() - 1;
  await runner.tick();
  assert.equal(runs, 2);
  assert.equal(goal.status, 'queued');
  assert.equal(goal.usage.runs, 0);
  assert.equal(goal.history.filter(entry => entry.kind === 'cycle-completed').length, 2);
});

test('Pause all records why the active goal was paused', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-ledger-pause-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-test-backups-'));
  t.after(() => fs.rm(backupRoot, { recursive: true, force: true }));
  const goal = validateGoal(draft(workspace), null, settings(workspace));
  goal.status = 'running'; goal.authorized = true;
  const store = { data: { settings: settings(workspace), autonomy: { paused: false, goals: [goal] } }, save() {} };
  const runner = new GoalRunner({ store, backupRoot, canRun: () => false, onChange() {}, onAlert() {}, run: async () => ({}), verifyCommand: async () => ({ passed: false }), stopRun: async () => {} });
  runner.activeId = goal.id;
  runner.execution = Promise.resolve();
  await runner.pauseAll();
  assert.equal(goal.status, 'paused');
  assert.match(goal.ledger.decisions.at(-1).rationale, /Paused with all goals/);
});

test('budget-stop completion records verification evidence before closing the ledger', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-ledger-budget-complete-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-test-backups-'));
  t.after(() => fs.rm(backupRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(workspace, 'done.txt'), 'done');
  const goal = validateGoal(draft(workspace), null, settings(workspace));
  goal.status = 'running'; goal.authorized = true;
  const store = { data: { settings: settings(workspace), autonomy: { paused: false, goals: [goal] } }, save() {} };
  const runner = new GoalRunner({ store, backupRoot, canRun: () => false, onChange() {}, onAlert() {}, run: async () => ({}), verifyCommand: async () => ({ passed: false }) });
  assert.equal(await runner.completeStoppedFiles(goal, 'run-3', 'The goal action budget was reached.', {}, false), true);
  assert.equal(goal.status, 'completed');
  assert.ok(goal.ledger.observations.some(item => item.source === 'verification' && item.evidence?.passed === true));
  assert.equal(activeStep(goal.ledger), null);
});

for (const previousArtifact of [false, true]) {
  test(`interrupted recurring cycle ${previousArtifact ? 'cannot reuse old passing output' : 'can verify newly completed output'}`, async t => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-cycle-budget-'));
    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-cycle-backup-'));
    t.after(() => fs.rm(workspace, { recursive: true, force: true }));
    t.after(() => fs.rm(backupRoot, { recursive: true, force: true }));
    if (previousArtifact) await fs.writeFile(path.join(workspace, 'done.txt'), 'previous cycle');
    const input = draft(workspace);
    input.trigger.type = 'interval';
    const goal = validateGoal(input, null, settings(workspace));
    goal.status = 'queued'; goal.authorized = true;
    const store = { data: { settings: settings(workspace), autonomy: { paused: false, goals: [goal] } }, save() {} };
    const runner = new GoalRunner({
      store, backupRoot, canRun: () => true, onChange() {}, onAlert() {},
      run: async () => {
        if (!previousArtifact) await fs.writeFile(path.join(workspace, 'done.txt'), 'new output');
        throw new Error('The goal token budget was reached.');
      },
    });
    await runner.execute(goal);
    assert.equal(goal.status, previousArtifact ? 'blocked' : 'queued');
    assert.equal(goal.history.some(entry => entry.kind === 'cycle-completed'), !previousArtifact);
    assert.equal(Number.isFinite(goal.lastCompletedAt), !previousArtifact);
  });
}
