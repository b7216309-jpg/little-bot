# Events, standing intents and calendar

## Event routing

[EventBus](../../src/event-bus.cjs) is an in-process, bounded queue. It orders ready events by priority, supports debounce/deduplication and expiry, limits payload/causal depth and tracks drops/errors. The default queue holds 100 events. It is not a durable job broker.

[EventRuntime](../../src/event-runtime.cjs) connects scheduler and heartbeat due events, goal outcomes, automation outcomes, direct-chat completion, calendar thresholds and goal file-watcher changes. It matches saved [standing intents](../../src/standing-intents.cjs), which have an event type/source, filters, priority/debounce and an existing goal/automation action. Intent traces prevent direct and indirect self-trigger loops.

A target goal must already be authorized. An automation must have been enabled or run. A busy intent action can retry at 15-second intervals up to 20 times during this open session. Editing/disabling an intent before dispatch uses its current saved target, not stale queued arguments. A goal's completed/reviewed/blocked/paused/removed event settles pending intent status; automation completion/error does likewise.

Stopping the runtime clears queued events. Pending actions are not replayed after reopening. Event handlers currently await entire automation/heartbeat runs, holding dispatch while the model works; priority does not preempt the active handler. The delayed matching/overflow reproduction is R4 in the [review](review.md).

## Calendar

[calendar.cjs](../../src/calendar.cjs) validates local dates, titles, all-day/timed events and intervals. Main's save/delete handlers update the Store and publish created/updated/deleted events after saving. Events are stored locally; there is no Google/Outlook/CalDAV sync.

Dates entered by UI/tools use the PC's local timezone. Calendar approach thresholds are 24 hours, one hour and 15 minutes. Startup baselines thresholds already passed rather than replaying historical reminders. A new or updated event also baselines already-passed thresholds: creating an event ten minutes before its start does not retroactively emit its 15-minute approach event, although calendar.created still emits.

calendar_list is available to active tasks, including goals and heartbeat. calendar_manage supplies direct-chat create/update/delete; the UI uses corresponding IPC handlers. The list tool is bounded to 200 entries per request. The goal's initial eight-event excerpt does not remove the ability to query additional events.

## What can prevent operation

Disabled intent, unmatched source/filter, unauthorized/missing target, busy lane, global pause, saved binding mismatch, loop suppression, debounce/dedupe, queue overflow, expiry or app closure. file.changed comes only from an existing file-triggered goal, not a general Windows watcher.

A calendar entry is data, not automatically a reminder or appointment booking. A standing intent or appropriate check must act on its event. Disk failures can change the live calendar without emitting its change event (R2), leaving intent consumers unaware.

