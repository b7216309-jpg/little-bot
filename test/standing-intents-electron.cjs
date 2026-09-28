'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  try {
    await window.loadFile(path.join(__dirname, 'standing-intents-fixture.html'));
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        const wait = async predicate => {
          for (let index = 0; index < 100; index++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
          throw new Error('Timed out waiting for Standing Intents UI.');
        };
        await wait(() => document.getElementById('create-standing-intent'));
        const notice = document.getElementById('standing-intents-section').textContent.includes('Foreground only');
        document.getElementById('create-standing-intent').click();
        const dialog = document.getElementById('standing-intent-dialog');
        const dialogOpen = dialog.open;
        document.getElementById('standing-intent-name').value = 'Review CSV changes';
        document.getElementById('standing-intent-event').value = 'file.changed';
        document.getElementById('standing-intent-filter-path').value = 'path';
        document.getElementById('standing-intent-filter-operator').value = 'glob';
        document.getElementById('standing-intent-filter-value').value = 'reports/*.csv';
        document.getElementById('standing-intent-action').value = 'goal.run';
        document.getElementById('standing-intent-action').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('standing-intent-target').value = 'goal-1';
        document.getElementById('standing-intent-debounce').value = '0';
        document.getElementById('standing-intent-form').requestSubmit();
        await wait(() => window.__savedIntent && !dialog.open);
        document.querySelector('.standing-intent-card-actions button').click();
        return { notice, dialogOpen, saved: window.__savedIntent, editDebounce: document.getElementById('standing-intent-debounce').value, cards: document.querySelectorAll('.standing-intent-card').length };
      })()
    `);
    assert.equal(result.notice, true);
    assert.equal(result.dialogOpen, true);
    assert.equal(result.saved.debounceMs, 0);
    assert.deepEqual(result.saved.when.filters, [{ path: 'payload.path', operator: 'glob', value: 'reports/*.csv' }]);
    assert.deepEqual(result.saved.action, { type: 'goal.run', goalId: 'goal-1' });
    assert.equal(result.editDebounce, '0');
    assert.equal(result.cards, 1);
    console.log(JSON.stringify(result));
  } finally { window.destroy(); app.quit(); }
}

run().catch(error => { console.error(error.stack || error); app.exit(1); });
