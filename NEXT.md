# Possible next additions

Keep additions driven by actual use. Little Bot remains a foreground-only, single-agent Windows application: closing the program stops every timer, watcher, model call, and action.

Independent Check is implemented. See [INDEPENDENT-CHECK.md](INDEPENDENT-CHECK.md) for its Selective, Always, Off, and manual Challenge behavior.

1. **In-process events and standing intents.** Normalize scheduler, heartbeat, file, calendar, chat, and goal events inside the existing process. Use one bounded queue and the current single execution lane. Do not add a gateway, listener, tray worker, or closed-app backlog.
2. **Plan and evidence ledger.** Give each goal a versioned sequential plan, assumptions, observations, and decisions that survive restart and compaction. Exactly one plan step remains active at a time.
3. **Windows UI Automation.** Add inspectable foreground control of native Windows applications through the accessibility tree, with one action between observations and screenshots only as fallback.
4. **Provider usage display.** Show reliable provider limits or local performance when available; existing token, time, and action budgets remain independent of a pricing service.

## Deliberate non-goals

- No daemon, gateway, startup service, tray worker, remote-control endpoint, or execution while the app is closed.
- No subagents, parallel workers, swarms, or second agent loop.
- No extra physical memory layer, vector database, marketplace, or automatic plugin update system unless a concrete use case later requires one.
