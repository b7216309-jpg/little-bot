// Focused Settings flow with fake keys in the isolated smoke profile. No provider requests.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { safeStorage } = require('electron');

async function run({ window, controller, store, output }) {
  assert.ok(process.env.LITTLE_BOT_DATA_DIR, 'Web Settings smoke requires an isolated profile.');
  assert.ok(controller.webServices, 'The service vault must be connected.');
  assert.equal(safeStorage.isEncryptionAvailable(), true);
  const js = code => window.webContents.executeJavaScript(code);
  const until = async (predicate, message) => {
    for (let i = 0; i < 40; i++) { if (await predicate()) return; await delay(100); }
    throw new Error(message || 'Web Settings smoke timed out.');
  };
  const setInput = (id, value) => js(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)}; document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('input',{bubbles:true}));`);
  const configured = service => controller.webServices.getState()[service].configured;
  const keys = { firecrawl: 'fc-smoke-fixture-never-a-real-key', brave: 'brave-smoke-fixture-never-a-real-key' };
  await js("document.getElementById('nav-settings').click()");
  assert.equal(await js("document.getElementById('settings-dialog').open"), true);

  for (const [service, key] of Object.entries(keys)) {
    await setInput(`service-${service}-key`, key);
    controller.changed(); await delay(100);
    assert.equal(await js(`document.getElementById('service-${service}-key').value`), key, 'Service key drafts must survive state events.');
    await js(`document.getElementById('service-${service}-form').requestSubmit()`);
    await until(() => configured(service), `${service} did not save through Settings IPC.`);
    await until(async () => await js(`document.getElementById('service-${service}-key').value`) === '', 'Saved keys must leave the password input empty.');
    assert.equal(await js(`document.getElementById('service-${service}-save').disabled`), true);
    assert.match(await js(`document.getElementById('service-${service}-status').textContent`), /Key saved/);
    await js(`document.getElementById('service-${service}-form').requestSubmit()`);
    const reply = await js(`window.bot.saveServiceKey({service:'${service}',apiKey:''})`);
    assert.equal(reply.webServices[service].configured, true, 'Blank key saves must preserve the saved key.');
  }

  const returned = JSON.stringify(await js('window.bot.getState()'));
  const stateFile = await fs.readFile(store.filePath, 'utf8');
  const vaultText = await fs.readFile(controller.webServices.file, 'utf8');
  const vault = JSON.parse(vaultText);
  for (const [service, key] of Object.entries(keys)) {
    assert.equal(returned.includes(key), false, 'Returned app state must not contain service secrets.');
    assert.equal(stateFile.includes(key), false, 'Ordinary settings must not contain service secrets.');
    assert.equal(vaultText.includes(key), false, 'The vault must not contain plaintext keys.');
    assert.equal(safeStorage.decryptString(Buffer.from(vault.keys[service], 'base64')), key, 'Keys must round-trip through real Windows secure storage.');
  }

  const originalPercent = store.data.settings.autoCompactPercent;
  await setInput('settings-auto-compact', '42');
  controller.changed(); await delay(100);
  assert.equal(await js("document.getElementById('settings-auto-compact').value"), '42', 'Compaction drafts must survive state events.');
  await js("document.getElementById('compaction-settings-form').requestSubmit()");
  await until(() => store.data.settings.autoCompactPercent === 42, 'Compaction percentage did not save.');
  await until(async () => await js("document.getElementById('compaction-settings-saved').textContent") === 'Saved');
  assert.equal(JSON.parse(await fs.readFile(store.filePath, 'utf8')).settings.autoCompactPercent, 42);
  await setInput('settings-auto-compact', '19');
  await js("document.getElementById('compaction-settings-form').requestSubmit()");
  assert.equal(store.data.settings.autoCompactPercent, 42);
  assert.equal(await js("document.getElementById('compaction-settings-error').classList.contains('hidden')"), false);
  await setInput('settings-auto-compact', '0');
  await js("document.getElementById('compaction-settings-form').requestSubmit()");
  await until(() => store.data.settings.autoCompactPercent === 0);
  await until(async () => await js("document.getElementById('settings-auto-compact').disabled") === false);
  await setInput('settings-auto-compact', String(originalPercent));
  await js("document.getElementById('compaction-settings-form').requestSubmit()");
  await until(() => store.data.settings.autoCompactPercent === originalPercent);

  await js("document.getElementById('settings-dialog').scrollTop=0; document.getElementById('toast').classList.add('hidden')");
  await delay(150);
  await fs.writeFile(path.join(output, 'browser-settings.png'), (await window.webContents.capturePage()).toPNG());
  await js("document.getElementById('services-settings-title').scrollIntoView({block:'start'})");
  await delay(150);
  await fs.writeFile(path.join(output, 'service-settings.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(900, 720); await delay(150);
  assert.equal(await js("document.documentElement.scrollWidth > innerWidth || document.getElementById('settings-dialog').scrollWidth > document.getElementById('settings-dialog').clientWidth"), false, 'Settings must fit the minimum window width.');
  await fs.writeFile(path.join(output, 'service-settings-compact.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(1240, 860);

  await js("document.getElementById('service-firecrawl-remove').click()");
  await until(() => !configured('firecrawl'));
  assert.equal(configured('brave'), true, 'Removing one provider must preserve the other.');
  await js("document.getElementById('service-brave-remove').click()");
  await until(() => !configured('brave'));
  await until(async () => await js("document.getElementById('service-brave-key').disabled") === false);
  await setInput('service-brave-key', keys.brave);
  await js("document.querySelector('[data-close=\"settings-dialog\"]').click()");
  await until(async () => await js("document.getElementById('service-brave-key').value") === '', 'Closing Settings must clear unsaved secret inputs.');
  return { settingsThroughIpc: true, secureStorage: true, secretStateExcluded: true, blankPreservesKey: true, independentKeyRemoval: true, percentageRoundTrip: true, settingsDraftsPreserved: true };
}
module.exports = { run };
