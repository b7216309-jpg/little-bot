'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('controller exposes transient provider usage and observes all engine turns', () => {
  const controller = read('src/controller.cjs');
  assert.match(controller, /new ProviderUsage/);
  assert.match(controller, /providerUsage: this.providerUsage.publicState()/);
  assert.ok(controller.includes('this.providerUsage.notification(method, params)'));
  assert.ok(read('src/provider-usage.cjs').includes('account/rateLimits/read'));
  assert.doesNotMatch(read('src/store.cjs'), /providerUsage/);
});

test('provider usage refresh is exposed through trusted IPC only', () => {
  assert.ok(read('src/main.cjs').includes("register('refreshProviderUsage'"));
  assert.ok(read('src/preload.cjs').includes("refreshProviderUsage: invoke('refreshProviderUsage')"));
});
