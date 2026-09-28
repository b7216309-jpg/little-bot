'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_PLAN_VERSIONS,
  MAX_OBSERVATIONS,
  normalizeGoalLedger,
  reconcileGoalLedger,
  currentPlan,
  activeStep,
  revisePlan,
  applyGoalLedgerUpdate,
  recordVerificationEvidence,
  recordSnapshotEvidence,
  recordGoalBlock,
  completeGoalLedger,
  recoverGoalLedger,
  goalLedgerContext,
  normalizeExecutorLedgerUpdate,
} = require('../src/goal-ledger.cjs');

function goal(overrides = {}) {
  return {
    id: 'goal-1',
    objective: 'Prepare and verify the weekly report.',
    steps: ['Read the source data', 'Write the report', 'Verify the output'],
    nextStep: '',
    status: 'queued',
    ...overrides,
  };
}

function activeCount(ledger) {
  return currentPlan(ledger).steps.filter(step => step.status === 'active').length;
}

test('creates a sequential initial plan with exactly one active step', () => {
  const ledger = normalizeGoalLedger(null, goal(), 1000);
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(currentPlan(ledger).version, 1);
  assert.deepEqual(currentPlan(ledger).steps.map(step => step.status), ['active', 'pending', 'pending']);
  assert.equal(activeStep(ledger).text, 'Read the source data');
  assert.equal(activeCount(ledger), 1);
});

test('repairs malformed persisted plans without allowing parallel active steps', () => {
  const ledger = normalizeGoalLedger({
    plans: [{ version: 4, steps: [
      { id: 'a', text: 'First', status: 'active' },
      { id: 'b', text: 'Second', status: 'active' },
      { id: 'c', text: 'Third', status: 'pending' },
    ] }],
  }, goal({ steps: [] }), 2000);
  assert.equal(currentPlan(ledger).version, 4);
  assert.equal(activeCount(ledger), 1);
  assert.deepEqual(currentPlan(ledger).steps.map(step => step.status), ['active', 'pending', 'pending']);
});

test('revising a plan archives remaining old work and increments the version', () => {
  const ledger = normalizeGoalLedger(null, goal(), 1000);
  revisePlan(ledger, ['Inspect the corrected data', 'Rebuild the report'], {
    now: 2000, source: 'agent', reason: 'The source format changed.', runId: 'run-1', goal: goal(),
  });
  assert.equal(ledger.plans.length, 2);
  assert.equal(ledger.plans[0].steps[0].status, 'superseded');
  assert.equal(ledger.plans[0].steps[1].status, 'superseded');
  assert.equal(currentPlan(ledger).version, 2);
  assert.equal(activeStep(ledger).text, 'Inspect the corrected data');
  assert.equal(activeCount(ledger), 1);
});

test('executor updates advance only one step and persist assumptions, observations, and decisions', () => {
  const value = goal();
  value.ledger = normalizeGoalLedger(null, value, 1000);
  const update = applyGoalLedgerUpdate(value, {
    stepStatus: 'completed',
    stepSummary: 'Read all source rows.',
    revisionReason: '',
    revisedSteps: [],
    assumptions: [{ text: 'The source file uses UTF-8.', status: 'confirmed' }],
    observations: [{ text: 'The source contains 42 rows.' }],
    decisions: [{ text: 'Use the latest dated row.', rationale: 'It is the only complete period.' }],
  }, { runId: 'run-1', now: 2000, status: 'continue', summary: 'Source inspected.', nextStep: 'Write the report' });
  assert.equal(update.stepStatus, 'completed');
  assert.deepEqual(currentPlan(value.ledger).steps.map(step => step.status), ['completed', 'active', 'pending']);
  assert.equal(activeStep(value.ledger).text, 'Write the report');
  assert.equal(value.ledger.assumptions.at(-1).status, 'confirmed');
  assert.equal(value.ledger.observations.at(-1).runId, 'run-1');
  assert.equal(value.ledger.decisions.at(-1).rationale, 'It is the only complete period.');
  assert.equal(activeCount(value.ledger), 1);
});

test('an executor plan revision replaces stale remaining work instead of activating it in parallel', () => {
  const value = goal();
  value.ledger = normalizeGoalLedger(null, value, 1000);
  applyGoalLedgerUpdate(value, {
    stepStatus: 'continue', stepSummary: 'The input is incomplete.',
    revisionReason: 'A missing source must be reconstructed first.',
    revisedSteps: ['Reconstruct the missing source', 'Write the report', 'Verify the output'],
    assumptions: [], observations: [{ text: 'One source file is missing.' }],
    decisions: [{ text: 'Reconstruct before writing.', rationale: 'Writing now would produce an incomplete report.' }],
  }, { runId: 'run-2', now: 3000, status: 'continue', summary: 'Input incomplete.' });
  assert.equal(currentPlan(value.ledger).version, 2);
  assert.equal(activeStep(value.ledger).text, 'Reconstruct the missing source');
  assert.equal(activeCount(value.ledger), 1);
  assert.ok(value.ledger.plans[0].steps.every(step => !['active', 'pending'].includes(step.status)));
});

test('verification and file snapshots become inspectable evidence', () => {
  const value = goal();
  value.ledger = normalizeGoalLedger(null, value, 1000);
  recordVerificationEvidence(value, [
    { type: 'fileExists', path: 'report.md', passed: true, detail: 'Found report.md' },
    { type: 'fileContains', path: 'report.md', passed: false, detail: 'Missing totals' },
  ], { runId: 'run-3', phase: 'completion', now: 4000 });
  recordSnapshotEvidence(value, { changes: 2, fileCount: 3, bytes: 1200 }, { runId: 'run-3', now: 4001 });
  assert.equal(value.ledger.observations.length, 3);
  assert.equal(value.ledger.observations[0].evidence.passed, true);
  assert.equal(value.ledger.observations[1].evidence.passed, false);
  assert.equal(value.ledger.observations[2].evidence.type, 'snapshot');
  assert.equal(value.ledger.observations[2].evidence.changes, 2);
});

test('blocked and recovered goals keep a single resumable active step', () => {
  const value = goal({ status: 'blocked' });
  value.ledger = normalizeGoalLedger(null, value, 1000);
  recordGoalBlock(value, 'Need the reporting period.', { runId: 'run-4', now: 5000 });
  recoverGoalLedger(value, 'The previous run ended while waiting for input.', { now: 6000 });
  assert.equal(activeCount(value.ledger), 1);
  assert.match(activeStep(value.ledger).summary, /reporting period/);
  assert.match(value.ledger.decisions.at(-1).rationale, /reporting period/);
  assert.match(value.ledger.observations.at(-1).text, /waiting for input/);
});

test('completion closes the active step and skips unused future steps', () => {
  const value = goal({ status: 'completed' });
  value.ledger = normalizeGoalLedger(null, goal(), 1000);
  completeGoalLedger(value, 'All completion checks passed.', { runId: 'run-5', now: 7000 });
  assert.equal(activeStep(value.ledger), null);
  assert.equal(currentPlan(value.ledger).steps[0].status, 'completed');
  assert.deepEqual(currentPlan(value.ledger).steps.slice(1).map(step => step.status), ['skipped', 'skipped']);
  assert.equal(value.ledger.decisions.at(-1).source, 'verification');
});

test('editing the saved goal creates a user-authored plan version only when the definition changes', () => {
  const previous = goal();
  const ledger = normalizeGoalLedger(null, previous, 1000);
  const unchanged = reconcileGoalLedger(ledger, previous, { ...previous }, 2000);
  assert.equal(unchanged.plans.length, 1);
  const changed = reconcileGoalLedger(unchanged, previous, { ...previous, steps: ['Collect evidence', 'Draft', 'Verify'] }, 3000);
  assert.equal(changed.plans.length, 2);
  assert.equal(currentPlan(changed).source, 'user');
  assert.equal(activeStep(changed).text, 'Collect evidence');
  assert.equal(changed.decisions.at(-1).source, 'user');
});

test('ledger context is bounded to the current plan and concise public records', () => {
  const value = goal();
  value.ledger = normalizeGoalLedger(null, value, 1000);
  for (let index = 0; index < MAX_OBSERVATIONS + 10; index++) {
    value.ledger.observations.push({ id: `o-${index}`, at: index, text: `Observation ${index}`, source: 'agent' });
  }
  value.ledger = normalizeGoalLedger(value.ledger, value, 2000);
  const context = goalLedgerContext(value.ledger, value);
  assert.equal(context.planVersion, 1);
  assert.equal(context.recentObservations.length, 20);
  assert.equal(context.recentObservations.at(-1).text, `Observation ${MAX_OBSERVATIONS + 9}`);
  assert.equal(context.activeStep.text, 'Read the source data');
});

test('normalization bounds old plan versions and malformed executor output fails closed to a safe update', () => {
  const plans = [];
  for (let version = 1; version <= MAX_PLAN_VERSIONS + 5; version++) {
    plans.push({ version, steps: [{ id: `s-${version}`, text: `Step ${version}`, status: 'active' }] });
  }
  const ledger = normalizeGoalLedger({ plans }, goal({ steps: [] }), 1000);
  assert.equal(ledger.plans.length, MAX_PLAN_VERSIONS);
  assert.equal(currentPlan(ledger).version, MAX_PLAN_VERSIONS + 5);
  assert.equal(activeCount(ledger), 1);
  const update = normalizeExecutorLedgerUpdate({ stepStatus: 'invalid', revisedSteps: 'wrong', assumptions: [{}] }, { status: 'blocked', summary: 'Need input.' });
  assert.equal(update.stepStatus, 'blocked');
  assert.equal(update.stepSummary, 'Need input.');
  assert.deepEqual(update.revisedSteps, []);
  assert.deepEqual(update.assumptions, []);
});
