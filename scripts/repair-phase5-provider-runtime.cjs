'use strict';

const fs = require('node:fs');
const file = 'scripts/apply-phase5-provider-runtime.cjs';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const replacements = [
  ["  assert.match(read('src/provider-usage.cjs'),", "  assert.ok(read('src/provider-usage.cjs').includes('account/rateLimits/read'));"],
  ["  assert.match(read('src/main.cjs'),", "  assert.ok(read('src/main.cjs').includes(\"register('refreshProviderUsage'\"));"],
  ["  assert.match(read('src/preload.cjs'),", "  assert.ok(read('src/preload.cjs').includes(\"refreshProviderUsage: invoke('refreshProviderUsage')\"));"],
];
for (const [prefix, replacement] of replacements) {
  const lines = source.split('\n');
  const matches = lines.map((line, index) => line.startsWith(prefix) ? index : -1).filter(index => index >= 0);
  if (matches.length !== 1) throw new Error(`runtime assertion repair for ${prefix}: expected one line, found ${matches.length}.`);
  lines[matches[0]] = replacement;
  source = lines.join('\n');
}
fs.writeFileSync(file, source, 'utf8');
