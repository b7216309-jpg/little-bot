 'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
const { Store } = require('../src/store.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-automation-ui-'));
app.setPath('userData', path.join(root, 'electron'));
async function run() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
  try {
    await window.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    const state = store.data;
    state.runtime = { status: 'ready' };
    state.chats = [{ id: 'one', title: 'Conversation', status: 'idle', workspace: root, mode: 'plan', messages: [
      { id: 'u1', role: 'user', text: 'Plan my project.' },
      { id: 'a1', role: 'assistant', text: 'A project plan.' },
      { id: 'u2', role: 'user', kind: 'automation', text: 'Read the notes.', automationId: 'daily', automationName: 'Daily review' },
      { id: 'a2', role: 'assistant', text: 'No changes in the notes.', automationId: 'daily', automationName: 'Daily review' },
    ] }];
    const result = await window.webContents.executeJavaScript(`window.bot = {}; applyState(${JSON.stringify(state)}); ({ labels: [...document.querySelectorAll('.message-label')].map(n => n.textContent), text: document.body.textContent });`);
    assert.ok(result.labels.includes('Scheduled · Daily review'));
    assert.ok(result.labels.some(label => label.endsWith('Little Bot · Daily review')));
    assert.match(result.text, /Plan my project/);
    assert.match(result.text, /No changes in the notes/);
    console.log('Scheduled origin labels and shared conversation rendering passed.');
  } finally { store.close(); window.destroy(); app.quit(); }
}
run().catch(error => { console.error(error); app.exit(1); });
