'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { ENGINES, engineRequest, parseResults, parseWith, detectBlock, unwrapUrl } = require('../src/web-engines.cjs');

const parse = (engine, html) => parseResults(engine, html, parseHTML(html).document);
const b64url = value => Buffer.from(value).toString('base64url');
const bingLink = target => `https://www.bing.com/ck/a?!&&p=abc123JmltdHM9&ptn=3&ver=2&hsh=4&fclid=1-2-3&u=a1${b64url(target)}&ntb=1`;
const yahooLink = target => `https://r.search.yahoo.com/_ylt=A2RSKEWl;_ylu=Y29sbwNldS13/RV=2/RE=1793564326/RO=10/RU=${encodeURIComponent(target).toLowerCase().replace(/%2f/g, '%2f')}/RK=2/RS=Edn1m_0lA1-`;

const DDG_PAGE = `<html><body><div class="serp__results"><div id="links" class="results">
<div class="result results_links results_links_deep result--ad"><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=shop.example&amp;ad_provider=bingv7aa">Buy things now</a></h2><a class="result__snippet" href="https://duckduckgo.com/y.js?ad_domain=shop.example">Sponsored text</a></div></div>
<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://example.org/docs/asyncio">Coroutines &amp; tasks &mdash; Example   Docs</a></h2><div class="result__extras"><a class="result__url" href="https://example.org/docs/asyncio"> example.org/docs/asyncio </a></div><a class="result__snippet" href="https://example.org/docs/asyncio">If cancel () is called <b>before</b> the group,
 it will be <b>cancelled</b>.</a></div></div>
<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.net%2Fa%3Fx%3D1%26y%3D2&amp;rut=deadbeef">Wrapped result</a></h2><a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Wrapped snippet.</a></div></div>
<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://example.org/docs/asyncio">Duplicate of the first</a></h2></div></div>
<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://example.com/no-snippet">No snippet here</a></h2></div></div>
<div class="nav-link"><form action="/html/" method="post"><input type="submit" value="Next"></form></div></div></div></body></html>`;

const DDG_EMPTY = `<html><body><div class="serp__results"><div id="links" class="results"><div class="result results_links results_links_deep web-result result--no-result"><div class="links_main links_deep result__body"><div class="no-results__container result__title"><span class="no-results"><div class="no-results__message"><h1>No results found for <strong>zzzz</strong></h1><p><strong>Suggestions</strong>:</p></div></span></div></div></div></div></div></body></html>`;

const DDG_BLOCK = `<html><body><div class="serp__results"><div id="links" class="results"><div class="result result--no-result"></div></div></div><div class="anomaly-modal__modal"><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div><form id="challenge-form" action="//duckduckgo.com/anomaly.js?sv=html&amp;cc=botnet" method="POST"><input type="hidden" name="q" value="x"></form></div></body></html>`;

const bingPage = () => `<html><body><ol id="b_results">
<li class="b_ad b_adTop"><ul><li class="b_adLastChild"><h2><a href="https://www.bing.com/aclick?ld=e8abc&amp;u=aHR0cHM6Ly9hZC5leGFtcGxl">Sponsored shoes</a></h2><div class="b_caption"><p>Ad text</p></div></li></ul></li>
<li class="b_ans b_top"><h2>People also ask</h2><a href="https://www.bing.com/search?q=related">Related thing</a></li>
<li class="b_algo"><div class="b_tpcn"><a class="tilk" href="${bingLink('https://example.org/guide')}"><cite>https://example.org › guide</cite></a></div><h2><a target="_blank" href="${bingLink('https://example.org/guide?id=7&lang=en')}">How to <strong>cancel</strong> tasks &amp; groups - Example</a></h2><div class="b_caption"><p class="b_lineclamp2"><span class="news_dt">May 19, 2023</span>&#160;· Cancelling is   done with the <strong>scope</strong> …</p></div></li>
<li class="b_algo b_algoBigWiki"><h2><a href="${bingLink('https://en.example.org/wiki/Tower')}">Tower - Example Wiki</a></h2><div class="b_caption"></div><div class="b_wikiGbMod"><a class="b_wikiGbModHero" href="${bingLink('https://en.example.org/wiki/Tower')}">The tower is 330 metres tall.</a></div></li>
<li class="b_algo"><h2><a href="https://example.com/direct?msockid=abc123">Direct link</a></h2><p class="b_lineclamp1">Plain paragraph snippet.</p></li>
<li class="b_algo"><h2><a href="${bingLink('https://example.com/direct?msockid=zzz')}">Same page again</a></h2></li>
<li class="b_algo"><h2><a href="${bingLink('https://www.bing.com/images/search?q=x')}">Image vertical</a></h2></li>
<li class="b_ans"><h2>Related searches</h2><ul><li class="rslist"><a href="/search?q=a">a</a></li></ul></li>
<li class="b_pag"><a href="/search?q=x&amp;first=11">2</a></li></ol></body></html>`;

const BING_EMPTY = `<html><body><ol id="b_results"><li class="b_no"><h1>There are no results for <strong>zzzz</strong></h1><ul><li>Check your spelling</li></ul></li></ol></body></html>`;
const BING_BLOCK = `<html><head><script>var challenge = 1;</script></head><body><div id="b_content"><h1>One last step</h1><div class="captcha-container"><iframe src="https://www.bing.com/turing/captcha/challenge"></iframe></div></div></body></html>`;

const yahooPage = () => `<html><body><div id="web"><ol class="reg searchCenterMiddle">
<li class="first"><div class="dd ads bcan20 relsrch p-rel AdTop"><div class="compTitle"><a href="https://r.search.yahoo.com/_ylt=a/RV=2/RE=1/RO=10/RU=https%3a%2f%2fads.example%2fbuy/RK=2/RS=zz-"><h3 class="title">Ad title</h3></a></div><div class="compText"><p>Ad body</p></div></div></li>
<li><div class="dd fst algo algo-sr relsrch richAlgo"><div class="compTitle options-toggle"><a class="d-ib" target="_blank" href="${yahooLink('https://example.org/docs/asyncio-task')}"><div class="d-ib fz-13"><span class="fc-141414 d-b">Example</span>https://example.org › docs</div><h3 style="display:block" class="title"><span class="d-b fz-20">Coroutines &amp; tasks - Example Docs</span></h3></a></div><div class="compText aAbs"><p class="fc-dustygray fz-14"><span class="fc-smoke">20 hours ago · </span>  If cancel () is called <b>before</b> the group … </p></div><div class="compList"><ul><li><a class="algo-sitelink-title" href="${yahooLink('https://example.org/docs/streams')}">Streams</a><p><span>Streams are high-level…</span></p></li></ul></div></div></li>
<li><div class="dd algo algo-sr relsrch Sr"><div class="compTitle"><a href="${yahooLink('https://example.net/page?a=1&b=2')}"><h3 class="title"><span>Second result</span></h3></a></div><div class="compText"><p>Second snippet</p></div></div></li>
<li><div class="dd lst algo algo-sr relsrch Sr"><div class="compTitle"><a href="${yahooLink('https://example.net/page?a=1&b=2')}"><h3 class="title"><span>Duplicate</span></h3></a></div></div></li>
<li><div class="dd AlsoTry_M"><div class="compTitle">Searches related to x</div><a href="https://search.yahoo.com/search?p=related">related</a></div></li>
<li><div class="dd algo algo-sr Sr"><div class="compTitle"><a href="https://r.search.yahoo.com/_ylt=a/RV=2/RE=1/RO=10/RU=https%3a%2f%2fsearch.yahoo.com%2fsearch%3fp%3dloop/RK=2/RS=zz-"><h3 class="title"><span>Self</span></h3></a></div></div></li>
<li><div class="dd NewsArticle"><div class="compTitle"><a href="${yahooLink('https://news.example/story')}"><h3 class="title">Top story</h3></a></div></div></li>
</ol></div></body></html>`;

const YAHOO_EMPTY = `<html><body><div id="web"><ol class="reg adultRegion"><li class="first last"><div class="dd zrp"><div class="compText"><p>We did not find results for: <strong>zzzz</strong>.</p></div></div></li></ol></div></body></html>`;
const YAHOO_CONSENT = `<html><head><script src="https://consent.cmp.oath.com/cmp.js"></script></head><body><form method="post" action="https://consent.yahoo.com/v2/collectConsent?sessionId=3_cc"><button type="submit" name="agree">Accept all</button><button name="reject">Reject all</button></form></body></html>`;
const DRIFT = `<html><body><div id="content"><p>Totally new layout nobody has seen</p><script>var consent = 1, challenge = 2, captcha = 3;</script></div></body></html>`;

test('engineRequest builds keyless requests for each engine', () => {
  assert.deepEqual(ENGINES, ['duckduckgo', 'bing', 'yahoo']);
  const ddg = engineRequest('duckduckgo', 'python & "asyncio" é');
  assert.equal(ddg.url, 'https://html.duckduckgo.com/html/');
  assert.equal(ddg.init.method, 'POST');
  assert.equal(ddg.init.headers['content-type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(ddg.init.body);
  assert.equal(form.get('q'), 'python & "asyncio" é');
  assert.equal(form.get('kl'), 'wt-wt');
  assert.equal(new URLSearchParams(engineRequest('duckduckgo', 'x', { page: 2 }).init.body).get('s'), '30');

  const bing = engineRequest('bing', 'a b&c');
  assert.equal(bing.url, 'https://www.bing.com/search?q=a+b%26c');
  assert.equal(bing.init.method, 'GET');
  assert.equal(engineRequest('bing', 'x', { page: 3 }).url, 'https://www.bing.com/search?q=x&first=21');

  const yahoo = engineRequest('yahoo', 'tarte tatin');
  assert.equal(yahoo.url, 'https://search.yahoo.com/search?p=tarte+tatin');
  assert.equal(engineRequest('yahoo', 'x', { page: 2 }).url, 'https://search.yahoo.com/search?p=x&b=11');

  for (const engine of ENGINES) {
    const { init } = engineRequest(engine, 'q');
    const names = Object.keys(init.headers).map(name => name.toLowerCase());
    assert.ok(!names.includes('user-agent') && !names.includes('cookie') && !names.includes('authorization'));
  }
  assert.throws(() => engineRequest('google', 'x'), /Unknown search engine/);
});

test('unwrapUrl decodes every redirect wrapper and rejects engine-internal links', () => {
  assert.equal(unwrapUrl('duckduckgo', '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa%3Fb%3D1&rut=abc'), 'https://example.org/a?b=1');
  assert.equal(unwrapUrl('duckduckgo', 'https://duckduckgo.com/l/?kh=-1&uddg=https%3A%2F%2Fexample.org%2F'), 'https://example.org/');
  assert.equal(unwrapUrl('duckduckgo', 'https://example.org/direct'), 'https://example.org/direct');
  assert.equal(unwrapUrl('duckduckgo', 'https://duckduckgo.com/y.js?ad_domain=shop.example'), null);
  assert.equal(unwrapUrl('duckduckgo', '/html/?q=next'), null);
  assert.equal(unwrapUrl('duckduckgo', 'javascript:void(0)'), null);
  assert.equal(unwrapUrl('duckduckgo', '//duckduckgo.com/l/?uddg=notaurl'), null);

  assert.equal(unwrapUrl('bing', bingLink('https://example.org/a b?x=1&y=é')), new URL('https://example.org/a b?x=1&y=é').href);
  assert.equal(unwrapUrl('bing', bingLink('https://example.org/p?msockid=1abc')), 'https://example.org/p');
  assert.equal(unwrapUrl('bing', 'https://www.bing.com/ck/a?!&&p=1&u=a1bm90YXVybA'), null);
  assert.equal(unwrapUrl('bing', 'https://www.bing.com/ck/a?!&&p=1'), null);
  assert.equal(unwrapUrl('bing', bingLink('https://www.bing.com/images/search?q=x')), null);
  assert.equal(unwrapUrl('bing', '/search?q=related'), null);
  assert.equal(unwrapUrl('bing', 'https://example.com/direct'), 'https://example.com/direct');
  assert.equal(unwrapUrl('bing', 'mailto:a@example.org'), null);

  assert.equal(unwrapUrl('yahoo', yahooLink('https://example.org/a?b=1&c=2')), 'https://example.org/a?b=1&c=2');
  assert.equal(unwrapUrl('yahoo', 'https://r.search.yahoo.com/_ylt=A;_ylu=B/RV=2/RE=1/RO=10/RU=https%3a%2f%2fexample.org%2fx%3fq%3d%25C3%25A9/RK=2/RS=z-'), 'https://example.org/x?q=%C3%A9');
  assert.equal(unwrapUrl('yahoo', 'https://r.search.yahoo.com/_ylt=A/RV=2/RK=2/RS=z-'), null);
  assert.equal(unwrapUrl('yahoo', 'https://search.yahoo.com/search?p=related'), null);
  assert.equal(unwrapUrl('yahoo', yahooLink('https://search.yahoo.com/search?p=loop')), null);
  assert.equal(unwrapUrl('yahoo', 'https://news.yahoo.com/story.html'), 'https://news.yahoo.com/story.html');
  assert.equal(unwrapUrl('nope', 'https://example.org/'), null);
});

test('DuckDuckGo results skip ads, decode wrappers, collapse text and deduplicate', () => {
  const { results, blocked, noResults } = parse('duckduckgo', DDG_PAGE);
  assert.equal(blocked, false);
  assert.equal(noResults, false);
  assert.deepEqual(results, [
    { title: 'Coroutines & tasks — Example Docs', url: 'https://example.org/docs/asyncio', snippet: 'If cancel () is called before the group, it will be cancelled.' },
    { title: 'Wrapped result', url: 'https://example.net/a?x=1&y=2', snippet: 'Wrapped snippet.' },
    { title: 'No snippet here', url: 'https://example.com/no-snippet', snippet: '' },
  ]);
});

test('Bing results skip ads and modules, unwrap /ck/a links and find snippets on rich cards', () => {
  const { results, blocked, noResults } = parse('bing', bingPage());
  assert.equal(blocked, false);
  assert.equal(noResults, false);
  assert.deepEqual(results, [
    { title: 'How to cancel tasks & groups - Example', url: 'https://example.org/guide?id=7&lang=en', snippet: 'May 19, 2023 · Cancelling is done with the scope …' },
    { title: 'Tower - Example Wiki', url: 'https://en.example.org/wiki/Tower', snippet: 'The tower is 330 metres tall.' },
    { title: 'Direct link', url: 'https://example.com/direct', snippet: 'Plain paragraph snippet.' },
  ]);
});

test('Yahoo results skip ads, sitelinks, related searches and self links', () => {
  const { results, blocked, noResults } = parse('yahoo', yahooPage());
  assert.equal(blocked, false);
  assert.equal(noResults, false);
  assert.deepEqual(results, [
    { title: 'Coroutines & tasks - Example Docs', url: 'https://example.org/docs/asyncio-task', snippet: '20 hours ago · If cancel () is called before the group …' },
    { title: 'Second result', url: 'https://example.net/page?a=1&b=2', snippet: 'Second snippet' },
  ]);
});

test('title and snippet are capped', () => {
  const html = `<div id="links"><div class="result"><a class="result__a" href="https://example.org/">${'T'.repeat(500)}</a><a class="result__snippet">${'S '.repeat(500)}</a></div></div>`;
  const [only] = parse('duckduckgo', html).results;
  assert.equal(only.title.length, 300);
  assert.ok(only.snippet.length <= 600);
});

test('legitimate no-results pages are told apart from blocks and parser drift', () => {
  assert.deepEqual(parse('duckduckgo', DDG_EMPTY), { results: [], blocked: false, noResults: true });
  assert.deepEqual(parse('bing', BING_EMPTY), { results: [], blocked: false, noResults: true });
  assert.deepEqual(parse('yahoo', YAHOO_EMPTY), { results: [], blocked: false, noResults: true });
  for (const engine of ENGINES) assert.deepEqual(parse(engine, DRIFT), { results: [], blocked: false, noResults: false }, `${engine} drift`);
});

test('block pages are detected by structure, not by loose words', () => {
  assert.deepEqual(parse('duckduckgo', DDG_BLOCK), { results: [], blocked: true, noResults: false });
  assert.deepEqual(parse('bing', BING_BLOCK), { results: [], blocked: true, noResults: false });
  assert.deepEqual(parse('yahoo', YAHOO_CONSENT), { results: [], blocked: true, noResults: false });
  assert.equal(detectBlock('duckduckgo', 202, DDG_BLOCK), true);
  assert.equal(detectBlock('duckduckgo', 202, '<html><body>busy</body></html>'), true);
  assert.equal(detectBlock('bing', 429, ''), true);
  assert.equal(detectBlock('yahoo', 503, '<html></html>'), true);
  // Inline scripts that mention the words are not a challenge, and result pages are never blocked.
  for (const engine of ENGINES) assert.equal(detectBlock(engine, 200, DRIFT), false);
  assert.equal(detectBlock('duckduckgo', 200, DDG_PAGE), false);
  assert.equal(detectBlock('bing', 200, bingPage() + '<script>var captcha="/turing/captcha"</script>'), false);
  assert.equal(detectBlock('yahoo', 200, yahooPage()), false);
  assert.equal(detectBlock('duckduckgo', 200, DDG_EMPTY), false);
  assert.equal(detectBlock('duckduckgo', 202, DDG_EMPTY), false);
  assert.equal(detectBlock('unknown', 429, ''), false);
});

test('parseWith builds the document itself and unknown engines throw', () => {
  assert.equal(parseWith('duckduckgo', DDG_PAGE).results.length, 3);
  assert.throws(() => parseResults('google', '', parseHTML('<p></p>').document), /Unknown search engine/);
});
