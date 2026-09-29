'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'little-bot-ui-test-')));

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try {
    await window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const result = await window.webContents.executeJavaScript(`
      (() => {
        const button = document.getElementById('agent-inspector-toggle');
        const panel = document.getElementById('agent-inspector');
        const close = document.getElementById('agent-inspector-close');
        const initial = panel.classList.contains('hidden');
        button.click();
        const opened = !panel.classList.contains('hidden') && button.getAttribute('aria-pressed') === 'true';
        const status = document.getElementById('inspector-status').textContent;
        const mode = document.getElementById('inspector-mode').textContent;
        close.click();
        const closed = panel.classList.contains('hidden') && button.getAttribute('aria-pressed') === 'false';
        return { initial, opened, status, mode, closed };
      })()
    `);
    assert.equal(result.initial, true);
    assert.equal(result.opened, true);
    assert.equal(result.status, 'No conversation');
    assert.equal(result.mode, 'Execute');
    assert.equal(result.closed, true);
    console.log(JSON.stringify(result));
  } finally {
    window.destroy();
    app.quit();
  }
}

run().catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
