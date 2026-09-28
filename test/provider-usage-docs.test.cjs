'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('public documentation describes provider usage as read-only and independent from goal budgets', () => {
  const readme = read('README.md');
  const connections = read('CONNECTIONS.md');
  const usage = read('USAGE.md');
  assert.match(readme, /USAGE\.md/);
  assert.match(connections, /account\/rateLimits\/read/);
  assert.match(connections, /Goal token, time, action, run, and retry limits remain separate/i);
  assert.match(usage, /does not estimate prices/i);
  assert.match(usage, /Independent goal budgets/i);
  assert.match(usage, /not written to `state\.json`/i);
});

test('documentation records sparse quota refetch and output-token semantics', () => {
  const usage = read('USAGE.md');
  assert.match(usage, /notification contains one sparse rate-limit snapshot/i);
  assert.match(usage, /requests a fresh `account\/rateLimits\/read` result/i);
  assert.match(usage, /reasoning tokens as a subset of output tokens/i);
  assert.match(usage, /not added to output tokens again/i);
  assert.match(usage, /Tool-containing turns.*excluded from the rolling throughput average/is);
});

test('the roadmap lists provider usage as an implemented foundation', () => {
  const next = read('NEXT.md');
  assert.match(next, /\[Provider usage and local performance\]\(USAGE\.md\)/);
  assert.doesNotMatch(next, /\d+\. \*\*Provider usage display/);
});
