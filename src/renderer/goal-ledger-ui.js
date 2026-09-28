'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotGoalLedger = api;
})(typeof globalThis === 'object' ? globalThis : window, () => {
  const STEP_LABELS = Object.freeze({
    pending: 'Pending',
    active: 'Active',
    completed: 'Completed',
    skipped: 'Skipped',
    superseded: 'Superseded',
  });
  const ASSUMPTION_LABELS = Object.freeze({
    open: 'Open',
    confirmed: 'Confirmed',
    rejected: 'Rejected',
    superseded: 'Superseded',
  });
  const SOURCE_LABELS = Object.freeze({
    user: 'You',
    agent: 'Agent',
    system: 'Little Bot',
    verification: 'Verification',
    migration: 'Migrated',
  });
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const array = value => Array.isArray(value) ? value : [];
  const text = value => typeof value === 'string' ? value.trim() : '';
  const time = value => Number.isFinite(value) && value >= 0 ? value : null;
  const version = value => Number.isInteger(value) && value > 0 ? value : null;

  function stepStatus(value) {
    return Object.prototype.hasOwnProperty.call(STEP_LABELS, value) ? value : 'pending';
  }

  function stepLabel(value) {
    return STEP_LABELS[stepStatus(value)];
  }

  function assumptionStatus(value) {
    return Object.prototype.hasOwnProperty.call(ASSUMPTION_LABELS, value) ? value : 'open';
  }

  function assumptionLabel(value) {
    return ASSUMPTION_LABELS[assumptionStatus(value)];
  }

  function sourceLabel(value) {
    return SOURCE_LABELS[value] || 'Little Bot';
  }

  function normalizeStep(value, index, completedGoal = false) {
    if (!object(value) || !text(value.text)) return null;
    const status = completedGoal && !value.status ? 'completed' : stepStatus(value.status);
    return {
      id: text(value.id) || `step-${index + 1}`,
      text: text(value.text),
      status,
      label: stepLabel(status),
      summary: text(value.summary),
      createdAt: time(value.createdAt),
      activatedAt: time(value.activatedAt),
      completedAt: time(value.completedAt),
      runId: text(value.runId),
    };
  }

  function normalizePlan(value, index, completedGoal = false) {
    if (!object(value)) return null;
    const steps = array(value.steps).map((step, stepIndex) => normalizeStep(step, stepIndex, completedGoal)).filter(Boolean);
    if (!steps.length) return null;
    return {
      version: version(value.version) || index + 1,
      createdAt: time(value.createdAt),
      source: text(value.source) || 'system',
      sourceLabel: sourceLabel(value.source),
      reason: text(value.reason) || 'Plan saved.',
      runId: text(value.runId),
      steps,
    };
  }

  function legacyPlan(goal) {
    const sourceSteps = array(goal?.steps).map(text).filter(Boolean);
    const descriptions = sourceSteps.length ? sourceSteps : [text(goal?.nextStep) || text(goal?.objective) || 'Establish the next verifiable step.'];
    const completed = goal?.status === 'completed';
    return {
      version: 1,
      createdAt: time(goal?.createdAt),
      source: 'migration',
      sourceLabel: 'Migrated',
      reason: 'Legacy goal steps.',
      runId: '',
      steps: descriptions.map((description, index) => ({
        id: `legacy-step-${index + 1}`,
        text: description,
        status: completed ? 'completed' : index === 0 ? 'active' : 'pending',
        label: completed ? 'Completed' : index === 0 ? 'Active' : 'Pending',
        summary: '', createdAt: null, activatedAt: null, completedAt: null, runId: '',
      })),
    };
  }

  function plans(goal) {
    const completed = goal?.status === 'completed';
    const normalized = array(goal?.ledger?.plans)
      .map((plan, index) => normalizePlan(plan, index, completed))
      .filter(Boolean)
      .sort((left, right) => left.version - right.version || (left.createdAt || 0) - (right.createdAt || 0));
    return normalized.length ? normalized : [legacyPlan(goal)];
  }

  function normalizeRecord(value, kind) {
    if (!object(value) || !text(value.text)) return null;
    const result = {
      id: text(value.id) || `${kind}-${time(value.at) || 0}`,
      text: text(value.text),
      at: time(value.at),
      source: text(value.source) || 'system',
      sourceLabel: sourceLabel(value.source),
      runId: text(value.runId),
      stepId: text(value.stepId),
      planVersion: version(value.planVersion),
    };
    if (kind === 'assumption') {
      result.status = assumptionStatus(value.status);
      result.statusLabel = assumptionLabel(result.status);
      result.supersedesId = text(value.supersedesId);
    }
    if (kind === 'observation' && object(value.evidence)) result.evidence = { ...value.evidence };
    if (kind === 'decision') result.rationale = text(value.rationale);
    return result;
  }

  function latestAssumptions(value) {
    const latest = new Map();
    for (const input of array(value)) {
      const record = normalizeRecord(input, 'assumption');
      if (!record) continue;
      const key = record.text.toLocaleLowerCase().replace(/\s+/g, ' ');
      latest.set(key, record);
    }
    return [...latest.values()].sort((left, right) => (right.at || 0) - (left.at || 0));
  }

  function records(value, kind) {
    return array(value).map(item => normalizeRecord(item, kind)).filter(Boolean)
      .sort((left, right) => (right.at || 0) - (left.at || 0));
  }

  function addRecordContext(records, allPlans) {
    const steps = new Map();
    for (const plan of allPlans) {
      plan.steps.forEach((step, index) => steps.set(step.id, {
        label: `v${plan.version} · Step ${index + 1}`,
        text: step.text,
      }));
    }
    return records.map(record => {
      const linked = steps.get(record.stepId);
      return {
        ...record,
        contextLabel: linked?.label || (record.planVersion ? `v${record.planVersion}` : ''),
        contextText: linked?.text || '',
      };
    });
  }

  function evidenceLabel(value) {
    if (!object(value)) return '';
    if (['snapshot', 'restore'].includes(value.type)) {
      const changes = Number.isSafeInteger(value.changes) && value.changes >= 0 ? value.changes : 0;
      const verb = value.type === 'restore' ? 'restored' : 'changed';
      return `${changes} ${verb} path${changes === 1 ? '' : 's'}`;
    }
    if (typeof value.passed === 'boolean') {
      const subject = text(value.path) || text(value.checkType) || 'check';
      return `${value.passed ? 'Passed' : 'Failed'} · ${subject}`;
    }
    return text(value.type).replace(/[._-]+/g, ' ');
  }

  function view(goal = {}) {
    const allPlans = plans(goal);
    const current = allPlans[allPlans.length - 1];
    const active = current.steps.find(step => step.status === 'active') || null;
    const assumptions = addRecordContext(latestAssumptions(goal?.ledger?.assumptions), allPlans);
    const observations = addRecordContext(records(goal?.ledger?.observations, 'observation'), allPlans);
    const decisions = addRecordContext(records(goal?.ledger?.decisions, 'decision'), allPlans);
    return {
      current,
      archived: allPlans.slice(0, -1).reverse(),
      active,
      assumptions,
      observations,
      decisions,
      counts: {
        versions: allPlans.length,
        steps: current.steps.length,
        completedSteps: current.steps.filter(step => step.status === 'completed').length,
        openAssumptions: assumptions.filter(item => item.status === 'open').length,
        observations: observations.length,
        decisions: decisions.length,
      },
      migrated: !array(goal?.ledger?.plans).length,
    };
  }

  return {
    STEP_LABELS,
    ASSUMPTION_LABELS,
    SOURCE_LABELS,
    stepStatus,
    stepLabel,
    assumptionStatus,
    assumptionLabel,
    sourceLabel,
    evidenceLabel,
    view,
  };
});
