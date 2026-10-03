'use strict';
// Real app renderer + secured preload + native windows; no engine is started.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { DesktopWindows } = require('../src/desktop-windows.cjs');
const { Store } = require('../src/store.cjs');
const { Controller } = require('../src/controller.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-widget-'));
app.setPath('userData', root);
app.whenReady().then(async () => {
  const rendererFile = path.resolve(__dirname, '../src/renderer/index.html');
  const preloadFile = path.resolve(__dirname, '../src/preload.cjs');
  const full = new BrowserWindow({ width: 1120, height: 800, show: false,
    webPreferences: { preload: preloadFile, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const errors = [];
  const desktop = new DesktopWindows({ fullWindow: full, BrowserWindow, screen, rendererFile, preloadFile,
    file: path.join(root, 'display.json'), onError: (source, error) => errors.push(`${source}: ${error.message}`) });
  const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
  const client = new EventEmitter(); client.request = () => { throw new Error('This UI test must never contact an engine'); };
  const controller = new Controller({ store, client });
  controller.runtime = { status: 'ready' }; controller.account = { status: 'connected' };
  controller.connection = { type: 'codex', status: 'connected' };
  controller.models = [{ id: 'widget-fixture', displayName: 'Fixture' }];
  Object.assign(store.data.settings, { connection: 'codex', model: 'widget-fixture' });
  store.data.chats = [{ id: 'chat-fixture', title: 'One conversation', mode: 'execute', status: 'idle',
    messages: [{ id: 'm1', role: 'user', text: 'A little room to think.', createdAt: new Date().toISOString() },
      { id: 'm2', role: 'assistant', text: 'Right here when you need me.\n\nWhat shall we put in motion?', createdAt: new Date().toISOString() }] }];
  const attachment = { id: 'fixture-note', name: 'note.txt', kind: 'file', mime: 'text/plain', size: 8 };
  const sent = []; let stopped = 0;
  const handlers = {
    getState: () => controller.state(), getDisplayState: () => desktop.state(),
    setDisplayMode: payload => desktop.setMode(payload), setWidgetState: payload => desktop.setWidgetState(payload),
    relayState: () => ({ status: 'stopped' }), chooseAttachments: () => [attachment], releaseAttachment: () => ({}),
    respondApproval: () => { controller.approvals.clear(); store.data.chats[0].status = 'idle'; controller.stateRevision++; desktop.broadcast({ type: 'state', state: controller.state() }); return {}; },
    send: payload => { sent.push(payload); store.data.chats[0].status = 'running'; controller.stateRevision++; desktop.broadcast({ type: 'state', state: controller.state() }); return { chatId: 'chat-fixture' }; },
    stop: () => { stopped++; store.data.chats[0].status = 'idle'; controller.stateRevision++; desktop.broadcast({ type: 'state', state: controller.state() }); return {}; },
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle('bot:' + name, (event, payload) => {
    assert.ok(desktop.trusted(event), `Trusted sender for ${name}`); return handler(payload);
  });
  function monitor(window) { window.webContents.on('console-message', (_event, details) => { if (details.level === 'error') errors.push(details.message); }); }
  monitor(full);
  const evaluate = (window, source) => window.webContents.executeJavaScript(source);
  const waitFor = async (window, source) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(window, source)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
    throw new Error('Timed out: ' + source);
  };
  const click = (window, id) => evaluate(window, `document.getElementById(${JSON.stringify(id)}).click()`);
  const shot = async (window, name) => { const directory = path.resolve(__dirname, '../.test-data'); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, name + '.png'), (await window.webContents.capturePage()).toPNG()); };
  try {
    await full.loadFile(rendererFile);
    await waitFor(full, "document.querySelector('#messages').textContent.includes('Right here')");
    await evaluate(full, "document.getElementById('message-input').value = 'Carry my draft'; document.getElementById('message-input').dispatchEvent(new Event('input', {bubbles:true}))");
    await click(full, 'plan-mode-toggle');
    await click(full, 'enter-widget');
    for (let i = 0; i < 100 && desktop.mode !== 'widget'; i++) await new Promise(resolve => setTimeout(resolve, 30));
    const widget = desktop.widget; assert.ok(widget); monitor(widget);
    await waitFor(widget, "document.getElementById('message-input').value === 'Carry my draft'");
    assert.equal(full.isVisible(), false);
    assert.equal(await evaluate(widget, "document.documentElement.classList.contains('widget-mode')"), true);
    await shot(widget, 'glass-expanded');
    controller.connection = { type: 'local', status: 'connected', adapter: 'strata' };
    store.data.settings.localThinking = false; controller.stateRevision++;
    desktop.broadcast({ type: 'state', state: controller.state() });
    widget.setSize(360, 420);
    await waitFor(widget, "document.getElementById('effort-select').value === 'none' && !document.getElementById('effort-select').classList.contains('hidden')");
    assert.equal(await evaluate(widget, "document.getElementById('composer').scrollWidth <= document.getElementById('composer').clientWidth"), true, 'Strata controls fit the smallest widget');
    controller.connection = { type: 'codex', status: 'connected' }; controller.stateRevision++;
    desktop.broadcast({ type: 'state', state: controller.state() }); widget.setSize(420, 560);
    await click(widget, 'widget-collapse');
    await waitFor(widget, "document.documentElement.classList.contains('widget-collapsed')");
    assert.equal(widget.getBounds().height, 78); await shot(widget, 'glass-collapsed');
    await click(widget, 'widget-pill-attach');
    await waitFor(widget, "document.querySelector('#attachment-queue').textContent.includes('note.txt')");
    await click(widget, 'widget-full');
    await waitFor(full, "document.querySelector('#attachment-queue').textContent.includes('note.txt')");
    assert.equal(await evaluate(full, "document.getElementById('message-input').value"), 'Carry my draft');
    assert.equal(await evaluate(full, "document.getElementById('plan-mode-toggle').getAttribute('aria-pressed')"), 'true');
    assert.equal(widget.isVisible(), false);
    await evaluate(full, "document.getElementById('message-input').value = 'Updated full draft'; document.getElementById('message-input').dispatchEvent(new Event('input', {bubbles:true}))");
    desktop.broadcast({ type: 'goalQuestion', goalId: 'fixture-goal' });
    await waitFor(full, "!document.getElementById('goals-view').classList.contains('hidden')");
    assert.equal(await evaluate(full, "document.getElementById('message-input').value"), 'Updated full draft', 'Hidden widget cannot replace the full-app draft after a background event');
    await click(full, 'nav-conversation');
    await click(full, 'enter-widget'); await waitFor(widget, "!document.getElementById('send-button').disabled");
    await click(widget, 'send-button'); await waitFor(widget, "document.getElementById('widget-status').textContent === 'Working…'");
    assert.equal(sent.length, 1); assert.equal(sent[0].text, 'Updated full draft'); assert.deepEqual(sent[0].attachmentIds, ['fixture-note']); assert.equal(sent[0].mode, 'plan');
    await click(widget, 'widget-collapse'); await waitFor(widget, "!document.getElementById('widget-pill-stop').hidden");
    await click(widget, 'widget-pill-stop'); await waitFor(widget, "document.getElementById('widget-pill-stop').hidden"); assert.equal(stopped, 1);
    controller.approvals.set('approve-fixture', { requestId: 'approve-fixture', chatId: 'chat-fixture', title: 'Fixture approval', kind: 'command', detail: 'No command runs in this test.' });
    store.data.chats[0].status = 'waiting'; controller.stateRevision++; desktop.broadcast({ type: 'state', state: controller.state() });
    await waitFor(widget, "document.getElementById('approval-dialog').open && !document.documentElement.classList.contains('widget-collapsed')");
    assert.equal(await evaluate(full, "document.getElementById('approval-dialog').open"), false, 'Hidden full app does not steal approval focus');
    await click(widget, 'decline-approval'); await waitFor(widget, "!document.getElementById('approval-dialog').open");
    await click(widget, 'widget-pill-expand'); await waitFor(widget, "!document.documentElement.classList.contains('widget-collapsed')");
    await click(widget, 'widget-pin'); await waitFor(widget, "document.getElementById('widget-pin').getAttribute('aria-pressed') === 'false'");
    assert.equal(widget.isAlwaysOnTop(), false);
    await evaluate(widget, "document.querySelector('[data-widget-view=settings]').click()");
    await waitFor(full, "document.getElementById('settings-dialog').open");
    assert.equal(desktop.mode, 'full');
    await evaluate(full, "document.getElementById('settings-dialog').close()");
    await click(full, 'enter-widget'); await waitFor(widget, "window.LittleBotWidget.isActive()");
    widget.close(); await waitFor(full, "document.getElementById('message-input').value === ''");
    for (let i = 0; i < 100 && desktop.mode !== 'full'; i++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(desktop.mode, 'full');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'display.json'))).mode, 'full');
    assert.deepEqual(errors, []);
    process.stdout.write('Glass widget: draft, attachment, send, Stop, collapse, restore, secure IPC and screenshots passed. No engine started.\n');
  } finally { desktop.close(); full.destroy(); }
  app.exit(0);
}).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });
