'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebServices, nodeRequest } = require('../src/web-services.cjs');
const { fuse, passages, normalizeUrl, stripLinks } = require('../src/web-rank.cjs');

const publicLookup = async () => [{ address: '93.184.215.14', family: 4 }];
const headers = type => ({ get: name => name.toLowerCase() === 'content-type' ? type : null });
const page = (status, body, type = 'text/html; charset=utf-8', url) => ({ status, url, headers: headers(type), body: Buffer.from(body) });
const serp = {
  duckduckgo: rows => `<html><body><div id="links" class="results">${rows.map(([url, title, snippet]) => `<div class="result results_links web-result"><div class="links_main result__body"><h2 class="result__title"><a class="result__a" href="${url}">${title}</a></h2><a class="result__snippet" href="${url}">${snippet}</a></div></div>`).join('')}</div></body></html>`,
  bing: rows => `<html><body><ol id="b_results">${rows.map(([url, title, snippet]) => `<li class="b_algo"><h2><a href="${url}">${title}</a></h2><div class="b_caption"><p>${snippet}</p></div></li>`).join('')}</ol></body></html>`,
  yahoo: rows => `<html><body><div id="web"><ol class="reg searchCenterMiddle">${rows.map(([url, title, snippet]) => `<li><div class="dd algo algo-sr Sr"><div class="compTitle"><a href="${url}"><h3 class="title"><span>${title}</span></h3></a></div><div class="compText"><p>${snippet}</p></div></div></li>`).join('')}</ol></div></body></html>`,
};
const ARTICLE = paragraphs => `<html><head><title>Fixture article</title></head><body><nav>menu</nav><article><h1>Fixture article</h1>${paragraphs.map(text => `<p>${text}</p>`).join('')}</article><footer>footer</footer></body></html>`;
const LONG = Array.from({ length: 8 }, (_, index) => `Paragraph ${index} explains how the heat pump moves warmth from outside air into the house using a refrigerant cycle and a compressor, even in winter.`);
const engineOf = url => url.includes('duckduckgo') ? 'duckduckgo' : url.includes('bing.com') ? 'bing' : url.includes('yahoo.com') ? 'yahoo' : null;

function harness({ engines = {}, pages = {}, render, reader } = {}) {
  const seen = [];
  let active = 0, peak = 0;
  const request = async options => {
    seen.push(options.url);
    active += 1; peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (options.signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'aborted' });
      const engine = engineOf(options.url);
      if (engine) return (engines[engine] || (() => page(200, serp[engine]([['https://example.org/heat-pump', 'How a heat pump works', 'A heat pump moves heat'], [`https://${engine}.example/answer`, `${engine} answer`, 'heat pump basics']]))))(options);
      if (options.url.startsWith('https://r.jina.ai/')) return reader ? reader(options) : page(429, '{}', 'application/json');
      const handler = pages[options.url];
      if (!handler) return page(200, ARTICLE(LONG), 'text/html', options.url);
      return handler(options);
    } finally { active -= 1; }
  };
  const web = new WebServices({ request, render, lookupImpl: publicLookup, workers: 2 });
  return { web, seen, peak: () => peak };
}

test('ranking fuses engines, removes tracking duplicates and keeps two results per site first', () => {
  const lists = {
    bing: [{ url: 'https://www.example.org/a?utm_source=x', title: 'A heat pump guide', snippet: 'heat pump' }, { url: 'https://example.org/b', title: 'B', snippet: 'pump' }, { url: 'https://example.org/c', title: 'C', snippet: 'heat' }],
    yahoo: [{ url: 'https://example.org/a', title: 'A heat pump guide', snippet: 'longer heat pump snippet text' }, { url: 'https://other.example/d', title: 'D heat pump', snippet: 'heat pump' }],
  };
  const results = fuse(lists, 'heat pump', { limit: 4 });
  assert.equal(results[0].url, 'https://www.example.org/a?utm_source=x');
  assert.deepEqual(results[0].engines, ['bing', 'yahoo']);
  assert.equal(results[0].snippet, 'longer heat pump snippet text');
  assert.equal(results.length, 4);
  assert.equal(results.filter(row => row.url.includes('example.org')).length, 3);
  assert.equal(results.findIndex(row => row.url.includes('other.example')) < 3, true);
  assert.equal(normalizeUrl('https://www.Example.org/x/?fbclid=1#top'), 'example.org/x');
  assert.equal(stripLinks('See [the docs](https://a.example/x_(y)) and [b](https://b.example "t").'), 'See the docs and b.');
  assert.deepEqual(passages('intro text that is long enough to count here\n\nThe compressor raises the refrigerant pressure in a heat pump cycle.', 'heat pump compressor', { count: 1, size: 80 }), ['The compressor raises the refrigerant pressure in a heat pump cycle.']);
});

test('ten queries in one call run in parallel and return fused, hydrated results', async () => {
  const { web, seen, peak } = harness();
  try {
    const queries = Array.from({ length: 10 }, (_, index) => `heat pump question ${index}`);
    const result = await web.call('web_search_service', { queries, limit: 3 });
    assert.equal(result.searches.length, 10);
    for (const search of result.searches) {
      assert.equal(search.error, undefined);
      assert.equal(search.results[0].url, 'https://example.org/heat-pump');
      assert.deepEqual(search.results[0].engines.sort(), ['bing', 'duckduckgo', 'yahoo']);
      assert.match(search.results[0].passage, /heat pump/);
      assert.deepEqual(search.engines, { duckduckgo: 'ok', bing: 'ok', yahoo: 'ok' });
    }
    assert.equal(peak() > 10, true);
    const before = seen.length;
    const again = await web.call('web_search_service', { query: 'heat pump question 3', limit: 3, provider: 'brave' });
    assert.equal(again.cached, true);
    assert.equal(seen.length, before);
    await assert.rejects(web.call('web_search_service', { queries: Array.from({ length: 11 }, (_, index) => `q${index}`) }), /at most 10/);
    await assert.rejects(web.call('web_search_service', {}), /Give a query/);
    await assert.rejects(web.call('web_search_service', { query: 'x', site: 'a' }), /Unsupported argument site/);
  } finally { web.close(); }
});

test('a page read by search and web_scrape at once is downloaded once, and a refusing site is not asked twice', async () => {
  let renders = 0;
  const { web, seen } = harness({
    pages: { 'https://refusing.example/a': () => page(403, 'no'), 'https://refusing.example/b': () => page(403, 'no') },
    render: async url => { renders += 1; return { html: ARTICLE(LONG), url }; },
  });
  try {
    await Promise.all([web.call('web_search_service', { query: 'heat pump shared' }), web.call('web_scrape', { url: 'https://example.org/heat-pump' })]);
    assert.equal(seen.filter(url => url === 'https://example.org/heat-pump').length, 1);
    assert.equal((await web.call('web_scrape', { url: 'https://refusing.example/a' })).via, 'browser');
    assert.equal((await web.call('web_scrape', { url: 'https://refusing.example/b' })).via, 'browser');
    assert.equal(seen.filter(url => url.startsWith('https://refusing.example/')).length, 1);
    assert.equal(renders, 2);
  } finally { web.close(); }
});

test('a rate-limited engine is paused while the others still answer', async () => {
  const { web, seen } = harness({ engines: { duckduckgo: () => page(202, '<html><body><div class="anomaly-modal__modal">bots</div></body></html>') } });
  try {
    const first = await web.call('web_search_service', { query: 'heat pump' });
    assert.equal(first.engines.duckduckgo, 'rate limited');
    assert.equal(first.results.length > 0, true);
    const ddgCalls = seen.filter(url => url.includes('duckduckgo')).length;
    const second = await web.call('web_search_service', { query: 'another heat pump' });
    assert.equal(second.engines.duckduckgo, 'paused');
    assert.equal(seen.filter(url => url.includes('duckduckgo')).length, ddgCalls);
    assert.match(web.getState().engines.duckduckgo, /paused/);
  } finally { web.close(); }
});

test('all engines failing is an error, not an empty answer', async () => {
  const down = () => { throw Object.assign(new Error('offline'), { code: 'network' }); };
  const { web } = harness({ engines: { duckduckgo: down, bing: down, yahoo: down } });
  try { await assert.rejects(web.call('web_search_service', { query: 'heat pump' }), /Search failed: .*duckduckgo network/); }
  finally { web.close(); }
});

test('reading falls back from a blocked page to the browser, then to the reader service', async () => {
  const blocked = () => page(403, '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>');
  let rendered = 0;
  const { web } = harness({
    pages: { 'https://spa.example/app': () => page(200, '<html><body><div id="root"></div><script></script><script></script><script></script><noscript>You need to enable JavaScript</noscript></body></html>'), 'https://guarded.example/x': blocked, 'https://gone.example/x': () => page(404, 'nope') },
    render: async url => { rendered += 1; return url.includes('spa.example') ? { html: ARTICLE(LONG), url } : { html: '<html><head><title>Just a moment...</title></head><body>wait</body></html>', url }; },
    reader: () => page(200, JSON.stringify({ data: { title: 'Reader copy', url: 'https://guarded.example/x', content: LONG.join('\n\n') } }), 'application/json'),
  });
  try {
    const spa = await web.call('web_scrape', { url: 'https://spa.example/app' });
    assert.equal(spa.via, 'browser');
    assert.match(spa.markdown, /refrigerant cycle/);
    const guarded = await web.call('web_scrape', { url: 'https://guarded.example/x' });
    assert.equal(guarded.via, 'reader');
    assert.equal(guarded.title, 'Reader copy');
    assert.equal(rendered, 2);
    await assert.rejects(web.call('web_scrape', { url: 'https://gone.example/x' }), /does not exist \(HTTP 404\)/);
    assert.equal(rendered, 2);
  } finally { web.close(); }
});

test('Reddit posts and comments are rebuilt with their scores from element attributes', async () => {
  const listing = `<html><head><title>r/Example</title></head><body><shreddit-post permalink="/r/Example/comments/a1/first/" post-title="First post" score="42" comment-count="7" author="alice" created-timestamp="2026-10-18T02:00:00+0000"></shreddit-post><shreddit-post permalink="/r/Example/comments/b2/second/" post-title="Second post" score="5" comment-count="1" author="bob"></shreddit-post></body></html>`;
  const thread = `<html><head><title>First post</title></head><body><shreddit-post post-title="First post" score="42" comment-count="2" author="alice" subreddit-prefixed-name="r/Example"><div slot="text-body"><p>Body of the post with enough words.</p></div></shreddit-post>
    <shreddit-comment author="carol" score="9" depth="0"><div slot="comment"><p>Top comment.</p></div><shreddit-comment author="dave" score="2" depth="1"><div slot="comment"><p>A reply.</p></div></shreddit-comment></shreddit-comment></body></html>`;
  const { web } = harness({ pages: { 'https://www.reddit.com/r/Example/': () => page(200, listing, 'text/html', 'https://www.reddit.com/r/Example/'), 'https://www.reddit.com/r/Example/comments/a1/first/': () => page(200, thread, 'text/html', 'https://www.reddit.com/r/Example/comments/a1/first/') } });
  try {
    const list = await web.call('web_scrape', { url: 'https://www.reddit.com/r/Example/', links: true });
    assert.match(list.markdown, /^1\. First post \(42 points, 7 comments, u\/alice, 2026-10-18\) https:\/\/www\.reddit\.com\/r\/Example\/comments\/a1\/first\//);
    // The JSON API and old.reddit refuse anonymous readers, so both are read as the regular page.
    const read = await web.call('web_scrape', { url: 'https://old.reddit.com/r/Example/comments/a1/first/.json?format=json' });
    assert.match(read.markdown, /# First post\nr\/Example · 42 points/);
    assert.match(read.markdown, /- u\/carol \(9 points\): Top comment\.\n  - u\/dave \(2 points\): A reply\./);
  } finally { web.close(); }
});

test('several pages in one call share a character budget and report failures per page', async () => {
  const { web } = harness({ pages: { 'https://gone.example/x': () => page(404, 'nope') } });
  try {
    const urls = ['https://a.example/1', 'https://b.example/2', 'https://gone.example/x', 'http://192.168.1.1/admin'];
    const result = await web.call('web_scrape', { urls, maxChars: 40000 });
    assert.equal(result.pages.length, 4);
    assert.equal(result.pages[0].markdown.length <= 15000, true);
    assert.match(result.pages[2].error, /404/);
    assert.match(result.pages[3].error, /Local and private network/);
    const linked = await web.call('web_scrape', { url: 'https://a.example/1', links: true });
    assert.equal(linked.via, 'direct');
  } finally { web.close(); }
});

test('the node transport refuses redirects into private networks and enforces the size limit', async () => {
  const fake = async url => url === 'https://public.example/r'
    ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/secret' } })
    : new Response('x'.repeat(2048), { status: 200, headers: { 'content-type': 'text/plain' } });
  const request = nodeRequest(fake);
  const { publicUrl } = require('../src/web-services.cjs');
  await assert.rejects(request({ url: 'https://public.example/r', validate: publicUrl }), /Local and private/);
  await assert.rejects(request({ url: 'https://public.example/big', maxBytes: 1024 }), /exceeded/);
  const done = await request({ url: 'https://public.example/ok' });
  assert.equal(done.body.length, 2048);
});

test('a cancelled call stops queued work', async () => {
  const { web } = harness({ engines: { bing: options => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'aborted' })))) } });
  const controller = new AbortController();
  const pending = web.call('web_search_service', { query: 'slow heat pump' }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, /cancelled/);
  web.close();
});

test('a redirect to a public name that points at this PC is refused, in the web tools and the page watcher', async () => {
  const lookupImpl = async host => [{ address: host === 'localtest.me' ? '127.0.0.1' : '93.184.215.14', family: 4 }];
  const fetchImpl = async url => url.startsWith('https://public.example/')
    ? new Response(null, { status: 302, headers: { location: 'http://localtest.me:8080/admin' } })
    : new Response('<html><body><p>secret admin page</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const web = new WebServices({ fetchImpl, lookupImpl, workers: 1 });
  try { await assert.rejects(web.call('web_scrape', { url: 'https://public.example/r' }), /local or private network/); }
  finally { web.close(); }

  const { WebWatcher, safeUrl } = require('../src/web-watch.cjs');
  for (const address of ['http://[::ffff:127.0.0.1]/', 'http://100.64.0.1/', 'http://router/', 'http://printer.lan/', 'http://0.1.2.3/']) assert.throws(() => safeUrl(address), /Local and private/, address);
  const store = { data: { webWatches: [] }, save() {} };
  const watcher = new WebWatcher({ store, fetchImpl, lookupImpl });
  watcher.add({ url: 'https://public.example/page' });
  const result = await watcher.check(store.data.webWatches[0]);
  assert.match(result.error, /Local and private/);
  assert.equal(store.data.webWatches[0].hash, '', 'nothing from the private page is kept');
});

test('the browser partition lets requests through only to public addresses', async () => {
  const { publicTarget } = require('../src/web-electron.cjs');
  const session = { resolveHost: async host => ({ endpoints: [{ address: host === 'rebind.example' ? '192.168.1.1' : '93.184.215.14' }] }) };
  const verdicts = new Map();
  const allowed = url => publicTarget(session, verdicts, url);
  assert.equal(await allowed('https://example.com/app.js'), true);
  assert.equal(await allowed('wss://example.com/socket'), true);
  assert.equal(await allowed('data:text/plain,hi'), true);
  for (const url of ['http://127.0.0.1:8080/v1/models', 'http://[::1]/', 'https://rebind.example/', 'http://router/', 'file:///C:/Windows/win.ini', 'ws://localhost:3000/']) assert.equal(await allowed(url), false, url);
  assert.equal(normalizeUrl('https://a.com:8443/x') === normalizeUrl('https://a.com/x'), false, 'another port is another page');
});
