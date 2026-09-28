'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Settings loads provider usage modules before app startup', () => {
  const html = read('src/renderer/index.html');
  assert.ok(html.indexOf('provider-usage-ui.js') < html.indexOf('provider-usage-panel.js'));
  assert.ok(html.indexOf('provider-usage-panel.js') < html.indexOf('app.js'));
  assert.ok(html.includes('id="provider-usage-content"'));
  assert.ok(html.includes('id="provider-usage-refresh"'));
  assert.ok(read('src/renderer/app.js').includes('LittleBotProviderUsagePanel?.render(state.providerUsage'));
});

test('provider usage remains a read-only display with a retained Electron fixture', () => {
  const panel = read('src/renderer/provider-usage-panel.js');
  assert.ok(panel.includes('refreshProviderUsage'));
  assert.equal(/saveProviderUsage|setRateLimit|setBudget/.test(panel), false);
  assert.ok(read('package.json').includes('provider-usage-electron.cjs'));
});
