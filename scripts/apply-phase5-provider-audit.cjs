'use strict';

const fs = require('node:fs');

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); }
function replaceOnce(file, before, after, label) {
  const source = read(file);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}
const block = lines => lines.join('\n');

replaceOnce('src/provider-usage.cjs',
block([
  "const text = (value, maximum = 200) => typeof value === 'string'",
  "  ? value.replace(/[\\u0000-\\u001f\\u007f]/g, '').trim().slice(0, maximum) : '';",
  "const clampPercent = value => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;",
]),
block([
  "const text = (value, maximum = 200) => typeof value === 'string'",
  "  ? value.replace(/[\\u0000-\\u001f\\u007f]/g, '').trim().slice(0, maximum) : '';",
  "const scrub = value => String(value?.message || value || 'Provider usage unavailable.')",
  "  .replace(/\\bsk-[A-Za-z0-9_-]+/g, '[redacted]')",
  "  .replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret)[\\\"'\\s:=]+)[^\\s,}\\\"']+/gi, '$1[redacted]')",
  "  .slice(0, 500);",
  "const clampPercent = value => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;",
]),
'provider error redaction');

replaceOnce('src/provider-usage.cjs',
block([
  'function normalizeCredits(value) {',
  '  if (!object(value)) return null;',
  '  const balance = number(value.balance ?? value.remaining);',
  '  const result = {',
  "    hasCredits: typeof value.hasCredits === 'boolean' ? value.hasCredits",
  "      : typeof value.has_credits === 'boolean' ? value.has_credits : null,",
  "    unlimited: typeof value.unlimited === 'boolean' ? value.unlimited : null,",
  '    balance,',
  '  };',
]),
block([
  'function normalizeCredits(value) {',
  '  if (!object(value)) return null;',
  '  const balance = text(value.balance ?? value.remaining, 120) || null;',
  '  const result = {',
  "    hasCredits: typeof value.hasCredits === 'boolean' ? value.hasCredits",
  "      : typeof value.has_credits === 'boolean' ? value.has_credits : null,",
  "    unlimited: typeof value.unlimited === 'boolean' ? value.unlimited : null,",
  '    balance,',
  '  };',
]),
'provider credit balance');

replaceOnce('src/provider-usage.cjs',
"  const label = text(value.limitName ?? value.limit_name ?? value.name ?? value.label, 120) || bucketId;\n  return {",
block([
  "  const label = text(value.limitName ?? value.limit_name ?? value.name ?? value.label, 120) || bucketId;",
  "  const reachedType = text(value.rateLimitReachedType ?? value.rate_limit_reached_type ?? value.reachedType ?? value.reached_type, 80) || null;",
  "  const spendControlReached = value.spendControlReached === true || value.spend_control_reached === true;",
  "  const explicitReached = typeof value.limitReached === 'boolean' ? value.limitReached",
  "    : typeof value.limit_reached === 'boolean' ? value.limit_reached : null;",
  '  return {',
]),
'provider reached fields');

replaceOnce('src/provider-usage.cjs',
block([
  '    id: bucketId,',
  '    label,',
  '    primary,',
  '    secondary,',
  "    limitReached: typeof value.limitReached === 'boolean' ? value.limitReached",
  "      : typeof value.limit_reached === 'boolean' ? value.limit_reached : null,",
  '    reachedType: text(value.reachedType ?? value.reached_type, 80) || null,',
  '    credits: normalizeCredits(value.credits),',
]),
block([
  '    id: bucketId,',
  '    label,',
  "    plan: text(value.planType ?? value.plan_type, 80) || null,",
  '    primary,',
  '    secondary,',
  '    limitReached: explicitReached ?? (spendControlReached || Boolean(reachedType)),',
  '    reachedType,',
  '    spendControlReached,',
  '    credits: normalizeCredits(value.credits),',
]),
'provider bucket metadata');

replaceOnce('src/provider-usage.cjs',
"  const ordinaryUsageAllowed = typeof source.ordinaryUsageAllowed === 'boolean' ? source.ordinaryUsageAllowed\n    : typeof source.ordinary_usage_allowed === 'boolean' ? source.ordinary_usage_allowed : null;\n  return {",
block([
  "  const ordinaryUsageAllowed = typeof source.ordinaryUsageAllowed === 'boolean' ? source.ordinaryUsageAllowed",
  "    : typeof source.ordinary_usage_allowed === 'boolean' ? source.ordinary_usage_allowed : null;",
  '  const providerPlan = buckets.map(bucket => bucket.plan).find(Boolean) || null;',
  '  return {',
]),
'provider plan source');

replaceOnce('src/provider-usage.cjs',
"    plan: text(source.planType ?? source.plan_type ?? plan, 80) || null,",
"    plan: text(source.planType ?? source.plan_type ?? plan, 80) || providerPlan,",
'provider plan fallback');

replaceOnce('src/provider-usage.cjs',
"    this.refreshing = null;\n    this.turns = new Map();",
"    this.refreshing = null;\n    this.refreshAgain = false;\n    this.turns = new Map();",
'provider refresh queue state');

replaceOnce('src/provider-usage.cjs',
block([
  '  async refresh() {',
  '    if (this.refreshing) return this.refreshing;',
  '    this.refreshing = this._refresh();',
  '    try { return await this.refreshing; } finally { this.refreshing = null; }',
  '  }',
]),
block([
  '  async refresh() {',
  '    if (this.refreshing) return this.refreshing;',
  '    this.refreshing = this._refresh();',
  '    try { return await this.refreshing; } finally {',
  '      this.refreshing = null;',
  '      if (this.refreshAgain) { this.refreshAgain = false; this.requestRefresh(); }',
  '    }',
  '  }',
  '',
  '  requestRefresh() {',
  '    if (this.refreshing) { this.refreshAgain = true; return; }',
  '    void this.refresh();',
  '  }',
]),
'provider refresh queue');

replaceOnce('src/provider-usage.cjs',
"        ordinaryUsageAllowed: null, buckets: [], error: text(error?.message || error, 500) || 'Provider limits are unavailable.',",
"        ordinaryUsageAllowed: null, buckets: [], error: text(scrub(error), 500) || 'Provider limits are unavailable.',",
'provider error scrub');

replaceOnce('src/provider-usage.cjs',
block([
  "    if (method === 'account/rateLimits/updated') {",
  "      if (normalizeConnection(this.connection()).type !== 'codex') return false;",
  "      this.state = normalizeRateLimits(params, { now: this.now(), plan: this.account()?.plan });",
  '      this.changed(); return true;',
  '    }',
]),
block([
  "    if (method === 'account/rateLimits/updated') {",
  "      if (normalizeConnection(this.connection()).type !== 'codex') return false;",
  '      // Rolling notifications are sparse; preserve the last full snapshot and refetch.',
  '      this.requestRefresh();',
  '      return true;',
  '    }',
]),
'sparse provider update');

replaceOnce('src/provider-usage.cjs',
"    const generatedTokens = outputTokens + reasoningTokens;",
"    // Codex reports reasoning as a subset of output tokens; never count it twice.\n    const generatedTokens = outputTokens;",
'local output token accounting');

replaceOnce('src/controller.cjs',
"    await this.providerUsage.refresh();\n    this.changed();",
"    this.providerUsage.connectionChanged(this.connection);\n    void this.providerUsage.refresh();\n    this.changed();",
'nonblocking provider refresh');

replaceOnce('src/renderer/provider-usage-panel.js',
"      metric(doc, 'Generated tokens', view.latest.generatedTokens, `${view.latest.outputTokens} output · ${view.latest.reasoningTokens} reasoning`),",
"      metric(doc, 'Generated tokens', view.latest.generatedTokens, `${view.latest.outputTokens} output · ${view.latest.reasoningTokens} reasoning subset`),",
'local reasoning subset label');

replaceOnce('test/provider-usage-fixture.js',
'      tokensPerSecond: 48.5, firstOutputMs: 650, durationMs: 3200, generatedTokens: 140,',
'      tokensPerSecond: 48.5, firstOutputMs: 650, durationMs: 3200, generatedTokens: 110,',
'local fixture output accounting');

replaceOnce('test/provider-usage.test.cjs',
block([
  "test('reads Codex rate limits and accepts push updates without affecting failures', async () => {",
  '  let now = 1000;',
  '  const calls = [];',
  '  let changed = 0;',
  '  const manager = new ProviderUsage({',
  '    client: { request: async (method, params) => {',
  '      calls.push([method, params]);',
  '      return { rateLimits: { primary: { usedPercent: 25, resetsAt: 1800000000 } } };',
  '    } },',
  "    connection: () => ({ type: 'codex', status: 'connected' }),",
  "    account: () => ({ status: 'connected', plan: 'plus' }),",
  '    onChange: () => changed++, now: () => now,',
  '  });',
  '  const result = await manager.refresh();',
  "  assert.deepEqual(calls, [['account/rateLimits/read', {}]]);",
  "  assert.equal(result.status, 'ready');",
  '  assert.equal(result.buckets[0].primary.remainingPercent, 75);',
  '  now = 2000;',
  "  assert.equal(manager.notification('account/rateLimits/updated', {",
  "    rateLimitsByLimitId: { main: { name: 'Main', primary: { usedPercent: 40 } } },",
  '  }), true);',
  '  assert.equal(manager.publicState().buckets[0].primary.remainingPercent, 60);',
  '  assert.ok(changed >= 3);',
  '});',
]),
block([
  "test('reads Codex limits and refetches sparse rolling updates without erasing the snapshot', async () => {",
  '  let now = 1000;',
  '  const calls = [];',
  '  let resolveSecond;',
  '  const manager = new ProviderUsage({',
  '    client: { request: async (method, params) => {',
  '      calls.push([method, params]);',
  '      if (calls.length === 1) return { rateLimits: { primary: { usedPercent: 25, resetsAt: 1800000000 } } };',
  '      return new Promise(resolve => { resolveSecond = resolve; });',
  '    } },',
  "    connection: () => ({ type: 'codex', status: 'connected' }),",
  "    account: () => ({ status: 'connected', plan: 'plus' }),",
  '    now: () => now,',
  '  });',
  '  const first = await manager.refresh();',
  '  assert.equal(first.buckets[0].primary.remainingPercent, 75);',
  '  now = 2000;',
  "  assert.equal(manager.notification('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 40 } } }), true);",
  '  assert.equal(manager.publicState().buckets[0].primary.remainingPercent, 75);',
  '  const pending = manager.refresh();',
  '  resolveSecond({ ordinaryUsageAllowed: false, rateLimitsByLimitId: { main: { limitName: \'Main\', primary: { usedPercent: 40 } } } });',
  '  await pending;',
  '  assert.equal(calls.length, 2);',
  '  assert.equal(manager.publicState().buckets[0].primary.remainingPercent, 60);',
  '  assert.equal(manager.publicState().ordinaryUsageAllowed, false);',
  '});',
]),
'sparse update test');

replaceOnce('test/provider-usage.test.cjs',
'  assert.equal(state.latest.generatedTokens, 100);',
'  assert.equal(state.latest.generatedTokens, 80);',
'local generated output test');
replaceOnce('test/provider-usage.test.cjs',
'  assert.equal(state.latest.tokensPerSecond, 100);',
'  assert.equal(state.latest.tokensPerSecond, 80);',
'local output rate test');
