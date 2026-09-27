'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

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
    await window.loadFile(path.join(__dirname, 'chat-scroll-fixture.html'));

    const anchored = await window.webContents.executeJavaScript(`
      (async () => {
        const scroller = document.getElementById('scroller');
        const host = document.getElementById('messages');
        const anchor = document.getElementById('three');
        scroller.scrollTop = 240;
        await new Promise(requestAnimationFrame);
        const before = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        const snapshot = LittleBotChatScroll.capture(scroller, host, false);
        document.getElementById('one').style.height = '220px';
        await new Promise(requestAnimationFrame);
        LittleBotChatScroll.restore(scroller, snapshot);
        await new Promise(requestAnimationFrame);
        const after = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        return { before, after, scrollTop: scroller.scrollTop };
      })()
    `);
    assert.ok(Math.abs(anchored.after - anchored.before) <= 1,
      `anchor moved from ${anchored.before} to ${anchored.after}`);

    const tail = await window.webContents.executeJavaScript(`
      (async () => {
        const scroller = document.getElementById('scroller');
        const host = document.getElementById('messages');
        scroller.scrollTop = scroller.scrollHeight;
        await new Promise(requestAnimationFrame);
        const snapshot = LittleBotChatScroll.capture(scroller, host, true);
        const item = document.createElement('div');
        item.textContent = 'seven';
        host.append(item);
        await new Promise(requestAnimationFrame);
        LittleBotChatScroll.restore(scroller, snapshot);
        await new Promise(requestAnimationFrame);
        return {
          gap: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
          near: LittleBotChatScroll.nearBottom(scroller),
        };
      })()
    `);
    assert.ok(tail.gap <= 1, `tail gap was ${tail.gap}px`);
    assert.equal(tail.near, true);

    console.log(JSON.stringify({ anchored, tail }));
  } finally {
    window.destroy();
    app.quit();
  }
}

run().catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
