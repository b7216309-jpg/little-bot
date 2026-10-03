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

Turning wild on schedules a check within a minute. Presence events (`app.opened`, `user.returned` after 90 minutes away, and `chat.completed`, debounced to 10 minutes) pull the next check forward and tell the agent why it woke.

The agent can also plan one-time check-ins with the `followup_manage` tool, from the wild heartbeat or a direct conversation. A follow-up can be due up to 30 days ahead, and at most 20 can be pending. When one is due, the heartbeat wakes with its note as the reason. Active hours and the daily run cap still apply. Follow-ups require wild initiative to be enabled.

Every finished run, including quiet ones, is kept in a bounded `pulse` log (30 entries) shown under Latest check. Small local models that wrap their JSON in `<think>` tags or Markdown fences are parsed instead of failing. Pause all, active hours and the daily run cap still apply.

## Delivery into the conversation

The Activity inbox is a tracking log. Every new heartbeat alert, Calm or Wild, is delivered into the conversation as a "Little Bot · on its own" message. Goal results with the chat source arrive the same way. If a turn is running, waiting for approval, or under Independent Check, the message waits in the chat's outbox. That outbox is saved with the encrypted conversation, holds up to 20 messages, and is flushed when the turn finishes or the app starts.

The engine thread never contains these messages. The next user message therefore carries, once, every proactive message the model has not yet seen, so a reply such as "yes, do that" has its context. Scheduled automation turns do not consume this bridge.

## Buttons, awareness, watches and offers

**Buttons.** Heartbeat, goal and web-watch messages in the chat carry three buttons: ✅ Do it, ⏰ Later and ✖ Not interested. Goal questions keep their own answer form.
- An answer is recorded once, in a bounded reaction log (`feedbackLog`, 200 entries).
- Heartbeat answers also update the inbox attention preferences.
- ✅ sends a follow-up user turn when the chat is idle.
- Every heartbeat and chat prompt lists the latest reactions, and the self-review goal reads them as evidence.

**Activity awareness** ([activity.cjs](../../src/activity.cjs)) is off by default. Turned on in the Heartbeat panel, it samples the foreground app name and window title every 20 seconds through one PowerShell process, and idle time through Electron.
- Samples stay in memory. They reach prompts only while the setting is on.
- `activity.app_started` fires when an app has stayed in the foreground for two minutes, at most once per 30 minutes per app.
- `activity.long_session` fires after three hours, and `user.returned` after 90 minutes idle.
- These events pull a Wild heartbeat forward, with the reason.

**Web watches** ([web-watch.cjs](../../src/web-watch.cjs)) are pages that the user, the chat model or a Wild heartbeat register with `web_watch`. Each is checked every 6–168 hours while the app is open.
- Only public http(s) addresses are allowed. Redirects are followed by hand, and every hop is rechecked.
- The first check is a baseline. A later change posts a "web watch" message with the new text.

**Games and offers.** [steam-library.cjs](../../src/steam-library.cjs) backs the read-only `games_list` tool: installed games with last-played date and playtime, available everywhere read tools are. `launch_propose` posts a message with a ▶ Launch button. Only an installed game's `steam://rungameid/<id>` target is accepted, and nothing starts without the click.

A Wild heartbeat may also manage standing intents (event rules) through `standing_intent_manage`. Other hidden work stays out of app management.

## Inbox and notification delivery

Heartbeat history is also the inbox backing store for goal notifications. [attention.cjs](../../src/attention.cjs) tracks stable subjects, Useful / Later / Dismiss feedback, snooze/mute state, pending deliveries and daily alert limits. Goal subjects use the goal ID; other subjects use normalized topic/workspace keys.

An inbox record and a Windows notification are different outcomes. Notifications require platform support, available attention budget, no global pause and the app not currently focused/busy. Pending delivery can occur later without running the model again. Read/unread and filtering are renderer controls over saved records.

## What can prevent operation

App closed/asleep, disabled heartbeat, empty checklist, active hours, daily run cap, paused autonomy, missing workspace, offline or unselected model, other work, repeated invalid JSON, muted subject, snooze, daily notification cap or unavailable Windows notifications.

Manual Run bypasses enable/hours checks but still honors daily run limits and lane readiness. A quiet check is a successful outcome, not a new advice message. Full coaching reviews belong to the goal system.

Event-runtime-triggered checks currently hold the whole event dispatch lane until the heartbeat finishes (R4 in the [review](review.md)). This can delay unrelated intent matching even when those events do not need the model.

## Verification

[Heartbeat](../../test/heartbeat.test.cjs).

