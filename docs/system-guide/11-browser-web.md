# Browser and web services

## Built-in browser

[EmbeddedBrowser](../../src/embedded-browser.cjs) is a WebContentsView inside the main window. The renderer reserves a side panel (`#browser-panel`) and reports the viewport rectangle; main lays the native view over it. While a dialog is open, the view steps aside. The page uses its own persistent partition (`persist:little-bot-browser`), so sign-ins survive restarts until Settings › Clear browsing data. The session denies permission requests and downloads, opens only http(s), loads target=_blank links in the same tab, and presents a plain Chrome user agent.

The agent tool supports navigate, snapshot, read, ref-based click/fill/select/check, approved keys, scroll, back/forward/reload, tabs/switch (one tab), screenshot and close. It is driven through the Chrome DevTools Protocol of that view only; the app's own window is never attached:
- Snapshots come from the accessibility tree, and the @eN refs map to DOM nodes.
- Clicks use real pointer events when the page is on screen and the target is under the pointer, and a DOM click otherwise.
- Fill selects the field, then inserts text.
- Off screen (minimized or covered), Enter and Space fall back to their common default actions. Screenshots then return an error that suggests snapshot or read.

Every protocol command has a 15-second limit. Actions are serialized by the busy state. When the agent uses the browser, the panel opens and shows "Little Bot is browsing". The user's address bar and buttons are disabled meanwhile. The user can browse, sign in or solve a check in the panel at any other time.

## Search and scrape

[WebServices](../../src/web-services.cjs) supplies Brave/Firecrawl service tools using keys configured in Settings. The local service vault uses Electron safeStorage. Direct chat can use the tools; goals require their saved network permission. Heartbeat has network disabled.

Brave search returns source URLs. Firecrawl supplies configured search/scrape behavior. Requests have a 45-second timeout and a 2 MiB response limit. A five-request Firecrawl concurrency limit queues excess calls and cancellation releases queued work. Missing credentials or API errors are returned as tool errors, not fabricated search results.

## Failure conditions

Stale refs, an unavailable page, a closed browser, ongoing browser operation or command timeout can prevent browser action. Login, MFA, CAPTCHA and site-specific UI changes may require manual interaction. Having network access alone does not solve those interactions.

Service tools need keys, network access and provider availability/quota. They accept supported public URLs, not arbitrary local addresses. Browser content and remote source data are bounded; neither tool promises to read every page/file type.

Firecrawl answers HTTP 403 for sites it does not scrape; that is reported as an unsupported site, not a rejected key.

## Verification

[Web concurrency/cancellation](../../test/web-services-concurrency.test.cjs), [agent-side routing](../../test/agent-side-panel.test.cjs), [full access](../../test/full-access.test.cjs), [built-in browser](../../test/embedded-browser-electron.cjs), [web smoke](../../src/web-smoke.cjs) and [web-settings smoke](../../src/web-settings-smoke.cjs). Smoke files are development harnesses, not automatically fresh live-provider evidence.
