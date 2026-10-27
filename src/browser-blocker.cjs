'use strict';

// Ad and tracker blocking for the built-in browser, with Ghostery's blocker (the engine of its extension). It works
// in the browser's own session only: requests to ad and tracker servers are cancelled before they leave, and
// leftover ad boxes and cookie notices are hidden in the page. The filter lists (EasyList, EasyPrivacy, uBlock
// Origin's privacy and annoyance lists) come from Ghostery's repository, are kept on disk as a ready engine, and are
// refreshed once a day; matching happens on this PC. A site can be let through: an exception rule for it.

const fs = require('node:fs');
const path = require('node:path');

const REFRESH_MS = 24 * 3600000;
const RETRY_MS = 30 * 60000;
const MAX_SITES = 500;
const HOST = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d-]{2,63}$/i;

// The site a page belongs to, as the exception names it: its host without "www.".
function siteOf(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (!['http:', 'https:'].includes(protocol)) return null;
    const host = hostname.toLowerCase().replace(/^www\./, '');
    return HOST.test(host) ? host : null;
  } catch { return null; }
}
const exception = site => `@@||${site}^$document`;

class BrowserBlocker {
  constructor({ root, store, onChange = () => {}, fetch = globalThis.fetch, load = () => require('@ghostery/adblocker-electron') }) {
    this.root = root;
    this.store = store;
    this.onChange = onChange;
    this.fetch = fetch;
    this.load = load;
    this.file = path.join(root, 'engine.bin');
    this.engine = null;
    this.session = null;
    this.enabledIn = false;
    this.error = null;
    this.refreshing = null;
    this.page = { contentsId: null, blocked: 0 };
    this.timer = null;
    this.notify = null;
  }

  get enabled() { return this.store.data.settings.browserBlocking !== false; }
  get sites() {
    const saved = this.store.data.browserBlocking?.allowed;
    return Array.isArray(saved) ? saved.filter(site => typeof site === 'string' && HOST.test(site)) : [];
  }

  // The browser's session, given once it exists. Blocking starts there when it is on.
  attach(session) {
    this.session = session;
    return this.sync();
  }

  // Brings blocking in line with the setting: loads the engine (from disk, else from the lists) and turns it on in
  // the session, or turns it off.
  async sync() {
    if (!this.session) return;
    if (!this.enabled) { this._disable(); this.onChange(); return; }
    try {
      if (!this.engine) await this._loadEngine();
      this._enable();
      this.error = null;
    } catch (error) {
      this.error = `Ad blocking could not start: ${String(error.message || error).slice(0, 200)}`;
    }
    this.onChange();
  }

  async _loadEngine() {
    const { ElectronBlocker } = this.load();
    let engine = null, age = Infinity;
    try {
      const stats = fs.statSync(this.file);
      engine = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(this.file)));
      age = Date.now() - stats.mtimeMs;
    } catch { /* No saved engine yet, or an unreadable one: build it. */ }
    if (!engine) engine = await this._build();
    else if (age > REFRESH_MS) this.refresh().catch(() => {});
    this._use(engine);
    this._schedule();
  }

  // Fetches the lists and builds a new engine; the saved one is replaced only when that works.
  async _build() {
    const { ElectronBlocker } = this.load();
    const engine = await ElectronBlocker.fromPrebuiltFull((url, init) => this.fetch(url, { ...init, signal: AbortSignal.timeout(60000) }));
    fs.mkdirSync(this.root, { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, engine.serialize());
    fs.renameSync(temporary, this.file);
    return engine;
  }

  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this._build().then(engine => {
      const wasOn = this.enabledIn;
      this._disable();
      this._use(engine);
      if (wasOn && this.enabled) this._enable();
      this.onChange();
    }).finally(() => { this.refreshing = null; this._schedule(); });
    return this.refreshing;
  }

  _schedule() {
    clearTimeout(this.timer);
    let age = 0;
    try { age = Date.now() - fs.statSync(this.file).mtimeMs; } catch { age = REFRESH_MS; }
    this.timer = setTimeout(() => this.refresh().catch(() => { this.timer = setTimeout(() => this._schedule(), RETRY_MS); this.timer.unref?.(); }), Math.max(60000, REFRESH_MS - age));
    this.timer.unref?.();
  }

  // A new engine gets the user's exceptions and reports what it blocks on the page shown.
  _use(engine) {
    if (this.engine && this.notify) { this.engine.off?.('request-blocked', this.notify); this.engine.off?.('request-redirected', this.notify); }
    this.engine = engine;
    const sites = this.sites;
    if (sites.length) engine.updateFromDiff({ added: sites.map(exception) });
    this.notify = request => {
      if (request?.tabId === undefined || request.tabId !== this.page.contentsId) return;
      this.page.blocked++;
      this._changedSoon();
    };
    engine.on('request-blocked', this.notify);
    engine.on('request-redirected', this.notify);
  }

  _enable() { if (this.engine && this.session && !this.enabledIn) { this.engine.enableBlockingInSession(this.session); this.enabledIn = true; } }
  _disable() { if (this.engine && this.session && this.enabledIn) { this.engine.disableBlockingInSession(this.session); this.enabledIn = false; } }

  // The count is per page: a new page in the browser starts again from zero.
  newPage(contentsId) { this.page = { contentsId, blocked: 0 }; this.onChange(); }
  _changedSoon() {
    if (this.pending) return;
    this.pending = setTimeout(() => { this.pending = null; this.onChange(); }, 400);
    this.pending.unref?.();
  }

  // Lets a site through (allow) or blocks it again. The caller reloads the page.
  setSite(url, allow) {
    const site = siteOf(url);
    if (!site) throw new Error('Only web pages can be let through.');
    const sites = this.sites;
    const has = sites.includes(site);
    if (allow === has) return site;
    const next = allow ? [...sites, site].slice(-MAX_SITES) : sites.filter(item => item !== site);
    this.store.data.browserBlocking = { ...(this.store.data.browserBlocking || {}), allowed: next };
    this.store.save();
    if (this.engine) this.engine.updateFromDiff(allow ? { added: [exception(site)] } : { removed: [exception(site)] });
    this.onChange();
    return site;
  }

  state(url) {
    const site = siteOf(url);
    return {
      enabled: this.enabled, ready: Boolean(this.engine && this.enabledIn), error: this.error, updating: Boolean(this.refreshing),
      blocked: this.page.blocked, site, allowed: Boolean(site && this.sites.includes(site)), sites: this.sites.length,
      updatedAt: (() => { try { return fs.statSync(this.file).mtimeMs; } catch { return null; } })(),
    };
  }

  close() { clearTimeout(this.timer); clearTimeout(this.pending); this._disable(); }
}

module.exports = { BrowserBlocker, siteOf };
