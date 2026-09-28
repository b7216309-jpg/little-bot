'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  try {
    await window.loadFile(path.join(__dirname, 'goal-ledger-fixture.html'));
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        for (let index = 0; index < 100; index++) {
          if (window.__goalLedgerMounted) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (!window.__goalLedgerMounted) throw new Error('Timed out waiting for the goal ledger.');
        const current = document.querySelector('.goal-ledger-current');
        const active = document.querySelector('.goal-ledger-step.active');
        const archive = document.querySelector('.goal-ledger-archive');
        return {
          currentText: current?.textContent || '',
          activeText: active?.textContent || '',
          activeCount: document.querySelectorAll('.goal-ledger-step.active').length,
          archivedPlans: archive?.querySelectorAll('.goal-ledger-archived-plan').length || 0,
          assumption: document.querySelector('.goal-ledger-record-badge.confirmed')?.textContent || '',
          evidence: document.querySelector('.goal-ledger-evidence.failed')?.textContent || '',
          contexts: Array.from(document.querySelectorAll('.goal-ledger-record-context')).map(node => ({ text: node.textContent, title: node.title })),
          decision: Array.from(document.querySelectorAll('.goal-ledger-record-section')).at(-1)?.textContent || '',
          publicNote: document.querySelector('.goal-ledger-note')?.textContent || '',
        };
      })()
    `);
    assert.match(result.currentText, /Current plan/);
    assert.match(result.currentText, /v2/);
    assert.match(result.activeText, /Write the report/);
    assert.equal(result.activeCount, 1);
    assert.equal(result.archivedPlans, 1);
    assert.equal(result.assumption, 'Confirmed');
    assert.equal(result.evidence, 'Failed · report.md');
    assert.equal(result.contexts.length, 3);
    assert.ok(result.contexts.every(item => item.text === 'v2 · Step 1'));
    assert.ok(result.contexts.every(item => item.title === 'Inspect the newer source.'));
    assert.match(result.decision, /Recalculate totals/);
    assert.match(result.publicNote, /not hidden model reasoning/i);
    console.log(JSON.stringify(result));
  } finally { window.destroy(); app.quit(); }
}

run().catch(error => { console.error(error.stack || error); app.exit(1); });
