'use strict';
const { parentPort } = require('node:worker_threads');

// HTML parsing and page extraction run here, never on Electron's main thread: a large page can take
// hundreds of milliseconds and ten parallel searches parse thirty result pages.
let libraries;
function libs() {
  if (!libraries) {
    const TurndownService = require('turndown');
    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
    turndown.use(require('turndown-plugin-gfm').gfm);
    turndown.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button', 'input', 'select', 'textarea', 'svg', 'canvas', 'video', 'audio']);
    // Added rules take precedence over turndown's own: images cost tokens and say nothing to a text model,
    // and gfm keeps header-less (layout) tables as raw HTML unless they are claimed here.
    turndown.addRule('images', { filter: ['img', 'picture'], replacement: () => '' });
    turndown.addRule('plainTables', {
      filter: node => {
        if (node.nodeName !== 'TABLE') return false;
        const row = node.querySelector('tr');
        const cells = Array.prototype.filter.call(row?.childNodes || [], cell => cell.nodeType === 1);
        return !row || !(row.parentNode?.nodeName === 'THEAD' || cells.every(cell => cell.nodeName === 'TH'));
      },
      replacement: content => `\n\n${content}\n\n`,
    });
    turndown.addRule('links', {
      filter: node => node.nodeName === 'A',
      replacement: (content, node) => {
        const text = content.replace(/\s+/g, ' ').trim();
        const href = node.getAttribute('href') || '';
        if (!text) return '';
        if (!/^https?:/i.test(href) || text === href) return text;
        return `[${text}](${href})`;
      },
    });
    libraries = { parseHTML: require('linkedom').parseHTML, Readability: require('@mozilla/readability').Readability, turndown };
  }
  return libraries;
}

const BLOCKED_TITLE = /^(?:just a moment|attention required|access denied|forbidden|are you a robot|security check|captcha|verifying you are human|please verify|un instant|vérification|pardon our interruption|request blocked)/i;
const JS_NOTICE = /(?:enable|turn on|activate|requires?)\s+javascript|javascript (?:is )?(?:required|disabled)|activ(?:er|ez) (?:le )?javascript/i;

function absolutize(document, base) {
  for (const [selector, attribute] of [['a[href]', 'href'], ['img[src]', 'src']]) {
    for (const node of document.querySelectorAll(selector)) {
      try { node.setAttribute(attribute, new URL(node.getAttribute(attribute), base).href); } catch { node.removeAttribute(attribute); }
    }
  }
}

function tidy(markdown) {
  return markdown.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\s*[-*]\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Reddit keeps titles, scores and comment counts in attributes of its custom elements, not in the text.
function reddit(document, turndown, url) {
  const posts = [...document.querySelectorAll('shreddit-post')];
  const comments = [...document.querySelectorAll('shreddit-comment')];
  if (!posts.length && !comments.length) return null;
  const link = value => value ? new URL(value, 'https://www.reddit.com/').href : '';
  const when = value => (value || '').slice(0, 10);
  const lines = [];
  const thread = posts.length === 1 && /\/comments\//.test(new URL(url).pathname);
  posts.forEach((post, index) => {
    const meta = `${post.getAttribute('score') || 0} points, ${post.getAttribute('comment-count') || 0} comments, u/${post.getAttribute('author') || '?'}, ${when(post.getAttribute('created-timestamp'))}`;
    const title = post.getAttribute('post-title') || '';
    if (thread) {
      lines.push(`# ${title}`, `${post.getAttribute('subreddit-prefixed-name') || ''} · ${meta}`);
      const body = post.querySelector('[slot="text-body"]');
      if (body) lines.push(turndown.turndown(body.innerHTML || ''));
      lines.push('', '## Comments');
    // The address stays plain text so it survives link stripping: the model needs it to open the thread.
    } else lines.push(`${index + 1}. ${title} (${meta}) ${link(post.getAttribute('permalink'))}`);
  });
  for (const comment of comments) {
    const own = [...comment.querySelectorAll('[slot="comment"]')].find(node => node.closest('shreddit-comment') === comment);
    const text = own ? turndown.turndown(own.innerHTML || '').replace(/\n+/g, ' ').trim() : '';
    if (!text) continue;
    lines.push(`${'  '.repeat(Math.min(6, Number(comment.getAttribute('depth')) || 0))}- u/${comment.getAttribute('author') || '?'} (${comment.getAttribute('score') || 0} points): ${text}`);
  }
  // The first response of a thread often holds the post only; its comments arrive by script.
  const incomplete = thread && !comments.length && Number(posts[0].getAttribute('comment-count')) > 0;
  return { markdown: lines.join('\n').trim(), incomplete };
}

function extractPage({ html, url }) {
  const { parseHTML, Readability, turndown } = libs();
  const { document } = parseHTML(html);
  const special = /(?:^|\.)reddit\.com$/i.test(new URL(url).hostname) ? reddit(document, turndown, url) : null;
  if (special) return { title: (document.querySelector('title')?.textContent || '').trim().slice(0, 300), siteName: 'Reddit', lang: '', markdown: special.markdown, blocked: false, needsBrowser: special.incomplete, incomplete: special.incomplete };
  const pageTitle = (document.querySelector('title')?.textContent || '').replace(/\s+/g, ' ').trim();
  const lang = document.documentElement?.getAttribute('lang') || '';
  const bodyText = (document.body?.textContent || '').replace(/\s+/g, ' ').trim();
  const blocked = BLOCKED_TITLE.test(pageTitle) && bodyText.length < 3000;
  absolutize(document, url);
  let article = null;
  try { article = new Readability(document.cloneNode(true), { charThreshold: 300, keepClasses: false }).parse(); } catch { article = null; }
  let markdown = article?.content ? tidy(turndown.turndown(article.content)) : '';
  // Readability gives up on list pages, docs indexes and forums; fall back to the cleaned body.
  if (markdown.length < 400 && document.body) {
    for (const node of document.body.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,svg,iframe,[role=navigation],[aria-hidden=true]')) node.remove();
    const fallback = tidy(turndown.turndown(document.body.innerHTML || ''));
    if (fallback.length > markdown.length) markdown = fallback;
  }
  const scripts = (html.match(/<script\b/gi) || []).length;
  const needsBrowser = !blocked && markdown.length < 600 && (JS_NOTICE.test(bodyText.slice(0, 4000)) || scripts >= 3 || /<div[^>]+id=["'](?:root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html));
  return { title: (article?.title || pageTitle).slice(0, 300), siteName: article?.siteName || '', lang, markdown, blocked, needsBrowser };
}

async function extractPdf({ buffer }) {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer), { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    let title = '';
    try { title = String((await pdf.getMetadata())?.info?.Title || '').trim(); } catch { /* Untitled PDF. */ }
    let text = '';
    for (let number = 1; number <= Math.min(pdf.numPages, 150) && text.length < 400000; number++) {
      const page = await pdf.getPage(number), content = await page.getTextContent();
      text += `\n\n[Page ${number}]\n`;
      for (const item of content.items) if (typeof item.str === 'string') text += item.str + (item.hasEOL ? '\n' : ' ');
      page.cleanup();
    }
    const markdown = text.replace(/[ \t]+\n/g, '\n').trim();
    return { title: title.slice(0, 300), markdown: markdown.replace(/\[Page \d+\]/g, '').trim() ? markdown : '', pages: pdf.numPages, blocked: false, needsBrowser: false };
  } finally { await pdf.loadingTask.destroy(); }
}

function parseSerp({ engine, html }) {
  const engines = require('./web-engines.cjs');
  return engines.parseResults(engine, html, libs().parseHTML(html).document);
}

parentPort?.on('message', async ({ id, task }) => {
  try {
    const result = task.kind === 'page' ? extractPage(task) : task.kind === 'pdf' ? await extractPdf(task) : task.kind === 'serp' ? parseSerp(task) : null;
    if (!result) throw new Error('Unknown web task.');
    parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: String(error?.message || error).slice(0, 500) }); }
});

module.exports = { extractPage, extractPdf, parseSerp };
