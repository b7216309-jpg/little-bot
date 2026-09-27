'use strict';

const COMPACTION_TIMEOUT_MS = 10 * 60 * 1000;
const COMPACTION_STOP_TIMEOUT_MS = 10000;
const DEFAULT_AUTO_COMPACT_PERCENT = 80;
const count = value => Number.isSafeInteger(value) && value >= 0;

function validAutoCompactPercent(value) {
  return Number.isInteger(value) && (value === 0 || (value >= 20 && value <= 95));
}
function normalizeAutoCompactPercent(value) {
  return validAutoCompactPercent(value) ? value : DEFAULT_AUTO_COMPACT_PERCENT;
}
function compactionConfig(settings) {
  // Supported by the pinned engine. Keep its model-specific hard limits intact.
  return { model_post_turn_compact_threshold_percent: normalizeAutoCompactPercent(settings?.autoCompactPercent) };
}

function ensureCompaction(chat) {
  chat.context ||= { usedTokens: null, windowTokens: null, updatedAt: null, stale: false };
  chat.compaction ||= { status: 'idle', count: 0, lastAt: null, lastError: null };
  return chat.compaction;
}

/** UI bookkeeping only: Codex owns context replacement and automatic policy. */
class CompactionTracker {
  constructor() { this.chats = new WeakMap(); }
  _state(chat) {
    let state = this.chats.get(chat);
    if (!state) { state = { active: new Map(), completed: new Set() }; this.chats.set(chat, state); }
    return state;
  }
  usage(chat, usage, now = Date.now()) {
    // `total` is cumulative billing/accounting; `last` is the engine's latest
    // reported context snapshot. Local input added later is not included.
    if (!count(usage?.last?.totalTokens)) return false;
    ensureCompaction(chat);
    chat.context = {
      usedTokens: usage.last.totalTokens,
      windowTokens: count(usage.modelContextWindow) && usage.modelContextWindow > 0 ? usage.modelContextWindow : null,
      updatedAt: now, stale: false,
    };
    return true;
  }
  beginManual(chat) {
    ensureCompaction(chat);
    chat.compaction.status = 'running';
    chat.compaction.lastError = null;
    chat.context.stale = true;
  }
  item(chat, { id, turnId, completed = false, manual = false }, now = Date.now()) {
    if (typeof id !== 'string' || !id || typeof turnId !== 'string' || !turnId) return false;
    const state = this._state(chat);
    const key = `${turnId}\0${id}`;
    if (state.completed.has(key)) return false;
    ensureCompaction(chat);
    if (!completed) {
      if (state.active.has(key)) return false;
      state.active.set(key, turnId);
      chat.compaction.status = 'running';
      chat.compaction.lastError = null;
      chat.context.stale = true;
      return true;
    }
    // Token usage can arrive before item/completed, after the engine replaces
    // history. Preserve that fresh update when the matching start was observed.
    if (!state.active.delete(key)) chat.context.stale = true;
    state.completed.add(key);
    if (state.completed.size > 256) state.completed.delete(state.completed.values().next().value);
    if (!manual) this.commitManual(chat, now);
    chat.compaction.lastError = null;
    chat.compaction.status = manual || state.active.size ? 'running' : 'idle';
    return true;
  }
  commitManual(chat, now = Date.now()) {
    ensureCompaction(chat);
    chat.compaction.count = Math.min(Number.MAX_SAFE_INTEGER, (count(chat.compaction.count) ? chat.compaction.count : 0) + 1);
    chat.compaction.lastAt = now;
    chat.compaction.lastError = null;
  }
  finish(chat, turnId, error = null, manual = false) {
    const state = this._state(chat);
    let unfinished = false;
    for (const [key, activeTurn] of state.active) {
      if (!turnId || activeTurn === turnId) { state.active.delete(key); unfinished = true; }
    }
    if (!manual && !unfinished) return;
    ensureCompaction(chat);
    chat.compaction.status = state.active.size ? 'running' : 'idle';
    if (error || unfinished) {
      chat.compaction.lastError = error || 'Compaction ended without a completion event.';
      chat.context.stale = true;
    }
  }
}

module.exports = { CompactionTracker, ensureCompaction, COMPACTION_TIMEOUT_MS, COMPACTION_STOP_TIMEOUT_MS,
  DEFAULT_AUTO_COMPACT_PERCENT, validAutoCompactPercent, normalizeAutoCompactPercent, compactionConfig };
