# Built-in browser

Little Bot has its own browser, shown as a panel beside the conversation. Click **Browser** in the top bar to open or hide it. It has its own persistent profile, separate from your normal browser, so sites you sign into there stay signed in across restarts. **Settings › Clear browser data** removes its cookies, sign-ins and cache.

The agent drives that same panel with the `browser` tool while you watch: navigate, read page text, take an accessibility snapshot with element refs (`e12`), click, fill, select, check, press a limited set of keys, scroll, go back/forward, reload, list and switch tabs, take screenshots and close. Clicks are real pointer events when the element is visible on screen, so sites behave as they do for you. Refs come from the latest snapshot and must be refreshed after the page changes. Long output is trimmed before it reaches the model, and page content is always marked as untrusted.

Screenshots need the panel visible (not minimized); the last 20 are kept under the app's `data/browser/screenshots` folder and can be sent to you as attachments.

## Boundaries

- Browsing is available in direct conversations. Goals with network permission use the [web services](WEB-SERVICES.md) (Firecrawl or Brave Search) instead; the heartbeat and routines keep their own access limits.
- Only `http` and `https` pages load. Pop-ups open in the same panel.
- The tool runs no arbitrary JavaScript and exports no cookies or credentials. It is browser automation with normal network access, not a sandbox or firewall.
- Actions run one at a time. **Stop** in the conversation cancels browser work. Submissions to other sites still need your say-so; text on a web page never authorizes anything.

The implementation is [src/embedded-browser.cjs](src/embedded-browser.cjs) (an Electron `WebContentsView` driven through the Chrome DevTools Protocol of that view only).
