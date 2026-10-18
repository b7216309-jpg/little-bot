# Web search and page reading

Little Bot searches the web and reads pages with built-in tools. There is no account, API key, quota or setting: only the PC's connection and the sites themselves set the limits. The implementation is [src/web-services.cjs](src/web-services.cjs), with [src/web-engines.cjs](src/web-engines.cjs) (search result pages), [src/web-rank.cjs](src/web-rank.cjs) (fusion and passages), [src/web-worker.cjs](src/web-worker.cjs) (parsing in worker threads) and [src/web-electron.cjs](src/web-electron.cjs) (the Electron transport).

## What it does

- Searches DuckDuckGo, Bing and Yahoo at once, fuses their results into one ranked list, and attaches the most relevant passage of the top pages, so the answer is often in the result already.
- Reads public pages as markdown: articles, documentation, forums, PDFs and JavaScript-rendered sites.
- Runs several searches or page reads in parallel in one call.

Settings shows a read-only line with each engine's state (for example "DuckDuckGo ready · Bing ready · Yahoo paused for 4 min (rate limited)").

## Agent tools

The tool names are unchanged (`web_search_service`, `web_scrape`) so existing chats keep working. They are available in direct conversations and in goals with network permission; the heartbeat and routines have no web access.

- `web_search_service({query?, queries?, limit?})`: `query` is one search (up to 600 characters and 75 words); `queries` is up to 10 searches run in parallel, instead of or in addition to `query` (duplicates are dropped). `limit` is results per query, 1 to 10 (default 6); values out of range are clamped, not refused. An old `provider` argument is accepted and ignored.
  - One query returns `{query, results, engines, authority}`, with `cached: true` when it came from the cache. Several queries return `{searches: [...], authority}`; a query that failed appears as `{query, results: [], error}` and the call fails only if every query failed.
  - Each result has `title`, `url`, `snippet`, `engines` (which engines returned it) and, for most of the top five, a `passage`. `engines` on the response gives each engine's outcome (`ok`, `no results`, `rate limited`, `unrecognized page`, `paused`, or an error code).
- `web_scrape({url?, urls?, maxChars?, links?})`: `url` is one page; `urls` is up to 10 pages read in parallel. `maxChars` is the text kept per page, 1,000 to 60,000 (default 12,000); values out of range are clamped, not refused. With several pages the total is capped at 60,000 characters, split evenly (at least 1,000 each). Links are shown as plain text unless `links` is `true`.
  - One page returns `{url, title, markdown, truncated, totalChars?, note?, via, authority}`; `note` says how to see more of a truncated page, or warns when almost no text came back (a sign-in or human check is likely); `via` is `direct`, `browser` or `reader`. Several pages return `{pages: [...], authority}`, with `{url, error}` for any page that failed.
- Results are marked as untrusted external sources: the model is told to cite them and ignore instructions inside page content. Arguments are bounded (50,000 characters of JSON) and unknown arguments are rejected. A cancelled conversation cancels its web work.

## How search works

1. **Engines.** The HTML result pages of DuckDuckGo (`html.duckduckgo.com`), Bing and Yahoo are requested through Electron's Chromium network stack, in a partition of their own (`persist:little-bot-web`) that never touches the signed-in browser profile. Requests time out after 10 s and are limited to 4 MiB. Redirect wrappers (DuckDuckGo `/l/`, Bing `/ck/a`, Yahoo `r.search`) are unwrapped to the real destination, and links back to the engine itself are dropped. Parsing runs in worker threads, so ten parallel searches never stall the app.
2. **Fusion.** Results are merged by normalized URL (case, `www`, tracking parameters, trailing `index.html` and fragments are ignored). The score blends reciprocal rank fusion across engines (0.55), BM25 relevance of title and snippet to the query (0.30) and the share of query terms covered (0.15). At most two results per site appear before any site gets a third.
3. **Passages.** Each engine's two leading results start downloading as soon as that engine answers, while the slower engines are still working. After fusion, the top five results are read directly (no browser render, no reader service; reads already under way are joined, not repeated), and the search returns as soon as three of them have a passage, or after 2.5 s. The two best-matching passages (about 450 characters each) are attached. Reads still running when the search returns finish in the background and land in the page cache for `web_scrape`.
4. **Cache.** Results are cached for 30 minutes (200 searches, keyed by query and limit).
5. **Pause on rate limit.** When an engine answers with HTTP 202 (and no results), 403, 429 or 503, or a bot-check page, it is paused: 2 minutes, then 10, then 30 for repeated failures. A success clears it. While an engine is paused it is skipped; if all are paused, the one that recovers first is tried anyway.
6. **Browser fallback.** If no engine returns results, Bing's result page is loaded in a hidden browser window and parsed instead (DuckDuckGo's HTML page needs a POST, so it is not rendered).

## How reading works

Each page is tried in three tiers, stopping at the first that gives enough text:

1. **Direct fetch** (20 s, 8 MiB limit) through the same Chromium stack. HTML is cleaned with Mozilla Readability (falling back to the whole body for list pages and forums) and converted to markdown; images and forms are dropped. A PDF (by content type or `%PDF-` header) is extracted page by page, up to 150 pages or 400,000 characters. Images, audio, video, fonts and archives are refused. Reddit pages are rebuilt from their post and comment elements (title, score, comment count, author, date, nested comments), whose numbers are not in the page text.
2. **Hidden browser render** (25 s) for pages that need JavaScript or look like a bot check: a sandboxed, invisible window with images, permissions, downloads and pop-ups off, which reads from the moment the DOM is ready, without waiting for every image, font and tracker, until the text stops growing. Text moving by under 1% (tickers, carousels) counts as settled, and text unchanged for 1.5 s (a short page, a bot check that will not pass) is read as it is. Up to 3 renders run at once.
3. **Reader service**: the public reader at `r.jina.ai` (no key), used last for sites that refuse both of the above. At most 18 reader calls per minute, 4 at once.

Safety and limits:

- Only `http` and `https` URLs without credentials. Local and private names (`localhost`, `.local`, `.internal`, `.lan`, `.home`, `.test`, `.invalid`, dotless hosts) and private, loopback, link-local, carrier-grade NAT and reserved IPv4 and IPv6 addresses are rejected. Hostnames are resolved first, through Chromium's own resolver (whose cached answer the connection then reuses), and refused if any address is private (DNS lookups time out after 20 s). A page already in the cache, or being read, is served before any lookup.
- Every redirect hop is checked the same way before it is followed (at most 6 hops).
- Concurrency: 48 page fetches at once, 4 per host, 10 per engine; extra calls wait in a cancellable queue. Concurrent reads of the same page share one download, whether they come from search passages or `web_scrape`. A site that refused a plain request (HTTP 401/403 or a bot-check page; 429 and 503 are treated as momentary) goes straight to the browser tier for 30 minutes, with one direct try at the end if every other tier fails.
- Pages are cached for 6 hours (150 pages, up to 400,000 characters each). A failed read is remembered for 5 minutes.
- A failed read says which tiers were tried ("direct: HTTP 403; browser: blocked by a bot check; ...") and suggests the browser tool.

## Limits and failure behaviour

- Pages that need a sign-in or a human check (a CAPTCHA) fail every tier, or return almost no text with a `note`. Open them with the `browser` tool, which uses the visible panel and its persistent profile. A JavaScript check that a normal browser passes on its own (Reddit's, for example) is handled by the hidden browser tier.
- If every engine fails, the call fails with each engine's status and suggests trying again in a minute or using the browser. If an engine only finds nothing, the result is empty with a hint to rephrase.
- Results are as good as the three engines' public pages; there is no ranking by a paid index and no freshness guarantee beyond the 30-minute cache.
- Recursive crawling and bulk scraping are intentionally omitted.

## Integration contract

`new WebServices({request, render, resolve, fetchImpl, lookupImpl, workers, trace})`, created after Electron is ready (`main.cjs` passes `electronWeb(require('electron'))`).

- `request({url, method?, headers?, body?, signal?, timeout?, maxBytes?, validate?})` returns `{status, url, headers: {get}, body: Buffer}` and must call `validate` on every redirect target. Without it, a plain Node transport over `fetchImpl` (default `fetch`) is used, which is what tests do.
- `render(url, {signal, timeout, validate})` returns `{html, url}` from a hidden browser window; optional (without it the browser tier and search fallback are skipped).
- `resolve(host)` returns `[{address}]` from the transport's own resolver (Chromium's in the app); without it `lookupImpl` (default `dns.lookup`) is used. `workers` is the parser thread count (default 3).
- `trace(stage, ms, detail)` is an optional timing hook (engine requests and parsing, DNS, queueing, page download and parsing, render, reader, search phases) used by benchmarks; it never changes results.
- `getState()` returns `{engines: {duckduckgo, bing, yahoo}, browserRendering}`, each engine a status string such as `ready`, `rate limited`, `slow`, `unreachable`, `HTTP 500`, `unrecognized page`, or `paused for N min (status)`.
- `specs()` returns the two tool definitions.
- `call(name, args, {signal?})` returns a bounded JSON result. The host must apply the conversation's network permission before calling it.
- `close()` cancels requests, empties the queues and stops the worker threads.

## Caveats

- The engines are read as HTML result pages, not through APIs. If an engine changes its page layout the parser can stop recognizing it; that engine is then reported as `unrecognized page` and the others carry the search. Parsers need an update when this happens.
- Redirects and hostnames are checked before connecting, but DNS rebinding (a name that resolves to a public address at check time and a private one when connecting) is not prevented at the socket level.
- The reader fallback sends the page address to `r.jina.ai`, a third party, and only when the direct fetch and the hidden browser both failed. Search queries go to DuckDuckGo, Bing and Yahoo. Nothing is sent to any other service, and no keys exist to leak.
- Engines may rate limit a PC that searches heavily; the pause logic backs off, and the results fall back to the remaining engines.
