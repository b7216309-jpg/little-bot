'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotStandingIntents = api;
})(typeof globalThis === 'object' ? globalThis : window, () => {
  const EVENTS = Object.freeze([
    ['file.changed', 'Watched files changed'],
    ['calendar.created', 'Calendar event created'],
    ['calendar.updated', 'Calendar event updated'],
    ['calendar.deleted', 'Calendar event deleted'],
    ['calendar.event_approaching', 'Calendar event approaching'],
    ['goal.queued', 'Goal queued'],
    ['goal.completed', 'Goal completed'],
    ['goal.reviewed', 'Ongoing goal review finished'],
    ['goal.blocked', 'Goal blocked'],
    ['goal.question_answered', 'Goal question answered'],
    ['automation.started', 'Automation started'],
    ['automation.completed', 'Automation completed'],
    ['automation.error', 'Automation failed'],
    ['chat.completed', 'Chat completed'],
    ['chat.failed', 'Chat failed'],
    ['heartbeat.alert', 'Heartbeat alert'],
    ['heartbeat.error', 'Heartbeat failed'],
    ['app.opened', 'Little Bot opened'],
  ]);
  const OPERATORS = Object.freeze([
    ['equals', 'equals'],
    ['notEquals', 'does not equal'],
    ['contains', 'contains'],
    ['startsWith', 'starts with'],
    ['glob', 'matches wildcard'],
    ['exists', 'exists'],
  ]);
  const EVENT_LABELS = new Map(EVENTS);
  const OPERATOR_LABELS = new Map(OPERATORS);

  function eventLabel(type) { return EVENT_LABELS.get(type) || String(type || 'Unknown event').replace(/[._-]/g, ' '); }
  function operatorLabel(operator) { return OPERATOR_LABELS.get(operator) || String(operator || 'equals'); }

  function parseScalar(value) {
    const text = String(value ?? '').trim();
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return Number(text);
    return text;
  }

  function normalizePayloadPath(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.startsWith('payload.') ? text : `payload.${text.replace(/^\.+/, '')}`;
  }

  function filterFromForm({ path, operator, value }) {
    const normalizedPath = normalizePayloadPath(path);
    if (!normalizedPath) return null;
    const selected = operator || 'equals';
    return {
      path: normalizedPath,
      operator: selected,
      value: selected === 'exists' ? value !== 'false' : ['contains', 'startsWith', 'glob'].includes(selected) ? String(value || '').trim() : parseScalar(value),
    };
  }

  function targetLabel(intent, state = {}) {
    if (intent?.action?.type === 'goal.run') {
      return state.autonomy?.goals?.find(goal => goal.id === intent.action.goalId)?.name || `Goal ${intent.action.goalId || 'missing'}`;
    }
    return state.automations?.find(automation => automation.id === intent?.action?.automationId)?.name || `Automation ${intent?.action?.automationId || 'missing'}`;
  }

  function describe(intent, state = {}) {
    const filters = intent?.when?.filters || [];
    const condition = filters.length ? filters.map(filter => `${filter.path.replace(/^payload\./, '')} ${operatorLabel(filter.operator)} ${filter.operator === 'exists' ? (filter.value ? 'yes' : 'no') : JSON.stringify(filter.value)}`).join(' and ') : 'any matching event';
    return {
      event: eventLabel(intent?.when?.type),
      condition,
      action: `${intent?.action?.type === 'goal.run' ? 'Run goal' : 'Run automation'} · ${targetLabel(intent, state)}`,
      status: String(intent?.lastStatus || 'never').replace(/[_-]/g, ' '),
    };
  }

  function buildIntent({ id, name, enabled, eventType, source, filterPath, filterOperator, filterValue, actionType, targetId, priority, debounceSeconds }) {
    const filter = filterFromForm({ path: filterPath, operator: filterOperator, value: filterValue });
    const action = actionType === 'automation.run'
      ? { type: actionType, automationId: targetId }
      : { type: 'goal.run', goalId: targetId };
    return {
      ...(id ? { id } : {}),
      name: String(name || '').trim(),
      enabled: enabled === true,
      priority: Number(priority || 0),
      debounceMs: Math.max(0, Number(debounceSeconds || 0) * 1000),
      when: { type: eventType, source: String(source || '').trim(), filters: filter ? [filter] : [] },
      action,
    };
  }

  return { EVENTS, OPERATORS, eventLabel, operatorLabel, parseScalar, normalizePayloadPath, filterFromForm, targetLabel, describe, buildIntent };
});
