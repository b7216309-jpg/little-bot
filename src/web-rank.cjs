'use strict';

// Ranking helpers for the built-in web search: tokenizing, BM25, result fusion and query-focused passages.
const STOPWORDS = new Set(('a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who why will with ' +
  'au aux avec ce ces dans de des du elle en est et il je la le les leur lui ma mais me mes mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes ton tu un une vos votre vous comment quel quelle quels quelles est-ce').split(' '));
const TRACKING = /^(?:utm_\w+|fbclid|gclid|dclid|msclkid|mc_[ce]id|ref|ref_src|igshid|si|spm|_hsenc|_hsmi)$/i;

function tokens(value) {
  return String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(token => (token.length > 1 || /\d/.test(token)) && !STOPWORDS.has(token)) || [];
}

// Okapi BM25 with the Lucene IDF, which stays positive in the tiny candidate sets a search page gives,
// plus the share of distinct query terms a document covers.
function bm25(query, documents, { k1 = 1.2, b = 0.75 } = {}) {
  const terms = [...new Set(tokens(query))];
  const docs = documents.map(tokens);
  const average = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length) || 1;
  const frequency = new Map(terms.map(term => [term, docs.filter(doc => doc.includes(term)).length]));
  return docs.map(doc => {
    const counts = new Map();
    for (const token of doc) counts.set(token, (counts.get(token) || 0) + 1);
    let score = 0, covered = 0;
    for (const term of terms) {
      const count = counts.get(term) || 0;
      if (!count) continue;
      covered += 1;
      const df = frequency.get(term);
      score += Math.log(1 + (docs.length - df + 0.5) / (df + 0.5)) * (count * (k1 + 1)) / (count + k1 * (1 - b + b * doc.length / average));
    }
    return { score, coverage: terms.length ? covered / terms.length : 0 };
  });
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\d?\./, '');
    for (const name of [...url.searchParams.keys()]) if (TRACKING.test(name)) url.searchParams.delete(name);
    const pathname = url.pathname.replace(/\/(?:index\.html?)?$/i, '') || '/';
    // http and https of one page are one result; another port is another site.
    return `${url.hostname}${url.port ? `:${url.port}` : ''}${pathname}${url.search}`;
  } catch { return null; }
}
const hostOf = value => { try { return new URL(value).hostname.toLowerCase().replace(/^www\d?\./, ''); } catch { return ''; } };

// Reciprocal rank fusion across engines, blended with lexical relevance, then at most two results per site
// before any site gets a third.
function fuse(lists, query, { limit = 6, perHost = 2 } = {}) {
  const merged = new Map();
  for (const [engine, rows] of Object.entries(lists)) {
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, rank) => {
      const key = normalizeUrl(row.url);
      if (!key) return;
      const item = merged.get(key) || { title: row.title, url: row.url, snippet: row.snippet || '', engines: [], rrf: 0 };
      if (!item.engines.includes(engine)) { item.engines.push(engine); item.rrf += 1 / (60 + rank); }
      if ((row.snippet || '').length > item.snippet.length) item.snippet = row.snippet;
      if (!item.title && row.title) item.title = row.title;
      if (item.url.startsWith('http:') && row.url.startsWith('https:')) item.url = row.url;
      merged.set(key, item);
    });
  }
  const items = [...merged.values()];
  if (!items.length) return [];
  const lexical = bm25(query, items.map(item => `${item.title} ${item.title} ${item.snippet}`));
  const topRrf = Math.max(...items.map(item => item.rrf)), topBm25 = Math.max(...lexical.map(row => row.score)) || 1;
  items.forEach((item, index) => { item.score = 0.55 * item.rrf / topRrf + 0.3 * lexical[index].score / topBm25 + 0.15 * lexical[index].coverage; });
  items.sort((a, b) => b.score - a.score);
  const chosen = [], used = new Map(), skipped = [];
  for (const item of items) {
    const host = hostOf(item.url);
    if ((used.get(host) || 0) >= perHost) { skipped.push(item); continue; }
    used.set(host, (used.get(host) || 0) + 1);
    chosen.push(item);
    if (chosen.length >= limit) break;
  }
  for (const item of skipped) { if (chosen.length >= limit) break; chosen.push(item); }
  return chosen.map(({ title, url, snippet, engines }) => ({ title, url, snippet, engines }));
}

// The passages of a page that best answer the query, in page order.
function passages(markdown, query, { count = 2, size = 700 } = {}) {
  const blocks = stripLinks(markdown).split(/\n{2,}/).map(block => block.trim()).filter(block => block.length > 30);
  const chunks = [];
  let current = '';
  for (const block of blocks) {
    if (current && current.length + block.length + 2 > size) { chunks.push(current); current = ''; }
    current = current ? `${current}\n\n${block}` : block;
    while (current.length > size) {
      let cut = current.lastIndexOf('. ', size);
      if (cut < size / 2) cut = current.lastIndexOf(' ', size);
      if (cut < size / 2) cut = size - 1;
      chunks.push(current.slice(0, cut + 1).trim()); current = current.slice(cut + 1).trim();
    }
  }
  if (current) chunks.push(current);
  if (!chunks.length) return [];
  const scores = bm25(query, chunks);
  return scores.map((row, index) => ({ index, value: row.score + row.coverage }))
    .filter(row => row.value > 0).sort((a, b) => b.value - a.value).slice(0, count)
    .sort((a, b) => a.index - b.index).map(row => chunks[row.index]);
}

// Markdown links as their text only: page links can be half of a page's tokens.
function stripLinks(markdown) {
  return String(markdown || '').replace(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\((?:[^()\s]|\([^()\s]*\))+(?:\s+"[^"]*")?\)/g, '$1');
}

module.exports = { tokens, bm25, normalizeUrl, hostOf, fuse, passages, stripLinks };
