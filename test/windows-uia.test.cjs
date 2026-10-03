'use strict';

// Drives a real WinForms window through the windows_ui tool and the actual PowerShell UI Automation bridge.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { WindowsUia } = require('../src/windows-uia.cjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await wait(150);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
const refOf = (elements, pattern) => (elements.split('\n').find(line => pattern.test(line)) || '').match(/\[ref=(u\d+)\]/)?.[1];

// Needs an interactive desktop: runs on the PC, skipped on CI runners.
const windowsOnly = process.platform === 'win32' && !process.env.CI ? test : test.skip;
windowsOnly('windows_ui lists, reads and operates a real window, one action per fresh look', { timeout: 120000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-uia-'));
  const readyFile = path.join(root, 'ready.json');
  const title = `Little Bot UIA Fixture ${randomUUID()}`;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const fixture = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'windows-uia-fixture.ps1'), '-Title', title, '-ReadyFile', readyFile], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let fixtureError = '';
  fixture.stderr.on('data', chunk => { fixtureError = (fixtureError + chunk.toString('utf8')).slice(-10000); });
  const uia = new WindowsUia({ root, platform: 'win32' });
  t.after(async () => { await uia.close(); try { fixture.kill(); } catch {} await fs.rm(root, { recursive: true, force: true }); });
  await waitFor(async () => {
    try { return JSON.parse((await fs.readFile(readyFile, 'utf8')).replace(/^\uFEFF/, '')); }
    catch { if (fixtureError) throw new Error(fixtureError); return null; }
  }, 'WinForms fixture');

  const context = { owner: 'chat-1', isActive: () => true };
  const call = args => uia.tool(args, context);
  assert.equal(uia.specs().length, 1);
  assert.equal(uia.specs()[0].name, 'windows_ui');

  const listed = await call({ action: 'list_windows' });
  const window = listed.windows.find(item => item.title === title)?.window;
  assert.ok(window, `fixture window missing from: ${listed.windows.map(item => item.title).join(', ')}`);

  let look = await call({ action: 'snapshot', window });
  // Plain Win32/WinForms controls come through as real types with actions, not bare panes.
  assert.match(look.elements, /- Edit .*\[ref=u\d+\]/, look.elements);
  assert.match(look.elements, /- Button "Save" \[ref=u\d+\]/);
  await call({ action: 'set_value', ref: refOf(look.elements, /- Edit /), value: 'Ada' });
  // One action per look: a second action without looking again is refused.
  await assert.rejects(call({ action: 'click', ref: refOf(look.elements, /Button "Save"/) }), /Observe this window again/);

  look = await call({ action: 'find', window, controlType: 'CheckBox' });
  await call({ action: 'select', ref: refOf(look.elements, /CheckBox "Agree"/), selected: true });
  look = await call({ action: 'snapshot', window });
  assert.match(look.elements, /CheckBox "Agree" \[checked\]/);
  assert.match(look.elements, /- Edit .*\[value="Ada"\]/);
  await call({ action: 'set_value', ref: refOf(look.elements, /- ComboBox /), value: 'Beta' });
  look = await call({ action: 'snapshot', window });
  await call({ action: 'click', ref: refOf(look.elements, /Button "Save"/) });

  await waitFor(async () => (await call({ action: 'find', window, containsName: 'Saved:Ada:True:Beta' })).elements.includes('Saved:Ada:True:Beta'), 'saved status');
  await assert.rejects(call({ action: 'click', ref: 'u999' }), /Unknown reference/);
  await assert.rejects(call({ action: 'click' }), /needs a ref/);
  await assert.rejects(call({ action: 'nope' }), /Choose a windows_ui action/);

  const shot = await call({ action: 'screenshot', window });
  assert.ok((await fs.stat(shot.path)).size > 1000);
});
