'use strict';

const { randomUUID } = require('node:crypto');

const LEDGER_SCHEMA_VERSION = 1;
const MAX_PLAN_VERSIONS = 20;
const MAX_PLAN_STEPS = 20;
const MAX_ASSUMPTIONS = 100;
const MAX_OBSERVATIONS = 150;
const MAX_DECISIONS = 100;
const MAX_RUN_ITEMS = 12;
const STEP_STATUSES = Object.freeze(['pending', 'active', 'completed', 'skipped', 'superseded']);
const ASSUMPTION_STATUSES = Object.freeze(['open', 'confirmed', 'rejected', 'superseded']);
const RECORD_SOURCES = Object.freeze(['user', 'agent', 'system', 'verification', 'migration']);
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => Number.isFinite(value) && value >= 0 ? value : null;

function clean(value, maximum = 2000) {
  return typeof value === 'string' ? value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/(\bBearer\s+)[^\s"',}]+/gi, '$1[redacted]')
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim().slice(0, maximum) : '';
}

function source(value, fallback = 'system') {
  return RECORD_SOURCES.includes(value) ? value : fallback;
}

function identifier(value) {
  return typeof value === 'string' && ID.test(value) ? value : randomUUID();
}

function uniqueTexts(value, maximum = MAX_PLAN_STEPS) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(), result = [];
  for (const item of value) {
    const text = clean(item, 1000);
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key); result.push(text);
    if (result.length >= maximum) break;
  }
  return result;
}

function fallbackStep(goal = {}) {
  return clean(goal.nextStep, 1000) || clean(goal.objective, 1000) || 'Establish and complete the next verifiable step.';
}

function definitionSteps(goal = {}) {
  return uniqueTexts(goal.steps).length ? uniqueTexts(goal.steps) : [fallbackStep(goal)];
}

function normalizeEvidence(value) {
  if (!object(value)) return null;
  const result = {};
  for (const key of ['type', 'checkType']) {
    const text = clean(value[key], 60);
    if (text) result[key] = text;
  }
  for (const key of ['path', 'detail']) {
    const text = clean(value[key], key === 'path' ? 500 : 2000);
    if (text) result[key] = text;
  }
  if (typeof value.passed === 'boolean') result.passed = value.passed;
  for (const key of ['changes', 'fileCount', 'bytes']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  }
  return Object.keys(result).length ? result : null;
}

function createPlan(version, texts, { now = Date.now(), source: planSource = 'system', reason = 'Initial goal plan.', runId = '', completed = false } = {}) {
  const steps = uniqueTexts(texts);
  const actual = steps.length ? steps : ['Establish and complete the next verifiable step.'];
  return {
    version,
    createdAt: now,
    source: source(planSource),
    reason: clean(reason, 1000) || 'Plan created.',
    ...(clean(runId, 100) ? { runId: clean(runId, 100) } : {}),
    steps: actual.map((text, index) => ({
      id: randomUUID(), text,
      status: completed ? 'completed' : index === 0 ? 'active' : 'pending',
      createdAt: now,
      ...(completed ? { completedAt: now, summary: 'Goal was already completed when this ledger was created.' } : index === 0 ? { activatedAt: now } : {}),
    })),
  };
}

function normalizeStep(value, now) {
  if (!object(value)) return null;
  const text = clean(value.text, 1000);
  if (!text) return null;
  const status = STEP_STATUSES.includes(value.status) ? value.status : 'pending';
  const step = {
    id: identifier(value.id), text, status,
    createdAt: finite(value.createdAt) ?? now,
  };
  for (const key of ['activatedAt', 'completedAt', 'updatedAt']) {
    const at = finite(value[key]);
    if (at !== null) step[key] = at;
  }
  const summary = clean(value.summary, 2000);
  if (summary) step.summary = summary;
  const runId = clean(value.runId, 100);
  if (runId) step.runId = runId;
  return step;
}

function normalizePlan(value, fallbackVersion, now) {
  if (!object(value)) return null;
  const steps = (Array.isArray(value.steps) ? value.steps : []).map(item => normalizeStep(item, now)).filter(Boolean).slice(0, MAX_PLAN_STEPS);
  if (!steps.length) return null;
  const version = Number.isInteger(value.version) && value.version > 0 ? value.version : fallbackVersion;
  const result = {
    version,
    createdAt: finite(value.createdAt) ?? now,
    source: source(value.source),
    reason: clean(value.reason, 1000) || 'Plan restored.',
    steps,
  };
  const runId = clean(value.runId, 100);
  if (runId) result.runId = runId;
  return result;
}

function normalizeAssumption(value, now) {
  if (!object(value)) return null;
  const text = clean(value.text, 2000);
  if (!text) return null;
  const result = {
    id: identifier(value.id), at: finite(value.at) ?? now, text,
    status: ASSUMPTION_STATUSES.includes(value.status) ? value.status : 'open',
    source: source(value.source),
  };
  for (const key of ['runId', 'stepId']) {
    const item = clean(value[key], 100);
    if (item) result[key] = item;
  }
  if (Number.isInteger(value.planVersion) && value.planVersion > 0) result.planVersion = value.planVersion;
  const supersedesId = clean(value.supersedesId, 100);
  if (supersedesId) result.supersedesId = supersedesId;
  return result;
}

function normalizeObservation(value, now) {
  if (!object(value)) return null;
  const text = clean(value.text, 3000);
  if (!text) return null;
  const result = { id: identifier(value.id), at: finite(value.at) ?? now, text, source: source(value.source) };
  for (const key of ['runId', 'stepId']) {
    const item = clean(value[key], 100);
    if (item) result[key] = item;
  }
  if (Number.isInteger(value.planVersion) && value.planVersion > 0) result.planVersion = value.planVersion;
  const evidence = normalizeEvidence(value.evidence);
  if (evidence) result.evidence = evidence;
  return result;
}

function normalizeDecision(value, now) {
  if (!object(value)) return null;
  const text = clean(value.text, 2000);
  if (!text) return null;
  const result = { id: identifier(value.id), at: finite(value.at) ?? now, text, source: source(value.source) };
  const rationale = clean(value.rationale, 3000);
  if (rationale) result.rationale = rationale;
  for (const key of ['runId', 'stepId']) {
    const item = clean(value[key], 100);
    if (item) result[key] = item;
  }
  if (Number.isInteger(value.planVersion) && value.planVersion > 0) result.planVersion = value.planVersion;
  return result;
}

function currentPlan(ledger) {
  return Array.isArray(ledger?.plans) && ledger.plans.length ? ledger.plans[ledger.plans.length - 1] : null;
}

function activeStep(ledger) {
  return currentPlan(ledger)?.steps.find(step => step.status === 'active') || null;
}

function repairCurrentPlan(ledger, goal, now) {
  const plan = currentPlan(ledger);
  if (!plan) return;
  for (const archived of ledger.plans.slice(0, -1)) {
    for (const step of archived.steps) if (['active', 'pending'].includes(step.status)) step.status = 'superseded';
  }
  if (goal?.status === 'completed') {
    for (const step of plan.steps) {
      if (step.status === 'active') {
        step.status = 'completed'; step.completedAt ||= now;
        step.summary ||= 'Goal completion was verified.';
      } else if (step.status === 'pending') step.status = 'skipped';
    }
    return;
  }
  const active = plan.steps.filter(step => step.status === 'active');
  if (active.length > 1) for (const step of active.slice(1)) step.status = 'pending';
  if (!active.length) {
    const pending = plan.steps.find(step => step.status === 'pending');
    if (pending) {
      pending.status = 'active'; pending.activatedAt ||= now;
    } else if (plan.steps.length < MAX_PLAN_STEPS) {
      plan.steps.push({ id: randomUUID(), text: fallbackStep(goal), status: 'active', createdAt: now, activatedAt: now });
    } else {
      const version = Math.max(0, ...ledger.plans.map(item => item.version)) + 1;
      ledger.plans.push(createPlan(version, [fallbackStep(goal)], {
        now, source: 'system', reason: 'Added a fresh step because the prior plan had no remaining work.',
      }));
      ledger.plans = ledger.plans.slice(-MAX_PLAN_VERSIONS);
      ledger.updatedAt = now;
    }
  }
}

function normalizeGoalLedger(value, goal = {}, now = Date.now()) {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('A valid ledger timestamp is required.');
  const inputPlans = Array.isArray(value?.plans) ? value.plans : [];
  const plans = [];
  const versions = new Set();
  for (const input of inputPlans) {
    const plan = normalizePlan(input, plans.length + 1, now);
    if (!plan || versions.has(plan.version)) continue;
    versions.add(plan.version); plans.push(plan);
  }
  plans.sort((left, right) => left.version - right.version || left.createdAt - right.createdAt);
  const keptPlans = plans.slice(-MAX_PLAN_VERSIONS);
  if (!keptPlans.length) keptPlans.push(createPlan(1, definitionSteps(goal), {
    now,
    source: value ? 'migration' : 'system',
    reason: value ? 'Migrated the goal into the plan and evidence ledger.' : 'Initial goal plan.',
    completed: goal?.status === 'completed',
  }));
  const ledger = {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    createdAt: finite(value?.createdAt) ?? now,
    updatedAt: finite(value?.updatedAt) ?? now,
    plans: keptPlans,
    assumptions: (Array.isArray(value?.assumptions) ? value.assumptions : []).map(item => normalizeAssumption(item, now)).filter(Boolean).slice(-MAX_ASSUMPTIONS),
    observations: (Array.isArray(value?.observations) ? value.observations : []).map(item => normalizeObservation(item, now)).filter(Boolean).slice(-MAX_OBSERVATIONS),
    decisions: (Array.isArray(value?.decisions) ? value.decisions : []).map(item => normalizeDecision(item, now)).filter(Boolean).slice(-MAX_DECISIONS),
  };
  repairCurrentPlan(ledger, goal, now);
  return ledger;
}

function recordContext(ledger, input = {}) {
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
}

function addAssumption(ledger, input = {}) {
  const text = clean(input.text, 2000);
  if (!text) return null;
  const status = ASSUMPTION_STATUSES.includes(input.status) ? input.status : 'open';
  const key = text.toLocaleLowerCase().replace(/\s+/g, ' ');
  const previous = [...ledger.assumptions].reverse().find(item => item.text.toLocaleLowerCase().replace(/\s+/g, ' ') === key);
  if (previous?.status === status) return previous;
  const item = normalizeAssumption({ ...recordContext(ledger, input), id: randomUUID(), text, status,
    ...(previous ? { supersedesId: previous.id } : {}) }, Date.now());
  ledger.assumptions.push(item);
  ledger.assumptions = ledger.assumptions.slice(-MAX_ASSUMPTIONS);
  return item;
}

function addObservation(ledger, input = {}) {
  const item = normalizeObservation({ ...recordContext(ledger, input), id: randomUUID(), text: input.text, evidence: input.evidence }, Date.now());
  if (!item) return null;
  const duplicate = ledger.observations.find(entry => entry.runId === item.runId && entry.stepId === item.stepId && entry.text === item.text);
  if (duplicate) return duplicate;
  ledger.observations.push(item);
  ledger.observations = ledger.observations.slice(-MAX_OBSERVATIONS);
  return item;
}

function addDecision(ledger, input = {}) {
  const item = normalizeDecision({ ...recordContext(ledger, input), id: randomUUID(), text: input.text, rationale: input.rationale }, Date.now());
  if (!item) return null;
  const duplicate = ledger.decisions.find(entry => entry.runId === item.runId && entry.stepId === item.stepId && entry.text === item.text && entry.rationale === item.rationale);
  if (duplicate) return duplicate;
  ledger.decisions.push(item);
  ledger.decisions = ledger.decisions.slice(-MAX_DECISIONS);
  return item;
}

function revisePlan(ledger, steps, { now = Date.now(), source: planSource = 'agent', reason = 'Plan revised.', runId = '', goal = {}, force = false } = {}) {
  const texts = uniqueTexts(steps);
  if (!texts.length) return currentPlan(ledger);
  const current = currentPlan(ledger);
  if (!force && current && JSON.stringify(current.steps.map(step => step.text)) === JSON.stringify(texts)) return current;
  if (current) for (const step of current.steps) if (['active', 'pending'].includes(step.status)) step.status = 'superseded';
  const version = Math.max(0, ...ledger.plans.map(plan => plan.version)) + 1;
  const plan = createPlan(version, texts, { now, source: planSource, reason, runId, completed: goal?.status === 'completed' });
  ledger.plans.push(plan);
  ledger.plans = ledger.plans.slice(-MAX_PLAN_VERSIONS);
  ledger.updatedAt = now;
  return plan;
}

function reconcileGoalLedger(value, previousGoal, nextGoal, now = Date.now()) {
  const ledger = normalizeGoalLedger(value, previousGoal || nextGoal, now);
  if (!previousGoal) return normalizeGoalLedger(ledger, nextGoal, now);
  const changed = clean(previousGoal.objective, 12000) !== clean(nextGoal.objective, 12000)
    || JSON.stringify(uniqueTexts(previousGoal.steps)) !== JSON.stringify(uniqueTexts(nextGoal.steps));
  const reopened = previousGoal.status === 'completed' && nextGoal.status !== 'completed';
  if (changed || reopened) {
    const reason = reopened && !changed ? 'The completed goal was reopened by the user.' : 'Goal definition updated by the user.';
    revisePlan(ledger, definitionSteps(nextGoal), { now, source: 'user', reason, goal: nextGoal, force: true });
    addDecision(ledger, { at: now, source: 'user', text: reopened ? 'Reopened the goal with a fresh plan version.' : 'Revised the goal plan.',
      rationale: changed ? 'The saved objective or suggested steps changed.' : 'The completed goal was prepared for another run.' });
  }
  repairCurrentPlan(ledger, nextGoal, now);
  ledger.updatedAt = now;
  return ledger;
}

function restartGoalLedger(goal, { now = Date.now(), source: recordSource = 'user' } = {}) {
  const ledger = normalizeGoalLedger(goal.ledger, { ...goal, status: 'completed' }, now);
  revisePlan(ledger, definitionSteps(goal), {
    now, source: recordSource, reason: 'Started a new run after verified completion.',
    goal: { ...goal, status: 'queued' }, force: true,
  });
  addDecision(ledger, { at: now, source: recordSource, text: 'Started a new plan version for another run.',
    rationale: 'The previous plan ended in verified completion.' });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}

function normalizeExecutorLedgerUpdate(value, { status = 'continue', summary = '' } = {}) {
  const input = object(value) ? value : {};
  const stepStatus = status === 'blocked' ? 'blocked' : status === 'verify' ? 'completed'
    : ['continue', 'completed', 'blocked'].includes(input.stepStatus) ? input.stepStatus : 'continue';
  const assumptions = (Array.isArray(input.assumptions) ? input.assumptions : []).filter(object).slice(0, MAX_RUN_ITEMS).map(item => ({
    text: clean(item.text, 2000),
    status: ['open', 'confirmed', 'rejected'].includes(item.status) ? item.status : 'open',
  })).filter(item => item.text);
  const observations = (Array.isArray(input.observations) ? input.observations : []).filter(object).slice(0, MAX_RUN_ITEMS)
    .map(item => ({ text: clean(item.text, 3000) })).filter(item => item.text);
  const decisions = (Array.isArray(input.decisions) ? input.decisions : []).filter(object).slice(0, MAX_RUN_ITEMS).map(item => ({
    text: clean(item.text, 2000), rationale: clean(item.rationale, 3000),
  })).filter(item => item.text);
  return {
    stepStatus,
    stepSummary: clean(input.stepSummary, 2000) || clean(summary, 2000),
    revisionReason: clean(input.revisionReason, 1000),
    revisedSteps: uniqueTexts(input.revisedSteps),
    assumptions, observations, decisions,
  };
}

function activateNext(plan, now) {
  const next = plan?.steps.find(step => step.status === 'pending');
  if (!next) return null;
  next.status = 'active'; next.activatedAt ||= now; next.updatedAt = now;
  return next;
}

function applyGoalLedgerUpdate(goal, value, { runId = '', now = Date.now(), status = 'continue', summary = '', nextStep = '' } = {}) {
  const ledger = normalizeGoalLedger(goal.ledger, goal, now);
  const update = normalizeExecutorLedgerUpdate(value, { status, summary });
  const planBefore = currentPlan(ledger), stepBefore = activeStep(ledger);
  if (stepBefore) {
    stepBefore.updatedAt = now;
    stepBefore.runId = clean(runId, 100) || stepBefore.runId;
    if (update.stepSummary) stepBefore.summary = update.stepSummary;
    if (update.stepStatus === 'completed') {
      stepBefore.status = 'completed'; stepBefore.completedAt = now;
    }
  }
  const context = {
    at: now, source: 'agent', runId,
    stepId: stepBefore?.id || '',
    planVersion: planBefore?.version || null,
  };
  for (const item of update.assumptions) addAssumption(ledger, { ...context, ...item });
  for (const item of update.observations) addObservation(ledger, { ...context, ...item });
  for (const item of update.decisions) addDecision(ledger, { ...context, ...item });
  if (update.revisedSteps.length) {
    const reason = update.revisionReason || 'New evidence changed the remaining plan.';
    revisePlan(ledger, update.revisedSteps, { now, source: 'agent', reason, runId, goal });
    addDecision(ledger, { ...context, text: 'Revised the remaining plan.', rationale: reason });
  } else if (update.stepStatus === 'completed') {
    const activated = activateNext(planBefore, now);
    if (!activated && goal.status !== 'completed' && clean(nextStep, 1000)) {
      revisePlan(ledger, [clean(nextStep, 1000)], { now, source: 'system', reason: 'Added the next verifiable step after completing the previous plan.', runId, goal });
    }
  }
  repairCurrentPlan(ledger, goal, now);
  ledger.updatedAt = now;
  goal.ledger = ledger;
  return update;
}

function recordVerificationEvidence(goal, results, {
  runId = '', phase = 'verification', now = Date.now(), stepId = '', planVersion = null,
} = {}) {
  const ledger = normalizeGoalLedger(goal.ledger, goal, now);
  for (const result of (Array.isArray(results) ? results : []).slice(0, MAX_PLAN_STEPS)) {
    const passed = result?.passed === true;
    const label = clean(result?.path, 500) || clean(result?.type, 60) || 'completion check';
    const detail = clean(result?.detail, 2000);
    addObservation(ledger, {
      at: now, source: 'verification', runId, stepId, planVersion,
      text: `${phase === 'preflight' ? 'Preflight' : 'Completion'} check ${passed ? 'passed' : 'failed'}: ${label}${detail ? ` — ${detail}` : ''}`,
      evidence: { type: phase, checkType: result?.type, path: result?.path, passed, detail },
    });
  }
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}

function recordSnapshotEvidence(goal, snapshot, {
  runId = '', now = Date.now(), stepId = '', planVersion = null,
} = {}) {
  if (!object(snapshot)) return goal.ledger;
  const ledger = normalizeGoalLedger(goal.ledger, goal, now);
  addObservation(ledger, {
    at: now, source: 'system', runId, stepId, planVersion,
    text: `Captured file evidence for this step: ${Number(snapshot.changes || 0)} changed path${Number(snapshot.changes || 0) === 1 ? '' : 's'}.`,
    evidence: { type: 'snapshot', changes: snapshot.changes, fileCount: snapshot.fileCount, bytes: snapshot.bytes },
  });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}

function recordGoalBlock(goal, reason, { runId = '', now = Date.now(), source: recordSource = 'system' } = {}) {
  const ledger = normalizeGoalLedger(goal.ledger, goal, now);
  const step = activeStep(ledger);
  if (step) { step.summary = clean(reason, 2000); step.updatedAt = now; }
  addDecision(ledger, { at: now, source: recordSource, runId, text: 'Paused the active plan step at a blocker.', rationale: clean(reason, 3000) });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}

function recordGoalPause(goal, reason, { now = Date.now(), source: recordSource = 'user' } = {}) {
  const ledger = normalizeGoalLedger(goal.ledger, goal, now);
  addDecision(ledger, { at: now, source: recordSource, text: 'Paused the goal.', rationale: clean(reason, 3000) || 'Paused by the user.' });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}

function recordGoalRestore(goal, result, { runId = '', now = Date.now() } = {}) {
  const ledger = normalizeGoalLedger(goal.ledger, goal, now);
  const restored = Number.isSafeInteger(result?.restored) && result.restored >= 0 ? result.restored : 0;
  addObservation(ledger, {
    at: now, source: 'system', runId,
    text: `Restored ${restored} path${restored === 1 ? '' : 's'} from saved file evidence.`,
    evidence: { type: 'restore', changes: restored },
  });
  addDecision(ledger, { at: now, source: 'user', runId, text: 'Applied Review undo.',
    rationale: `Restored ${restored} path${restored === 1 ? '' : 's'} from the selected run.` });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}

function recordUserAnswer(goal, question, answer, { now = Date.now() } = {}) {
  const ledger = normalizeGoalLedger(goal.ledger, goal, now);
  addDecision(ledger, { at: now, source: 'user', text: `Answered: ${clean(question, 1000)}`, rationale: clean(answer, 3000) });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}

function completeGoalLedger(goal, summary, {
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
}

function recoverGoalLedger(goal, summary, { now = Date.now() } = {}) {
  const ledger = normalizeGoalLedger(goal.ledger, goal, now);
  addObservation(ledger, { at: now, source: 'system', text: clean(summary, 3000) || 'Execution was interrupted; verify existing results before continuing.' });
  ledger.updatedAt = now; goal.ledger = ledger; return ledger;
}

function latestAssumptions(ledger) {
  const latest = new Map();
  for (const item of ledger.assumptions || []) latest.set(item.text.toLocaleLowerCase().replace(/\s+/g, ' '), item);
  return [...latest.values()].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
}

function goalLedgerContext(value, goal = {}) {
  const ledger = normalizeGoalLedger(value, goal, Date.now());
  const plan = currentPlan(ledger), active = activeStep(ledger);
  return {
    planVersion: plan?.version || 1,
    planReason: plan?.reason || '',
    steps: (plan?.steps || []).map(step => ({ id: step.id, text: step.text, status: step.status, ...(step.summary ? { summary: step.summary } : {}) })),
    activeStep: active ? { id: active.id, text: active.text, ...(active.summary ? { summary: active.summary } : {}) } : null,
    assumptions: latestAssumptions(ledger).slice(-20).map(({ text, status, source }) => ({ text, status, source })),
    recentObservations: ledger.observations.slice(-20).map(({ text, source, evidence }) => ({ text, source, ...(evidence ? { evidence } : {}) })),
    recentDecisions: ledger.decisions.slice(-20).map(({ text, rationale, source }) => ({ text, rationale: rationale || '', source })),
  };
}

const EXECUTOR_LEDGER_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    stepStatus: { type: 'string', enum: ['continue', 'completed', 'blocked'] },
    stepSummary: { type: 'string', maxLength: 2000 },
    revisionReason: { type: 'string', maxLength: 1000 },
    revisedSteps: { type: 'array', maxItems: MAX_PLAN_STEPS, items: { type: 'string', minLength: 1, maxLength: 1000 } },
    assumptions: { type: 'array', maxItems: MAX_RUN_ITEMS, items: { type: 'object', properties: {
      text: { type: 'string', minLength: 1, maxLength: 2000 }, status: { type: 'string', enum: ['open', 'confirmed', 'rejected'] },
    }, required: ['text', 'status'], additionalProperties: false } },
    observations: { type: 'array', maxItems: MAX_RUN_ITEMS, items: { type: 'object', properties: {
      text: { type: 'string', minLength: 1, maxLength: 3000 },
    }, required: ['text'], additionalProperties: false } },
    decisions: { type: 'array', maxItems: MAX_RUN_ITEMS, items: { type: 'object', properties: {
      text: { type: 'string', minLength: 1, maxLength: 2000 }, rationale: { type: 'string', maxLength: 3000 },
    }, required: ['text', 'rationale'], additionalProperties: false } },
  },
  required: ['stepStatus', 'stepSummary', 'revisionReason', 'revisedSteps', 'assumptions', 'observations', 'decisions'],
  additionalProperties: false,
});

module.exports = {
  LEDGER_SCHEMA_VERSION,
  MAX_PLAN_VERSIONS,
  MAX_PLAN_STEPS,
  MAX_ASSUMPTIONS,
  MAX_OBSERVATIONS,
  MAX_DECISIONS,
  STEP_STATUSES,
  ASSUMPTION_STATUSES,
  EXECUTOR_LEDGER_SCHEMA,
  normalizeGoalLedger,
  reconcileGoalLedger,
  restartGoalLedger,
  normalizeExecutorLedgerUpdate,
  currentPlan,
  activeStep,
  revisePlan,
  applyGoalLedgerUpdate,
  addAssumption,
  addObservation,
  addDecision,
  recordVerificationEvidence,
  recordSnapshotEvidence,
  recordGoalBlock,
  recordGoalPause,
  recordGoalRestore,
  recordUserAnswer,
  completeGoalLedger,
  recoverGoalLedger,
  goalLedgerContext,
};
