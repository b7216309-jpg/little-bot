'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { BrowserBlocker, siteOf } = require('../src/browser-blocker.cjs');

// A stand-in for Ghostery's ElectronBlocker: records what the blocker does with it.
function fakeGhostery() {
  const log = { built: 0, deserialized: 0, diffs: [], enabled: [], disabled: [] };
  class Engine extends EventEmitter {
    constructor(origin) { super(); this.origin = origin; }
    serialize() { return new Uint8Array([7, 7, 7]); }
    updateFromDiff(diff) { log.diffs.push(diff); }
    enableBlockingInSession(session) { log.enabled.push([this.origin, session]); }
    disableBlockingInSession(session) { log.disabled.push([this.origin, session]); }
  }
  const ElectronBlocker = {
    fromPrebuiltFull: async fetch => { await fetch('https://lists.example/easylist.txt'); log.built++; return new Engine(`built-${log.built}`); },
    deserialize: bytes => { log.deserialized++; assert.deepEqual([...bytes], [7, 7, 7]); return new Engine('saved'); },
  };
  return { log, load: () => ({ ElectronBlocker }), Engine };
}

function setup(t, { enabled = true, fetch = async () => ({ ok: true }) } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-blocker-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = { data: { settings: { browserBlocking: enabled } }, saves: 0, save() { this.saves++; } };
  const ghostery = fakeGhostery();
  const blocker = new BrowserBlocker({ root, store, fetch, load: ghostery.load });
  t.after(() => blocker.close());
  return { root, store, ghostery, blocker, session: { name: 'browser session' } };
}

test('the first start builds the engine from the lists, saves it, and blocks in the browser session', async t => {
  const fetched = [];
  const { blocker, ghostery, session, root } = setup(t, { fetch: async url => { fetched.push(url); return { ok: true }; } });
  await blocker.attach(session);
  assert.deepEqual(fetched, ['https://lists.example/easylist.txt']);
  assert.equal(ghostery.log.built, 1);
  assert.deepEqual(ghostery.log.enabled, [['built-1', session]]);
  assert.ok(fs.existsSync(path.join(root, 'engine.bin')));
  assert.equal(blocker.state('https://www.lemonde.fr/').ready, true);
});

test('a saved engine starts without the network, and an old one is refreshed in the background', async t => {
  const { blocker, ghostery, session, root } = setup(t, { fetch: async () => { throw new Error('offline'); } });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'engine.bin'), Buffer.from([7, 7, 7]));
  await blocker.attach(session);
  assert.equal(ghostery.log.deserialized, 1);
  assert.equal(ghostery.log.built, 0, 'no download for a fresh engine');
  assert.deepEqual(blocker.state('https://example.org/'), { ...blocker.state('https://example.org/'), ready: true, error: null });
  // Two days old: it is used at once, and a refresh starts; a failed refresh keeps the saved engine.
  const old = new Date(Date.now() - 2 * 24 * 3600000);
  fs.utimesSync(path.join(root, 'engine.bin'), old, old);
  const again = new BrowserBlocker({ root, store: blocker.store, fetch: async () => ({ ok: true }), load: ghostery.load });
  t.after(() => again.close());
  await again.attach(session);
  assert.equal(ghostery.log.deserialized, 2);
  await again.refreshing;
  assert.equal(ghostery.log.built, 1);
  assert.equal(again.engine.origin, 'built-1', 'the new engine replaced the old one');
  assert.ok(ghostery.log.disabled.some(([origin]) => origin === 'saved') && ghostery.log.enabled.some(([origin]) => origin === 'built-1'));
});

test('without lists or a saved engine, blocking reports why and the browser still works', async t => {
  const { blocker, session } = setup(t, { fetch: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  await blocker.attach(session);
  const state = blocker.state('https://example.org/');
  assert.equal(state.ready, false);
  assert.match(state.error, /Ad blocking could not start: getaddrinfo ENOTFOUND/);
});

test('a site let through gets an exception rule, kept across restarts and engines', async t => {
  const { blocker, ghostery, session, store } = setup(t);
  await blocker.attach(session);
  assert.equal(blocker.setSite('https://www.marmiton.org/recettes/', true), 'marmiton.org');
  assert.deepEqual(store.data.browserBlocking.allowed, ['marmiton.org']);
  assert.deepEqual(ghostery.log.diffs.at(-1), { added: ['@@||marmiton.org^$document'] });
  assert.equal(blocker.state('https://marmiton.org/').allowed, true);
  // A new engine (a refresh, or the next start) gets the exception too.
  await blocker.refresh();
  assert.deepEqual(ghostery.log.diffs.at(-1), { added: ['@@||marmiton.org^$document'] });
  blocker.setSite('https://marmiton.org/', false);
  assert.deepEqual(ghostery.log.diffs.at(-1), { removed: ['@@||marmiton.org^$document'] });
  assert.deepEqual(store.data.browserBlocking.allowed, []);
  assert.throws(() => blocker.setSite('about:blank', true), /Only web pages/);
});

test('the shield counts what is blocked on the page shown, from zero on each new page', async t => {
  const { blocker, session } = setup(t);
  await blocker.attach(session);
  blocker.newPage(42);
  blocker.engine.emit('request-blocked', { tabId: 42 });
  blocker.engine.emit('request-redirected', { tabId: 42 });
  blocker.engine.emit('request-blocked', { tabId: 7 }); // another page (the CAD engine, a worker)
  assert.equal(blocker.state('https://example.org/').blocked, 2);
  blocker.newPage(42);
  assert.equal(blocker.state('https://example.org/').blocked, 0);
});

test('switched off, blocking stops in the session; the site of a page is its host without www', async t => {
  const { blocker, ghostery, session, store } = setup(t);
  await blocker.attach(session);
  store.data.settings.browserBlocking = false;
  await blocker.sync();
  assert.deepEqual(ghostery.log.disabled.at(-1), ['built-1', session]);
  assert.equal(blocker.state('https://example.org/').enabled, false);
  assert.equal(siteOf('https://www.Example.ORG/a?b'), 'example.org');
  assert.equal(siteOf('https://shop.example.co.uk/'), 'shop.example.co.uk');
  assert.equal(siteOf('file:///C:/x.html'), null);
  assert.equal(siteOf('http://localhost:3000/'), null);
});
