# Browser and web services

## Built-in browser

[EmbeddedBrowser](../../src/embedded-browser.cjs) is a WebContentsView inside the main window. The renderer reserves a side panel (`#browser-panel`) and reports the viewport rectangle; main lays the native view over it. While a dialog is open, the view steps aside. The page uses its own persistent partition (`persist:little-bot-browser`), so sign-ins survive restarts until Settings › Clear browsing data. The session denies permission requests and downloads, opens only http(s), loads target=_blank links in the same tab, and presents a plain Chrome user agent.

The agent tool supports navigate, snapshot, read, ref-based click/fill/select/check, approved keys, scroll, back/forward/reload, tabs/switch (one tab), screenshot and close. It is driven through the Chrome DevTools Protocol of that view only; the app's own window is never attached:
- Snapshots come from the accessibility tree, and the @eN refs map to DOM nodes.
- Clicks use real pointer events when the page is on screen and the target is under the pointer, and a DOM click otherwise.
- Fill selects the field, then inserts text.
- Off screen (minimized or covered), Enter and Space fall back to their common default actions. Screenshots then return an error that suggests snapshot or read.

Every protocol command has a 15-second limit. Actions are serialized by the busy state. When the agent uses the browser, the panel opens and shows "Little Bot is browsing". The user's address bar and buttons are disabled meanwhile. The user can browse, sign in or solve a check in the panel at any other time.

## Other Windows apps

[WindowsUia](../../src/windows-uia.cjs) gives the agent one `windows_ui` tool for other desktop apps. Its actions are list_windows, snapshot, find, click, set_value, select, expand, scroll, type, focus, screenshot and wait. A snapshot or find returns compact lines with `@uN` refs, and an action uses one ref.

Each call runs [a PowerShell bridge](../../src/windows-uia-bridge.ps1) in a hidden STA process using the managed UI Automation client, with a 30-second limit; a stopped conversation kills it. Standard Win32 and WinForms controls often reach that client as bare panes, so the bridge recognises them through MSAA (true role, accessible name, checked state), falling back to window class and style. It then operates them with the MSAA default action or their own messages: posted BM_CLICK, WM_SETTEXT, or CB_SELECTSTRING plus CBN_SELCHANGE.

Rules:
- The tool exists only on Windows, and only in the user's own running conversation, never in goals, heartbeat or automations.
- After every action the window must be observed again within 5 minutes before the next action.
- Screenshots go to data/windows-ui/screenshots, and the newest 20 are kept.

## Search and scrape

[WebServices](../../src/web-services.cjs) supplies Brave/Firecrawl service tools using keys configured in Settings. The local service vault uses Electron safeStorage. Direct chat can use the tools; goals require their saved network permission. Heartbeat has network disabled.

Brave search returns source URLs. Firecrawl supplies configured search/scrape behavior. Requests have a 45-second timeout and a 2 MiB response limit. A five-request Firecrawl concurrency limit queues excess calls and cancellation releases queued work. Missing credentials or API errors are returned as tool errors, not fabricated search results.

## Failure conditions

Stale refs, an unavailable page, a closed browser, ongoing browser operation or command timeout can prevent browser action. Login, MFA, CAPTCHA and site-specific UI changes may require manual interaction. Having network access alone does not solve those interactions.

Service tools need keys, network access and provider availability/quota. They accept supported public URLs, not arbitrary local addresses. Browser content and remote source data are bounded; neither tool promises to read every page/file type.

Firecrawl answers HTTP 403 for sites it does not scrape; that is reported as an unsupported site, not a rejected key.

## Verification

[built-in browser](../../test/embedded-browser-electron.cjs).

