'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  try {
    await window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const result = await window.webContents.executeJavaScript(`
      (() => {
        const view = document.getElementById('calendar-view');
        document.getElementById('nav-calendar').click();
        const opened = !view.classList.contains('hidden');
        document.getElementById('create-calendar-event').click();
        const dialog = document.getElementById('calendar-dialog');
        const dialogOpen = dialog.open;
        const allDay = document.getElementById('calendar-all-day');
        allDay.checked = true;
        allDay.dispatchEvent(new Event('change', { bubbles: true }));
        const hidesTime = document.getElementById('calendar-start-time-field').classList.contains('hidden')
          && document.getElementById('calendar-end-fields').classList.contains('hidden');
        dialog.close();
        return { opened, dialogOpen, hidesTime };
      })()
    `);
    assert.deepEqual(result, { opened: true, dialogOpen: true, hidesTime: true });
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
