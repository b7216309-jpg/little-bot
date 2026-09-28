'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeUsage, normalizeWindow, normalizeRateLimits, averageSamples, ProviderUsage,
} = require('../src/provider-usage.cjs');

test('normalizes provider windows without inventing missing limits', () => {
  assert.deepEqual(normalizeWindow({ usedPercent: 42.5, windowDurationMins: 300, resetsAt: 1800000000 }), {
    usedPercent: 42.5, remainingPercent: 57.5, windowDurationMinutes: 300, resetsAt: 1800000000000,
  });
  assert.equal(normalizeWindow({}), null);
  const result = normalizeRateLimits({ rateLimits: {
    primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: 1800000000 },
    secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 1800600000 },
  }, ordinaryUsageAllowed: true }, { now: 1234, plan: 'plus' });
  assert.equal(result.status, 'ready');
  assert.equal(result.plan, 'plus');
  assert.equal(result.ordinaryUsageAllowed, true);
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].primary.remainingPercent, 85);
  assert.equal(result.buckets[0].secondary.windowDurationMinutes, 10080);
});

test('normalizes named multi-bucket responses and bounds unsafe values', () => {
  const result = normalizeRateLimits({
    rateLimitsByLimitId: {
      codex: { limitName: 'Codex', primary: { usedPercent: 140, resetsAt: 1800000000 } },
      review: { limitName: 'Code review', primary: { usedPercent: -5, windowDurationMins: 60 } },
      empty: { name: 'No data' },
    },
  }, { now: 5000 });
  assert.deepEqual(result.buckets.map(bucket => bucket.label), ['Codex', 'Code review']);
  assert.equal(result.buckets[0].primary.remainingPercent, 0);
  assert.equal(result.buckets[1].primary.usedPercent, 0);
  assert.equal(result.buckets[1].primary.resetsAt, null);
});

test('normalizes reported token usage only', () => {
  assert.deepEqual(normalizeUsage({ inputTokens: 200, cachedInputTokens: 150, outputTokens: 30,
    reasoningOutputTokens: 20, totalTokens: 250 }), {
    inputTokens: 200, cachedInputTokens: 150, outputTokens: 30, reasoningTokens: 20, totalTokens: 250,
  });
  assert.equal(normalizeUsage({ outputTokens: -1 }), null);
});

test('weighted local average excludes tool turns', () => {
  const average = averageSamples([
    { generatedTokens: 100, generationMs: 1000, tokensPerSecond: 100, includesTools: false },
    { generatedTokens: 300, generationMs: 3000, tokensPerSecond: 100, includesTools: false },
    { generatedTokens: 1000, generationMs: 1000, tokensPerSecond: 1000, includesTools: true },
  ]);
  assert.equal(average.tokensPerSecond, 100);
  assert.equal(average.sampleCount, 2);
});

test('reads Codex limits and refetches sparse rolling updates without erasing the snapshot', async () => {
  let now = 1000;
  const calls = [];
  let resolveSecond;
  const manager = new ProviderUsage({
    client: { request: async (method, params) => {
      calls.push([method, params]);
      if (calls.length === 1) return { rateLimits: { primary: { usedPercent: 25, resetsAt: 1800000000 } } };
      return new Promise(resolve => { resolveSecond = resolve; });
    } },
    connection: () => ({ type: 'codex', status: 'connected' }),
    account: () => ({ status: 'connected', plan: 'plus' }),
    now: () => now,
  });
  const first = await manager.refresh();
  assert.deepEqual(calls, [['account/rateLimits/read', {}]]);
  assert.equal(first.buckets[0].primary.remainingPercent, 75);
  now = 2000;
  assert.equal(manager.notification('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 40 } } }), true);
  assert.equal(manager.publicState().buckets[0].primary.remainingPercent, 75);
  const pending = manager.refresh();
  resolveSecond({ ordinaryUsageAllowed: false, rateLimitsByLimitId: {
    main: { limitName: 'Main', primary: { usedPercent: 40 } },
  } });
  await pending;
  assert.equal(calls.length, 2);
  assert.equal(manager.publicState().buckets[0].primary.remainingPercent, 60);
  assert.equal(manager.publicState().ordinaryUsageAllowed, false);
});

test('Codex usage failures remain a display-only unavailable state', async () => {
  const manager = new ProviderUsage({
    client: { request: async () => { throw new Error('RPC unavailable'); } },
    connection: () => ({ type: 'codex', status: 'connected' }),
    account: () => ({ status: 'connected' }),
  });
  const result = await manager.refresh();
  assert.equal(result.status, 'unavailable');
  assert.match(result.error, /RPC unavailable/);
});

test('local performance settles after completion and late usage, preserving honest timing', () => {
  let now = 1000;
  const manager = new ProviderUsage({
    client: { request: async () => ({}) },
    connection: () => ({ type: 'local', status: 'connected', model: 'Qwen' }),
    account: () => ({ status: 'connected' }),
    now: () => now,
  });
  manager.connectionChanged();
  manager.notification('turn/started', { turn: { id: 'turn-1' }, threadId: 'thread-1' });
  now = 1600;
  manager.notification('item/reasoning/textDelta', { turnId: 'turn-1', delta: 'thinking' });
  now = 2600;
  manager.notification('turn/completed', { turnId: 'turn-1', turn: { id: 'turn-1', status: 'completed' } });
  assert.equal(manager.publicState().status, 'waiting');
  now = 2700;
  assert.equal(manager.notification('thread/tokenUsage/updated', { turnId: 'turn-1', tokenUsage: { last: {
    inputTokens: 400, cachedInputTokens: 250, outputTokens: 80, reasoningOutputTokens: 20, totalTokens: 500,
  } } }), true);
  const state = manager.publicState();
  assert.equal(state.status, 'ready');
  assert.equal(state.latest.generatedTokens, 80);
  assert.equal(state.latest.durationMs, 1600);
  assert.equal(state.latest.firstOutputMs, 600);
  assert.equal(state.latest.generationMs, 1000);
  assert.equal(state.latest.tokensPerSecond, 80);
  assert.equal(state.latest.reasoningTokens, 20);
  assert.equal(state.latest.cachedInputTokens, 250);
});

test('local compaction turns are excluded and tool turns do not enter the rolling average', () => {
  let now = 0;
  const manager = new ProviderUsage({
    client: { request: async () => ({}) },
    connection: () => ({ type: 'local', status: 'connected', model: 'Qwen' }),
    account: () => ({ status: 'connected' }), now: () => now,
  });
  const finish = ({ id, tool = false, compact = false, output = 50 }) => {
    manager.notification('turn/started', { turn: { id } });
    now += 100;
    manager.notification('item/agentMessage/delta', { turnId: id, delta: 'x' });
    if (tool) manager.notification('item/started', { turnId: id, item: { type: 'commandExecution' } });
    if (compact) manager.notification('item/started', { turnId: id, item: { type: 'contextCompaction' } });
    now += 1000;
    manager.notification('thread/tokenUsage/updated', { turnId: id, tokenUsage: { last: { outputTokens: output } } });
    manager.notification('turn/completed', { turnId: id, turn: { id, status: 'completed' } });
    now += 100;
  };
  finish({ id: 'clean' });
  finish({ id: 'tool', tool: true, output: 500 });
  finish({ id: 'compact', compact: true, output: 5000 });
  const state = manager.publicState();
  assert.equal(state.sampleCount, 2);
  assert.equal(state.latest.includesTools, true);
  assert.equal(state.average.sampleCount, 1);
  assert.equal(state.average.tokensPerSecond, 50);
});
