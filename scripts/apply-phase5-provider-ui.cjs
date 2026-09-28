'use strict';

const fs = require('node:fs');

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); }
function replaceOnce(file, before, after, label) {
  const source = read(file);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}

replaceOnce('src/renderer/provider-usage-panel.js',
`(function expose(root, factory) {
  const api = factory(root.LittleBotProviderUsage);
  if (typeof module === 'object' && module.exports) module.exports = api;`,
`(function expose(root, factory) {
  const model = typeof module === 'object' && module.exports ? require('./provider-usage-ui.js') : root.LittleBotProviderUsage;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;`,
'provider panel CommonJS model');

replaceOnce('src/controller.cjs',
`  async refreshProviderUsage() { return this.providerUsage.refresh(); }`,
`  async refreshProviderUsage() {
    await this.providerUsage.refresh();
    return this.state();
  }`,
'provider usage refresh state');

replaceOnce('src/renderer/index.html',
`  <link rel="stylesheet" href="./styles.css">
  <link rel="stylesheet" href="./goal-ledger.css">`,
`  <link rel="stylesheet" href="./styles.css">
  <link rel="stylesheet" href="./provider-usage.css">
  <link rel="stylesheet" href="./goal-ledger.css">`,
'provider usage stylesheet');

replaceOnce('src/renderer/index.html',
`  <script src="./independent-check.js" defer></script>
  <script src="./standing-intents-ui.js" defer></script>`,
`  <script src="./independent-check.js" defer></script>
  <script src="./provider-usage-ui.js" defer></script>
  <script src="./provider-usage-panel.js" defer></script>
  <script src="./standing-intents-ui.js" defer></script>`,
'provider usage scripts');

replaceOnce('src/renderer/index.html',
`      <div id="settings-codex-account" class="settings-row"><div><strong id="settings-account">Codex account</strong><p id="settings-account-detail">ChatGPT or an OpenAI API key.</p></div><button id="settings-login" class="button secondary">Connect</button></div>
    </section>
    <div class="settings-section"><h3>Workspace</h3>`,
`      <div id="settings-codex-account" class="settings-row"><div><strong id="settings-account">Codex account</strong><p id="settings-account-detail">ChatGPT or an OpenAI API key.</p></div><button id="settings-login" class="button secondary">Connect</button></div>
    </section>
    <section class="settings-section provider-usage-section" aria-labelledby="provider-usage-title">
      <div class="provider-usage-heading"><div class="provider-usage-heading-copy"><h3 id="provider-usage-title">Provider usage</h3><p id="provider-usage-subtitle" class="field-hint"></p></div><div class="provider-usage-heading-actions"><span id="provider-usage-status" class="service-status provider-usage-status" role="status">Loading</span><button id="provider-usage-refresh" class="button text-button" type="button">Refresh</button></div></div>
      <span id="provider-usage-updated" class="provider-usage-updated hidden"></span>
      <div id="provider-usage-content" class="provider-usage-content"></div>
      <p id="provider-usage-note" class="provider-usage-note"></p>
    </section>
    <div class="settings-section"><h3>Workspace</h3>`,
'provider usage settings markup');

replaceOnce('src/renderer/app.js',
`  renderConnection();
  renderSettings();
  if (currentView === 'chat') renderConversation();`,
`  renderConnection();
  renderSettings();
  window.LittleBotProviderUsagePanel?.render(state.providerUsage || null);
  if (currentView === 'chat') renderConversation();`,
'provider usage render');

replaceOnce('package.json',
`    "test:electron": "electron test/agent-side-panel-electron.cjs && electron test/calendar-electron.cjs && electron test/chat-scroll-electron.cjs && electron test/goal-ledger-electron.cjs && electron test/slash-commands-electron.cjs && electron test/standing-intents-electron.cjs",`,
`    "test:electron": "electron test/agent-side-panel-electron.cjs && electron test/calendar-electron.cjs && electron test/chat-scroll-electron.cjs && electron test/goal-ledger-electron.cjs && electron test/provider-usage-electron.cjs && electron test/slash-commands-electron.cjs && electron test/standing-intents-electron.cjs",`,
'provider usage Electron suite');

fs.writeFileSync('test/provider-usage-ui-wiring.test.cjs', `'use strict';

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
`, 'utf8');
