# Automations and schedules

## How it works

An automation is a saved recurring prompt with a folder, model/provider binding and schedule. [scheduler.cjs](../../src/scheduler.cjs) validates records, calculates due times and runs one routine at a time. [schedule-management.cjs](../../src/schedule-management.cjs) handles chat-created/edited schedules; main.cjs supplies the matching UI operations.

Two repeating schedules are supported: elapsed intervals from 1 to 10,080 minutes, or a PC-local HH:MM time on selected weekdays (0 Sunday through 6 Saturday). There is no cron parser or dedicated one-time reminder scheduler.

The foreground scheduler polls every 15 seconds. With the event runtime active it publishes automation.due; [EventRuntime](../../src/event-runtime.cjs) starts the saved routine. The controller sends its prompt into the continuous public conversation with automation origin metadata, waits for the turn to finish and preserves the user's conversation title/mode/working objective. It does not teach the saved prompt as a new personal fact.

Chat-tool creation defaults to disabled unless enabled:true is supplied. Enable/resume authorizes scheduled work; Run can execute a saved routine now. Global Pause all and a mismatched saved connection prevent autonomous starts. Scheduled runs receive the read-only Little Bot dynamic tools: skill lookup, recall and calendar_list. Direct-chat management, browser and web-service dynamic tools are not included. Native terminal/file/MCP capabilities are configured separately. A saved prompt alone cannot create a missing integration.

## Due times, busy work and reopening

If the app remains open but the shared lane is busy, due work waits. On reopening after the app was closed, [missed-schedules.cjs](../../src/missed-schedules.cjs) advances overdue enabled routines to a future occurrence without running the missed occurrence. File triggers and calendar thresholds also baseline closed-app history. If the PC sleeps while the process stays alive, due work may attempt once after wake.

There is no Windows service, tray worker or wake-from-sleep scheduler. Notification delivery is not scheduling, and seeing a saved routine does not imply its model is connected.

The controller's base agent instructions still say to run once after a missed exact schedule, contradicting the actual reopen policy and current bundled skill. This is R5 in the [review](review.md); the implementation behavior above is the source of truth.

## Failure paths

Offline/provider failure records an error and advances the next schedule; the scheduler does not guarantee retrying that same occurrence immediately. Unselected saved connection waits. schedule_manage refuses edits to a running routine, and deletion is refused while running. The UI edit path lacks the equivalent check (R6).

Failed schedule persistence can leave an enabled routine in memory (R2). An event-triggered long routine also holds event dispatch until its model turn resolves (R4). See the [review](review.md).

