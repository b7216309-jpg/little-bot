'use strict';

// Torrents: a small BitTorrent client built into Little Bot. The engine (WebTorrent) runs in a utility process
// (torrents/engine.mjs); this side keeps the list of transfers in state.json, decides what runs, stops sharing at
// the user's limit, searches the sources (torrents/sources.cjs) and answers the model's torrents tool. The model
// never starts a download itself: it asks, and a card in the panel waits for the user's click.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { Sources, validUrl } = require('./torrents/sources.cjs');

const STATUSES = ['queued', 'downloading', 'seeding', 'paused', 'finished', 'error'];
const MAX_ITEMS = 200;
const MAX_TORRENT_FILE = 10 * 1024 * 1024;
const DRAFT_TTL = 60 * 60000;
const RISKY = /\.(?:exe|msi|msix|appx|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|jar|reg|cpl|dll|sys|iso|img|vhd|vhdx|zip|7z|rar|cab|tar|gz)$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const MAGNET = /^magnet:\?(?:[^#\s]*&)?xt=urn:bt[im]h:[a-z\d]{32,40}/i;

const SPEC = {
  type: 'function',
  name: 'torrents',
  description: 'Little Bot\'s torrent client, for freely shared content: the Internet Archive, Academic Torrents, official Linux images, and the user\'s own sources. '
    + 'Actions: search (the user\'s enabled sources; results are numbered), request (ask to download one result by its number, or a magnet link or .torrent address the user gave; '
    + 'the user sees the name, size and files and decides with a click, so it does not start by itself), list (transfers with progress, speed and status), '
    + 'pause and resume (a transfer by its name or key, or "all"), limits (download and upload speed in KB/s, 0 for none). '
    + 'Do not look for copies of films, series, music, books or games that are not freely shared.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['search', 'request', 'list', 'pause', 'resume', 'limits'] },
      query: { type: 'string', maxLength: 200, description: 'search: what to look for.' },
      result: { type: 'integer', minimum: 1, description: 'request: the number of a result from your last search.' },
      link: { type: 'string', maxLength: 4000, description: 'request: a magnet link or the address of a .torrent file.' },
      note: { type: 'string', maxLength: 300, description: 'request: why, in a few words, shown on the card.' },
      target: { type: 'string', maxLength: 300, description: 'pause/resume: a transfer\'s name or key, or "all".' },
      download: { type: 'number', minimum: 0, description: 'limits: download speed in KB/s, 0 for none.' },
      upload: { type: 'number', minimum: 0, description: 'limits: upload speed in KB/s, 0 for none.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
};

class TorrentManager {
  // secrets: { seal(text) -> string, open(string) -> text }, so a Torznab key is never written in clear.
  constructor({ store, root, fork, enginePath = path.join(__dirname, 'torrents', 'engine.mjs'), downloadsDir, onChange, onStats, onFinished, fetch = globalThis.fetch, spawnProbe = null, runScan = null, secrets = null }) {
    this.store = store;
    this.root = root;
    this.fork = fork;
    this.enginePath = enginePath;
    this.downloadsDir = downloadsDir;
    this.onChange = onChange || (() => {});
    this.onStats = onStats || (() => {});
    this.onFinished = onFinished || (() => {});
    this.fetch = fetch;
    this.sources = new Sources({ fetch });
    this.spawnProbe = spawnProbe;
    this.runScan = runScan;
    this.secrets = secrets;
    this.panel = false;
    this.child = null;
    this.starting = null;
    this.calls = new Map();
    this.nextCall = 1;
    this.live = new Map();      // key -> the engine's latest numbers
    this.drafts = new Map();    // id -> a torrent read but not started
    this.requests = [];         // the model's requests, waiting for the user
    this.lastResults = [];      // the model's last search, so it can request "result 3"
    this.gamePaused = false;
    this.probe = null;
    this.scans = new Map();     // key -> 'running' | result
  }

  get enabled() { return this.store.data.settings.torrentsEnabled === true; }
  get data() {
    if (!object(this.store.data.torrents)) this.store.data.torrents = {};
    const data = this.store.data.torrents;
    if (!Array.isArray(data.items)) data.items = [];
    if (!object(data.settings)) data.settings = {};
    if (!object(data.sources)) data.sources = {};
    return data;
  }
  get settings() {
    const saved = this.data.settings;
    return {
      folder: typeof saved.folder === 'string' && saved.folder ? saved.folder : path.join(this.downloadsDir, 'Little Bot'),
      downloadLimit: Number.isFinite(saved.downloadLimit) && saved.downloadLimit > 0 ? saved.downloadLimit : 0,
      uploadLimit: Number.isFinite(saved.uploadLimit) && saved.uploadLimit > 0 ? saved.uploadLimit : 0,
      stopSharing: ['ratio', 'time', 'never'].includes(saved.stopSharing) ? saved.stopSharing : 'ratio',
      ratio: Number.isFinite(saved.ratio) && saved.ratio > 0 ? saved.ratio : 1,
      hours: Number.isFinite(saved.hours) && saved.hours > 0 ? saved.hours : 24,
      maxActive: Number.isInteger(saved.maxActive) && saved.maxActive >= 1 ? saved.maxActive : 3,
      upnp: saved.upnp !== false,
      magnetLinks: saved.magnetLinks === true,
      pauseForGames: saved.pauseForGames === true,
    };
  }

  specs() { return this.enabled ? [structuredClone(SPEC)] : []; }
  owns(name) { return name === 'torrents'; }
  _requireEnabled() { if (!this.enabled) throw new Error('Torrents is off. Turn it on in Extensions › Tools.'); }
  _save() { this.store.save(); this.onChange(); }
  item(key) { return this.data.items.find(item => item.key === key) || null; }

  // ------------------------------------------------------------------------------------------------ the engine

  async engine() {
    if (this.child) return this.child;
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const child = this.fork(this.enginePath, [], { serviceName: 'Little Bot torrents' });
      const timer = setTimeout(() => reject(new Error('The torrent engine did not start.')), 20000);
      child.on('message', message => {
        if (message?.type === 'ready') { clearTimeout(timer); this.child = child; resolve(child); return; }
        this._onEngine(message);
      });
      child.on('exit', () => {
        clearTimeout(timer);
        const was = this.child === child;
        this.child = null;
        for (const job of this.calls.values()) job.reject(new Error('The torrent engine stopped.'));
        this.calls.clear();
        this.live.clear();
        if (was && !this.closing) {
          // A crash: put running transfers back in the queue, to restart on the next look.
          for (const item of this.data.items) if (['downloading', 'seeding'].includes(item.status)) this._bank(item);
          this.onChange();
        }
      });
    }).finally(() => { this.starting = null; });
    const child = await this.starting;
    await this._call('configure', this._limits());
    return child;
  }

  _limits() {
    const settings = this.settings;
    const paused = this.gamePaused;
    return { upnp: settings.upnp, downloadLimit: paused ? 1024 : settings.downloadLimit * 1024, uploadLimit: paused ? 1024 : settings.uploadLimit * 1024 };
  }

  async _call(op, args, timeoutMs = 120000) {
    const child = this.child || await this.engine();
    const id = this.nextCall++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.calls.delete(id); reject(new Error('The torrent engine did not answer.')); }, timeoutMs);
      this.calls.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      child.postMessage({ id, op, args });
    });
  }

  _onEngine(message) {
    if (!object(message)) return;
    if (message.id && this.calls.has(message.id)) {
      const job = this.calls.get(message.id);
      this.calls.delete(message.id);
      if (message.error) job.reject(new Error(message.error)); else job.resolve(message.result);
      return;
    }
    if (message.type === 'stats') this._onStats(message.torrents || []);
    else if (message.type === 'done') this._onDone(message.key);
    else if (message.type === 'error' && message.key) {
      const item = this.item(message.key);
      if (item) { this._bank(item); Object.assign(item, { status: 'error', error: String(message.message || 'The transfer failed.').slice(0, 300) }); this._call('remove', { key: item.key }).catch(() => {}); this._save(); this._schedule(); }
    }
  }

  // Keeps the bytes a running transfer has sent, since the engine's counters restart with each run.
  _bank(item) {
    const live = this.live.get(item.key);
    if (live) item.uploaded = (item.uploaded || 0) + (live.uploaded || 0);
    this.live.delete(item.key);
    if (['downloading', 'seeding'].includes(item.status)) item.status = item.status === 'seeding' ? 'seeding' : 'queued';
  }

  _onStats(list) {
    const now = Date.now();
    let changed = false;
    for (const stats of list) {
      const item = this.item(stats.key);
      if (!item) continue;
      this.live.set(item.key, stats);
      item.progress = stats.progress;
      if (item.status === 'downloading' && stats.done) { this._onDone(item.key); changed = true; }
      if (item.status === 'seeding') {
        const settings = this.settings;
        const sent = (item.uploaded || 0) + (stats.uploaded || 0);
        const enough = settings.stopSharing === 'ratio' ? sent >= settings.ratio * (item.length || 1)
          : settings.stopSharing === 'time' ? now - (item.doneAt || now) >= settings.hours * 3600000 : false;
        if (enough) { this._stop(item, 'finished'); changed = true; }
      }
    }
    this.onStats(this.liveStats());
    if (changed) this._save();
  }

  _onDone(key) {
    const item = this.item(key);
    if (!item || item.status !== 'downloading') return;
    Object.assign(item, { status: this.settings.stopSharing === 'ratio' && this.settings.ratio <= 0 ? 'finished' : 'seeding', doneAt: Date.now(), progress: 1 });
    this.onFinished(item);
    this._save();
    this._schedule();
  }

  liveStats() {
    const result = {};
    for (const [key, stats] of this.live) {
      const item = this.item(key);
      result[key] = { progress: stats.progress, downloadSpeed: stats.downloadSpeed, uploadSpeed: stats.uploadSpeed, peers: stats.peers, timeRemaining: stats.timeRemaining,
        uploaded: (item?.uploaded || 0) + (stats.uploaded || 0), downloaded: stats.downloaded };
    }
    return result;
  }

  // Starts queued transfers up to the limit, and keeps seeding ones running.
  async _schedule() {
    if (!this.enabled) return;
    const items = this.data.items;
    let active = items.filter(item => item.status === 'downloading').length;
    const toRun = items.filter(item => (item.status === 'seeding' && !this.live.has(item.key)) || (item.status === 'downloading' && !this.live.has(item.key)));
    for (const item of items) if (item.status === 'queued' && active < this.settings.maxActive) { item.status = 'downloading'; active++; toRun.push(item); }
    if (!toRun.length) { this._updateProbe(); return; }
    this._save();
    for (const item of toRun) {
      if (this.live.has(item.key)) continue;
      this.live.set(item.key, { progress: item.progress || 0, uploaded: 0 });
      try {
        const bytes = fs.readFileSync(item.torrentPath);
        await this._call('add', { key: item.key, source: bytes, base: item.folder, select: item.select });
      } catch (error) {
        this.live.delete(item.key);
        Object.assign(item, { status: 'error', error: String(error.message || error).slice(0, 300) });
        this._save();
      }
    }
    this._updateProbe();
  }

  _stop(item, status) {
    this._bank(item);
    item.status = status;
    if (status === 'finished') item.finishedAt = Date.now();
    this._call('remove', { key: item.key }).catch(() => {});
  }

  // ------------------------------------------------------------------------------------------------ adding

  // Reads a torrent before starting it: from a search result, a magnet link, a .torrent address or file bytes.
  async prepare({ result, magnet, url, bytes, name = null } = {}) {
    this._requireEnabled();
    let source = { name: name || 'Added by you', page: null };
    if (object(result)) {
      source = { name: String(result.source || 'Search').slice(0, 80), page: typeof result.page === 'string' ? result.page.slice(0, 500) : null };
      magnet = result.magnet || null; url = result.torrent || null;
      if (magnet && url) magnet = null; // a .torrent file is read here; a magnet needs peers
    }
    let info;
    if (bytes) info = await this._call('inspect', { bytes: Uint8Array.from(bytes) });
    else if (url && !MAGNET.test(url)) {
      const target = validUrl(url).href;
      const response = await this.fetch(target, { headers: { 'user-agent': 'Little Bot', accept: 'application/x-bittorrent, */*' }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
      // Some indexers answer a .torrent address with a redirect to a magnet link.
      const location = response.url && MAGNET.test(response.url) ? response.url : null;
      if (location) info = await this._peek(location);
      else {
        if (!response.ok) throw new Error(`${new URL(target).host} answered ${response.status}.`);
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length > MAX_TORRENT_FILE) throw new Error('That .torrent file is too large.');
        info = await this._call('inspect', { bytes: data });
      }
    } else if (magnet || (url && MAGNET.test(url))) {
      const link = String(magnet || url).trim();
      if (!MAGNET.test(link)) throw new Error('That is not a magnet link.');
      info = await this._peek(link);
    } else throw new Error('Give a magnet link, a .torrent address or a .torrent file.');
    if (!info?.torrentFile) throw new Error('The torrent could not be read.');
    const id = crypto.randomUUID();
    const draft = { id, at: Date.now(), source, infoHash: info.infoHash, name: String(info.name || 'Torrent').slice(0, 300), length: info.length,
      files: info.files.map(file => ({ index: file.index, path: String(file.path).slice(0, 500), length: file.length })), torrentFile: Buffer.from(info.torrentFile) };
    this._dropOldDrafts();
    this.drafts.set(id, draft);
    return this.publicDraft(draft);
  }

  _peek(magnet) { return this._call('peek', { magnet, scratch: path.join(this.root, 'peek') }, 120000); }

  _dropOldDrafts() { for (const [id, draft] of this.drafts) if (Date.now() - draft.at > DRAFT_TTL) this.drafts.delete(id); }

  publicDraft(draft) {
    const folder = this.settings.folder;
    return { id: draft.id, name: draft.name, length: draft.length, source: draft.source, infoHash: draft.infoHash,
      files: draft.files.map(file => ({ ...file, risky: RISKY.test(file.path) })), folder, free: freeSpace(folder),
      existing: Boolean(this.item(draft.infoHash)) };
  }

  cancelDraft(id) { this.drafts.delete(id); }

  // Starts a read torrent with the chosen files (all when select is null).
  async start(draftId, select = null) {
    this._requireEnabled();
    const draft = this.drafts.get(draftId);
    if (!draft) throw new Error('This torrent is no longer ready. Add it again.');
    const chosen = Array.isArray(select) ? [...new Set(select.filter(index => draft.files.some(file => file.index === index)))] : null;
    if (chosen && !chosen.length) throw new Error('Choose at least one file.');
    const length = draft.files.filter(file => !chosen || chosen.includes(file.index)).reduce((sum, file) => sum + file.length, 0);
    const folder = this.settings.folder;
    fs.mkdirSync(folder, { recursive: true });
    const free = freeSpace(folder);
    if (free !== null && free < length + 200 * 1024 * 1024) throw new Error(`Not enough space: it needs ${formatBytes(length)} and ${formatBytes(free)} is free in ${folder}.`);
    const existing = this.item(draft.infoHash);
    if (existing && !['finished', 'error', 'paused'].includes(existing.status)) throw new Error(`${existing.name} is already in your transfers.`);
    const torrentPath = path.join(this.root, 'files', `${draft.infoHash}.torrent`);
    fs.mkdirSync(path.dirname(torrentPath), { recursive: true });
    fs.writeFileSync(torrentPath, draft.torrentFile);
    const item = {
      key: draft.infoHash, name: draft.name, length, totalLength: draft.length, files: draft.files.length === 1 ? draft.files : draft.files.slice(0, 500),
      fileCount: draft.files.length, select: chosen, folder, source: draft.source, torrentPath, addedAt: Date.now(), status: 'queued',
      progress: 0, uploaded: existing?.uploaded || 0, error: null, risky: draft.files.some(file => (!chosen || chosen.includes(file.index)) && RISKY.test(file.path)),
    };
    this.data.items = [item, ...this.data.items.filter(other => other.key !== item.key)].slice(0, MAX_ITEMS);
    this.drafts.delete(draftId);
    this._save();
    await this._schedule();
    return item;
  }

  pause(key) {
    const item = this.item(key);
    if (!item) throw new Error('There is no such transfer.');
    if (!['queued', 'downloading', 'seeding'].includes(item.status)) return item;
    item.resumeTo = item.status === 'seeding' ? 'seeding' : 'queued';
    this._stop(item, 'paused');
    this._save();
    this._schedule();
    return item;
  }

  resume(key) {
    const item = this.item(key);
    if (!item) throw new Error('There is no such transfer.');
    if (!['paused', 'error', 'finished'].includes(item.status)) return item;
    // A finished transfer resumes sharing; anything else picks up where it stopped (the engine checks what is on disk).
    item.status = item.status === 'finished' || item.resumeTo === 'seeding' ? 'seeding' : 'queued';
    if (item.status === 'seeding') item.doneAt = Date.now();
    item.error = null;
    delete item.resumeTo;
    this._save();
    this._schedule();
    return item;
  }

  async remove(key, { deleteFiles = false } = {}) {
    const item = this.item(key);
    if (!item) return;
    this._bank(item);
    if (this.child) await this._call('remove', { key, deleteFiles }).catch(() => {});
    if (deleteFiles && !this.child) {
      // Not running: remove the files it would have written, inside the download folder only.
      for (const file of item.files || []) {
        if (item.select && !item.select.includes(file.index)) continue;
        const target = path.resolve(item.folder, file.path);
        if (target.startsWith(path.resolve(item.folder) + path.sep)) fs.rmSync(target, { force: true });
      }
    }
    fs.rmSync(item.torrentPath, { force: true });
    this.data.items = this.data.items.filter(other => other.key !== key);
    this._save();
    this._schedule();
  }

  // Where the files are: the single file, or the torrent's folder.
  location(item) {
    const first = item.files?.[0]?.path || item.name;
    const top = first.split(/[\\/]/)[0];
    return path.join(item.folder, item.fileCount > 1 ? top : first);
  }

  // Microsoft Defender's command-line scanner, on the files of one transfer.
  async scan(key) {
    const item = this.item(key);
    if (!item) throw new Error('There is no such transfer.');
    const target = this.location(item);
    if (!fs.existsSync(target)) throw new Error('The files are not on disk yet.');
    this.scans.set(key, { status: 'running' });
    this.onChange();
    try {
      const result = await (this.runScan || defenderScan)(target);
      this.scans.set(key, { status: result.threats ? 'threats' : 'clean', at: Date.now(), detail: result.detail || '' });
    } catch (error) {
      this.scans.set(key, { status: 'failed', at: Date.now(), detail: error.message });
    }
    this.onChange();
    return this.scans.get(key);
  }

  // ------------------------------------------------------------------------------------------------ the model's requests

  async request({ result, link, note }) {
    let draft;
    if (Number.isInteger(result)) {
      const chosen = this.lastResults[result - 1];
      if (!chosen) throw new Error(this.lastResults.length ? `Choose a result between 1 and ${this.lastResults.length}.` : 'Search first, then request a result by its number.');
      draft = await this.prepare({ result: chosen });
    } else if (typeof link === 'string' && link.trim()) draft = await this.prepare(MAGNET.test(link.trim()) ? { magnet: link.trim() } : { url: link.trim() });
    else throw new Error('Request a result by its number, or give a magnet link or .torrent address.');
    const request = { id: draft.id, at: Date.now(), note: typeof note === 'string' ? note.trim().slice(0, 300) : '' };
    this.requests = [request, ...this.requests.filter(other => Date.now() - other.at < DRAFT_TTL)].slice(0, 10);
    if (!this.panel) this.panel = true;
    this.onChange();
    return draft;
  }

  answerRequest(id, accept, select = null) {
    const request = this.requests.find(item => item.id === id);
    if (!request) throw new Error('This request is no longer waiting.');
    this.requests = this.requests.filter(item => item.id !== id);
    if (!accept) { this.cancelDraft(id); this.onChange(); return null; }
    return this.start(id, select);
  }

  async call(args, { chat } = {}) {
    if (!object(args)) throw new Error('Tool arguments must be an object.');
    this._requireEnabled();
    if (!chat || chat.internal || chat.status !== 'running') throw new Error('Torrents are handled in your own conversation with the user, not in background work.');
    const { action } = args;
    if (action === 'search') {
      const { results, errors } = await this.sources.search(String(args.query || ''), this._unsealed(), { limit: 15 });
      this.lastResults = results;
      return {
        results: results.map((item, index) => `${index + 1}. ${item.title} — ${item.size ? formatBytes(item.size) : 'size unknown'}${item.seeders !== null ? `, ${item.seeders} seeders` : ''} (${item.source}${item.note ? `, ${item.note}` : ''})`),
        ...(errors.length ? { unavailable: errors.map(error => `${error.source}: ${error.error}`) } : {}),
        hint: results.length ? 'Request one by its number; the user decides.' : 'Nothing found. Try other words.',
      };
    }
    if (action === 'request') {
      const draft = await this.request({ result: args.result, link: args.link, note: args.note });
      return { requested: draft.name, size: formatBytes(draft.length), files: draft.files.length, note: 'A card is waiting in the Torrents panel; it downloads only if the user clicks Download.' };
    }
    if (action === 'list') {
      const live = this.liveStats();
      return { transfers: this.data.items.slice(0, 30).map(item => {
        const stats = live[item.key];
        return `${item.name} (${item.key.slice(0, 8)}): ${item.status}, ${Math.round((stats?.progress ?? item.progress ?? 0) * 100)}% of ${formatBytes(item.length)}${stats?.downloadSpeed ? `, ↓ ${formatBytes(stats.downloadSpeed)}/s` : ''}${stats?.uploadSpeed ? `, ↑ ${formatBytes(stats.uploadSpeed)}/s` : ''}${item.error ? `, error: ${item.error}` : ''}`;
      }), ...(this.gamePaused ? { note: 'Paused while a full-screen game runs.' } : {}) };
    }
    if (action === 'pause' || action === 'resume') {
      const targets = this._find(args.target);
      for (const item of targets) action === 'pause' ? this.pause(item.key) : this.resume(item.key);
      return { [action === 'pause' ? 'paused' : 'resumed']: targets.map(item => item.name) };
    }
    if (action === 'limits') {
      const next = {};
      if (args.download !== undefined) next.downloadLimit = Math.round(Number(args.download));
      if (args.upload !== undefined) next.uploadLimit = Math.round(Number(args.upload));
      await this.setSettings(next);
      const settings = this.settings;
      return { download: settings.downloadLimit ? `${settings.downloadLimit} KB/s` : 'no limit', upload: settings.uploadLimit ? `${settings.uploadLimit} KB/s` : 'no limit' };
    }
    throw new Error('Use one of the listed actions.');
  }

  _find(target) {
    const wanted = String(target || '').trim().toLowerCase();
    if (!wanted) throw new Error('Say which transfer, or "all".');
    if (wanted === 'all') return this.data.items.filter(item => item.status !== 'finished');
    const found = this.data.items.filter(item => item.key.startsWith(wanted) || item.name.toLowerCase().includes(wanted));
    if (!found.length) throw new Error(`No transfer matches "${target}".`);
    return found;
  }

  // ------------------------------------------------------------------------------------------------ settings and sources

  async setSettings(input) {
    if (!object(input)) throw new Error('Give the torrent settings.');
    const next = { ...this.data.settings };
    if (input.folder !== undefined) {
      if (typeof input.folder !== 'string' || !path.isAbsolute(input.folder)) throw new Error('Choose a folder.');
      next.folder = path.resolve(input.folder);
    }
    for (const [name, high] of [['downloadLimit', 10 ** 7], ['uploadLimit', 10 ** 7]]) {
      if (input[name] === undefined) continue;
      if (!Number.isFinite(input[name]) || input[name] < 0 || input[name] > high) throw new Error('Speed limits are in KB/s, 0 for none.');
      next[name] = Math.round(input[name]);
    }
    if (input.stopSharing !== undefined) { if (!['ratio', 'time', 'never'].includes(input.stopSharing)) throw new Error('Stop sharing by ratio, by time, or never.'); next.stopSharing = input.stopSharing; }
    if (input.ratio !== undefined) { if (!Number.isFinite(input.ratio) || input.ratio < 0.1 || input.ratio > 100) throw new Error('The ratio is between 0.1 and 100.'); next.ratio = input.ratio; }
    if (input.hours !== undefined) { if (!Number.isFinite(input.hours) || input.hours < 1 || input.hours > 24 * 365) throw new Error('Share for 1 hour to a year.'); next.hours = input.hours; }
    if (input.maxActive !== undefined) { if (!Number.isInteger(input.maxActive) || input.maxActive < 1 || input.maxActive > 20) throw new Error('Run 1 to 20 downloads at once.'); next.maxActive = input.maxActive; }
    for (const name of ['upnp', 'magnetLinks', 'pauseForGames']) if (input[name] !== undefined) next[name] = input[name] === true;
    const restart = input.upnp !== undefined && next.upnp !== this.settings.upnp;
    this.data.settings = next;
    this._save();
    if (this.child) {
      if (restart) await this.restartEngine();
      else await this._call('configure', this._limits()).catch(() => {});
    }
    this._updateProbe();
    this._schedule();
  }

  async restartEngine() {
    for (const item of this.data.items) if (this.live.has(item.key)) this._bank(item);
    const child = this.child;
    this.child = null;
    child?.kill();
    this.live.clear();
    this._save();
  }

  async setSources(input) {
    if (!object(input)) throw new Error('Say what to change in the sources.');
    const sources = this.data.sources;
    sources.builtIn = object(sources.builtIn) ? sources.builtIn : {};
    sources.custom = Array.isArray(sources.custom) ? sources.custom : [];
    if (input.action === 'toggle') {
      const builtIn = ['archive', 'academic', 'linux'].includes(input.id);
      if (builtIn) sources.builtIn[input.id] = input.enabled === true;
      else { const source = sources.custom.find(item => item.id === input.id); if (!source) throw new Error('There is no such source.'); source.enabled = input.enabled === true; }
    } else if (input.action === 'add') {
      const kind = input.kind === 'torznab' ? 'torznab' : 'rss';
      const url = validUrl(input.url).href;
      const name = String(input.name || new URL(url).host).trim().slice(0, 60);
      const apiKey = kind === 'torznab' && input.apiKey ? String(input.apiKey).trim().slice(0, 200) : '';
      if (apiKey && !this.secrets) throw new Error('Secure storage is unavailable, so a key cannot be saved.');
      const source = { id: crypto.randomUUID(), name, kind, url, enabled: true };
      const check = await this.sources.test({ ...source, apiKey });
      sources.custom = [...sources.custom, { ...source, ...(apiKey ? { apiKeySealed: this.secrets.seal(apiKey) } : {}) }].slice(0, 30);
      this._save();
      return { added: name, items: check.items };
    } else if (input.action === 'remove') {
      sources.custom = sources.custom.filter(item => item.id !== input.id);
    } else throw new Error('Toggle, add or remove a source.');
    this._save();
    return null;
  }

  search(query, only = null) { this._requireEnabled(); return this.sources.search(query, this._unsealed(), { only }); }

  // The saved sources with their keys opened, for a search only.
  _unsealed() {
    const saved = this.data.sources;
    return { ...saved, custom: (saved.custom || []).map(source => {
      if (!source.apiKeySealed) return source;
      try { return { ...source, apiKey: this.secrets.open(source.apiKeySealed) }; } catch { return source; }
    }) };
  }

  // ------------------------------------------------------------------------------------------------ full-screen games

  // While the switch is on and something transfers, Windows is asked every 10 s whether a full-screen game or app
  // is in front; if so, transfers slow to a trickle until it closes.
  _updateProbe() {
    const want = this.enabled && this.settings.pauseForGames && this.data.items.some(item => ['downloading', 'seeding'].includes(item.status));
    if (want && !this.probe) {
      const child = (this.spawnProbe || spawnFullscreenProbe)();
      this.probe = child;
      let buffer = '';
      child.stdout?.on('data', chunk => {
        buffer += chunk.toString();
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
          const state = Number(buffer.slice(0, at).trim()); buffer = buffer.slice(at + 1);
          this._setGamePaused(state === 2 || state === 3);
        }
      });
      child.on?.('exit', () => { if (this.probe === child) { this.probe = null; this._setGamePaused(false); } });
    } else if (!want && this.probe) {
      const child = this.probe;
      this.probe = null;
      try { child.kill(); } catch { /* Already gone. */ }
      this._setGamePaused(false);
    }
  }

  _setGamePaused(paused) {
    if (paused === this.gamePaused) return;
    this.gamePaused = paused;
    if (this.child) this._call('configure', this._limits()).catch(() => {});
    this.onChange();
  }

  // ------------------------------------------------------------------------------------------------ the panel

  showPanel(visible) { this._requireEnabled(); this.panel = visible === true; if (this.panel) this._schedule(); this.onChange(); }

  // Called at startup and when switched on: transfers that were running carry on.
  resumeAll() { if (this.enabled && this.data.items.some(item => ['queued', 'downloading', 'seeding'].includes(item.status))) this._schedule().catch(() => {}); }

  state() {
    const live = this.liveStats();
    return {
      enabled: this.enabled, panel: this.panel && this.enabled, settings: this.settings, gamePaused: this.gamePaused, engine: Boolean(this.child),
      sources: this.sources.list(this.data.sources),
      items: this.data.items.map(item => ({
        key: item.key, name: item.name, length: item.length, fileCount: item.fileCount, folder: item.folder, source: item.source, status: item.status,
        progress: live[item.key]?.progress ?? item.progress ?? 0, uploaded: live[item.key]?.uploaded ?? item.uploaded ?? 0, addedAt: item.addedAt, doneAt: item.doneAt || null,
        error: item.error || null, risky: Boolean(item.risky), scan: this.scans.get(item.key) || null,
      })),
      requests: this.requests.map(request => { const draft = this.drafts.get(request.id); return draft ? { ...this.publicDraft(draft), note: request.note, at: request.at } : null; }).filter(Boolean),
    };
  }

  close() {
    this.closing = true;
    for (const item of this.data.items) if (this.live.has(item.key)) this._bank(item);
    try { this.store.save(); } catch { /* Saved on the next start. */ }
    this.child?.kill();
    this.child = null;
    try { this.probe?.kill(); } catch { /* Already gone. */ }
    this.probe = null;
  }

  disable() {
    this.close();
    this.closing = false;
    this.panel = false;
    this.requests = [];
    this.drafts.clear();
  }
}

function freeSpace(folder) {
  let target = folder;
  while (target && !fs.existsSync(target)) { const parent = path.dirname(target); if (parent === target) break; target = parent; }
  try { const stats = fs.statfsSync(target); return stats.bavail * stats.bsize; } catch { return null; }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function spawnFullscreenProbe() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type 'using System; using System.Runtime.InteropServices; public static class LbQuns { [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state); }'
while ($true) { $s = 0; [void][LbQuns]::SHQueryUserNotificationState([ref]$s); [Console]::Out.WriteLine($s); Start-Sleep -Seconds 10 }`;
  return spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
}

// Defender's scanner: exit 0 is clean, 2 is a threat found (Defender deals with it as it is set to).
function defenderScan(target) {
  const scanner = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe');
  if (!fs.existsSync(scanner)) return Promise.reject(new Error('Microsoft Defender\'s scanner is not on this PC.'));
  return new Promise((resolve, reject) => {
    execFile(scanner, ['-Scan', '-ScanType', '3', '-File', target], { windowsHide: true, timeout: 30 * 60000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      const code = error ? error.code : 0;
      if (code === 0) resolve({ threats: false, detail: 'No threats found.' });
      else if (code === 2) resolve({ threats: true, detail: String(stdout || '').split(/\r?\n/).filter(line => /threat|found/i.test(line)).slice(0, 4).join(' ').slice(0, 300) || 'Defender found a threat.' });
      else reject(new Error(`Defender could not scan it (${error?.code ?? 'error'}).`));
    });
  });
}

module.exports = { TorrentManager, TORRENTS_TOOL: SPEC, formatBytes, RISKY, MAGNET };
