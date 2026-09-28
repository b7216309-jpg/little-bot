'use strict';

const fs = require('node:fs');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function replaceOnce(file, before, after, label) {
  const source = read(file);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}

replaceOnce('src/goal-ledger.cjs',
`function recordContext(ledger, input = {}) {
  const plan = currentPlan(ledger), step = activeStep(ledger);
  return {
    at: finite(input.at) ?? Date.now(),
    source: source(input.source),
    ...(clean(input.runId, 100) ? { runId: clean(input.runId, 100) } : {}),
    ...(step?.id ? { stepId: step.id } : {}),
    ...(plan?.version ? { planVersion: plan.version } : {}),
  };
}`,
`function recordContext(ledger, input = {}) {
  const plan = currentPlan(ledger), step = activeStep(ledger);
  const explicitStepId = clean(input.stepId, 100);
  const explicitPlanVersion = Number.isInteger(input.planVersion) && input.planVersion > 0 ? input.planVersion : null;
  const stepId = explicitStepId || step?.id || '';
  const planVersion = explicitPlanVersion || plan?.version || null;
  return {
    at: finite(input.at) ?? Date.now(),
    source: source(input.source),
    ...(clean(input.runId, 100) ? { runId: clean(input.runId, 100) } : {}),
    ...(stepId ? { stepId } : {}),
    ...(planVersion ? { planVersion } : {}),
  };
}`,
'explicit record context');

replaceOnce('src/goal-ledger.cjs',
`  const context = { at: now, source: 'agent', runId };`,
`  const context = {
    at: now, source: 'agent', runId,
    stepId: stepBefore?.id || '',
    planVersion: planBefore?.version || null,
  };`,
'executed-step model context');

replaceOnce('src/goal-ledger.cjs',
`function recordVerificationEvidence(goal, results, { runId = '', phase = 'verification', now = Date.now() } = {}) {`,
`function recordVerificationEvidence(goal, results, {
  runId = '', phase = 'verification', now = Date.now(), stepId = '', planVersion = null,
} = {}) {`,
'verification context signature');

replaceOnce('src/goal-ledger.cjs',
`      at: now, source: 'verification', runId,
      text: \`${'${phase === \'preflight\' ? \'Preflight\' : \'Completion\'}'} check ${'${passed ? \'passed\' : \'failed\'}'}: ${'${label}'}${'${detail ? ` — ${detail}` : \'\'}'}\`,`,
`      at: now, source: 'verification', runId, stepId, planVersion,
      text: \`${'${phase === \'preflight\' ? \'Preflight\' : \'Completion\'}'} check ${'${passed ? \'passed\' : \'failed\'}'}: ${'${label}'}${'${detail ? ` — ${detail}` : \'\'}'}\`,`,
'verification record context');

replaceOnce('src/goal-ledger.cjs',
`function recordSnapshotEvidence(goal, snapshot, { runId = '', now = Date.now() } = {}) {`,
`function recordSnapshotEvidence(goal, snapshot, {
  runId = '', now = Date.now(), stepId = '', planVersion = null,
} = {}) {`,
'snapshot context signature');

replaceOnce('src/goal-ledger.cjs',
`    at: now, source: 'system', runId,
    text: \`Captured file evidence for this step: ${'${Number(snapshot.changes || 0)}'} changed path${'${Number(snapshot.changes || 0) === 1 ? \'\' : \'s\'}'}.\`,`,
`    at: now, source: 'system', runId, stepId, planVersion,
    text: \`Captured file evidence for this step: ${'${Number(snapshot.changes || 0)}'} changed path${'${Number(snapshot.changes || 0) === 1 ? \'\' : \'s\'}'}.\`,`,
'snapshot record context');

replaceOnce('src/goal-ledger.cjs',
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
`function completeGoalLedger(goal, summary, {
  runId = '', now = Date.now(), stepId = '', planVersion = null,
} = {}) {
  const rawPlan = currentPlan(goal.ledger);
  const unfinished = rawPlan?.steps?.some(step => ['active', 'pending'].includes(step.status)) === true;
  const ledger = normalizeGoalLedger(goal.ledger, { ...goal, status: unfinished ? 'running' : 'completed' }, now);
  const explicitStepId = clean(stepId, 100);
  const explicitPlanVersion = Number.isInteger(planVersion) && planVersion > 0 ? planVersion : null;
  let targetPlan = explicitPlanVersion ? ledger.plans.find(plan => plan.version === explicitPlanVersion) : null;
  let targetStep = explicitStepId ? targetPlan?.steps.find(step => step.id === explicitStepId) : null;
  if (!targetStep && explicitStepId) {
    for (const candidate of ledger.plans) {
      const found = candidate.steps.find(step => step.id === explicitStepId);
      if (found) { targetPlan = candidate; targetStep = found; break; }
    }
  }
  if (!targetStep) {
    targetPlan = currentPlan(ledger);
    targetStep = activeStep(ledger);
  }
  const current = currentPlan(ledger);
  for (const plan of ledger.plans) {
    for (const step of plan.steps) {
      if (targetStep && step.id === targetStep.id) {
        step.status = 'completed'; step.completedAt ||= now; step.updatedAt = now;
        step.summary = clean(summary, 2000) || step.summary || 'Goal completion was verified.';
      } else if (['active', 'pending'].includes(step.status)) {
        step.status = plan === current ? 'skipped' : 'superseded';
        step.updatedAt = now;
      }
    }
  }
  addDecision(ledger, {
    at: now, source: 'verification', runId,
    stepId: targetStep?.id || explicitStepId,
    planVersion: targetPlan?.version || explicitPlanVersion,
    text: 'Marked the goal complete.',
    rationale: clean(summary, 3000) || 'All saved completion checks passed.',
  });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}`,
'completion step context');

replaceOnce('src/goal-ledger.cjs',
`  return [...latest.values()];`,
`  return [...latest.values()].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));`,
'assumption recency ordering');

replaceOnce('src/goals.cjs',
`  normalizeGoalLedger, reconcileGoalLedger, restartGoalLedger, applyGoalLedgerUpdate,
  recordVerificationEvidence, recordSnapshotEvidence, recordGoalBlock,`,
`  normalizeGoalLedger, reconcileGoalLedger, restartGoalLedger, applyGoalLedgerUpdate,
  currentPlan, activeStep,
  recordVerificationEvidence, recordSnapshotEvidence, recordGoalBlock,`,
'goal step-context imports');

replaceOnce('src/goals.cjs',
`  async completeStoppedFiles(goal, runId, reason) {`,
`  async completeStoppedFiles(goal, runId, reason, ledgerContext = {}) {`,
'budget completion context signature');

replaceOnce('src/goals.cjs',
`    recordVerificationEvidence(goal, verification, { runId, phase: 'completion', now: Date.now() });`,
`    recordVerificationEvidence(goal, verification, {
      runId, phase: 'completion', now: Date.now(), ...ledgerContext,
    });`,
'budget completion verification context');

replaceOnce('src/goals.cjs',
`    completeGoalLedger(goal, 'Goal completed and verified after the final allowed action.', { runId, now: Date.now() });`,
`    completeGoalLedger(goal, 'Goal completed and verified after the final allowed action.', {
      runId, now: Date.now(), ...ledgerContext,
    });`,
'budget completion final context');

replaceOnce('src/goals.cjs',
`    goal.ledger = normalizeGoalLedger(goal.ledger, goal, startedAt);
    let snapshot = null, verificationActions = 0, modelUsage = { tokens: 0, actions: 0, elapsedMs: 0 }, result = null, timer;`,
`    goal.ledger = normalizeGoalLedger(goal.ledger, goal, startedAt);
    const ledgerPlanAtStart = currentPlan(goal.ledger);
    const ledgerStepAtStart = activeStep(goal.ledger);
    const ledgerRunContext = {
      stepId: ledgerStepAtStart?.id || '',
      planVersion: ledgerPlanAtStart?.version || null,
    };
    let snapshot = null, verificationActions = 0, modelUsage = { tokens: 0, actions: 0, elapsedMs: 0 }, result = null, timer;`,
'run step-context capture');

replaceOnce('src/goals.cjs',
`      recordVerificationEvidence(goal, checked.results, { runId, phase: 'preflight', now: Date.now() }); this.changed();`,
`      recordVerificationEvidence(goal, checked.results, {
        runId, phase: 'preflight', now: Date.now(), ...ledgerRunContext,
      }); this.changed();`,
'preflight step context');

replaceOnce('src/goals.cjs',
`        completeGoalLedger(goal, summary, { runId, now: Date.now() });`,
`        completeGoalLedger(goal, summary, { runId, now: Date.now(), ...ledgerRunContext });`,
'preflight completion step context');

replaceOnce('src/goals.cjs',
`        recordSnapshotEvidence(goal, snapshot, { runId, now: Date.now() });`,
`        recordSnapshotEvidence(goal, snapshot, { runId, now: Date.now(), ...ledgerRunContext });`,
'normal snapshot step context');

replaceOnce('src/goals.cjs',
`        if (await this.completeStoppedFiles(goal, runId, this.stopReason)) return;`,
`        if (await this.completeStoppedFiles(goal, runId, this.stopReason, ledgerRunContext)) return;`,
'normal budget completion context');

replaceOnce('src/goals.cjs',
`      recordVerificationEvidence(goal, checked.results, { runId, phase: 'completion', now: Date.now() });`,
`      recordVerificationEvidence(goal, checked.results, {
        runId, phase: 'completion', now: Date.now(), ...ledgerRunContext,
      });`,
'final verification step context');

replaceOnce('src/goals.cjs',
`        completeGoalLedger(goal, summary, { runId, now: Date.now() });`,
`        completeGoalLedger(goal, summary, { runId, now: Date.now(), ...ledgerRunContext });`,
'final completion step context');

replaceOnce('src/goals.cjs',
`        recordSnapshotEvidence(goal, snapshot, { runId, now: Date.now() });
        this.record(goal, 'snapshot', 'Saved file evidence after an interrupted or failed step.', { runId, snapshot });`,
`        recordSnapshotEvidence(goal, snapshot, { runId, now: Date.now(), ...ledgerRunContext });
        this.record(goal, 'snapshot', 'Saved file evidence after an interrupted or failed step.', { runId, snapshot });`,
'failed snapshot step context');

replaceOnce('src/goals.cjs',
`      if (await this.completeStoppedFiles(goal, runId, this.stopReason || clean(error))) return;`,
`      if (await this.completeStoppedFiles(goal, runId, this.stopReason || clean(error), ledgerRunContext)) return;`,
'failed budget completion context');
