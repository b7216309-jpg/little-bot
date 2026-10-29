'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Sources, parseFeed } = require('../src/torrents/sources.cjs');
const { TorrentManager } = require('../src/torrents.cjs');
const { AgentTools } = require('../src/agent-tools.cjs');

const HASH_A = 'a'.repeat(40), HASH_B = 'b'.repeat(40);

// A stand-in for the engine process: answers the manager's calls and lets a test push numbers.
function fakeEngine() {
  const engine = { calls: [], children: [], torrents: new Map() };
  engine.fork = () => {
    const child = new EventEmitter();
    child.postMessage = ({ id, op, args }) => {
      engine.calls.push([op, args]);
      let result = true;
      if (op === 'inspect' || op === 'peek') {
        const hash = op === 'peek' ? HASH_B : HASH_A;
        result = { infoHash: hash, name: op === 'peek' ? 'From a magnet' : 'Example.iso', length: 3000, files: [{ index: 0, path: 'Example/a.iso', length: 1000 }, { index: 1, path: 'Example/b.txt', length: 2000 }], torrentFile: new Uint8Array([1, 2, 3]) };
      }
      if (op === 'add') engine.torrents.set(args.key, args);
      if (op === 'remove') engine.torrents.delete(args.key);
      setImmediate(() => child.emit('message', { id, result }));
    };
    child.kill = () => child.emit('exit', 0);
    engine.children.push(child);
    setImmediate(() => child.emit('message', { type: 'ready' }));
    return child;
  };
  engine.push = message => engine.children.at(-1).emit('message', message);
  return engine;
}

function setup(t, { enabled = true, fetch = null, settings = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-torrents-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = { data: { settings: { torrentsEnabled: enabled }, torrents: { settings: { folder: path.join(root, 'downloads'), ...settings } } }, saves: 0, save() { this.saves++; } };
  const engine = fakeEngine();
  const finished = [];
  const manager = new TorrentManager({ store, root: path.join(root, 'state'), fork: engine.fork, downloadsDir: root, onFinished: item => finished.push(item.name),
    fetch: fetch || (async () => { throw new Error('no network in tests'); }), secrets: { seal: text => `sealed:${Buffer.from(text).toString('base64')}`, open: sealed => Buffer.from(sealed.slice(7), 'base64').toString() } });
  return { store, engine, manager, finished, chat: { id: 'c', status: 'running' } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('feeds: .torrent enclosures, magnet links, Torznab numbers and Atom entries', () => {
  const rss = `<rss><channel>
    <item><title>Big &amp; Free Film</title><link>https://example.org/page</link><enclosure url="https://example.org/film.torrent" length="7340032" type="application/x-bittorrent"/><pubDate>Tue, 15 Sep 2026 00:00:00 GMT</pubDate>
      <torznab:attr name="seeders" value="42"/><torznab:attr name="peers" value="50"/><torznab:attr name="size" value="7340032"/></item>
    <item><title><![CDATA[Dataset <v2>]]></title><link>magnet:?xt=urn:btih:${HASH_A}&amp;dn=data</link></item>
    <item><title>No link at all</title></item>
  </channel></rss>`;
  const items = parseFeed(rss, 'Mine');
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].title, items[0].torrent, items[0].size, items[0].seeders, items[0].leechers], ['Big & Free Film', 'https://example.org/film.torrent', 7340032, 42, 8]);
  assert.equal(items[1].title, 'Dataset <v2>');
  assert.equal(items[1].magnet, `magnet:?xt=urn:btih:${HASH_A}&dn=data`);
  const atom = parseFeed(`<feed><entry><title>Atom one</title><link href="https://example.org/one.torrent"/><updated>2026-01-02T00:00:00Z</updated></entry></feed>`, 'Atom');
  assert.equal(atom[0].torrent, 'https://example.org/one.torrent');
});

test('search: every enabled source at once, titles with the words first, a failing source reported apart', async () => {
  const pages = {
    'archive.org': JSON.stringify({ response: { docs: [{ identifier: 'debian-12-netinst', title: 'debian 12 netinst', item_size: 600, downloads: 9, mediatype: 'software' }, { identifier: 'cats', title: 'Cats', item_size: 1 }] } }),
    'cdimage.debian.org': '<a href="debian-13.7.0-amd64-netinst.iso.torrent"><img></a><a href="debian-13.7.0-amd64-netinst.iso.torrent">x</a>',
    'releases.ubuntu.com': '<a href="24.04/">24.04/</a><a href="26.04/">26.04/</a><a href="26.10/">26.10/</a>',
    'torrent.fedoraproject.org': '<rss><item><title>Fedora Workstation</title><link>https://torrent.fedoraproject.org/torrents/F.torrent</link></item></rss>',
  };
  const seen = [];
  const fetch = async url => {
    seen.push(url);
    if (url.includes('academictorrents')) return { ok: false, status: 503, headers: new Map() };
    const host = new URL(url).host;
    const body = url.includes('/bt-dvd/') ? '' : pages[host] ?? '';
    return { ok: true, status: 200, headers: new Map(), text: async () => body };
  };
  const sources = new Sources({ fetch });
  const { results, errors } = await sources.search('debian netinst', {});
  assert.deepEqual(results.slice(0, 2).map(item => [item.source, item.title]), [['Linux images', 'debian-13.7.0-amd64-netinst.iso'], ['Internet Archive', 'debian 12 netinst']]);
  assert.equal(results.filter(item => item.title === 'debian-13.7.0-amd64-netinst.iso').length, 1, 'a link listed twice counts once');
  assert.deepEqual(errors, [{ source: 'Academic Torrents', error: 'academictorrents.com answered 503.' }]);
  assert.ok(seen.some(url => url.startsWith('https://releases.ubuntu.com/26.04/')), 'the newest LTS');
  assert.ok(seen.some(url => url.startsWith('https://releases.ubuntu.com/26.10/')), 'and the newest release');
  // Built-in sources can be switched off.
  const off = await sources.search('debian', { builtIn: { archive: false, academic: false } });
  assert.ok(off.results.every(item => item.source === 'Linux images'));
});

test('a transfer: read, start with chosen files, finish, share back to the ratio, then stop', async t => {
  const { manager, engine, finished, store } = setup(t);
  const draft = await manager.prepare({ bytes: [1, 2, 3] });
  assert.equal(draft.name, 'Example.iso');
  assert.deepEqual(draft.files.map(file => file.risky), [true, false], 'disk images are flagged');
  await assert.rejects(manager.start(draft.id, []), /at least one file/);
  await manager.start(draft.id, [1]);
  const item = manager.item(HASH_A);
  assert.equal(item.status, 'downloading');
  assert.equal(item.length, 2000, 'only the chosen file counts');
  assert.deepEqual(engine.torrents.get(HASH_A).select, [1]);
  assert.ok(fs.existsSync(item.torrentPath));
  engine.push({ type: 'stats', torrents: [{ key: HASH_A, progress: 0.5, uploaded: 0, downloadSpeed: 1000, uploadSpeed: 0, peers: 3 }] });
  assert.equal(manager.state().items[0].progress, 0.5);
  engine.push({ type: 'done', key: HASH_A });
  assert.equal(item.status, 'seeding');
  assert.deepEqual(finished, ['Example.iso']);
  engine.push({ type: 'stats', torrents: [{ key: HASH_A, progress: 1, done: true, uploaded: 1999 }] });
  assert.equal(item.status, 'seeding', 'not yet given back as much');
  engine.push({ type: 'stats', torrents: [{ key: HASH_A, progress: 1, done: true, uploaded: 2000 }] });
  await tick();
  assert.equal(item.status, 'finished');
  assert.equal(item.uploaded, 2000, 'what was shared is kept');
  assert.ok(!engine.torrents.has(HASH_A), 'the engine stopped it');
  assert.ok(store.saves > 0);
});

test('downloads wait their turn; pause, resume and remove', async t => {
  const { manager, engine } = setup(t, { settings: { maxActive: 1 } });
  await manager.start((await manager.prepare({ bytes: [1] })).id);
  await manager.start((await manager.prepare({ magnet: `magnet:?xt=urn:btih:${HASH_B}` })).id);
  assert.ok(engine.calls.some(([op, args]) => op === 'peek' && args.scratch.endsWith(path.join('state', 'peek'))), 'a magnet is read in a private folder');
  assert.deepEqual(manager.data.items.map(item => [item.key, item.status]), [[HASH_B, 'queued'], [HASH_A, 'downloading']]);
  manager.pause(HASH_A);
  await tick();
  assert.equal(manager.item(HASH_A).status, 'paused');
  assert.equal(manager.item(HASH_B).status, 'downloading', 'the next one starts');
  manager.resume(HASH_A);
  assert.equal(manager.item(HASH_A).status, 'queued');
  await manager.remove(HASH_B, { deleteFiles: true });
  assert.ok(engine.calls.some(([op, args]) => op === 'remove' && args.key === HASH_B && args.deleteFiles === true));
  await tick();
  assert.equal(manager.item(HASH_A).status, 'downloading');
  assert.equal(manager.item(HASH_B), null);
});

test('the model searches and asks; only the user starts a download', async t => {
  const { manager, store, chat } = setup(t);
  manager.sources.search = async () => ({ results: [{ source: 'Linux images', title: 'debian-13.7.0-amd64-netinst.iso', size: 790000000, seeders: null, note: 'Debian · installer', torrent: 'https://cdimage.debian.org/x.torrent' }], errors: [] });
  manager.prepare = async ({ result }) => { assert.equal(result.title, 'debian-13.7.0-amd64-netinst.iso'); const draft = { id: 'd1', at: Date.now(), source: { name: 'Linux images' }, infoHash: HASH_A, name: result.title, length: 790000000, files: [{ index: 0, path: result.title, length: 790000000 }], torrentFile: Buffer.from([1]) }; manager.drafts.set('d1', draft); return manager.publicDraft(draft); };
  const found = await manager.call({ action: 'search', query: 'debian netinst' }, { chat });
  assert.match(found.results[0], /^1\. debian-13\.7\.0-amd64-netinst\.iso — 753 MB \(Linux images, Debian · installer\)$/);
  await assert.rejects(manager.call({ action: 'request', result: 2 }, { chat }), /between 1 and 1/);
  const asked = await manager.call({ action: 'request', result: 1, note: 'The installer you asked for' }, { chat });
  assert.match(asked.note, /only if the user clicks Download/);
  assert.equal(manager.data.items.length, 0, 'nothing started');
  assert.equal(manager.panel, true, 'the panel opens on the card');
  assert.deepEqual(manager.state().requests.map(request => [request.name, request.note]), [['debian-13.7.0-amd64-netinst.iso', 'The installer you asked for']]);
  manager.answerRequest('d1', false);
  assert.equal(manager.state().requests.length, 0);
  assert.equal(manager.drafts.has('d1'), false, 'a declined request is forgotten');
  // Gating.
  await assert.rejects(manager.call({ action: 'list' }, { chat: { id: 'h', internal: true, status: 'running' } }), /not in background work/);
  await assert.doesNotReject(manager.call({ action: 'list' }, { chat: { id: 'a', automationId: 'x', status: 'running' } }), 'a scheduled task has full access');
  store.data.settings.torrentsEnabled = false;
  assert.ok(!new AgentTools({ store, torrents: manager }).specs().some(tool => tool.name === 'torrents'));
  await assert.rejects(manager.call({ action: 'list' }, { chat }), /Torrents is off/);
  store.data.settings.torrentsEnabled = true;
  const tools = new AgentTools({ store, torrents: manager });
  assert.ok(tools.specs().some(tool => tool.name === 'torrents'));
  assert.ok(!tools.specs({ readOnly: true }).some(tool => tool.name === 'torrents'), 'not in Plan mode');
});

test('a Torznab key is saved sealed and opened only for a search', async t => {
  let asked = null;
  const fetch = async url => { asked = url; return { ok: true, status: 200, headers: new Map(), text: async () => `<rss><item><title>Thing</title><link>magnet:?xt=urn:btih:${HASH_A}</link><torznab:attr name="seeders" value="5"/></item></rss>` }; };
  const { manager } = setup(t, { fetch });
  const added = await manager.setSources({ action: 'add', kind: 'torznab', name: 'My indexer', url: 'http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/', apiKey: 'secret-key' });
  assert.deepEqual(added, { added: 'My indexer', items: 1 });
  const saved = manager.data.sources.custom[0];
  assert.equal(saved.apiKey, undefined);
  assert.match(saved.apiKeySealed, /^sealed:/);
  assert.equal(JSON.stringify(manager.state()).includes('secret-key'), false, 'the key never reaches the window');
  manager.data.sources.builtIn = { archive: false, academic: false, linux: false };
  const { results } = await manager.search('thing');
  assert.equal(results[0].seeders, 5);
  assert.match(asked, /[?&]apikey=secret-key/);
  assert.match(asked, /\/torznab\/api\?t=search&q=thing/);
  await assert.rejects(manager.setSources({ action: 'add', kind: 'rss', url: 'file:///C:/x' }), /Only http and https/);
});

test('the store keeps transfers and settings, restarts running ones and drops malformed entries', t => {
  const { Store } = require('../src/store.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-torrents-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store({ filePath: path.join(dir, 'state.json'), defaultWorkspace: dir });
  store.data.settings.torrentsEnabled = true;
  store.data.torrents = {
    items: [
      { key: HASH_A, name: 'Running', length: 5, folder: dir, torrentPath: path.join(dir, 'a.torrent'), status: 'downloading', progress: 0.4, uploaded: 7, select: [0], files: [{ index: 0, path: 'a', length: 5 }], fileCount: 1, source: { name: 'Linux images', page: null } },
      { key: 'not-a-hash', name: 'Bad', folder: dir, torrentPath: 'x' },
    ],
    settings: { folder: dir, ratio: 2, stopSharing: 'time', hours: 12, upnp: false, bogus: 1 },
    sources: { builtIn: { academic: false }, custom: [{ id: 's1', name: 'Feed', kind: 'rss', url: 'https://example.org/rss' }, { id: 's2', kind: 'ftp', url: 'ftp://x' }, { id: 's3', name: 'Idx', kind: 'torznab', url: 'http://127.0.0.1:9117/api', apiKeySealed: 'sealed:abc' }] },
  };
  store.save();
  const again = new Store({ filePath: path.join(dir, 'state.json'), defaultWorkspace: dir });
  const saved = again.data.torrents;
  assert.equal(again.data.settings.torrentsEnabled, true);
  assert.deepEqual(saved.items.map(item => [item.name, item.status, item.progress, item.uploaded, item.select]), [['Running', 'queued', 0.4, 7, [0]]]);
  assert.deepEqual(saved.settings, { folder: dir, ratio: 2, hours: 12, stopSharing: 'time', upnp: false });
  assert.deepEqual(saved.sources.builtIn, { academic: false });
  assert.deepEqual(saved.sources.custom.map(source => [source.id, source.apiKeySealed || null]), [['s1', null], ['s3', 'sealed:abc']]);
  store.close(); again.close();
});

test('the engine refuses file names that leave the folder or that Windows treats specially', async () => {
  const { safeFiles } = await import('../src/torrents/engine.mjs');
  const base = path.resolve('downloads');
  assert.equal(safeFiles([{ path: 'Film/film.mkv' }, { path: 'Film\\subs\\fr.srt' }], base), true);
  for (const bad of ['../evil.txt', 'safe\\C:\\Windows\\x.txt', 'file.txt:hidden', 'Film/CON', 'Film/nul.txt', 'Film/trailing.', 'a/<b>.txt', 'a//b.txt']) {
    assert.equal(safeFiles([{ path: bad }], base), false, bad);
  }
});
