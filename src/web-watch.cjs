'use strict';

const { randomUUID, createHash } = require('node:crypto');

// Pages the user or the agent asked to watch. Checked only while the app is open, one at a time,
// public http(s) addresses only. The first check records a baseline; later changes are reported.
const MAX_WATCHES = 20;
const MAX_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_CHARS = 8000;
const TICK_MS = 10 * 60000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clip = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

function safeUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Use a full http or https address.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https pages can be watched.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '0.0.0.0'
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host)) {
    throw new Error('Local and private network addresses cannot be watched.');
  }
  if (url.username || url.password) throw new Error('Addresses with credentials cannot be watched.');
  return url.toString();
}

function pageText(html) {
  return String(html || '')
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length > 2).join('\n');
}

function addedLines(before, after) {
  const known = new Set(String(before || '').split('\n'));
  return String(after || '').split('\n').filter(line => !known.has(line)).join('\n');
}

function normalizeWatches(value) {
  return (Array.isArray(value) ? value : []).filter(object).slice(0, MAX_WATCHES).flatMap(item => {
    try {
      return [{
        id: clip(item.id, 100) || randomUUID(), url: safeUrl(item.url), label: clip(item.label, 80) || new URL(item.url).hostname,
        intervalHours: Number.isInteger(item.intervalHours) && item.intervalHours >= 6 && item.intervalHours <= 168 ? item.intervalHours : 24,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        lastCheckedAt: Number.isFinite(item.lastCheckedAt) ? item.lastCheckedAt : null,
        lastChangeAt: Number.isFinite(item.lastChangeAt) ? item.lastChangeAt : null,
        hash: /^[a-f0-9]{64}$/.test(item.hash) ? item.hash : '', snapshot: clip(item.snapshot, SNAPSHOT_CHARS),
        ...(typeof item.lastError === 'string' && item.lastError ? { lastError: clip(item.lastError, 300) } : {}),
      }];
    } catch { return []; }
  });
}

class WebWatcher {
  constructor({ store, onChange = () => {}, onChanged = () => {}, fetchImpl = fetch, now = Date.now }) {
    this.store = store; this.onChange = onChange; this.onChanged = onChanged; this.fetch = fetchImpl; this.now = now;
    this.timer = null; this.checking = false;
    store.data.webWatches = normalizeWatches(store.data.webWatches);
  }
  get watches() { return this.store.data.webWatches; }
  list() { return this.watches.map(({ snapshot, hash, ...item }) => ({ ...item })); }
  add({ url, label, intervalHours } = {}) {
    if (this.watches.length >= MAX_WATCHES) throw new Error(`At most ${MAX_WATCHES} pages can be watched. Remove one first.`);
    const address = safeUrl(url);
    if (this.watches.some(item => item.url === address)) throw new Error('That page is already watched.');
    if (intervalHours !== undefined && !(Number.isInteger(intervalHours) && intervalHours >= 6 && intervalHours <= 168)) throw new Error('intervalHours must be from 6 to 168.');
    const item = normalizeWatches([{ url: address, label: clip(label, 80) || new URL(address).hostname, intervalHours: intervalHours ?? 24, createdAt: this.now() }])[0];
    this.watches.push(item); this.save();
    void this.check(item).catch(() => {});
    return { id: item.id, url: item.url, label: item.label, intervalHours: item.intervalHours };
  }
  remove(id) {
    const before = this.watches.length;
    this.store.data.webWatches = this.watches.filter(item => item.id !== id);
    if (this.watches.length === before) throw new Error('That watch does not exist.');
    this.save(); return { removed: id };
  }
  save() { this.store.save(); this.onChange(); }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.tick(); }, TICK_MS); this.timer.unref?.(); setTimeout(() => { void this.tick(); }, 60000).unref?.(); } }
  stop() { clearInterval(this.timer); this.timer = null; }
  async tick() {
    if (this.checking) return null;
    const due = this.watches.find(item => !item.lastCheckedAt || this.now() - item.lastCheckedAt >= item.intervalHours * 3600000);
    return due ? this.check(due) : null;
  }
  async check(item) {
    this.checking = true;
    try {
      // Follow redirects by hand so every hop passes the same public-address check.
      let address = item.url, response;
      for (let hop = 0; ; hop++) {
        response = await this.fetch(address, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'LittleBot-WebWatch/1.0' } });
        const location = response.status >= 300 && response.status < 400 ? response.headers?.get?.('location') : null;
        if (!location) break;
        if (hop >= 3) throw new Error('Too many redirects.');
        address = safeUrl(new URL(location, address).toString());
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const length = Number(response.headers?.get?.('content-length'));
      if (length > MAX_BYTES) throw new Error('Page is too large to watch.');
      const text = pageText((await response.text()).slice(0, MAX_BYTES)).slice(0, 200000);
      const hash = createHash('sha256').update(text).digest('hex');
      const live = this.watches.find(entry => entry.id === item.id);
      if (!live) return null;
      const changed = Boolean(live.hash) && live.hash !== hash;
      const added = changed ? addedLines(live.snapshot, text.slice(0, SNAPSHOT_CHARS)).slice(0, 800) : '';
      Object.assign(live, { lastCheckedAt: this.now(), hash, snapshot: text.slice(0, SNAPSHOT_CHARS) });
      delete live.lastError;
      if (changed) live.lastChangeAt = this.now();
      this.save();
      if (changed) this.onChanged({ id: live.id, label: live.label, url: live.url, added });
      return { changed, added };
    } catch (error) {
      const live = this.watches.find(entry => entry.id === item.id);
      if (live) { live.lastCheckedAt = this.now(); live.lastError = clip(error?.message || String(error), 300); this.save(); }
      return { error: live?.lastError };
    } finally { this.checking = false; }
  }
}

module.exports = { WebWatcher, normalizeWatches, safeUrl, pageText, addedLines, MAX_WATCHES };
