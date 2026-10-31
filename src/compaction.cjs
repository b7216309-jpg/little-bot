'use strict';

const COMPACTION_TIMEOUT_MS = 10 * 60 * 1000;
const COMPACTION_STOP_TIMEOUT_MS = 10000;
const DEFAULT_AUTO_COMPACT_PERCENT = 50;
const count = value => Number.isSafeInteger(value) && value >= 0;

function validAutoCompactPercent(value) {
  return Number.isInteger(value) && (value === 0 || (value >= 20 && value <= 95));
}
function normalizeAutoCompactPercent(value, fallback = DEFAULT_AUTO_COMPACT_PERCENT) {
  return validAutoCompactPercent(value) ? value : fallback;
}
// The engine keeps 5% of the window in reserve; its percentages and the context meter use the remaining 95%.
const USABLE_WINDOW = 0.95;
function compactionConfig(settings, contextWindow) {
  const percent = normalizeAutoCompactPercent(settings?.autoCompactPercent);
  const config = { model_post_turn_compact_threshold_percent: percent };
  // The post-turn threshold is checked only when a turn ends, so a long tool-using turn ran on to the engine's
  // 90% hard limit. The token limit compacts at the same point while the turn is still working, then continues.
  if (percent && Number.isSafeInteger(contextWindow) && contextWindow > 0) config.model_auto_compact_token_limit = Math.floor(contextWindow * USABLE_WINDOW * percent / 100);
  return config;
}
// Resumed engine sessions keep the settings they were opened with, so any change here must reopen them.
function compactionKey(config) {
  return `${config.model_post_turn_compact_threshold_percent}\0${config.model_auto_compact_token_limit ?? ''}`;
}

function ensureCompaction(chat) {
  chat.context ||= { usedTokens: null, windowTokens: null, updatedAt: null, stale: false };
  chat.compaction ||= { status: 'idle', lastAt: null, lastError: null };
  return chat.compaction;
}

/** UI bookkeeping only: the engine owns context replacement and automatic policy. */
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
  item(chat, { id, turnId, completed = false, manual = false, error = null }, now = Date.now()) {
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
    if (error) chat.compaction.lastError = error;
    else if (!manual) this.commitManual(chat, now);
    chat.compaction.status = (manual && !error) || state.active.size ? 'running' : 'idle';
    return true;
  }
  commitManual(chat, now = Date.now()) {
    ensureCompaction(chat);
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
  DEFAULT_AUTO_COMPACT_PERCENT, validAutoCompactPercent, normalizeAutoCompactPercent, compactionConfig, compactionKey };
