'use strict';

const MAX_SAMPLES = 10;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const text = (value, maximum = 200) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) : '';

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
  return { status: text(value.status, 40) || 'offline', model: text(value.model, 200) || null };
}

class ProviderUsage {
  constructor({ connection = () => ({}), onChange = () => {}, now = () => Date.now() } = {}) {
    if (typeof connection !== 'function' || typeof onChange !== 'function' || typeof now !== 'function') {
      throw new TypeError('Provider usage callbacks must be functions.');
    }
    this.connection = connection;
    this.onChange = onChange;
    this.now = now;
    this.turns = new Map();
    this.samples = [];
    this.state = { kind: 'local', status: 'waiting', updatedAt: null, model: null, latest: null, average: null, sampleCount: 0, error: null };
  }

  publicState() { return structuredClone(this.state); }

  changed() {
    try { this.onChange(); } catch { /* Usage display failures never affect model work. */ }
  }

  localState(current) {
    const connected = current.status === 'connected', checking = current.status === 'checking';
    return {
      kind: 'local', status: connected ? (this.samples.length ? 'ready' : 'waiting') : checking ? 'waiting' : 'offline',
      updatedAt: this.samples.at(-1)?.at || null, model: current.model, latest: this.samples.at(-1) || null,
      average: averageSamples(this.samples), sampleCount: this.samples.length,
      error: connected || checking ? null : 'Local performance appears after a completed model turn.',
    };
  }

  connectionChanged(value = this.connection()) {
    const current = normalizeConnection(value);
    this.turns.clear();
    if (current.model && this.samples.some(sample => sample.model && sample.model !== current.model)) this.samples = [];
    this.state = this.localState(current);
    this.changed();
    return this.publicState();
  }

  notification(method, params = {}) { return this.localNotification(method, params); }

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
    // The engine reports reasoning as a subset of output tokens; never count it twice.
    const generatedTokens = outputTokens;
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

module.exports = { MAX_SAMPLES, normalizeUsage, averageSamples, ProviderUsage };
