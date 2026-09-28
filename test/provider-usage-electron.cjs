'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

async function run() {
  await app.whenReady();
  const errors = [];
  const window = new BrowserWindow({ show: false, width: 600, height: 620, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  try {
    await window.loadFile(path.join(__dirname, 'provider-usage-fixture.html'));
    const codex = await window.webContents.executeJavaScript(`
      (async () => {
        for (let index = 0; index < 100 && !window.__providerUsageMounted; index++) await new Promise(resolve => setTimeout(resolve, 10));
        if (!window.__providerUsageMounted) throw new Error('Timed out waiting for provider usage.');
        return {
          title: document.getElementById('provider-usage-title').textContent,
          subtitle: document.getElementById('provider-usage-subtitle').textContent,
          windows: Array.from(document.querySelectorAll('.provider-usage-window')).map(node => node.textContent),
          progress: Array.from(document.querySelectorAll('.provider-usage-progress')).map(node => Number(node.value)),
          note: document.getElementById('provider-usage-note').textContent,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      })()
    `);
    assert.equal(codex.title, 'Provider usage');
    assert.equal(codex.subtitle, 'Codex · plus');
    assert.equal(codex.windows.length, 2);
    assert.match(codex.windows[0], /75% remaining/);
    assert.deepEqual(codex.progress, [25, 60]);
    assert.match(codex.note, /does not change goal token/i);
    assert.equal(codex.overflow, false);

    const local = await window.webContents.executeJavaScript(`
      (() => {
        window.__renderLocalUsage();
        return {
          title: document.getElementById('provider-usage-title').textContent,
          subtitle: document.getElementById('provider-usage-subtitle').textContent,
          metrics: document.getElementById('provider-usage-content').textContent,
          note: document.getElementById('provider-usage-note').textContent,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      })()
    `);
    assert.equal(local.title, 'Local performance');
    assert.equal(local.subtitle, 'Qwen local');
    assert.match(local.metrics, /48\.5 tok\/s/);
    assert.match(local.metrics, /Tool-free rolling average/);
    assert.match(local.metrics, /Turn included tools/);
    assert.match(local.note, /not a price, quota, or model benchmark/i);
    assert.equal(local.overflow, false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ codex, local }));
  } finally {
    window.destroy();
    app.quit();
  }
}

run().catch(error => { console.error(error.stack || error); app.exit(1); });
