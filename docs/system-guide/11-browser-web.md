# Browser and web

## Built-in browser

[EmbeddedBrowser](../../src/embedded-browser.cjs) is a WebContentsView inside the main window. The renderer reserves a side panel (`#browser-panel`) and reports the viewport rectangle; main lays the native view over it. While a dialog is open, the view steps aside. The page uses its own persistent partition (`persist:little-bot-browser`), so sign-ins survive restarts until Settings › Clear browsing data. The session denies permission requests and downloads, opens only http(s), loads target=_blank links in the same tab, and presents a plain Chrome user agent.

The agent tool supports navigate, snapshot, read, ref-based click/fill/select/check, approved keys, scroll, back/forward/reload, tabs/switch (one tab), screenshot and close. It is driven through the Chrome DevTools Protocol of that view only; the app's own window is never attached:
- Snapshots come from the accessibility tree, and the @eN refs map to DOM nodes.
- Clicks and key presses use native input only when the page is visible and its window is focused; inactive windows use DOM actions.
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

[WebServices](../../src/web-services.cjs) supplies the keyless `web_search_service` and `web_scrape` tools; see [WEB-SERVICES.md](../../WEB-SERVICES.md). Search fans out to DuckDuckGo, Bing and Yahoo result pages through Electron's network stack (own partition, not the browser profile), fuses and ranks the results, and adds the best passage of the top pages. `queries` (up to 10) and `urls` (up to 10) run in parallel. Reading tries a direct fetch, then a hidden browser render for JavaScript sites, then the public reader service r.jina.ai; PDFs are supported. Direct chat can use the tools; goals require their saved network permission. Heartbeat has network disabled.

Results are cached for 30 minutes and pages for 6 hours. An engine that rate limits is paused for 2, 10, then 30 minutes. Local and private addresses are refused before and after every redirect, and each redirect target's name is looked up first, so a public name that points at this PC (`localtest.me`) is refused too. The web partition also refuses every request a rendered page makes (scripts, frames, sockets) to a local or private address. Failures are returned as tool errors, not fabricated results.

## Failure conditions

Stale refs, an unavailable page, a closed browser, ongoing browser operation or command timeout can prevent browser action. Login, MFA, CAPTCHA and site-specific UI changes may require manual interaction. Having network access alone does not solve those interactions.

Web tools need network access and the engines being reachable. They accept public URLs, not local addresses. Browser content and remote source data are bounded; neither tool promises to read every page/file type. Engines are read as HTML pages, so a layout change on their side shows up as "unrecognized page" until the parser is updated.

Pages behind a sign-in or a human check (CAPTCHA) fail every reading tier or come back nearly empty with a `note`; the error says which tiers were tried and the agent falls back to the browser tool. JavaScript checks that a normal browser passes on its own, such as Reddit's, are handled by the hidden browser tier, and Reddit posts and comments are rebuilt with their scores.

## Verification

[built-in browser](../../test/embedded-browser-electron.cjs).

