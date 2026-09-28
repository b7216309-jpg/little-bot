'use strict';

const { randomUUID } = require('node:crypto');

const MAX_INTENTS = 50;
const MAX_FILTERS = 8;
const EVENT_TYPE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PATH = /^payload(?:\.[A-Za-z_][A-Za-z0-9_-]*){1,8}$/;
const OPERATORS = Object.freeze(['equals', 'notEquals', 'contains', 'startsWith', 'glob', 'exists']);
const ACTIONS = Object.freeze(['goal.run', 'automation.run']);
const STATUSES = Object.freeze(['never', 'matched', 'queued', 'completed', 'error', 'skipped']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, maximum) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) : '';
const integer = (value, fallback, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;

function validScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function normalizeFilter(value) {
  if (!object(value)) throw new Error('Standing-intent filters must be objects.');
  const path = clean(value.path, 200);
  if (!PATH.test(path)) throw new Error('Standing-intent filter paths must start with payload.');
  const operator = OPERATORS.includes(value.operator) ? value.operator : 'equals';
  if (operator === 'exists') return { path, operator, value: value.value !== false };
  if (!validScalar(value.value)) throw new Error('Standing-intent filter values must be text, numbers, booleans, or null.');
  if (['contains', 'startsWith', 'glob'].includes(operator) && typeof value.value !== 'string') {
    throw new Error(`${operator} filters require text.`);
  }
  const normalized = typeof value.value === 'string' ? clean(value.value, 500) : value.value;
  if (typeof value.value === 'string' && !normalized && operator !== 'equals' && operator !== 'notEquals') throw new Error('Standing-intent filter text cannot be empty.');
  return { path, operator, value: normalized };
}

function normalizeAction(value) {
  if (!object(value) || !ACTIONS.includes(value.type)) throw new Error('Choose a supported standing-intent action.');
  if (value.type === 'goal.run') {
    const goalId = clean(value.goalId, 100);
    if (!goalId) throw new Error('Choose a goal for this standing intent.');
    return { type: value.type, goalId };
  }
  const automationId = clean(value.automationId, 100);
  if (!automationId) throw new Error('Choose an automation for this standing intent.');
  return { type: value.type, automationId };
}

function validateStandingIntent(input, existing = null, now = Date.now()) {
  if (!object(input)) throw new Error('Standing-intent details are required.');
  if (input.id !== undefined && (!existing || input.id !== existing.id)) throw new Error('This standing intent no longer exists.');
  if (!Number.isFinite(now) || now < 0) throw new Error('A valid current time is required.');
  const name = clean(input.name === undefined ? existing?.name : input.name, 80);
  if (!name) throw new Error('Give the standing intent a name.');
  const whenInput = input.when === undefined ? existing?.when : input.when;
  if (!object(whenInput)) throw new Error('Choose an event for this standing intent.');
  const type = clean(whenInput.type, 120);
  if (!EVENT_TYPE.test(type)) throw new Error('Standing-intent event types use lowercase dot-separated words.');
  const source = clean(whenInput.source, 120);
  if (source && !EVENT_TYPE.test(source)) throw new Error('Standing-intent event sources use lowercase dot-separated words.');
  const filtersInput = whenInput.filters === undefined ? [] : whenInput.filters;
  if (!Array.isArray(filtersInput) || filtersInput.length > MAX_FILTERS) throw new Error(`Standing intents accept at most ${MAX_FILTERS} filters.`);
  const filters = filtersInput.map(normalizeFilter);
  const action = normalizeAction(input.action === undefined ? existing?.action : input.action);
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('Standing-intent enabled must be true or false.');
  const enabled = input.enabled === undefined ? existing?.enabled === true : input.enabled;
  const id = existing?.id || clean(input.id, 100) || randomUUID();
  const createdAt = existing?.createdAt || now;
  const result = {
    id,
    name,
    enabled,
    priority: integer(input.priority, existing?.priority || 0, -10, 10),
    debounceMs: integer(input.debounceMs, existing?.debounceMs || 0, 0, 60 * 60 * 1000),
    when: { type, source, filters },
    action,
    createdAt,
    updatedAt: now,
    triggerCount: integer(existing?.triggerCount, 0, 0, Number.MAX_SAFE_INTEGER),
    lastTriggeredAt: Number.isFinite(existing?.lastTriggeredAt) ? existing.lastTriggeredAt : null,
    lastStatus: STATUSES.includes(existing?.lastStatus) ? existing.lastStatus : 'never',
  };
  if (typeof existing?.lastEventId === 'string') result.lastEventId = existing.lastEventId.slice(0, 128);
  if (typeof existing?.lastError === 'string') result.lastError = existing.lastError.slice(0, 2000);
  return result;
}

function normalizeStandingIntents(value, now = Date.now(), recovering = false) {
  const intents = [];
  for (const input of (Array.isArray(value?.intents) ? value.intents : []).slice(0, MAX_INTENTS)) {
    try {
      const intent = validateStandingIntent(input, null, now);
      if (intents.some(item => item.id === intent.id)) continue;
      intent.createdAt = Number.isFinite(input.createdAt) ? input.createdAt : intent.createdAt;
      intent.updatedAt = Number.isFinite(input.updatedAt) ? input.updatedAt : intent.updatedAt;
      intent.triggerCount = integer(input.triggerCount, 0, 0, Number.MAX_SAFE_INTEGER);
      intent.lastTriggeredAt = Number.isFinite(input.lastTriggeredAt) ? input.lastTriggeredAt : null;
      intent.lastStatus = STATUSES.includes(input.lastStatus) ? input.lastStatus : 'never';
      if (typeof input.lastEventId === 'string') intent.lastEventId = input.lastEventId.slice(0, 128);
      if (typeof input.lastError === 'string') intent.lastError = input.lastError.slice(0, 2000);
      if (recovering && intent.lastStatus === 'queued') {
        intent.lastStatus = 'skipped';
        intent.lastError = 'The app closed before this standing intent could run. It was not replayed.';
      }
      intents.push(intent);
    } catch { /* Invalid persisted standing intents are omitted instead of executed. */ }
  }
  return { intents };
}

function valueAt(event, path) {
  const parts = path.split('.');
  let current = event;
  for (const part of parts) {
    if (current == null || !Object.prototype.hasOwnProperty.call(current, part)) return { exists: false, value: undefined };
    current = current[part];
  }
  return { exists: true, value: current };
}

function globPattern(value) {
  const escaped = value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchFilter(filter, event) {
  const actual = valueAt(event, filter.path);
  if (filter.operator === 'exists') return actual.exists === filter.value;
  if (!actual.exists) return filter.operator === 'notEquals';
  if (filter.operator === 'equals') return actual.value === filter.value;
  if (filter.operator === 'notEquals') return actual.value !== filter.value;
  const text = typeof actual.value === 'string' ? actual.value : String(actual.value ?? '');
  if (filter.operator === 'contains') return text.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase());
  if (filter.operator === 'startsWith') return text.toLocaleLowerCase().startsWith(filter.value.toLocaleLowerCase());
  if (filter.operator === 'glob') return globPattern(filter.value).test(text);
  return false;
}

function matchStandingIntent(intent, event) {
  if (!intent?.enabled || !event || intent.when.type !== event.type) return false;
  if (intent.when.source && intent.when.source !== event.source) return false;
  return intent.when.filters.every(filter => matchFilter(filter, event));
}

class StandingIntentStore {
  constructor({ store, now = Date.now, onChange = () => {} }) {
    if (!store || !object(store.data) || typeof store.save !== 'function') throw new TypeError('A store is required.');
    if (typeof now !== 'function' || typeof onChange !== 'function') throw new TypeError('Standing-intent callbacks must be functions.');
    this.store = store;
    this.now = now;
    this.onChange = onChange;
    store.data.standingIntents = normalizeStandingIntents(store.data.standingIntents, now());
  }

  get data() { return this.store.data.standingIntents; }

  list() { return structuredClone(this.data.intents); }

  get(id) {
    const intent = this.data.intents.find(item => item.id === id);
    if (!intent) throw new Error('Standing intent not found.');
    return intent;
  }

  save(input) {
    const existing = input?.id ? this.get(input.id) : null;
    if (!existing && this.data.intents.length >= MAX_INTENTS) throw new Error(`Keep at most ${MAX_INTENTS} standing intents.`);
    const intent = validateStandingIntent(input, existing, this.now());
    if (existing) Object.assign(existing, intent); else this.data.intents.push(intent);
    this._changed();
    return structuredClone(existing || intent);
  }

  remove(id) {
    const before = this.data.intents.length;
    this.data.intents = this.data.intents.filter(item => item.id !== id);
    if (before === this.data.intents.length) throw new Error('Standing intent not found.');
    this._changed();
    return true;
  }

  setEnabled(id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Enabled must be true or false.');
    const intent = this.get(id);
    intent.enabled = enabled;
    intent.updatedAt = this.now();
    this._changed();
    return structuredClone(intent);
  }

  matches(event) {
    return this.data.intents.filter(intent => matchStandingIntent(intent, event))
      .sort((left, right) => right.priority - left.priority || left.createdAt - right.createdAt);
  }

  record(id, { status, event, error = '' } = {}) {
    if (!STATUSES.includes(status) || status === 'never') throw new Error('Choose a valid standing-intent result status.');
    const intent = this.get(id);
    intent.lastStatus = status;
    intent.lastTriggeredAt = this.now();
    intent.triggerCount = Math.min(Number.MAX_SAFE_INTEGER, intent.triggerCount + (status === 'matched' ? 1 : 0));
    if (event?.id) intent.lastEventId = String(event.id).slice(0, 128);
    if (error) intent.lastError = String(error).slice(0, 2000); else delete intent.lastError;
    this._changed();
    return structuredClone(intent);
  }

  _changed() {
    this.store.save();
    try { this.onChange(); } catch { /* Observers cannot undo persisted state. */ }
  }
}

module.exports = {
  MAX_INTENTS,
  MAX_FILTERS,
  OPERATORS,
  ACTIONS,
  validateStandingIntent,
  normalizeStandingIntents,
  matchStandingIntent,
  matchFilter,
  StandingIntentStore,
};
