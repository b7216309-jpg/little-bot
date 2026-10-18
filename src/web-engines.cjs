'use strict';

const ENGINES = ['duckduckgo', 'bing', 'yahoo'];
const TITLE_MAX = 300;
const SNIPPET_MAX = 600;
const BLOCK_STATUSES = new Set([202, 403, 429, 503]);
const HOME = { duckduckgo: 'https://duckduckgo.com/', bing: 'https://www.bing.com/', yahoo: 'https://search.yahoo.com/' };
// The engines' own hosts; a link there is internal navigation or an ad redirect, never a destination.
const SELF_HOSTS = {
  duckduckgo: /(^|\.)duckduckgo\.com$/,
  bing: /(^|\.)bing\.com$/,
  yahoo: /^([a-z]{2}\.)?(r\.)?search\.yahoo\.com$|(^|\.)gemini\.yahoo\.com$/,
};

const clean = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);

function engineRequest(engine, query, { page = 1 } = {}) {
  const q = String(query || '').trim();
  const n = Math.max(1, Math.floor(Number(page)) || 1);
  if (engine === 'duckduckgo') {
    const form = new URLSearchParams({ q, kl: 'wt-wt' });
    if (n > 1) { form.set('s', String((n - 1) * 30)); form.set('dc', String((n - 1) * 30 + 1)); form.set('v', 'l'); form.set('o', 'json'); form.set('api', '/d.js'); }
    return { url: 'https://html.duckduckgo.com/html/', init: { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' }, body: form.toString() } };
  }
  if (engine === 'bing') {
    const params = new URLSearchParams({ q });
    if (n > 1) params.set('first', String((n - 1) * 10 + 1));
    return { url: 'https://www.bing.com/search?' + params, init: { method: 'GET', headers: { accept: 'text/html' } } };
  }
  if (engine === 'yahoo') {
    const params = new URLSearchParams({ p: q });
    if (n > 1) params.set('b', String((n - 1) * 10 + 1));
    return { url: 'https://search.yahoo.com/search?' + params, init: { method: 'GET', headers: { accept: 'text/html' } } };
  }
  throw new Error(`Unknown search engine: ${engine}`);
}

function decodeBase64Url(value) {
  try { return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; }
}

function unwrapUrl(engine, href) {
  if (!SELF_HOSTS[engine]) return null;
  let url;
  try { url = new URL(String(href || '').trim(), HOME[engine]); } catch { return null; }
  for (let hop = 0; hop < 3; hop++) {
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    let next = null;
    if (engine === 'duckduckgo' && host === 'duckduckgo.com' && url.pathname.startsWith('/l/')) next = url.searchParams.get('uddg') || '';
    else if (engine === 'bing' && /(^|\.)bing\.com$/.test(host) && /^\/ck\/a/.test(url.pathname)) {
      const u = url.searchParams.get('u') || '';
      next = /^a1/.test(u) ? decodeBase64Url(u.slice(2)) : /^https?:\/\//i.test(u) ? u : '';
    } else if (engine === 'yahoo' && /(^|\.)r\.search\.yahoo\.com$/.test(host)) {
      const m = /\/RU=([^/]+)/.exec(url.pathname);
      next = '';
      if (m) { try { next = decodeURIComponent(m[1]); } catch { /* malformed escape */ } }
    }
    if (next === null) break;
    try { url = new URL(next); } catch { return null; }
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname || SELF_HOSTS[engine].test(url.hostname.toLowerCase())) return null;
  if (engine === 'bing') url.searchParams.delete('msockid');
  return url.href;
}

function collect(items, engine, pick) {
  const results = [];
  const seen = new Set();
  for (const item of items) {
    const found = pick(item);
    if (!found) continue;
    const url = unwrapUrl(engine, found.href);
    const title = clean(found.title, TITLE_MAX);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url, snippet: clean(found.snippet, SNIPPET_MAX) });
  }
  return results;
}

const text = el => (el ? el.textContent : '');
const firstText = (el, selectors) => {
  for (const selector of selectors) { const t = clean(text(el.querySelector(selector)), SNIPPET_MAX); if (t) return t; }
  return '';
};

const PARSERS = {
  duckduckgo(document) {
    const items = [...document.querySelectorAll('#links .result, .result')].filter(el => !/\bresult--ad\b/.test(el.className || ''));
    return collect([...new Set(items)], 'duckduckgo', el => {
      const a = el.querySelector('a.result__a');
      return a && { href: a.getAttribute('href'), title: text(a), snippet: text(el.querySelector('.result__snippet')) };
    });
  },
  bing(document) {
    const items = [...document.querySelectorAll('li.b_algo')].filter(el => !el.closest('.b_ad'));
    return collect(items, 'bing', el => {
      const a = el.querySelector('h2 a[href]');
      // Rich cards (Wikipedia, recipes, shops) leave .b_caption empty and keep their text elsewhere.
      const snippet = firstText(el, ['.b_caption p', 'p[class*="b_lineclamp"]', '.b_wikiGbModHero', '.b_richcard .b_vList li', '.b_algoSlug', '.b_snippet', '.acf_t_c_body']);
      return a && { href: a.getAttribute('href'), title: text(a), snippet };
    });
  },
  yahoo(document) {
    const items = [...document.querySelectorAll('div.algo-sr, div.algo')].filter(el => !el.closest('.ads, .sponsored') && !/\b(ads?|sponsored)\b/.test(el.className || ''));
    return collect([...new Set(items)], 'yahoo', el => {
      const h = el.querySelector('h3.title, .compTitle h3, h3');
      const a = h && (h.closest('a') || h.querySelector('a') || el.querySelector('.compTitle a[href]'));
      return a && { href: a.getAttribute('href'), title: text(h), snippet: text(el.querySelector('.compText p, .compText')) };
    });
  },
};

// Class-token matchers on the raw markup; a trailing * means "any class starting with".
const cls = name => String.raw`class=["']?[^"'>]*(?<![\w-])` + name.replace(/\*$/, '') + (name.endsWith('*') ? '' : String.raw`(?![\w-])`);
// A page with organic-result markup is never a block page, whatever else the scripts mention.
const RESULT_MARKUP = {
  duckduckgo: new RegExp(cls('result__a')),
  bing: new RegExp('<li[^>]*' + cls('b_algo')),
  yahoo: new RegExp(cls('algo-sr')),
};
const NO_RESULTS_MARKUP = {
  duckduckgo: new RegExp(cls('no-results__message') + '|' + cls('result--no-result')),
  bing: new RegExp('<li[^>]*' + cls('b_no')),
  yahoo: new RegExp('<div[^>]*' + cls('zrp')),
};
// Anomaly modal (DuckDuckGo), captcha/turnstile (Bing), consent/GUCE forms (Yahoo): structure, not words.
const BLOCK_MARKUP = {
  duckduckgo: new RegExp([cls('anomaly-modal*'), String.raw`id=["']?challenge-form`, String.raw`/anomaly\.js`, String.raw`error-lite@duckduckgo\.com`].join('|')),
  bing: new RegExp([String.raw`/turing/captcha`, String.raw`id=["']?b_captcha`, '<(?:div|form|iframe)[^>]*' + cls('captcha*'), '<div[^>]*' + cls('cf-turnstile'), String.raw`<form[^>]*action=["']?[^"'>]*captcha`].join('|'), 'i'),
  yahoo: new RegExp([String.raw`<form[^>]*action=["']?[^"'>]*(?:collectConsent|consent\.yahoo\.com|guce\.yahoo)`, '<form[^>]*' + cls('consent-form'), String.raw`<(?:div|form)[^>]*id=["']?consent-page`, '<(?:div|form)[^>]*' + cls('captcha*'), String.raw`<form[^>]*action=["']?[^"'>]*captcha`].join('|'), 'i'),
};

function detectBlock(engine, status, html) {
  if (!RESULT_MARKUP[engine]) return false;
  const body = String(html || '');
  if (RESULT_MARKUP[engine].test(body)) return false;
  if (BLOCK_MARKUP[engine].test(body)) return true;
  return BLOCK_STATUSES.has(Number(status)) && !NO_RESULTS_MARKUP[engine].test(body);
}

function parseResults(engine, html, document) {
  if (!PARSERS[engine]) throw new Error(`Unknown search engine: ${engine}`);
  const results = PARSERS[engine](document);
  if (results.length) return { results, blocked: false, noResults: false };
  const body = String(html || '');
  const blocked = detectBlock(engine, 0, body);
  return { results: [], blocked, noResults: !blocked && NO_RESULTS_MARKUP[engine].test(body) };
}

function parseWith(engine, html) {
  const { parseHTML } = require('linkedom');
  return parseResults(engine, html, parseHTML(String(html || '')).document);
}

module.exports = { ENGINES, engineRequest, parseResults, parseWith, detectBlock, unwrapUrl };
