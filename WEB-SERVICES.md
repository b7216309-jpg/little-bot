# Web services

Little Bot supports Firecrawl for public-page extraction and web search, plus optional Brave Search for an independent search index. Both use the app's existing native HTTP runtime, without provider SDKs or background servers.

Add keys in the app's Settings. Each service has its own key and remove control. A blank input keeps the existing key; saving a key does not make a paid validation request. Keys are encrypted with Electron safeStorage (Windows DPAPI) into a separate `service-keys.json` vault under the app's data directory. The renderer receives configured flags, never saved keys. There is no plaintext fallback.

## Agent tools

- `web_search_service({query, provider?, limit?})` returns up to five titles, snippets and source URLs. `provider` can be `auto`, `brave` or `firecrawl`. Auto selects Brave if configured, otherwise Firecrawl. Search does not also scrape results. A request failure is returned directly; it never silently switches services, retries or doubles the bill.
- `web_scrape({url, maxChars?})` uses Firecrawl to read one public page as markdown. The default text limit is 12,000 characters, adjustable between 1,000 and 20,000. The result includes its source URL and a truncation flag.

Provider endpoints are fixed, credentialed requests reject redirects, and request duration and response size are bounded. Firecrawl requests share a five-call concurrency gate across search and scrape; additional Firecrawl calls wait in a cancellable FIFO queue. Brave Search is independent of that gate. Local, private, credential-bearing and non-HTTP page URLs are rejected before scraping. DNS must resolve to public addresses; the external service remains responsible for redirects and its own network isolation. Search results and page text are marked as untrusted source material. Requests may consume the chosen service's credits. Credentials are not added to model instructions, chat history or normal application state.

Recursive crawling, bulk scraping and a second hosted browser service are intentionally omitted: search, reading one page and the agent browser cover the first useful workflows with clear cost boundaries.

## Integration contract

`new WebServices({root, safeStorage, fetchImpl?, lookupImpl?})` accepts an absolute vault directory and Electron's safeStorage. The optional fetch and DNS implementations support isolated fixture checks. Instantiate after Electron is ready.

- `getState()` returns `{firecrawl:{configured}, brave:{configured}, error}`. A configured flag means a saved encrypted key exists, not that the remote provider has accepted it.
- `save({service, apiKey?, remove?})` stores/removes only the selected service and returns the updated state. It is synchronous and saves through a flushed temporary file and rename.
- `specs()` provides static dynamic-tool definitions, so a key can be added after creating a chat.
- `call(name, args, {signal?}?)` returns a bounded JSON result. The host must apply the current conversation's network permissions before calling it.
- `close()` cancels requests on app shutdown.

## Sources

Current official APIs checked on 2026-09-26:

- [Firecrawl search API](https://docs.firecrawl.dev/api-reference/endpoint/search): `POST https://api.firecrawl.dev/v2/search`, Bearer authorization, results under `data.web`.
- [Firecrawl scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape): `POST https://api.firecrawl.dev/v2/scrape`, markdown format and main-content filtering.
- [Brave Search API](https://api-dashboard.search.brave.com/api-reference/web/search/get): `GET https://api.search.brave.com/res/v1/web/search`, `X-Subscription-Token`, results under `web.results`.
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage): native operating-system encryption. It protects stored bytes, not against another malicious process running as the same Windows user.
