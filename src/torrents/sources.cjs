'use strict';

// Where torrents are found: three built-in catalogues of freely shared content (the Internet Archive, Academic
// Torrents, official Linux images) and the user's own RSS/Atom feeds and Torznab endpoints. Every source answers a
// search with the same result shape; results are fetched only when the user (or Little Bot) searches.

const BUILT_IN = [
  { id: 'archive', name: 'Internet Archive', description: 'Public-domain films, books, music and software. Every item can be downloaded, as the Archive seeds it itself.' },
  { id: 'academic', name: 'Academic Torrents', description: 'Research datasets, papers and AI models.' },
  { id: 'linux', name: 'Linux images', description: 'Official Debian, Ubuntu and Fedora images from their own sites.' },
];
const PRIORITY = { 'Linux images': 4, 'Academic Torrents': 2, 'Internet Archive': 1 };
const TIMEOUT_MS = 20000;
const MAX_PAGE = 8 * 1024 * 1024;
const ACADEMIC_TTL = 24 * 3600000;
const LINUX_TTL = 6 * 3600000;

const decode = text => String(text ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').trim();
const tag = (xml, name) => { const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return match ? decode(match[1]) : ''; };
const attr = (text, name) => { const match = text.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')) || text.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i')); return match ? decode(match[1]) : ''; };
const words = query => String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
const matches = (text, terms) => { const lower = String(text || '').toLowerCase(); return terms.every(term => lower.includes(term)); };
const number = value => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; };

function validUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Give a full web address, starting with https:// or http://.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https addresses can be sources.');
  return url;
}

class Sources {
  constructor({ fetch = globalThis.fetch } = {}) {
    this.fetch = fetch;
    this.cache = new Map(); // url -> { at, text }
  }

  async get(url, { ttl = 0, accept = '*/*' } = {}) {
    const cached = this.cache.get(url);
    if (ttl && cached && Date.now() - cached.at < ttl) return cached.text;
    const response = await this.fetch(url, { headers: { 'user-agent': 'Little Bot', accept }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
    if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}.`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_PAGE) throw new Error(`${new URL(url).host} sent too much.`);
    const text = await response.text();
    if (text.length > MAX_PAGE) throw new Error(`${new URL(url).host} sent too much.`);
    if (ttl) this.cache.set(url, { at: Date.now(), text });
    return text;
  }

  // The list the panel shows: built-in catalogues, then the user's own.
  list(saved = {}) {
    const builtIn = BUILT_IN.map(source => ({ ...source, kind: 'built-in', enabled: saved.builtIn?.[source.id] !== false }));
    const custom = (saved.custom || []).map(source => ({ id: source.id, name: source.name, kind: source.kind, url: source.url, enabled: source.enabled !== false, hasKey: Boolean(source.apiKeySealed || source.apiKey) }));
    return [...builtIn, ...custom];
  }

  // Searches every enabled source at once; one failing source does not spoil the others.
  async search(query, saved = {}, { only = null, limit = 60 } = {}) {
    const terms = words(query);
    if (!terms.length) throw new Error('Type something to search for.');
    const jobs = [];
    for (const source of BUILT_IN) {
      if (saved.builtIn?.[source.id] === false || (only && !only.includes(source.id))) continue;
      jobs.push([source.name, this[source.id](query, terms)]);
    }
    for (const source of saved.custom || []) {
      if (source.enabled === false || (only && !only.includes(source.id))) continue;
      jobs.push([source.name, source.kind === 'torznab' ? this.torznab(source, query) : this.rss(source, terms)]);
    }
    const settled = await Promise.allSettled(jobs.map(([, job]) => job));
    const results = [], errors = [];
    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') results.push(...outcome.value);
      else errors.push({ source: jobs[index][0], error: outcome.reason?.message || String(outcome.reason) });
    });
    // Best first: titles holding the words (the whole phrase best), then official images over the big Archive, then
    // seeders, then newer.
    const phrase = terms.join(' ');
    const score = item => { const title = item.title.toLowerCase().replace(/[-_.]+/g, ' '); return terms.filter(term => title.includes(term)).length * 10 + (title.includes(phrase) ? 15 : 0) + (PRIORITY[item.source] ?? 2); };
    for (const item of results) item.score = score(item);
    results.sort((a, b) => b.score - a.score || (b.seeders ?? -1) - (a.seeders ?? -1) || (b.date || 0) - (a.date || 0));
    for (const item of results) delete item.score;
    return { results: results.slice(0, limit), errors };
  }

  async archive(query) {
    // Titles first: a full-text match anywhere in an item's metadata brings in too much.
    const clean = query.replace(/[():"\\]/g, ' ').trim();
    const q = `title:(${clean}) AND mediatype:(movies OR texts OR audio OR software OR image OR data)`;
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=item_size&fl[]=downloads&fl[]=mediatype&fl[]=publicdate&sort[]=downloads+desc&rows=30&output=json`;
    const data = JSON.parse(await this.get(url, { accept: 'application/json' }));
    return (data.response?.docs || []).filter(doc => /^[\w.-]+$/.test(doc.identifier || '')).map(doc => ({
      source: 'Internet Archive', title: String(doc.title || doc.identifier).slice(0, 300), size: number(doc.item_size),
      seeders: null, note: `${doc.mediatype || 'item'} · ${Number(doc.downloads || 0).toLocaleString('en-US')} downloads · always available from the Archive`,
      date: doc.publicdate ? Date.parse(doc.publicdate) || null : null,
      torrent: `https://archive.org/download/${doc.identifier}/${doc.identifier}_archive.torrent`, page: `https://archive.org/details/${doc.identifier}`,
    }));
  }

  async academic(query, terms) {
    const xml = await this.get('https://academictorrents.com/database.xml', { ttl: ACADEMIC_TTL, accept: 'application/rss+xml, text/xml' });
    const results = [];
    for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const title = tag(item, 'title');
      if (!matches(`${title} ${tag(item, 'category')}`, terms)) continue;
      const hash = tag(item, 'infohash');
      if (!/^[a-f\d]{40}$/i.test(hash)) continue;
      results.push({ source: 'Academic Torrents', title: title.slice(0, 300), size: number(tag(item, 'size')), seeders: null,
        note: tag(item, 'category') || 'dataset', date: null, torrent: `https://academictorrents.com/download/${hash}.torrent`, page: `https://academictorrents.com/details/${hash}` });
      if (results.length >= 40) break;
    }
    return results;
  }

  // The official images, read from Debian's and Ubuntu's download folders and Fedora's torrent feed.
  async linux(query, terms) {
    const all = await this.linuxImages();
    return all.filter(item => matches(`${item.title} ${item.note}`, terms));
  }

  async linuxImages() {
    const images = [];
    const folder = async (base, note) => {
      const html = await this.get(base, { ttl: LINUX_TTL });
      for (const href of new Set([...html.matchAll(/href="([^"?#/]+\.torrent)"/g)].map(match => match[1]))) images.push({ source: 'Linux images', title: decode(href).replace(/\.torrent$/, ''), size: null, seeders: null, note, date: null, torrent: new URL(href, base).href, page: base });
    };
    const jobs = [
      folder('https://cdimage.debian.org/debian-cd/current/amd64/bt-cd/', 'Debian · installer'),
      folder('https://cdimage.debian.org/debian-cd/current/amd64/bt-dvd/', 'Debian · DVD'),
      (async () => {
        // Ubuntu: the newest long-term release (an even year's .04) and the newest release.
        const index = await this.get('https://releases.ubuntu.com/', { ttl: LINUX_TTL });
        const versions = [...new Set([...index.matchAll(/href="(\d\d\.\d\d)\/"/g)].map(match => match[1]))].sort();
        const lts = versions.filter(v => v.endsWith('.04') && Number(v.slice(0, 2)) % 2 === 0).at(-1);
        for (const version of new Set([lts, versions.at(-1)].filter(Boolean))) await folder(`https://releases.ubuntu.com/${version}/`, `Ubuntu ${version}${version === lts ? ' LTS' : ''}`);
      })(),
      (async () => {
        const xml = await this.get('https://torrent.fedoraproject.org/rss20.xml', { ttl: LINUX_TTL });
        for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
          const link = tag(item, 'link');
          if (/\.torrent$/i.test(link)) images.push({ source: 'Linux images', title: tag(item, 'title'), size: null, seeders: null, note: 'Fedora', date: Date.parse(tag(item, 'pubDate')) || null, torrent: link, page: 'https://torrent.fedoraproject.org/' });
        }
      })(),
    ];
    await Promise.allSettled(jobs);
    if (!images.length) throw new Error('The Linux download sites did not answer.');
    return images;
  }

  // An RSS or Atom feed listing torrents: each entry's .torrent enclosure or link, or a magnet link.
  async rss(source, terms) {
    const xml = await this.get(source.url, { accept: 'application/rss+xml, application/atom+xml, text/xml' });
    return parseFeed(xml, source.name).filter(item => matches(item.title, terms));
  }

  // Torznab: the standard search API many catalogues and self-hosted indexers offer.
  async torznab(source, query) {
    const url = validUrl(source.url);
    if (!/\/api\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/?$/, '/api');
    url.searchParams.set('t', 'search');
    url.searchParams.set('q', query);
    if (source.apiKey) url.searchParams.set('apikey', source.apiKey);
    const xml = await this.get(url.href, { accept: 'application/rss+xml, text/xml' });
    const error = xml.match(/<error\b[^>]*>/i);
    if (error) throw new Error(attr(error[0], 'description') || 'The Torznab source refused the search.');
    return parseFeed(xml, source.name);
  }

  // Checks a source before saving it: it must answer and list something.
  async test(source) {
    validUrl(source.url);
    const items = source.kind === 'torznab' ? await this.torznab(source, 'test') : parseFeed(await this.get(source.url), source.name);
    return { ok: true, items: items.length };
  }
}

function parseFeed(xml, name) {
  const entries = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g), ...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)].map(match => match[1]);
  const results = [];
  for (const entry of entries) {
    const title = tag(entry, 'title');
    const torznab = Object.fromEntries([...entry.matchAll(/<(?:torznab|newznab):attr\b[^>]*>/gi)].map(([element]) => [attr(element, 'name').toLowerCase(), attr(element, 'value')]));
    const enclosure = (entry.match(/<enclosure\b[^>]*>/i) || [''])[0];
    const links = [attr(enclosure, 'url'), tag(entry, 'link'), ...[...entry.matchAll(/<link\b[^>]*>/gi)].map(([element]) => attr(element, 'href')), torznab.magneturl, tag(entry, 'guid')].filter(Boolean);
    const magnet = links.find(link => /^magnet:\?/i.test(link)) || null;
    const torrent = links.find(link => /^https?:\/\//i.test(link) && (/\.torrent(?:$|\?)/i.test(link) || /bittorrent/i.test(attr(enclosure, 'type')) || link === attr(enclosure, 'url'))) || null;
    if (!title || (!magnet && !torrent)) continue;
    results.push({
      source: name, title: title.slice(0, 300),
      size: number(torznab.size) ?? number(attr(enclosure, 'length')) ?? number(tag(entry, 'size')) ?? number(tag(entry, 'contentLength')),
      seeders: number(torznab.seeders), leechers: number(torznab.peers) !== null && number(torznab.seeders) !== null ? Math.max(0, number(torznab.peers) - number(torznab.seeders)) : null,
      note: '', date: Date.parse(tag(entry, 'pubDate') || tag(entry, 'updated') || tag(entry, 'published')) || null,
      ...(magnet ? { magnet } : {}), ...(torrent ? { torrent } : {}),
      page: links.find(link => /^https?:\/\//i.test(link) && link !== torrent) || null,
    });
  }
  return results;
}

module.exports = { Sources, BUILT_IN, parseFeed, validUrl };
