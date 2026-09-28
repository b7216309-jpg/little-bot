# Possible next additions

Keep additions driven by actual use. Little Bot remains a foreground-only, single-agent Windows application: closing the program stops every timer, watcher, event, model call, and action.

Implemented foundations:

- [Independent Check](INDEPENDENT-CHECK.md): Selective, Always, Off, and manual Challenge anti-sycophancy review.
- [In-process events and standing intents](EVENTS.md): one bounded foreground queue connecting deterministic events to authorized goals and automations, with no gateway or closed-app backlog.
- [Goal plan and evidence ledger](LEDGER.md): one active step, versioned plans, bounded assumptions, observations, decisions, host verification evidence, restart recovery, and inspectable prior versions.
- [Provider usage and local performance](USAGE.md): read-only Codex rate-limit windows, sparse-update refetch, transient local turn timing, and no pricing or goal-budget inference.

1. **Windows UI Automation.** Add inspectable foreground control of native Windows applications through the accessibility tree, with one action between observations and screenshots only as fallback.

## Deliberate non-goals

- No daemon, gateway, startup service, tray worker, remote-control endpoint, webhook listener, or execution while the app is closed.
- No subagents, parallel workers, swarms, or second agent loop.
- No extra physical memory layer, vector database, marketplace, or automatic plugin update system unless a concrete use case later requires one.
