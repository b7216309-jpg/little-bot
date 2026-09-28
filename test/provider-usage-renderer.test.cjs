'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../src/renderer/provider-usage-ui.js');

test('formats provider windows and reset timing without guessing', () => {
  assert.equal(ui.durationLabel(300), '5-hour window');
  assert.equal(ui.durationLabel(10080), '7-day window');
  assert.equal(ui.durationLabel(null), '');
  assert.equal(ui.resetLabel(1000 + 90 * 60000, 1000), 'Resets in 1h 30m');
  assert.equal(ui.resetLabel(null, 1000), 'Reset time unavailable');
});

test('builds a truthful multi-bucket Codex view', () => {
  const view = ui.view({
    kind: 'codex', status: 'ready', plan: 'plus', updatedAt: 1000, ordinaryUsageAllowed: true,
    buckets: [
      { id: 'main', label: 'Codex', primary: { usedPercent: 20, remainingPercent: 80, windowDurationMinutes: 300, resetsAt: 1000 + 3600000 } },
      { id: 'review', label: 'Review', primary: { usedPercent: null, remainingPercent: null, resetsAt: null } },
    ],
  }, 1000);
  assert.equal(view.title, 'Provider usage');
  assert.equal(view.subtitle, 'Codex · plus');
  assert.equal(view.buckets[0].windows[0].label, '5-hour window');
  assert.equal(view.buckets[0].windows[0].usageLabel, '80% remaining');
  assert.equal(view.buckets[1].windows[0].usageLabel, 'Usage percentage unavailable');
  assert.match(view.note, /does not change goal token/i);
});

test('builds local performance metrics with explicit tool and benchmark caveats', () => {
  const view = ui.view({
    kind: 'local', status: 'ready', model: 'Qwen', updatedAt: 2000, sampleCount: 2,
    latest: {
      tokensPerSecond: 42.25, firstOutputMs: 800, durationMs: 2500, generatedTokens: 100,
      outputTokens: 80, reasoningTokens: 20, inputTokens: 500, cachedInputTokens: 300, includesTools: true,
    },
    average: { tokensPerSecond: 40, sampleCount: 1 },
  });
  assert.equal(view.title, 'Local performance');
  assert.equal(view.latest.tokensPerSecond, '42.3 tok/s');
  assert.equal(view.latest.firstOutput, '800 ms');
  assert.equal(view.latest.includesTools, true);
  assert.equal(view.average.tokensPerSecond, '40.0 tok/s');
  assert.match(view.note, /not a price, quota, or model benchmark/i);
});

test('unavailable states do not imply remaining allowance or speed', () => {
  const codex = ui.view({ kind: 'codex', status: 'unavailable', buckets: [], error: 'No limit data' });
  assert.equal(codex.buckets.length, 0);
  assert.equal(codex.message, 'No limit data');
  const local = ui.view({ kind: 'local', status: 'waiting', latest: null });
  assert.equal(local.latest, null);
  assert.match(local.message, /Complete a local model turn/);
});
