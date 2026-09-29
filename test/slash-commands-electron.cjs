'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'little-bot-ui-test-')));

async function submit(window, value) {
  const source = `(async () => {
    const input = document.getElementById('message-input');
    input.value = ${JSON.stringify(value)};
    document.getElementById('composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 25));
    return {
      toast: document.getElementById('toast').textContent,
      privateControl: Boolean(document.getElementById('private-session-toggle')),
      inspectorHidden: document.getElementById('agent-inspector').classList.contains('hidden'),
      input: input.value,
    };
  })()`;
  return window.webContents.executeJavaScript(source);
}

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

    const help = await submit(window, '/help');
    assert.match(help.toast, /\/plan/);
    assert.match(help.toast, /\/goal/);
    assert.equal(help.input, '');

    const privateResult = await submit(window, '/private');
    assert.equal(privateResult.privateControl, false);
    assert.match(privateResult.toast, /Unknown command/);

    const activity = await submit(window, '/activity');
    assert.equal(activity.inspectorHidden, false);

    const unknown = await submit(window, '/wat');
    assert.match(unknown.toast, /Unknown command/);

    console.log(JSON.stringify({ help, privateResult, activity, unknown }));
  } finally {
    window.destroy();
    app.quit();
  }
}

run().catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
