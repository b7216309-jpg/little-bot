'use strict';

const { createHash, randomUUID } = require('node:crypto');

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_EVENT_DEPTH = 12;
const MAX_LINEAGE_REPEATS = 2;
const MAX_INTENT_TRACE = 12;
const TYPE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, fallback, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
const string = (value, maximum = 256) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) : '';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function payload(value) {
  if (value == null) return {};
  if (!object(value)) throw new TypeError('Event payload must be an object.');
  const copy = structuredClone(value);
  const encoded = JSON.stringify(copy);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('Event payload is too large.');
  return copy;
}

function normalizeIntentTrace(value, parent = null) {
  if (value !== undefined && !Array.isArray(value)) throw new TypeError('Event intentTrace must be an array.');
  const trace = [];
  for (const item of [...(parent?.intentTrace || []), ...(value || [])]) {
    const id = string(item, 100);
    if (id && !trace.includes(id)) trace.push(id);
  }
  return trace.slice(-MAX_INTENT_TRACE);
}

function eventSignature(value) {
  const body = JSON.stringify(stable({ type: value.type, source: value.source, dedupeKey: value.dedupeKey || '', payload: value.payload }));
  return createHash('sha256').update(body).digest('hex');
}

function normalizeEvent(input, nowMs, parent = null) {
  if (!object(input)) throw new TypeError('An event is required.');
  const type = string(input.type, 120);
  if (!TYPE_PATTERN.test(type)) throw new Error('Event type must use lowercase dot-separated words.');
  const source = string(input.source || 'little-bot', 120);
  if (!TYPE_PATTERN.test(source)) throw new Error('Event source must use lowercase dot-separated words.');
  const id = string(input.id, 128) || randomUUID();
  const occurredAt = Number.isFinite(input.occurredAt) && input.occurredAt >= 0 ? input.occurredAt : nowMs;
  const expiresAt = input.expiresAt == null ? null : Number(input.expiresAt);
  if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt < occurredAt)) throw new Error('Event expiry must not be before its occurrence.');
  const debounceMs = integer(input.debounceMs, 0, 0, 60 * 60 * 1000);
  const priority = integer(input.priority, 0, -10, 10);
  const depth = parent ? parent.depth + 1 : 0;
  if (depth > MAX_EVENT_DEPTH) return { dropped: 'depth' };
  const value = {
    id,
    type,
    source,
    occurredAt,
    availableAt: nowMs + debounceMs,
    expiresAt,
    priority,
    payload: payload(input.payload),
    dedupeKey: string(input.dedupeKey, 256),
    debounceKey: string(input.debounceKey, 256),
    debounceMs,
    correlationId: string(input.correlationId, 128) || parent?.correlationId || id,
    causationId: string(input.causationId, 128) || parent?.id || null,
    intentTrace: normalizeIntentTrace(input.intentTrace, parent),
    depth,
  };
  const signature = eventSignature(value);
  const lineage = parent?._lineage ? [...parent._lineage, signature] : [signature];
  if (lineage.filter(item => item === signature).length > MAX_LINEAGE_REPEATS) return { dropped: 'cycle' };
  Object.defineProperty(value, '_lineage', { value: lineage, enumerable: false });
  Object.freeze(value.payload);
  Object.freeze(value.intentTrace);
  return value;
}

class EventBus {
  constructor({ maxQueue = 100, dedupeWindowMs = 30000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
    defer = queueMicrotask, onError = () => {}, onDrop = () => {}, onChange = () => {} } = {}) {
    if (typeof now !== 'function' || typeof setTimer !== 'function' || typeof clearTimer !== 'function' || typeof defer !== 'function') {
      throw new TypeError('EventBus clock and scheduling hooks must be functions.');
    }
    for (const callback of [onError, onDrop, onChange]) if (typeof callback !== 'function') throw new TypeError('EventBus observers must be functions.');
    this.maxQueue = integer(maxQueue, 100, 1, 1000);
    this.dedupeWindowMs = integer(dedupeWindowMs, 30000, 0, 60 * 60 * 1000);
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.defer = defer;
    this.onError = onError;
    this.onDrop = onDrop;
    this.onChange = onChange;
    this.started = false;
    this.dispatching = false;
    this.drainPromise = null;
    this.queue = [];
    this.subscriptions = new Map();
    this.dedupeUntil = new Map();
    this.debounceIds = new Map();
    this.timer = null;
    this.scheduled = false;
    this.sequence = 0;
    this.subscriptionSequence = 0;
    this.counters = { accepted: 0, handled: 0, dropped: 0, errors: 0 };
  }

  get state() {
    const next = this.queue.length ? Math.min(...this.queue.map(entry => entry.event.availableAt)) : null;
    return {
      started: this.started,
      dispatching: this.dispatching,
      queued: this.queue.length,
      subscriptions: this.subscriptions.size,
      nextAvailableAt: Number.isFinite(next) ? next : null,
      ...this.counters,
    };
  }

  start() {
    if (this.started) return false;
    this.started = true;
    this._changed();
    this._schedule();
    return true;
  }

  stop({ clear = true } = {}) {
    const changed = this.started || this.queue.length > 0;
    this.started = false;
    this.scheduled = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (clear) {
      this.queue = [];
      this.debounceIds.clear();
      this.dedupeUntil.clear();
    }
    if (changed) this._changed();
    return changed;
  }

  subscribe({ id, type = '*', source = '', filter = null, handler, priority = 0 } = {}) {
    if (type !== '*' && !TYPE_PATTERN.test(string(type, 120))) throw new Error('Subscription type must be an event type or * wildcard.');
    const normalizedSource = string(source, 120);
    if (normalizedSource && !TYPE_PATTERN.test(normalizedSource)) throw new Error('Subscription source is invalid.');
    if (filter !== null && typeof filter !== 'function') throw new TypeError('Subscription filter must be a function.');
    if (typeof handler !== 'function') throw new TypeError('Subscription handler must be a function.');
    const subscriptionId = string(id, 128) || randomUUID();
    if (this.subscriptions.has(subscriptionId)) throw new Error('Subscription ID already exists.');
    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      type,
      source: normalizedSource,
      filter,
      handler,
      priority: integer(priority, 0, -10, 10),
      sequence: this.subscriptionSequence++,
    });
    this._changed();
    return () => this.unsubscribe(subscriptionId);
  }

  unsubscribe(id) {
    const removed = this.subscriptions.delete(id);
    if (removed) this._changed();
    return removed;
  }

  publish(input, { parent = null } = {}) {
    if (!this.started) return this._drop(null, 'stopped');
    const nowMs = this.now();
    this._purgeDedupe(nowMs);
    const normalized = normalizeEvent(input, nowMs, parent);
    if (normalized?.dropped) return this._drop(input, normalized.dropped);
    const event = normalized;
    const replacingId = event.debounceKey ? this.debounceIds.get(event.debounceKey) : null;
    if (event.dedupeKey && this.dedupeUntil.get(event.dedupeKey) > nowMs && !replacingId) {
      return this._drop(event, 'duplicate');
    }
    if (replacingId) this._removeQueued(replacingId, 'debounced');
    if (event.expiresAt !== null && event.expiresAt <= nowMs) return this._drop(event, 'expired');

    const entry = { event, sequence: this.sequence++ };
    if (this.queue.length >= this.maxQueue) {
      const weakest = [...this.queue].sort((left, right) => left.event.priority - right.event.priority || right.sequence - left.sequence)[0];
      if (!weakest || weakest.event.priority >= event.priority) return this._drop(event, 'overflow');
      this._removeQueued(weakest.event.id, 'evicted');
    }
    this.queue.push(entry);
    if (event.debounceKey) this.debounceIds.set(event.debounceKey, event.id);
    if (event.dedupeKey && this.dedupeWindowMs) this.dedupeUntil.set(event.dedupeKey, nowMs + this.dedupeWindowMs);
    this.counters.accepted++;
    this._changed();
    this._schedule();
    return { accepted: true, event };
  }

  drain() {
    if (!this.started) return Promise.resolve(false);
    if (this.drainPromise) return this.drainPromise;
    const operation = this._drain();
    const tracked = operation.finally(() => {
      if (this.drainPromise === tracked) this.drainPromise = null;
    });
    this.drainPromise = tracked;
    return tracked;
  }

  async _drain() {
    this.dispatching = true;
    this.scheduled = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    try {
      while (this.started) {
        const nowMs = this.now();
        this._purgeExpired(nowMs);
        const available = this.queue.filter(entry => entry.event.availableAt <= nowMs)
          .sort((left, right) => right.event.priority - left.event.priority || left.sequence - right.sequence)[0];
        if (!available) break;
        this._take(available.event.id);
        await this._dispatch(available.event);
      }
    } finally {
      this.dispatching = false;
      this._changed();
      this._schedule();
    }
    return true;
  }

  clear(reason = 'cleared') {
    const events = this.queue.map(entry => entry.event);
    this.queue = [];
    this.debounceIds.clear();
    for (const event of events) this._drop(event, reason, false);
    if (events.length) this._changed();
    return events.length;
  }

  _matching(event) {
    return [...this.subscriptions.values()].filter(subscription => {
      if (subscription.type !== '*' && subscription.type !== event.type) return false;
      if (subscription.source && subscription.source !== event.source) return false;
      if (!subscription.filter) return true;
      try { return subscription.filter(event) === true; }
      catch (error) { this._error(error, event, subscription); return false; }
    }).sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
  }

  async _dispatch(event) {
    for (const subscription of this._matching(event)) {
      if (!this.started) break;
      try {
        await subscription.handler(event, {
          publish: child => this.publish(child, { parent: event }),
          state: () => this.state,
        });
        this.counters.handled++;
      } catch (error) {
        this._error(error, event, subscription);
      }
    }
  }

  _take(id) {
    const index = this.queue.findIndex(entry => entry.event.id === id);
    if (index < 0) return null;
    const [entry] = this.queue.splice(index, 1);
    if (entry.event.debounceKey && this.debounceIds.get(entry.event.debounceKey) === id) this.debounceIds.delete(entry.event.debounceKey);
    return entry.event;
  }

  _removeQueued(id, reason) {
    const event = this._take(id);
    if (event) this._drop(event, reason, false);
    return event;
  }

  _purgeExpired(nowMs) {
    for (const { event } of [...this.queue]) {
      if (event.expiresAt !== null && event.expiresAt <= nowMs) this._removeQueued(event.id, 'expired');
    }
    this._purgeDedupe(nowMs);
  }

  _purgeDedupe(nowMs) {
    for (const [key, until] of this.dedupeUntil) if (until <= nowMs) this.dedupeUntil.delete(key);
  }

  _schedule() {
    if (!this.started || this.dispatching || this.scheduled) return;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (!this.queue.length) return;
    const delay = Math.max(0, Math.min(...this.queue.map(entry => entry.event.availableAt)) - this.now());
    this.scheduled = true;
    if (delay === 0) {
      this.defer(() => { this.scheduled = false; void this.drain(); });
    } else {
      this.timer = this.setTimer(() => { this.timer = null; this.scheduled = false; void this.drain(); }, delay);
      this.timer?.unref?.();
    }
  }

  _drop(event, reason, count = true) {
    if (count) this.counters.dropped++;
    try { this.onDrop({ event, reason }); } catch { /* Drop observers cannot affect the queue. */ }
    return { accepted: false, reason };
  }

  _error(error, event, subscription) {
    this.counters.errors++;
    try { this.onError(error, event, subscription); } catch { /* Error observers cannot stop dispatch. */ }
  }

  _changed() {
    try { this.onChange(this.state); } catch { /* State observers cannot affect dispatch. */ }
  }
}

module.exports = {
  EventBus,
  normalizeEvent,
  eventSignature,
  MAX_PAYLOAD_BYTES,
  MAX_EVENT_DEPTH,
  MAX_INTENT_TRACE,
};
