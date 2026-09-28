'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeRateLimits, ProviderUsage } = require('../src/provider-usage.cjs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('normalizes the pinned Codex rate-limit snapshot fields', () => {
  const result = normalizeRateLimits({
    ordinaryUsageAllowed: false,
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex', limitName: 'Codex', normalModelSlug: 'gpt-example', planType: 'plus',
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1800000000 },
        secondary: null, credits: { hasCredits: true, unlimited: false, balance: '12.50' },
        spendControlReached: false, rateLimitReachedType: 'primary',
      },
      reserve: {
        limitId: 'reserve', limitName: 'Reserve', primary: { usedPercent: 20 },
        spendControlReached: true, rateLimitReachedType: null,
      },
    },
  }, { now: 5000 });
  assert.equal(result.status, 'ready');
  assert.equal(result.plan, 'plus');
  assert.equal(result.ordinaryUsageAllowed, false);
  assert.equal(result.buckets[0].id, 'codex');
  assert.equal(result.buckets[0].limitReached, true);
  assert.equal(result.buckets[0].reachedType, 'primary');
  assert.equal(result.buckets[0].credits.balance, '12.50');
  assert.equal(result.buckets[1].limitReached, true);
  assert.equal(result.buckets[1].spendControlReached, true);
});

test('a sparse update arriving during a read queues one follow-up full refetch', async () => {
  const responses = [];
  let resolveFirst;
  const manager = new ProviderUsage({
    client: { request: async () => {
      responses.push(responses.length + 1);
      if (responses.length === 1) return new Promise(resolve => { resolveFirst = resolve; });
      return { rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: 30 } } } };
    } },
    connection: () => ({ type: 'codex', status: 'connected' }),
    account: () => ({ status: 'connected' }),
  });
  const first = manager.refresh();
  assert.equal(manager.notification('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 30 } } }), true);
  resolveFirst({ rateLimits: { primary: { usedPercent: 20 } } });
  await first;
  for (let index = 0; index < 20 && responses.length < 2; index++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(responses.length, 2);
  await manager.refresh();
  assert.equal(manager.publicState().buckets[0].primary.remainingPercent, 70);
});

test('provider errors are scrubbed before entering renderer state', async () => {
  const manager = new ProviderUsage({
    client: { request: async () => { throw new Error('api_key=super-secret sk-visible'); } },
    connection: () => ({ type: 'codex', status: 'connected' }),
    account: () => ({ status: 'connected' }),
  });
  const result = await manager.refresh();
  assert.equal(result.status, 'unavailable');
  assert.doesNotMatch(result.error, /super-secret|sk-visible/);
  assert.match(result.error, /\[redacted\]/);
});

test('provider telemetry is exposed as transient state rather than an execution budget', () => {
  const controller = read('src/controller.cjs');
  assert.ok(controller.includes('providerUsage: this.providerUsage.publicState()'));
  assert.ok(controller.includes("async refreshProviderUsage()"));
  assert.equal(read('src/store.cjs').includes('providerUsage'), false);
  assert.equal(read('src/goals.cjs').includes('providerUsage'), false);
});

test('local output accounting treats reasoning tokens as a reported output subset', () => {
  const source = read('src/provider-usage.cjs');
  assert.ok(source.includes('const generatedTokens = outputTokens;'));
  assert.equal(source.includes('outputTokens + reasoningTokens'), false);
  assert.ok(read('src/renderer/provider-usage-panel.js').includes('reasoning subset'));
});
