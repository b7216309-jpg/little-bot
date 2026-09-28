# Possible next additions

Keep additions driven by actual use. Little Bot remains a foreground-only, single-agent Windows application: closing the program stops every timer, watcher, event, model call, and action.

Implemented foundations:

- [Independent Check](INDEPENDENT-CHECK.md): Selective, Always, Off, and manual Challenge anti-sycophancy review.
- [In-process events and standing intents](EVENTS.md): one bounded foreground queue connecting deterministic events to authorized goals and automations, with no gateway or closed-app backlog.

1. **Plan and evidence ledger.** Give each goal a versioned sequential plan, assumptions, observations, and decisions that survive restart and compaction. Exactly one plan step remains active at a time.
2. **Windows UI Automation.** Add inspectable foreground control of native Windows applications through the accessibility tree, with one action between observations and screenshots only as fallback.
3. **Provider usage display.** Show reliable provider limits or local performance when available; existing token, time, and action budgets remain independent of a pricing service.

## Deliberate non-goals

- No daemon, gateway, startup service, tray worker, remote-control endpoint, webhook listener, or execution while the app is closed.
- No subagents, parallel workers, swarms, or second agent loop.
- No extra physical memory layer, vector database, marketplace, or automatic plugin update system unless a concrete use case later requires one.
