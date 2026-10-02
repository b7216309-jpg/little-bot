'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WebServices, FIRECRAWL_CONCURRENCY } = require('../src/web-services.cjs');

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'kwallet',
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8'),
  };
}

async function until(predicate, message = 'Condition not reached') {
  for (let index = 0; index < 250; index++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail(message);
}

function response(index) {
  return new Response(JSON.stringify({
    success: true,
    data: { web: [{ title: `Result ${index}`, url: `https://example.com/${index}`, description: 'ok' }] },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('Firecrawl search requests never exceed five concurrent calls', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-firecrawl-limit-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  let started = 0;
  let active = 0;
  let maxActive = 0;
  const releases = [];
  const fetchImpl = (_url, options) => new Promise((resolve, reject) => {
    const index = ++started;
    active += 1;
    maxActive = Math.max(maxActive, active);
    const abort = () => {
      active -= 1;
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (options.signal.aborted) return abort();
    options.signal.addEventListener('abort', abort, { once: true });
    releases.push(() => {
      options.signal.removeEventListener('abort', abort);
      active -= 1;
      resolve(response(index));
    });
  });

  const services = new WebServices({ root, safeStorage: safeStorage(), fetchImpl });
  services.save({ service: 'firecrawl', apiKey: 'firecrawl-test-key' });

  const calls = Array.from({ length: 7 }, (_, index) =>
    services.call('web_search_service', { query: `query ${index}`, provider: 'firecrawl', limit: 1 }));

  await until(() => started === FIRECRAWL_CONCURRENCY);
  assert.equal(started, 5);
  assert.equal(active, 5);
  assert.equal(maxActive, 5);

  releases.shift()();
  await until(() => started === 6);
  assert.equal(maxActive, 5);

  releases.shift()();
  await until(() => started === 7);
  assert.equal(maxActive, 5);

  while (releases.length) releases.shift()();
  const results = await Promise.all(calls);
  assert.equal(results.length, 7);
  assert.ok(results.every(item => item.provider === 'firecrawl'));
  assert.equal(maxActive, 5);
  services.close();
});

test('a queued Firecrawl request can be cancelled before it starts', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-firecrawl-cancel-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  let started = 0;
  const releases = [];
  const fetchImpl = (_url, options) => new Promise((resolve, reject) => {
    const index = ++started;
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (options.signal.aborted) return abort();
    options.signal.addEventListener('abort', abort, { once: true });
    releases.push(() => {
      options.signal.removeEventListener('abort', abort);
      resolve(response(index));
    });
  });

  const services = new WebServices({ root, safeStorage: safeStorage(), fetchImpl });
  services.save({ service: 'firecrawl', apiKey: 'firecrawl-test-key' });

  const occupying = Array.from({ length: FIRECRAWL_CONCURRENCY }, (_, index) =>
    services.call('web_search_service', { query: `busy ${index}`, provider: 'firecrawl', limit: 1 }));
  await until(() => started === FIRECRAWL_CONCURRENCY);

  const controller = new AbortController();
  const queued = services.call('web_search_service', { query: 'cancel me', provider: 'firecrawl', limit: 1 }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, /cancelled/);
  assert.equal(started, FIRECRAWL_CONCURRENCY);

  while (releases.length) releases.shift()();
  await Promise.all(occupying);
  services.close();
});

test('Brave calls are not held behind the Firecrawl concurrency gate', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-firecrawl-brave-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  let firecrawlStarted = 0;
  let braveStarted = 0;
  const releases = [];
  const fetchImpl = (url, options) => {
    if (url.includes('firecrawl')) {
      firecrawlStarted += 1;
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        options.signal.addEventListener('abort', abort, { once: true });
        releases.push(() => {
          options.signal.removeEventListener('abort', abort);
          resolve(response(firecrawlStarted));
        });
      });
    }
    braveStarted += 1;
    return Promise.resolve(new Response(JSON.stringify({
      web: { results: [{ title: 'Brave', url: 'https://example.com/brave', description: 'ok' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  };

  const services = new WebServices({ root, safeStorage: safeStorage(), fetchImpl });
  services.save({ service: 'firecrawl', apiKey: 'firecrawl-test-key' });
  services.save({ service: 'brave', apiKey: 'brave-test-key-123' });

  const busy = Array.from({ length: FIRECRAWL_CONCURRENCY }, (_, index) =>
    services.call('web_search_service', { query: `busy ${index}`, provider: 'firecrawl', limit: 1 }));
  await until(() => firecrawlStarted === FIRECRAWL_CONCURRENCY);

  const brave = await services.call('web_search_service', { query: 'independent', provider: 'brave', limit: 1 });
  assert.equal(braveStarted, 1);
  assert.equal(brave.provider, 'brave');

  while (releases.length) releases.shift()();
  await Promise.all(busy);
  services.close();
});

test('Firecrawl unsupported-site 403s are not reported as a rejected key', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-firecrawl-403-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let body = { success: false, error: 'We apologize for the inconvenience but we do not support this site.' };
  const fetchImpl = async () => new Response(JSON.stringify(body), { status: 403, headers: { 'content-type': 'application/json' } });
  const lookupImpl = async () => [{ address: '93.184.215.14', family: 4 }];
  const services = new WebServices({ root, safeStorage: safeStorage(), fetchImpl, lookupImpl });
  services.save({ service: 'firecrawl', apiKey: 'firecrawl-test-key' });
  await assert.rejects(services.call('web_scrape', { url: 'https://www.reddit.com/r/test/' }), /does not scrape this site.*browser/);
  body = { success: false, error: 'Unauthorized: invalid token' };
  await assert.rejects(services.call('web_scrape', { url: 'https://www.reddit.com/r/test/' }), /API key was rejected/);
});
