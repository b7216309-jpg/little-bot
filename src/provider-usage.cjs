'use strict';

const MAX_BUCKETS = 20;
const MAX_SAMPLES = 10;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const text = (value, maximum = 200) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) : '';
const clampPercent = value => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;

function timestamp(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const milliseconds = value < 100000000000 ? value * 1000 : value;
  return Number.isSafeInteger(Math.round(milliseconds)) ? Math.round(milliseconds) : null;
}

function normalizeUsage(value) {
  if (!object(value)) return null;
  const result = {};
  for (const [source, target] of [
    ['inputTokens', 'inputTokens'], ['cachedInputTokens', 'cachedInputTokens'],
    ['cacheWriteInputTokens', 'cacheWriteInputTokens'], ['outputTokens', 'outputTokens'],
    ['reasoningOutputTokens', 'reasoningTokens'], ['totalTokens', 'totalTokens'],
  ]) {
    const count = integer(value[source] ?? value[source.replace(/[A-Z]/g, character => `_${character.toLowerCase()}`)]);
    if (count !== null) result[target] = count;
  }
  return Object.keys(result).length ? result : null;
}

function normalizeWindow(value) {
  if (!object(value)) return null;
  const usedPercent = clampPercent(value.usedPercent ?? value.used_percent);
  const windowDurationMinutes = integer(value.windowDurationMins ?? value.window_duration_mins
    ?? value.windowDurationMinutes ?? value.window_duration_minutes);
  const resetsAt = timestamp(value.resetsAt ?? value.resets_at);
  if (usedPercent === null && windowDurationMinutes === null && resetsAt === null) return null;
  return {
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent),
    windowDurationMinutes,
    resetsAt,
  };
}

function bucketLike(value) {
  return object(value) && ['primary', 'secondary', 'primaryWindow', 'secondaryWindow', 'primary_window', 'secondary_window']
    .some(key => object(value[key]));
}

function normalizeCredits(value) {
  if (!object(value)) return null;
  const balance = number(value.balance ?? value.remaining);
  const result = {
    hasCredits: typeof value.hasCredits === 'boolean' ? value.hasCredits
      : typeof value.has_credits === 'boolean' ? value.has_credits : null,
    unlimited: typeof value.unlimited === 'boolean' ? value.unlimited : null,
    balance,
  };
  return Object.values(result).some(item => item !== null) ? result : null;
}

function normalizeBucket(value, id, index) {
  if (!object(value)) return null;
  const primary = normalizeWindow(value.primary ?? value.primaryWindow ?? value.primary_window);
  const secondary = normalizeWindow(value.secondary ?? value.secondaryWindow ?? value.secondary_window);
  if (!primary && !secondary) return null;
  const bucketId = text(value.limitId ?? value.limit_id ?? id, 120) || `limit-${index + 1}`;
  const label = text(value.limitName ?? value.limit_name ?? value.name ?? value.label, 120) || bucketId;
  return {
    id: bucketId,
    label,
    primary,
    secondary,
    limitReached: typeof value.limitReached === 'boolean' ? value.limitReached
      : typeof value.limit_reached === 'boolean' ? value.limit_reached : null,
    reachedType: text(value.reachedType ?? value.reached_type, 80) || null,
    credits: normalizeCredits(value.credits),
  };
}

function rateLimitEntries(value) {
  if (!object(value)) return [];
  const byId = value.rateLimitsByLimitId ?? value.rate_limits_by_limit_id;
  if (object(byId)) return Object.entries(byId);
  const limits = value.rateLimits ?? value.rate_limits ?? value;
  if (bucketLike(limits)) return [['default', limits]];
  if (object(limits)) return Object.entries(limits).filter(([, entry]) => bucketLike(entry));
  if (Array.isArray(limits)) return limits.map((entry, index) => [text(entry?.limitId ?? entry?.id, 120) || `limit-${index + 1}`, entry]);
  return [];
}

function normalizeRateLimits(value, { now = Date.now(), plan = '' } = {}) {
  const source = object(value) ? value : {};
  const buckets = rateLimitEntries(source).slice(0, MAX_BUCKETS)
    .map(([id, entry], index) => normalizeBucket(entry, id, index)).filter(Boolean);
  const ordinaryUsageAllowed = typeof source.ordinaryUsageAllowed === 'boolean' ? source.ordinaryUsageAllowed
    : typeof source.ordinary_usage_allowed === 'boolean' ? source.ordinary_usage_allowed : null;
  return {
    kind: 'codex',
    status: buckets.length ? 'ready' : 'unavailable',
    updatedAt: now,
    plan: text(source.planType ?? source.plan_type ?? plan, 80) || null,
    ordinaryUsageAllowed,
    buckets,
    error: buckets.length ? null : 'The provider did not report a usable rate-limit window.',
  };
}

function averageSamples(samples) {
  const eligible = samples.filter(sample => !sample.includesTools && Number.isFinite(sample.tokensPerSecond)
    && sample.generatedTokens > 0 && sample.generationMs > 0);
  if (!eligible.length) return null;
  const generatedTokens = eligible.reduce((sum, sample) => sum + sample.generatedTokens, 0);
  const generationMs = eligible.reduce((sum, sample) => sum + sample.generationMs, 0);
  return {
    tokensPerSecond: generationMs > 0 ? generatedTokens / (generationMs / 1000) : null,
    sampleCount: eligible.length,
    generatedTokens,
    generationMs,
  };
}

function normalizeConnection(value = {}) {
  return {
    type: value.type === 'codex' ? 'codex' : 'local',
    status: text(value.status, 40) || 'offline',
    model: text(value.model, 200) || null,
  };
}

class ProviderUsage {
  constructor({ client, connection = () => ({}), account = () => ({}), onChange = () => {}, now = () => Date.now() } = {}) {
    if (!client || typeof client.request !== 'function') throw new TypeError('A provider usage client is required.');
    if (typeof connection !== 'function' || typeof account !== 'function' || typeof onChange !== 'function' || typeof now !== 'function') {
      throw new TypeError('Provider usage callbacks must be functions.');
    }
    this.client = client;
    this.connection = connection;
    this.account = account;
    this.onChange = onChange;
    this.now = now;
    this.refreshing = null;
    this.turns = new Map();
    this.samples = [];
    this.state = { kind: 'local', status: 'waiting', updatedAt: null, model: null, latest: null, average: null, sampleCount: 0, error: null };
  }

  publicState() { return structuredClone(this.state); }

  changed() {
    try { this.onChange(); } catch { /* Usage display failures never affect model work. */ }
  }

  connectionChanged(value = this.connection()) {
    const current = normalizeConnection(value);
    this.turns.clear();
    if (current.type === 'codex') {
      this.state = {
        kind: 'codex', status: current.status === 'connected' ? 'loading' : 'signedOut', updatedAt: null,
        plan: text(this.account()?.plan, 80) || null, ordinaryUsageAllowed: null, buckets: [], error: null,
      };
    } else {
      this.state = {
        kind: 'local', status: current.status === 'connected' ? (this.samples.length ? 'ready' : 'waiting') : 'offline',
        updatedAt: this.samples.at(-1)?.at || null, model: current.model, latest: this.samples.at(-1) || null,
        average: averageSamples(this.samples), sampleCount: this.samples.length,
        error: current.status === 'connected' ? null : 'Local performance appears after a completed model turn.',
      };
    }
    this.changed();
    return this.publicState();
  }

  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this._refresh();
    try { return await this.refreshing; } finally { this.refreshing = null; }
  }

  async _refresh() {
    const current = normalizeConnection(this.connection());
    if (current.type !== 'codex') return this.connectionChanged(current);
    if (current.status !== 'connected' || this.account()?.status !== 'connected') {
      this.state = { kind: 'codex', status: 'signedOut', updatedAt: null, plan: null, ordinaryUsageAllowed: null, buckets: [], error: 'Connect Codex to read provider limits.' };
      this.changed(); return this.publicState();
    }
    this.state = { ...this.state, kind: 'codex', status: 'loading', error: null, plan: text(this.account()?.plan, 80) || this.state.plan || null };
    this.changed();
    try {
      const result = await this.client.request('account/rateLimits/read', {});
      this.state = normalizeRateLimits(result, { now: this.now(), plan: this.account()?.plan });
    } catch (error) {
      this.state = {
        kind: 'codex', status: 'unavailable', updatedAt: this.now(), plan: text(this.account()?.plan, 80) || null,
        ordinaryUsageAllowed: null, buckets: [], error: text(error?.message || error, 500) || 'Provider limits are unavailable.',
      };
    }
    this.changed(); return this.publicState();
  }

  notification(method, params = {}) {
    if (method === 'account/rateLimits/updated') {
      if (normalizeConnection(this.connection()).type !== 'codex') return false;
      this.state = normalizeRateLimits(params, { now: this.now(), plan: this.account()?.plan });
      this.changed(); return true;
    }
    if (normalizeConnection(this.connection()).type !== 'local') return false;
    return this.localNotification(method, params);
  }

  localNotification(method, params = {}) {
    const turnId = text(params.turnId ?? params.turn?.id, 160);
    const current = normalizeConnection(this.connection());
    if (method === 'turn/started') {
      if (!turnId) return false;
      this.turns.set(turnId, {
        turnId, threadId: text(params.threadId, 160), model: current.model,
        startedAt: this.now(), firstOutputAt: null, completedAt: null, completed: false,
        usage: null, includesTools: false, excluded: false,
      });
      this.pruneTurns();
      return false;
    }
    if (!turnId) return false;
    const turn = this.turns.get(turnId);
    if (!turn) return false;
    if (method === 'thread/tokenUsage/updated') {
      const usage = normalizeUsage(params.tokenUsage?.last ?? params.token_usage?.last);
      if (usage) turn.usage = usage;
      return this.settleLocal(turn);
    }
    if (['item/agentMessage/delta', 'item/plan/delta', 'item/reasoning/textDelta', 'item/reasoning/summaryTextDelta'].includes(method)) {
      if (!turn.firstOutputAt) turn.firstOutputAt = this.now();
      return false;
    }
    if (['item/started', 'item/completed'].includes(method)) {
      const type = text(params.item?.type, 80);
      if (type === 'contextCompaction') turn.excluded = true;
      else if (['commandExecution', 'fileChange', 'webSearch', 'mcpToolCall', 'dynamicToolCall'].includes(type)) turn.includesTools = true;
      return false;
    }
    if (method === 'turn/completed') {
      turn.completed = params.turn?.status === 'completed';
      turn.completedAt = this.now();
      return this.settleLocal(turn);
    }
    return false;
  }

  settleLocal(turn) {
    if (!turn.completedAt || !turn.usage) return false;
    this.turns.delete(turn.turnId);
    if (!turn.completed || turn.excluded) return false;
    const outputTokens = integer(turn.usage.outputTokens) || 0;
    const reasoningTokens = integer(turn.usage.reasoningTokens) || 0;
    const generatedTokens = outputTokens + reasoningTokens;
    if (!generatedTokens) return false;
    const durationMs = Math.max(1, turn.completedAt - turn.startedAt);
    const firstOutputMs = turn.firstOutputAt ? Math.max(0, turn.firstOutputAt - turn.startedAt) : null;
    const generationMs = Math.max(1, turn.completedAt - (turn.firstOutputAt || turn.startedAt));
    const sample = {
      at: turn.completedAt,
      model: turn.model || normalizeConnection(this.connection()).model,
      outputTokens,
      reasoningTokens,
      generatedTokens,
      inputTokens: integer(turn.usage.inputTokens),
      cachedInputTokens: integer(turn.usage.cachedInputTokens),
      durationMs,
      firstOutputMs,
      generationMs,
      tokensPerSecond: generatedTokens / (generationMs / 1000),
      includesTools: turn.includesTools,
    };
    this.samples.push(sample);
    this.samples = this.samples.slice(-MAX_SAMPLES);
    this.state = {
      kind: 'local', status: 'ready', updatedAt: sample.at, model: sample.model,
      latest: sample, average: averageSamples(this.samples), sampleCount: this.samples.length, error: null,
    };
    this.changed(); return true;
  }

  pruneTurns() {
    const cutoff = this.now() - 60 * 60 * 1000;
    for (const [id, turn] of this.turns) if (turn.startedAt < cutoff) this.turns.delete(id);
    while (this.turns.size > 100) this.turns.delete(this.turns.keys().next().value);
  }
}

module.exports = {
  MAX_BUCKETS, MAX_SAMPLES, normalizeUsage, normalizeWindow, normalizeRateLimits,
  averageSamples, ProviderUsage,
};
