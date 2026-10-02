'use strict';

// Drives the built-in browser end to end in real Electron against a local fixture page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow } = require('electron');
const { EmbeddedBrowser } = require('../src/embedded-browser.cjs');

const page = `<!doctype html><html><head><title>Fixture form</title></head><body>
<h1>Agent browser ready</h1>
<label>Name <input id="name"></label>
<label>Color <select id="color"><option value="r">Red</option><option value="g">Green</option></select></label>
<label><input type="checkbox" id="agree"> I agree</label>
<button onclick="document.querySelector('output').textContent='Hello '+document.querySelector('#name').value+' '+document.querySelector('#color').value+' '+document.querySelector('#agree').checked">Greet</button>
<output>Waiting</output>
<form action="/second"><input name="q" aria-label="Query"></form>
<a href="/second" target="_blank">Open second</a>
<div style="height:3000px"></div><p>Bottom text</p>
</body></html>`;

app.whenReady().then(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-embedded-browser-'));
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(request.url.startsWith('/second') ? `<!doctype html><title>Second</title><p>Second page ${request.url}</p>` : page);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const window = new BrowserWindow({ width: 1200, height: 800, show: false });
  if (process.env.SHOW_WINDOW !== '0') window.showInactive();
  if (process.env.SHOW_WINDOW === 'min') window.minimize();
  await window.loadURL('data:text/html,<title>Shell</title>');
  let changes = 0;
  const browser = new EmbeddedBrowser({ root, getWindow: () => window, onChange: () => { changes += 1; }, partition: `test-${Date.now()}` });
  const call = args => browser.call(args, { isActive: () => true, owner: 'chat-1' });
  const ref = (refs, role, name) => Object.keys(refs).find(key => refs[key].role === role && (name === undefined || refs[key].name === name));
  try {
    assert.equal(browser.getState().available, true);
    browser.setBounds({ x: 600, y: 0, width: 600, height: 800 });
    await call({ action: 'navigate', url: base + '/' });
    assert.equal(browser.getState().panel, true, 'The panel opens when the agent browses.');
    assert.equal(browser.attached, true, 'A real page is laid over the panel.');
    assert.equal(browser.getState().title, 'Fixture form');

    let snapshot = JSON.parse((await call({ action: 'snapshot' })).content);
    assert.match(snapshot.snapshot, /heading "Agent browser ready"/);
    const name = ref(snapshot.refs, 'textbox', 'Name');
    const greet = ref(snapshot.refs, 'button', 'Greet');
    const color = ref(snapshot.refs, 'combobox');
    const agree = ref(snapshot.refs, 'checkbox', 'I agree');
    assert.ok(name && greet && color && agree, snapshot.snapshot);

    await call({ action: 'fill', ref: name, text: 'Little Bot' });
    await call({ action: 'select', ref: '@' + color, text: 'Green' });
    await call({ action: 'check', ref: agree });
    await call({ action: 'click', ref: greet });
    const read = JSON.parse((await call({ action: 'read' })).content);
    assert.match(read.text, /Hello Little Bot g true/);
    snapshot = JSON.parse((await call({ action: 'snapshot' })).content);
    assert.match(snapshot.snapshot, /checkbox "I agree" \[checked\]/);
    await call({ action: 'uncheck', ref: ref(snapshot.refs, 'checkbox', 'I agree') });

    await assert.rejects(call({ action: 'click', ref: 'e999' }), /Unknown reference/);
    await assert.rejects(call({ action: 'navigate', url: 'file:///C:/Windows/win.ini' }), /http/);
    await assert.rejects(call({ action: 'switch_tab', tab: 1 }), /one tab/);

    await call({ action: 'scroll', direction: 'down', pixels: 1500 });
    const scrolled = await browser.view.webContents.executeJavaScript('scrollY');
    assert.ok(scrolled > 500, `page scrolled (${scrolled})`);

    // Enter submits a form; target=_blank links load in the same tab.
    snapshot = JSON.parse((await call({ action: 'snapshot' })).content);
    await call({ action: 'fill', ref: ref(snapshot.refs, 'textbox', 'Query'), text: 'kittens' });
    await call({ action: 'press', key: 'Enter' });
    assert.match(browser.getState().url, /\/second\?q=kittens$/);
    await call({ action: 'back' });
    assert.equal(browser.getState().title, 'Fixture form');
    snapshot = JSON.parse((await call({ action: 'snapshot' })).content);
    await call({ action: 'click', ref: ref(snapshot.refs, 'link', 'Open second') });
    for (let index = 0; index < 50 && !/\/second$/.test(browser.getState().url); index++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(browser.getState().url, /\/second$/);

    if (process.env.SHOW_WINDOW === '0' || process.env.SHOW_WINDOW === 'min') await assert.rejects(call({ action: 'screenshot' }), /snapshot or read/);
    else {
      const shot = await call({ action: 'screenshot' });
      assert.ok(fs.statSync(shot.screenshotPath).size > 1000);
    }

    // A dialog over the panel detaches the native view; the agent can still work.
    browser.setBounds({ x: 600, y: 0, width: 600, height: 800, hidden: true });
    assert.equal(browser.attached, false);
    const hiddenRead = JSON.parse((await call({ action: 'read' })).content);
    assert.match(hiddenRead.text, /Second page/);
    browser.setBounds({ x: 600, y: 0, width: 600, height: 800 });
    assert.equal(browser.attached, true);

    // The user's own address bar: plain words search, bare hosts get https.
    await browser.userNavigate({ url: base + '/second?user=1' });
    for (let index = 0; index < 50 && !/user=1/.test(browser.getState().url || ''); index++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(browser.getState().url, /user=1/);

    browser.showPanel(false);
    assert.equal(browser.attached, false);
    assert.equal(browser.getState().active, true, 'Hiding keeps the page open.');
    await call({ action: 'close' });
    assert.equal(browser.getState().active, false);
    assert.equal(browser.view, null);
    assert.ok(changes > 0);
    console.log(JSON.stringify({ embeddedBrowser: true, navigateSnapshotFillSelectCheckClickReadScrollPressBackPopupScreenshot: true }));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    server.close();
  }
});
