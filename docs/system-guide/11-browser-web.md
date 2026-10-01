# Browser and web services

## Visible browser

[AgentBrowser](../../src/agent-browser.cjs) wraps the bundled Windows agent-browser 0.38.1 executable. It uses a separate persistent browser profile under data/browser and a fixed session namespace. It locates a cached installed browser, Chrome or Edge. The Browser button lets the user open/sign into that profile.

The agent tool supports navigate, snapshot, read, ref-based click/fill/select/check, approved keys, scroll, back/forward/reload, tabs/switch, screenshot and close. Snapshot refs must be refreshed after the page changes. Screenshots are local output files; attachment_send can deliver them into chat.

Commands are serialized by browser busy state. A normal command has a 35-second host timeout and bounded output. After a timed-out action, the outcome is uncertain and the browser must be closed before another action. It is not an arbitrary page-JavaScript, upload, network-interception or credential-export API.

## Search and scrape

[WebServices](../../src/web-services.cjs) supplies Brave/Firecrawl service tools using keys configured in Settings. The local service vault uses Electron safeStorage. Direct chat can use the tools; goals require their saved network permission. Heartbeat has network disabled.

Brave search returns source URLs. Firecrawl supplies configured search/scrape behavior. Requests have a 45-second timeout and a 2 MiB response limit. A five-request Firecrawl concurrency limit queues excess calls and cancellation releases queued work. Missing credentials or API errors are returned as tool errors, not fabricated search results.

## Failure conditions

A missing bundled executable, missing browser installation, stale refs, an unavailable page, a closed browser, ongoing browser operation or command timeout can prevent browser action. Login, MFA, CAPTCHA and site-specific UI changes may require manual interaction. Having network access alone does not solve those interactions.

Service tools need keys, network access and provider availability/quota. They accept supported public URLs, not arbitrary local addresses. Browser content and remote source data are bounded; neither tool promises to read every page/file type.

No paid Brave/Firecrawl calls, real sign-in or consequential form submission were performed in this review. The installed native browser CLI's version invocation worked through both ordinary and namespaced Windows paths at the actual 201-character source path. That check verifies executable launch only, not end-to-end browsing.

## Verification

[Web concurrency/cancellation](../../test/web-services-concurrency.test.cjs), [agent-side routing](../../test/agent-side-panel.test.cjs), [full access](../../test/full-access.test.cjs), [web smoke](../../src/web-smoke.cjs) and [web-settings smoke](../../src/web-settings-smoke.cjs). Smoke files are development harnesses, not automatically fresh live-provider evidence.
