# In-process events and standing intents

Little Bot has a bounded event queue inside the existing Electron main process. It normalizes activity that already happens while the application is open and lets a **standing intent** connect a matching event to an existing authorized goal or automation.

This is not a gateway or background service. It does not open a network port, expose a webhook, add a tray worker, create another agent, or continue after Little Bot closes.

## Lifecycle contract

```text
Little Bot open
→ timers and watched goals may publish events
→ one bounded in-memory queue dispatches them sequentially
→ a matching standing intent may queue one authorized goal or automation

Little Bot closed
→ no timers
→ no watchers
→ no event collection
→ no queue
→ no model calls or actions
```

Closing the application clears queued events. They are not saved for replay.

When Little Bot opens again:

- an overdue enabled automation advances to its next future occurrence without running the missed occurrence;
- an overdue enabled heartbeat advances to its next future check;
- an authorized queued interval goal advances to its next future step;
- a file-triggered goal records a fresh foreground-session baseline, so file changes made while Little Bot was closed do not wake it;
- a standing intent left in `matched` or `queued` state is recorded as `skipped`, not replayed.

If the application stays open but the one execution lane is busy, due work waits until the lane is available. If the PC sleeps while the process remains open, timers resume with the process and may make one due attempt after wake. That is different from reopening a closed application.

## Event envelope

Internal events use a normalized shape:

```js
{
  id,
  type,
  source,
  occurredAt,
  availableAt,
  expiresAt,
  priority,
  payload,
  dedupeKey,
  debounceKey,
  debounceMs,
  correlationId,
  causationId,
  intentTrace,
  depth
}
```

`correlationId` and `causationId` preserve the local chain of events. `intentTrace` records which standing intents caused later goal or automation activity, preventing an intent from triggering itself indirectly.

The queue is operational state only. It is never written to the saved app state.

## Queue behavior

- At most **100** events may be queued.
- An event payload is limited to **64 KiB** of JSON.
- Priority ranges from **-10** to **10**.
- Dispatch is sequential, including subscription handlers.
- A debounce key replaces an older queued event with the newest observation.
- A dedupe key suppresses recent duplicates; the event runtime uses a 10-second default window.
- Events may expire before they are handled.
- Causal depth is limited to **12**.
- Repeated causal signatures and standing-intent ancestry stop event loops.
- Handler failures are reported without preventing later matching handlers from running.
- Stopping the foreground event runtime clears pending events immediately.

## User-selectable events

The Standing Intents editor exposes these foreground events.

| Event | Source | Main payload fields |
| --- | --- | --- |
| `app.opened` | `app` | `openedAt` |
| `file.changed` | `goal.runner` | `goalId`, `name`, `workspace`, `path`, `paths`, `fingerprint`, `previousFingerprint` |
| `calendar.created` | `calendar` | `eventId`, `title`, `startAt`, `endAt`, `allDay`, `location` |
| `calendar.updated` | `calendar` | same calendar fields |
| `calendar.deleted` | `calendar` | same calendar fields |
| `calendar.event_approaching` | `calendar` | calendar fields plus `horizonMinutes`, `minutesUntil` |
| `goal.queued` | `goal.runner` | `goalId`, `name`, `workspace`, `queuedAt` |
| `goal.completed` | `goal.runner` | `goalId`, `name`, `workspace`, `runId`, `summary`, `completedAt` |
| `goal.blocked` | `goal.runner` | `goalId`, `name`, `workspace`, `reason`, `blockedAt` |
| `goal.question_answered` | `goal.runner` | `goalId`, `name`, `workspace`, `questionId`, `answeredAt` |
| `automation.started` | `scheduler` | `automationId`, `name`, `workspace`, `startedAt` |
| `automation.completed` | `scheduler` | `automationId`, `name`, `workspace`, `finishedAt` |
| `automation.error` | `scheduler` | automation fields plus `error` |
| `chat.completed` | `chat` | `chatId`, `title`, `workspace`, `automationId`, `status`, `finishedAt` |
| `chat.failed` | `chat` | chat fields plus `error` |
| `heartbeat.alert` | `heartbeat` | `status`, `summary`, `topic`, `actions`, `workspace`, `finishedAt` |
| `heartbeat.error` | `heartbeat` | same heartbeat fields |

Calendar approach events use three local thresholds: **24 hours**, **60 minutes**, and **15 minutes** before the event.

`file.changed` is not a general Windows file watcher. It is emitted only by an existing goal whose trigger is **File changes**. The `paths` field contains that goal's configured watched paths; `path` is the first configured path and is intended for simple filters. It does not identify the exact changed child when a watched directory contains several files.

The runtime also uses internal events such as `automation.due`, `heartbeat.due`, `heartbeat.started`, `heartbeat.quiet`, and `standing_intent.action`. These coordinate existing features and are not offered as standing-intent sources.

## Creating a standing intent

Open **Automations → Standing intents → New standing intent**.

A standing intent contains:

1. **Name**
2. **Event type**
3. Optional **source**
4. Optional deterministic payload condition
5. **Action target**
6. **Debounce**
7. **Priority**
8. Enabled state

The editor currently exposes one optional condition. The persisted engine format supports up to eight conditions, all of which must match.

Supported operators:

- `equals`
- `does not equal`
- `contains`
- `starts with`
- `matches wildcard`
- `exists`

Filter paths are relative to `payload`. Entering `path` becomes `payload.path`; entering `horizonMinutes` becomes `payload.horizonMinutes`.

Standing intents do not run arbitrary prompts. Their actions are deliberately limited to:

- **Run an authorized goal**
- **Run an authorized automation**

Run the target once through its normal panel before enabling an intent for it. That establishes its existing folder, model, connection, permissions, and other saved settings. A standing intent does not expand those settings.

There is currently no agent tool for creating or editing standing intents. Configure them in the Automations panel; do not edit `state.json`.

## Action lifecycle

A matching intent records these operational states:

```text
matched
→ queued
→ completed | error | skipped
```

When the single execution lane is temporarily busy, an intent action can retry every 15 seconds, at most 20 times, while the same foreground app session remains open. Closing Little Bot discards those retries. A debounced or waiting action resolves the intent's current saved target when it executes, so editing or disabling the intent does not launch a stale target.

An intent's ID travels through the goal or automation it launches. Events caused by that work retain the ancestry, so the same intent cannot react to its own downstream completion and form an indirect loop.

At most ten standing intents are evaluated for a single event. The application stores at most 50 standing intents.

## Examples

### Review a changed report

```text
Event: file.changed
Condition: path matches wildcard reports/*.csv
Action: Run goal · Review report
Debounce: 30 seconds
```

The target goal must already use a File changes trigger that watches the report path.

### Prepare for a meeting

```text
Event: calendar.event_approaching
Condition: horizonMinutes equals 60
Action: Run automation · Prepare meeting notes
```

The local event must exist in Little Bot's calendar. External calendar synchronization is not included.

### Continue after another goal

```text
Event: goal.completed
Condition: goalId equals <saved-goal-id>
Action: Run goal · Summarize the result
```

Dependencies inside Goals remain the better choice when one finite goal strictly depends on another. A standing intent is useful when the reaction should remain a separately managed routine.

## Current limits

- No external event sources, inbox listener, webhook, socket, or remote-control endpoint.
- No semantic or model-evaluated event condition; matching is deterministic.
- No background collection while Little Bot is closed.
- No replay of a closed-app backlog.
- No parallel actions or additional agent loop.
- No standing-intent management tool for the agent.
- No generic OS-wide file watcher outside configured file-triggered goals.

## Validation

Phase 2 includes focused tests for queue bounds, ordering, debounce, dedupe, expiry, causal depth, direct and indirect loop prevention, foreground start/stop, schedule advancement, calendar thresholds, standing-intent persistence, goal and automation actions, file-session baselines, and renderer form logic.

The Windows CI path also exercises the real Electron Standing Intents form and the complete retained Electron integration suite.
