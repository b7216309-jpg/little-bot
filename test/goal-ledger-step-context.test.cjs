'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeGoalLedger,
  currentPlan,
  activeStep,
  applyGoalLedgerUpdate,
  recordVerificationEvidence,
  recordSnapshotEvidence,
  completeGoalLedger,
  goalLedgerContext,
} = require('../src/goal-ledger.cjs');
const { GoalRunner, validateGoal } = require('../src/goals.cjs');

function simpleGoal(overrides = {}) {
  return {
    id: 'goal-1',
    name: 'Trace evidence',
    objective: 'Produce and verify the result.',
    steps: ['Create the draft', 'Repair failed checks'],
    nextStep: '',
    status: 'queued',
    ...overrides,
  };
}

function settings(workspace) {
  return { workspace, model: '', connection: 'codex', effort: 'low' };
}

function runnableGoal(workspace) {
  return {
    name: 'Trace evidence',
    objective: 'Create done.txt containing the word complete.',
    steps: ['Create the draft', 'Repair failed checks'],
    workspace,
    model: '',
    connection: 'codex',
    effort: 'low',
    priority: 3,
    checks: [{ type: 'fileContains', path: 'done.txt', contains: 'complete' }],
    permissions: { write: true, writePaths: ['.'], shell: false, network: false, mcpTools: [] },
    limits: { maxTokens: 50000, maxMinutes: 30, maxActions: 50, maxRuns: 10, maxRetries: 2 },
    trigger: { type: 'manual', intervalMinutes: 30, paths: [] },
    dependsOn: [],
  };
}

test('model records stay attached to the step that executed after the next step becomes active', () => {
  const goal = simpleGoal();
  goal.ledger = normalizeGoalLedger(null, goal, 1000);
  const executedPlan = currentPlan(goal.ledger);
  const executedStep = activeStep(goal.ledger);

  applyGoalLedgerUpdate(goal, {
    stepStatus: 'completed',
    stepSummary: 'Created the first draft.',
    revisionReason: '',
    revisedSteps: [],
    assumptions: [{ text: 'The workspace is writable.', status: 'confirmed' }],
    observations: [{ text: 'The draft file was created.' }],
    decisions: [{ text: 'Verify the draft now.', rationale: 'The write completed.' }],
  }, { runId: 'run-1', now: 2000, status: 'continue', summary: 'Draft created.', nextStep: 'Repair failed checks' });

  const nextStep = activeStep(goal.ledger);
  assert.notEqual(nextStep.id, executedStep.id);
  for (const record of [goal.ledger.assumptions.at(-1), goal.ledger.observations.at(-1), goal.ledger.decisions.at(-1)]) {
    assert.equal(record.stepId, executedStep.id);
    assert.equal(record.planVersion, executedPlan.version);
  }
});

test('records that cause a plan revision retain the superseded executed-step context', () => {
  const goal = simpleGoal();
  goal.ledger = normalizeGoalLedger(null, goal, 1000);
  const oldPlan = currentPlan(goal.ledger);
  const oldStep = activeStep(goal.ledger);

  applyGoalLedgerUpdate(goal, {
    stepStatus: 'continue',
    stepSummary: 'The expected source is missing.',
    revisionReason: 'Reconstruct the source before drafting.',
    revisedSteps: ['Reconstruct the source', 'Create the draft', 'Verify the result'],
    assumptions: [],
    observations: [{ text: 'The expected source file is absent.' }],
    decisions: [{ text: 'Reconstruct the source.', rationale: 'Drafting now would use incomplete evidence.' }],
  }, { runId: 'run-2', now: 2000, status: 'continue', summary: 'Source missing.' });

  assert.equal(currentPlan(goal.ledger).version, oldPlan.version + 1);
  assert.equal(goal.ledger.observations.at(-1).stepId, oldStep.id);
  assert.equal(goal.ledger.observations.at(-1).planVersion, oldPlan.version);
  assert.equal(goal.ledger.decisions.at(-2).stepId, oldStep.id);
  assert.equal(goal.ledger.decisions.at(-2).planVersion, oldPlan.version);
  assert.equal(goal.ledger.decisions.at(-1).stepId, oldStep.id);
  assert.equal(goal.ledger.decisions.at(-1).planVersion, oldPlan.version);
});

test('host evidence and completion can explicitly target the executed step after plan advancement', () => {
  const goal = simpleGoal();
  goal.ledger = normalizeGoalLedger(null, goal, 1000);
  const plan = currentPlan(goal.ledger);
  const executed = activeStep(goal.ledger);

  applyGoalLedgerUpdate(goal, {
    stepStatus: 'completed', stepSummary: 'Drafted.', revisionReason: '', revisedSteps: [],
    assumptions: [], observations: [], decisions: [],
  }, { runId: 'run-3', now: 2000, status: 'verify', summary: 'Drafted.' });
  const future = activeStep(goal.ledger);

  recordSnapshotEvidence(goal, { changes: 1, fileCount: 1, bytes: 12 }, {
    runId: 'run-3', now: 2100, stepId: executed.id, planVersion: plan.version,
  });
  recordVerificationEvidence(goal, [{ type: 'fileContains', path: 'done.txt', passed: true, detail: 'Found complete.' }], {
    runId: 'run-3', phase: 'completion', now: 2200, stepId: executed.id, planVersion: plan.version,
  });
  goal.status = 'completed';
  completeGoalLedger(goal, 'All saved checks passed.', {
    runId: 'run-3', now: 2300, stepId: executed.id, planVersion: plan.version,
  });

  const executedAfter = goal.ledger.plans.find(item => item.version === plan.version).steps.find(item => item.id === executed.id);
  const futureAfter = goal.ledger.plans.find(item => item.version === plan.version).steps.find(item => item.id === future.id);
  assert.equal(executedAfter.status, 'completed');
  assert.equal(executedAfter.summary, 'All saved checks passed.');
  assert.equal(futureAfter.status, 'skipped');
  assert.equal(activeStep(goal.ledger), null);
  for (const record of goal.ledger.observations.slice(-2)) {
    assert.equal(record.stepId, executed.id);
    assert.equal(record.planVersion, plan.version);
  }
  const completion = goal.ledger.decisions.at(-1);
  assert.equal(completion.stepId, executed.id);
  assert.equal(completion.planVersion, plan.version);
});

test('bounded model context keeps the most recently updated assumption statuses', () => {
  const goal = simpleGoal();
  const assumptions = [{ id: 'early', at: 1, text: 'Important late update', status: 'open', source: 'agent' }];
  for (let index = 0; index < 24; index++) {
    assumptions.push({ id: `middle-${index}`, at: index + 2, text: `Assumption ${index}`, status: 'open', source: 'agent' });
  }
  assumptions.push({ id: 'late', at: 100, text: 'Important late update', status: 'confirmed', source: 'verification' });
  goal.ledger = normalizeGoalLedger({
    plans: [{ version: 1, steps: [{ id: 'step-1', text: 'Create the draft', status: 'active' }] }],
    assumptions,
  }, goal, 1000);

  const context = goalLedgerContext(goal.ledger, goal);
  assert.equal(context.assumptions.length, 20);
  assert.ok(context.assumptions.some(item => item.text === 'Important late update' && item.status === 'confirmed'));
  assert.equal(context.assumptions.at(-1).text, 'Important late update');
});

test('the real GoalRunner assigns model, snapshot, and final verification evidence to the executed step', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-ledger-step-context-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const goal = validateGoal(runnableGoal(workspace), null, settings(workspace));
  goal.status = 'queued';
  goal.authorized = true;
  goal.nextRunAt = Date.now();
  const executedStep = activeStep(goal.ledger);
  const futureStep = currentPlan(goal.ledger).steps.find(step => step.id !== executedStep.id);
  const store = {
    data: { settings: settings(workspace), autonomy: { paused: false, goals: [goal] } },
    save() {},
  };
  const runner = new GoalRunner({
    store,
    backupRoot: path.join(workspace, '.backups'),
    canRun: () => true,
    onChange() {},
    onAlert() {},
    verifyCommand: async () => ({ passed: false, detail: 'unused' }),
    run: async () => {
      await fs.writeFile(path.join(workspace, 'done.txt'), 'draft');
      return {
        status: 'verify',
        summary: 'Created an incomplete draft.',
        checkpoint: 'done.txt exists but is incomplete.',
        nextStep: 'Repair failed checks',
        ledger: {
          stepStatus: 'completed',
          stepSummary: 'Created the first draft.',
          revisionReason: '',
          revisedSteps: [],
          assumptions: [{ text: 'The file is writable.', status: 'confirmed' }],
          observations: [{ text: 'done.txt contains only draft text.' }],
          decisions: [{ text: 'Repair the content next.', rationale: 'The required word is absent.' }],
        },
        usage: { tokens: 20, actions: 1, elapsedMs: 10 },
        actions: ['Wrote done.txt'],
      };
    },
  });

  await runner.tick();
  assert.equal(goal.status, 'queued');
  assert.equal(activeStep(goal.ledger).id, futureStep.id);
  const runRecords = [
    ...goal.ledger.assumptions.filter(item => item.runId),
    ...goal.ledger.observations.filter(item => item.runId),
    ...goal.ledger.decisions.filter(item => item.runId),
  ];
  assert.ok(runRecords.some(item => item.source === 'agent'));
  assert.ok(runRecords.some(item => item.evidence?.type === 'snapshot'));
  assert.ok(runRecords.some(item => item.evidence?.type === 'completion' && item.evidence.passed === false));
  assert.ok(runRecords.every(item => item.stepId === executedStep.id));
  assert.ok(runRecords.every(item => item.planVersion === 1));
  assert.ok(!runRecords.some(item => item.stepId === futureStep.id));
});
