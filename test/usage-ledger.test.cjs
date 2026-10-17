'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UsageLedger, normalizeUsage, dayKey } = require('../src/usage-ledger.cjs');

test('the usage ledger counts each request by day, source, model and hour, with honest speeds', async () => {
  let saved = 0, clock = new Date(2026, 9, 17, 14, 30).getTime();
  const store = { data: {} };
  const ledger = new UsageLedger({ store, now: () => clock, persist: () => { saved++; }, persistMs: 0 });
  ledger.record({ source: 'conversation', model: 'qwen', input: 1000, cached: 800, output: 100, startedAt: clock - 3000, firstByteAt: clock - 2000, finishedAt: clock });
  ledger.record({ source: 'heartbeat', model: 'qwen', input: 500, cached: 0, output: 50, finishedAt: clock });
  ledger.record({ source: 'nonsense', model: 'qwen', input: 10, cached: 50, output: 0, finishedAt: clock });
  ledger.record({ source: 'conversation', input: 0, output: 0, finishedAt: clock });
  const yesterday = clock - 24 * 3600000;
  ledger.record({ source: 'sessions', model: 'qwen', input: 200, cached: 100, output: 20, finishedAt: yesterday });
  const summary = ledger.summary({ days: 7 });
  assert.equal(summary.days.length, 7);
  assert.deepEqual(summary.totals, { requests: 4, input: 1710, cached: 910, output: 170 });
  const today = summary.days.at(-1);
  assert.equal(today.day, dayKey(clock));
  assert.deepEqual(today.groups, { chats: 100, background: 50, memory: 0, checks: 0, compaction: 0 });
  assert.equal(summary.sources.find(source => source.id === 'other').cached, 10, 'cached never exceeds input');
  assert.equal(summary.hours[14], 170, 'hours add up across the range: today 150, yesterday 20');
  assert.equal(summary.generation.tokensPerSecond, 50, 'only the request with timing: 100 tokens in 2 s');
  assert.equal(summary.prefill.tokensPerSecond, 200, '200 fresh prompt tokens in 1 s');
  assert.equal(summary.streak, 2);
  assert.equal(summary.models[0].id, 'qwen');
  // A day saved with fractional or missing timing can never inflate the speed.
  store.data.usage.days['2026-10-10'] = { requests: 1, input: 10, output: 9000, genTokens: 9000, genMs: 0.4 };
  store.data.usage = normalizeUsage(store.data.usage);
  assert.equal(ledger.summary({ days: 0 }).generation.tokensPerSecond, 50);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(saved, 1, 'one debounced save for a burst of requests');
  ledger.close();
});
