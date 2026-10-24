// The torrent engine: WebTorrent in an Electron utility process, so hashing pieces and talking to peers never
// slows the window. The main process (torrents.cjs) owns the list of transfers and sends commands; this process
// owns the live torrents and sends back their numbers once a second.

import path from 'node:path';
import fs from 'node:fs';
import WebTorrent from 'webtorrent';
import parseTorrent, { toTorrentFile } from 'parse-torrent';

const port = process.parentPort;
let client = null;
let options = { upnp: true, downloadLimit: -1, uploadLimit: -1, torrentPort: 0 };
const torrents = new Map(); // key -> { torrent, base }

function send(message) { port.postMessage(message); }

function ensureClient() {
  if (client) return client;
  client = new WebTorrent({ natUpnp: options.upnp, natPmp: options.upnp, utp: true, lsd: true, dht: true, ...(options.torrentPort ? { torrentPort: options.torrentPort } : {}) });
  client.on('error', error => send({ type: 'error', message: error.message || String(error) }));
  applyLimits();
  return client;
}

function applyLimits() {
  if (!client) return;
  client.throttleDownload(options.downloadLimit > 0 ? options.downloadLimit : -1);
  client.throttleUpload(options.uploadLimit > 0 ? options.uploadLimit : -1);
}

// Every file must stay inside the download folder, under a name Windows takes as a plain file: no drive letters or
// streams (":"), no reserved characters, no device names like CON or NUL. Anything else is refused.
const RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i;
const REFUSED = 'This torrent names files outside the download folder or with names Windows does not allow, so it was refused.';
export function safeFiles(files, base) {
  const root = path.resolve(base) + path.sep;
  return files.every(file => {
    const parts = String(file.path).split(/[\\/]/);
    return parts.every(part => part && !/[<>:"|?*\x00-\x1f]/.test(part) && !RESERVED.test(part) && !/[. ]$/.test(part))
      && path.resolve(base, file.path).startsWith(root);
  });
}

function describe(torrent) {
  return {
    infoHash: torrent.infoHash, name: torrent.name, length: torrent.length, pieceLength: torrent.pieceLength,
    files: torrent.files.map((file, index) => ({ index, path: file.path, length: file.length })),
  };
}

function choose(torrent, select) {
  // WebTorrent selects every piece when a torrent starts; narrow it to the chosen files.
  torrent.deselect(0, torrent.pieces.length - 1, false);
  torrent.files.forEach((file, index) => { if (!select || select.includes(index)) file.select(); else file.deselect(); });
}

const ops = {
  configure(next) {
    const restart = client && (next.upnp !== undefined && next.upnp !== options.upnp);
    options = { ...options, ...next };
    if (restart) send({ type: 'restartNeeded' });
    applyLimits();
    return true;
  },

  // What a .torrent file holds, read here without touching the network.
  async inspect({ bytes }) {
    const parsed = await parseTorrent(Buffer.from(bytes));
    if (!parsed.infoHash || !parsed.files?.length) throw new Error('This is not a valid .torrent file.');
    if (!safeFiles(parsed.files, path.resolve('torrent-check'))) throw new Error(REFUSED);
    return { infoHash: parsed.infoHash, name: parsed.name, length: parsed.length, files: parsed.files.map((file, index) => ({ index, path: file.path, length: file.length })), torrentFile: Buffer.from(toTorrentFile(parsed)) };
  },

  // A magnet link only says which torrent; its file list comes from peers. It is fetched into a private folder,
  // so a cancelled look never touches the download folder, and nothing is kept.
  async peek({ magnet, scratch, timeoutMs = 90000 }) {
    const key = `peek:${Math.random().toString(36).slice(2)}`;
    fs.mkdirSync(scratch, { recursive: true });
    try {
      const info = await ops.add({ key, source: magnet, base: scratch, peek: true, timeoutMs });
      return info;
    } finally { await ops.remove({ key, deleteFiles: true }); }
  },

  // Adds a torrent from the bytes of its .torrent file (or a magnet link) and starts the chosen files.
  // Resolves once the metadata is known.
  add({ key, source, base, select = null, peek = false, timeoutMs = 90000 }) {
    const existing = torrents.get(key);
    if (existing) {
      if (!peek && existing.torrent.files.length) choose(existing.torrent, select);
      return Promise.resolve(describe(existing.torrent));
    }
    const input = typeof source === 'string' ? source : Buffer.from(source);
    return new Promise((resolve, reject) => {
      let settled = false;
      const torrent = ensureClient().add(input, { path: base, deselect: true, destroyStoreOnDestroy: false });
      torrents.set(key, { torrent, base });
      const fail = message => {
        if (settled) return;
        settled = true;
        torrents.delete(key);
        try { torrent.destroy({ destroyStore: false }); } catch { /* Already gone. */ }
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail('No peer sent the torrent\'s file list in time. It may have no seeders right now.'), timeoutMs);
      torrent.on('error', error => { clearTimeout(timer); if (!settled) fail(error.message || String(error)); else send({ type: 'error', key, message: error.message || String(error) }); });
      torrent.on('warning', () => {});
      torrent.on('done', () => send({ type: 'done', key }));
      torrent.once('metadata', () => {
        clearTimeout(timer);
        if (!safeFiles(torrent.files, base)) return fail(REFUSED);
        if (!peek) choose(torrent, select);
        settled = true;
        resolve({ ...describe(torrent), torrentFile: torrent.torrentFile ? Buffer.from(torrent.torrentFile) : null });
      });
    });
  },

  select({ key, select }) {
    const entry = torrents.get(key);
    if (!entry) throw new Error('That transfer is not running.');
    choose(entry.torrent, select);
    return true;
  },

  remove({ key, deleteFiles = false }) {
    const entry = torrents.get(key);
    if (!entry) return Promise.resolve(false);
    torrents.delete(key);
    return new Promise(resolve => entry.torrent.destroy({ destroyStore: deleteFiles }, () => resolve(true)));
  },

  stats() { return snapshot(); },
};

function snapshot() {
  const list = [];
  for (const [key, { torrent }] of torrents) {
    const selected = torrent.files.filter(file => !file._destroyed && file._startPiece !== undefined);
    list.push({
      key, ready: Boolean(torrent.files.length), done: torrent.done, progress: torrent.progress,
      downloaded: torrent.downloaded, uploaded: torrent.uploaded, received: torrent.received,
      downloadSpeed: Math.round(torrent.downloadSpeed), uploadSpeed: Math.round(torrent.uploadSpeed),
      peers: torrent.numPeers, timeRemaining: Number.isFinite(torrent.timeRemaining) ? Math.round(torrent.timeRemaining / 1000) : null, // WebTorrent gives milliseconds
      files: torrent.files.map(file => ({ length: file.length, downloaded: file.downloaded, progress: file.progress })),
      selected: selected.length,
    });
  }
  return list;
}

// Only as a utility process; tests import this file for safeFiles alone.
if (port) {
  setInterval(() => { if (torrents.size) send({ type: 'stats', torrents: snapshot() }); }, 1000).unref();
  port.on('message', async ({ data }) => {
    const { id, op, args } = data || {};
    if (!ops[op]) { send({ id, error: `Unknown operation ${op}.` }); return; }
    try { send({ id, result: await ops[op](args || {}) }); }
    catch (error) { send({ id, error: error.message || String(error) }); }
  });
  send({ type: 'ready' });
}
