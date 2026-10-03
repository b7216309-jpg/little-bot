'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { attachmentDescriptors } = require('./attachment-message.cjs');

const EXPANDED = { width: 420, height: 560 };
const COLLAPSED = { width: 310, height: 78 };
const FULL_VIEWS = new Set(['chat', 'settings', 'goals', 'automations', 'calendar', 'memory', 'profile', 'heartbeat', 'inbox', 'extensions', 'browser']);
const available = window => window && !window.isDestroyed();

function clampBounds(bounds, area, collapsed = false) {
  const width = collapsed ? Math.min(COLLAPSED.width, area.width) : Math.min(area.width, Math.max(360, Math.min(640, bounds?.width || EXPANDED.width)));
  const height = collapsed ? Math.min(COLLAPSED.height, area.height) : Math.min(area.height, Math.max(420, Math.min(900, bounds?.height || EXPANDED.height)));
  const x = Number.isInteger(bounds?.x) ? bounds.x : area.x + area.width - width - 24;
  const y = Number.isInteger(bounds?.y) ? bounds.y : area.y + area.height - height - 24;
  return { x: Math.max(area.x, Math.min(x, area.x + area.width - width)), y: Math.max(area.y, Math.min(y, area.y + area.height - height)), width, height };
}

function normalizePreferences(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const box = value.bounds;
  const bounds = box && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(box[key]) && Math.abs(box[key]) < 200000)
    ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
  return { mode: value.mode === 'widget' ? 'widget' : 'full', collapsed: value.collapsed === true, pinned: value.pinned !== false, bounds };
}

function composerDraft(value) {
  if (!value || typeof value !== 'object') return null;
  return { text: typeof value.text === 'string' ? value.text.slice(0, 32000) : '',
    attachments: attachmentDescriptors(value.attachments), plan: value.plan === true };
}

// Two views of one controller. Creating the widget never starts another engine.
class DesktopWindows {
  constructor({ fullWindow, BrowserWindow, screen, rendererFile, preloadFile, icon, file, onError = () => {}, onFocus = () => {}, onBlur = () => {}, openLink = () => {} }) {
    Object.assign(this, { fullWindow, BrowserWindow, screen, rendererFile, preloadFile, icon, file, onError, onFocus, onBlur, openLink });
    this.rendererUrl = pathToFileURL(rendererFile).href;
    this.widget = null; this.creating = null; this.closing = false; this.sequence = 0; this.saveTimer = null;
    let saved;
    try { if (file && fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { onError('display-preferences', error); }
    this.preferences = normalizePreferences(saved);
    this.mode = 'full';
    // A hidden widget must not keep the process alive after the full app closes.
    fullWindow.on('closed', () => this.close());
  }
  windows() { return [this.fullWindow, this.widget].filter(available); }
  activeWindow() { return this.mode === 'widget' && available(this.widget) ? this.widget : this.fullWindow; }
  isFocused() { return this.windows().some(window => window.isVisible() && window.isFocused()); }
  trusted(event) {
    return this.windows().some(window => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
      && event.senderFrame.url.split('#')[0] === this.rendererUrl);
  }
  broadcast(event) { for (const window of this.windows()) window.webContents.send('bot:event', event); }
  state() { return { mode: this.mode, collapsed: this.preferences.collapsed, pinned: this.preferences.pinned }; }
  area(bounds) { return bounds ? this.screen.getDisplayMatching(bounds).workArea : this.screen.getPrimaryDisplay().workArea; }
  persist() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(this.preferences)); fs.renameSync(temporary, this.file);
    } catch (error) { this.onError('display-preferences', error); }
  }
  rememberBounds() {
    if (!available(this.widget) || this.adjusting) return;
    const bounds = this.widget.getBounds();
    if (this.preferences.collapsed) {
      const expanded = this.preferences.bounds || EXPANDED;
      this.preferences.bounds = { ...expanded, x: bounds.x + bounds.width - expanded.width, y: bounds.y + bounds.height - expanded.height };
    } else this.preferences.bounds = bounds;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(), 250); this.saveTimer.unref?.();
  }
  async ensureWidget() {
    if (available(this.widget) && !this.creating) return this.widget;
    if (this.creating) return this.creating;
    this.creating = (async () => {
      const expanded = clampBounds(this.preferences.bounds, this.area(this.preferences.bounds));
      this.preferences.bounds = expanded;
      const bounds = this.preferences.collapsed
        ? clampBounds({ x: expanded.x + expanded.width - COLLAPSED.width, y: expanded.y + expanded.height - COLLAPSED.height }, this.area(expanded), true) : expanded;
      const widget = new this.BrowserWindow({ ...bounds, minWidth: this.preferences.collapsed ? COLLAPSED.width : 360,
        minHeight: this.preferences.collapsed ? COLLAPSED.height : 420, maxWidth: 640, maxHeight: 900,
        title: 'Little Bot · Glass', frame: false, transparent: true, backgroundColor: '#00000000',
        show: false, hasShadow: true, roundedCorners: true, resizable: !this.preferences.collapsed,
        maximizable: false, fullscreenable: false, alwaysOnTop: this.preferences.pinned, icon: this.icon,
        webPreferences: { preload: this.preloadFile, additionalArguments: ['--little-bot-widget'],
          contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, webviewTag: false, backgroundThrottling: false } });
      this.widget = widget;
      // Windows 11 22H2+ provides the real desktop blur. Other hosts keep a
      // legible frosted CSS surface rather than requiring an OS upgrade.
      if (process.platform === 'win32') {
        try { widget.setBackgroundMaterial('acrylic'); } catch (error) { this.onError('widget-material', error); }
      }
      widget.on('move', () => this.rememberBounds()); widget.on('resize', () => this.rememberBounds());
      widget.on('focus', this.onFocus); widget.on('blur', this.onBlur);
      widget.on('close', event => {
        if (this.closing) return;
        event.preventDefault();
        // Let the renderer hand off its unsent text and attachment references.
        widget.webContents.send('bot:event', { type: 'displayRequestFull' });
      });
      widget.webContents.setWindowOpenHandler(({ url }) => {
        this.openLink(url); return { action: 'deny' };
      });
      widget.webContents.on('will-navigate', (event, url) => { if (url !== this.rendererUrl) event.preventDefault(); });
      widget.webContents.on('render-process-gone', (_event, details) => {
        this.onError('widget-renderer', new Error(`Widget renderer exited: ${details.reason}`));
        if (available(widget)) widget.destroy();
        if (this.widget === widget) this.widget = null;
        this.setMode({ mode: 'full' }).catch(error => this.onError('widget-recovery', error));
      });
      try { await widget.loadFile(this.rendererFile); return widget; }
      catch (error) { widget.destroy(); this.widget = null; throw error; }
    })();
    try { return await this.creating; } finally { this.creating = null; }
  }
  async setMode({ mode, draft, view = 'chat' } = {}) {
    if (!['full', 'widget'].includes(mode)) throw new Error('Choose full app or widget mode.');
    if (!FULL_VIEWS.has(view)) throw new Error('Choose an app view.');
    if (this.closing) return this.state();
    const sequence = ++this.sequence;
    const target = mode === 'widget' ? await this.ensureWidget() : this.fullWindow;
    if (sequence !== this.sequence || this.closing || !available(target)) return this.state();
    this.mode = this.preferences.mode = mode;
    this.broadcast({ type: 'display', display: this.state(), target: mode, view, draft: composerDraft(draft) });
    const other = mode === 'widget' ? this.fullWindow : this.widget;
    if (available(other)) other.hide();
    if (target.isMinimized()) target.restore();
    target.show(); target.focus(); this.persist();
    return this.state();
  }
  setWidgetState({ collapsed, pinned } = {}) {
    if ((collapsed !== undefined && typeof collapsed !== 'boolean') || (pinned !== undefined && typeof pinned !== 'boolean')) throw new Error('Widget controls must be on or off.');
    if (pinned !== undefined) { this.preferences.pinned = pinned; if (available(this.widget)) this.widget.setAlwaysOnTop(pinned); }
    if (collapsed !== undefined && collapsed !== this.preferences.collapsed) {
      if (available(this.widget)) {
        this.rememberBounds();
        const previous = this.widget.getBounds();
        const expanded = this.preferences.bounds || EXPANDED;
        const next = collapsed ? { x: previous.x + previous.width - COLLAPSED.width, y: previous.y + previous.height - COLLAPSED.height }
          : { ...expanded, x: previous.x + previous.width - expanded.width, y: previous.y + previous.height - expanded.height };
        this.adjusting = true;
        this.widget.setMinimumSize(collapsed ? COLLAPSED.width : 360, collapsed ? COLLAPSED.height : 420);
        this.widget.setResizable(!collapsed);
        this.widget.setBounds(clampBounds(next, this.area(previous), collapsed));
        this.adjusting = false;
      }
      this.preferences.collapsed = collapsed;
    }
    this.broadcast({ type: 'display', display: this.state() }); this.persist();
    return this.state();
  }
  show() { return this.setMode({ mode: this.mode }); }
  openFull(view = 'chat') {
    if (this.mode === 'widget' && available(this.widget)) this.widget.webContents.send('bot:event', { type: 'displayRequestFull', view });
    else this.setMode({ mode: 'full', view }).catch(error => this.onError('display-show', error));
  }
  close() {
    this.closing = true; this.sequence++; clearTimeout(this.saveTimer); this.persist();
    if (available(this.widget)) this.widget.destroy();
  }
}

module.exports = { DesktopWindows, clampBounds, normalizePreferences, composerDraft, EXPANDED, COLLAPSED };
