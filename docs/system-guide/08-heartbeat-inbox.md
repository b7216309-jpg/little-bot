# Heartbeat, attention and inbox

## How it works

[Heartbeat](../../src/heartbeat.cjs) performs small proactive checks from a saved checklist; it does not own an ongoing goal's full review. It polls every 15 seconds and honors enable state, nonempty checklist, interval, PC-local active hours, maximum daily runs, global pause and execution-lane availability. Active hours can cross midnight; equal start/end represents all-day availability.

[Controller.runHeartbeat](../../src/controller.cjs) creates an ephemeral engine thread in cache slot 2. It supplies current time, checklist, relevant profile/memory, recent local heartbeat summaries, goal state and attention preferences. Read-only Little Bot recall/skill/calendar tools are available. Native execution is workspace-write with network disabled, and MCP is disabled and verified for this thread. Therefore a checklist needing remote APIs or a GitHub action cannot simply use ordinary chat's integrations.

The final result is parsed as quiet or alert with summary/topic. A quiet result stays quiet. Actual recorded file changes force an alert so the app does not hide work performed before the final response. Parsing/provider failures preserve recorded actions and enter a bounded retry/backoff path.

## Wild initiative

Heartbeat has two initiative levels. **Calm** is the behavior above. **Wild** changes four things:

- **Agenda.** The agent keeps `agenda.md` in the working folder as its own backlog. Edits to that file do not force an alert.
- **Wider access.** It runs at medium effort or higher with network access. It can save memories and manage the calendar, routines and draft goals.
- **Its own schedule.** Each run returns a reason and `wakeInMinutes` (clamped to 5–240), which replaces the fixed interval for the next run.
- **Pressure to act.** After two or more quiet runs in a row, the prompt asks for one concrete move.

Turning wild on schedules a check within a minute. Presence events (`app.opened`, `user.returned` after 90 minutes away, and `chat.completed`, debounced to 10 minutes) pull the next check forward and tell the agent why it woke. New wild alerts also appear in the conversation as "Little Bot · on its own" messages, but only when the chat is idle.

The agent can also plan one-time check-ins with the `followup_manage` tool, from the wild heartbeat or a direct conversation. A follow-up can be due up to 30 days ahead, and at most 20 can be pending. When one is due, the heartbeat wakes with its note as the reason. Active hours and the daily run cap still apply. Follow-ups require wild initiative to be enabled.

Every finished run, including quiet ones, is kept in a bounded `pulse` log (30 entries) shown under Latest check. Small local models that wrap their JSON in `<think>` tags or Markdown fences are parsed instead of failing. Pause all, active hours and the daily run cap still apply.

## Inbox and notification delivery

Heartbeat history is also the inbox backing store for goal notifications. [attention.cjs](../../src/attention.cjs) tracks stable subjects, Useful / Later / Dismiss feedback, snooze/mute state, pending deliveries and daily alert limits. Goal subjects use the goal ID; other subjects use normalized topic/workspace keys.

An inbox record and a Windows notification are different outcomes. Notifications require platform support, available attention budget, no global pause and the app not currently focused/busy. Pending delivery can occur later without running the model again. Read/unread and filtering are renderer controls over saved records.

## What can prevent operation

App closed/asleep, disabled heartbeat, empty checklist, active hours, daily run cap, paused autonomy, missing workspace, offline or unselected model, other work, repeated invalid JSON, muted subject, snooze, daily notification cap or unavailable Windows notifications.

Manual Run bypasses enable/hours checks but still honors daily run limits and lane readiness. A quiet check is a successful outcome, not a new advice message. Full coaching reviews belong to the goal system.

Event-runtime-triggered checks currently hold the whole event dispatch lane until the heartbeat finishes (R4 in the [review](review.md)). This can delay unrelated intent matching even when those events do not need the model.

## Verification

[Heartbeat](../../test/heartbeat.test.cjs), [controller heartbeat](../../test/controller-heartbeat.test.cjs), [event producers](../../test/event-producers.test.cjs) and [inbox/UI behavior](../../test/qol-electron.cjs). Tests cover quiet/alert parsing, action recording, caps, hours, persisted attention and interruption. They do not prove that Windows delivered a real toast.
