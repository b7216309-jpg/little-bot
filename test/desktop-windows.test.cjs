'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { DesktopWindows, clampBounds, normalizePreferences } = require('../src/desktop-windows.cjs');

class Window extends EventEmitter {
  constructor(options = {}) {
    super(); this.options = options; this.bounds = { x: 20, y: 20, width: 1000, height: 700, ...options };
    this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: '' }; this.events = [];
    this.webContents.send = (_channel, event) => this.events.push(event);
    this.webContents.setWindowOpenHandler = fn => { this.popup = fn; };
  }
  isDestroyed() { return Boolean(this.destroyed); } destroy() { this.destroyed = true; }
  isVisible() { return Boolean(this.visible); } isFocused() { return Boolean(this.focused); }
  isMinimized() { return false; } show() { this.visible = true; } hide() { this.visible = this.focused = false; }
  focus() { this.focused = true; } getBounds() { return this.bounds; } setBounds(value) { this.bounds = value; this.emit('resize'); }
  setMinimumSize() {} setResizable(value) { this.resizable = value; } setAlwaysOnTop(value) { this.pinned = value; } setBackgroundMaterial() {}
  async loadFile(file) { this.webContents.mainFrame.url = pathToFileURL(file).href; }
}
function fixture(BrowserWindow = Window) {
  const rendererFile = require('node:path').resolve('src/renderer/index.html');
  const full = new Window(); full.webContents.mainFrame.url = pathToFileURL(rendererFile).href;
  const area = { x: -1600, y: 0, width: 1600, height: 900 };
  return { full, desktop: new DesktopWindows({ fullWindow: full, BrowserWindow, rendererFile,
    screen: { getPrimaryDisplay: () => ({ workArea: area }), getDisplayMatching: () => ({ workArea: area }) } }) };
}
test('widget switching carries a sanitized draft, hides the other window, and reuses the widget', async t => {
  const { full, desktop } = fixture(); t.after(() => desktop.close());
  await desktop.setMode({ mode: 'widget', draft: { text: 'unsent', plan: true,
    attachments: [{ id: 'fixture-1', kind: 'file', name: 'note.txt', size: 8, path: 'private', bytes: 'secret' }] } });
  const widget = desktop.widget;
  assert.equal(full.isVisible(), false); assert.equal(widget.isVisible(), true);
  assert.deepEqual(widget.events.at(-1).draft, { text: 'unsent', plan: true, attachments: [{ id: 'fixture-1', kind: 'file', name: 'note.txt', mime: 'application/octet-stream', size: 8 }] });
  desktop.setWidgetState({ collapsed: true, pinned: false });
  assert.equal(widget.bounds.width, 310); assert.equal(widget.pinned, false);
  const right = widget.bounds.x + widget.bounds.width, bottom = widget.bounds.y + widget.bounds.height;
  desktop.setWidgetState({ collapsed: false });
  assert.equal(widget.bounds.width, 420); assert.equal(widget.bounds.x + widget.bounds.width, right); assert.equal(widget.bounds.y + widget.bounds.height, bottom);
  desktop.openFull('settings'); assert.equal(widget.events.at(-1).type, 'displayRequestFull');
  await desktop.setMode({ mode: 'full' }); assert.equal(widget.isVisible(), false); assert.equal(full.isVisible(), true);
  await desktop.setMode({ mode: 'widget' }); assert.equal(desktop.widget, widget);
});
test('only app main frames can invoke desktop IPC', async t => {
  const { full, desktop } = fixture(); t.after(() => desktop.close());
  assert.equal(desktop.trusted({ sender: full.webContents, senderFrame: full.webContents.mainFrame }), true);
  assert.equal(desktop.trusted({ sender: full.webContents, senderFrame: { ...full.webContents.mainFrame } }), false);
  await desktop.setMode({ mode: 'widget' });
  assert.equal(desktop.trusted({ sender: desktop.widget.webContents, senderFrame: desktop.widget.webContents.mainFrame }), true);
  desktop.widget.webContents.mainFrame.url = 'https://example.com';
  assert.equal(desktop.trusted({ sender: desktop.widget.webContents, senderFrame: desktop.widget.webContents.mainFrame }), false);
  await assert.rejects(desktop.setMode({ mode: 'bad' }), /full app/);
  assert.throws(() => desktop.setWidgetState({ pinned: 'yes' }), /on or off/);
});
test('a newer full-app request wins while the widget is still loading', async t => {
  let ready;
  class Slow extends Window { async loadFile(file) { await new Promise(resolve => { ready = resolve; }); await super.loadFile(file); } }
  const { full, desktop } = fixture(Slow); t.after(() => desktop.close());
  const opening = desktop.setMode({ mode: 'widget' });
  await desktop.setMode({ mode: 'full' }); ready(); await opening;
  assert.equal(desktop.mode, 'full'); assert.equal(full.isVisible(), true); assert.equal(desktop.widget.isVisible(), false);
});
test('corrupt display preferences and disconnected screens recover on screen', () => {
  assert.equal(normalizePreferences(null).mode, 'full');
  assert.equal(normalizePreferences({ bounds: { x: 10 } }).bounds, null);
  const area = { x: -1600, y: 0, width: 1600, height: 900 };
  assert.deepEqual(clampBounds({ x: 9999, y: -9999, width: 500, height: 600 }, area), { x: -500, y: 0, width: 500, height: 600 });
});
test('closing the full app also destroys its hidden widget', async () => {
  const { full, desktop } = fixture();
  await desktop.setMode({ mode: 'widget' }); await desktop.setMode({ mode: 'full' });
  full.destroyed = true; full.emit('closed');
  assert.equal(desktop.widget.isDestroyed(), true); assert.equal(desktop.closing, true);
});
