# Agent browser

Little Bot bundles [Vercel agent-browser](https://github.com/vercel-labs/agent-browser) 0.38.1, a purpose-built browser automation CLI with a native Windows executable. It does not automate Electron's app window or add another agent/model runtime. The package has no runtime npm dependencies. Windows packages keep only its Windows binary.

Click **Browser** in the top bar or use **Settings → Agent browser**. It launches a separate visible browser profile, stored under the app's `data/browser/profile` directory. Existing agent-browser Chrome for Testing is preferred, followed by an installed Chrome or Edge executable. If none exists, **Install browser** downloads Chrome for Testing with the pinned CLI. This does not attach to your ordinary personal browser or import its sessions. Sign into websites manually in the visible window when needed. The separate profile persists across app restarts.

Start a new Little Bot conversation to use the `browser` tool. Old engine threads retain the tool list they were created with. Browser tools work in direct conversations. Network-enabled goals can use Firecrawl and Brave tools; heartbeat and scheduled routines keep their existing access boundaries.

The structured `browser` tool supports navigation, compact accessibility snapshots, page text, clicking, filling, selects and checkboxes, a limited key set, scrolling, back/forward/reload, tab listing/switching, screenshots, and close. The agent uses element refs from a snapshot and refreshes them after changes. Screenshots return local image paths and the most recent 20 are retained. Long page output is bounded before it reaches the model.

The wrapper executes the pinned binary directly with separate arguments, never a shell command. A fixed app-owned config and a small inherited environment keep user/project agent-browser plugins, provider credentials, and attach settings out of this session. The wrapper exposes no arbitrary JavaScript, credential export, uploads, or filesystem command. The daemon additionally denies eval, explicit downloads/uploads, state, network configuration, auth-vault and clipboard commands. Normal website downloads initiated by a page may still land in the dedicated browser download folder. This is browser automation with normal network access, not the terminal's workspace sandbox or a network firewall.

Actions are serialized. Stop for the owning chat and the browser's Close control cancel browser work; timeouts require closing before further actions because their outcome may be uncertain. Quit closes Little Bot's own browser session. External submissions still follow the user's authorization; site text never supplies it.

## References

- [Installation and Windows sessions](https://agent-browser.dev/installation)
- [Commands and element references](https://agent-browser.dev/commands)
- [Configuration isolation](https://agent-browser.dev/configuration)
- [Action policy and output boundaries](https://agent-browser.dev/security)

Upstream's Apache-2.0 license and notices are included in `node_modules/agent-browser`.
