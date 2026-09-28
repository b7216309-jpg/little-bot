'use strict';

const fs = require('node:fs');

function replaceOnce(file, before, after, label) {
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}

replaceOnce('src/provider-usage.cjs',
`    if (!client || typeof client.request !== 'function') throw new TypeError('A provider usage client is required.');
    if (typeof connection !== 'function' || typeof account !== 'function' || typeof onChange !== 'function' || typeof now !== 'function') {
      throw new TypeError('Provider usage callbacks must be functions.');
    }
    this.client = client;`,
`    if (typeof connection !== 'function' || typeof account !== 'function' || typeof onChange !== 'function' || typeof now !== 'function') {
      throw new TypeError('Provider usage callbacks must be functions.');
    }
    this.client = client && typeof client.request === 'function' ? client : {
      request: async () => { throw new Error('Provider usage is unavailable for this runtime.'); },
    };`,
'optional provider usage client');

const file = 'scripts/apply-phase5-provider-runtime.cjs';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const replacements = [
  ["  assert.match(controller, /this\\.providerUsage\\.notification", "  assert.ok(controller.includes('this.providerUsage.notification(method, params)'));"],
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
