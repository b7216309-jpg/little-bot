'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
const { Store } = require('../src/store.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-goal-usage-'));
app.setPath('userData', path.join(root, 'electron'));
async function run() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  try {
    await window.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
    const state = store.data;
    state.runtime = { status: 'ready' };
    state.autonomy = { paused: false, goals: [{ id: 'g', name: 'Daily review', objective: 'Review saved state', status: 'running', workspace: root,
      steps: ['Review'], checks: [], permissions: {}, trigger: { type: 'interval', intervalMinutes: 1440 },
      currentAction: 'memory_search: next commitment', usage: { tokens: 30501, inputTokens: 30236, outputTokens: 265, actions: 2 },
      limits: { maxTokens: 100000, maxMinutes: 15, maxActions: 30, maxRuns: 2, maxRetries: 1 },
      history: [{ id: 'h', at: Date.now(), kind: 'run', summary: 'Reviewed state', usage: { inputTokens: 30236, outputTokens: 265 }, actions: ['workspace_read: state/user-growth.md'] }] }] };
    const result = await window.webContents.executeJavaScript(`window.bot = {}; applyState(${JSON.stringify(state)}); $('nav-goals').click(); $('goals-view').textContent;`);
    assert.match(result, /input \+ output tokens/);
    assert.match(result, /265 generated/);
    assert.match(result, /Current action: memory_search: next commitment/);
    assert.match(result, /Input is counted again on each model request/);
    assert.match(result, /workspace_read: state\/user-growth.md/);
    console.log('Goal usage and current-action rendering passed.');
  } finally { window.destroy(); app.quit(); }
}
run().catch(error => { console.error(error); app.exit(1); });
