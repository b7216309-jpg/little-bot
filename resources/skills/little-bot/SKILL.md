---
name: little-bot
description: Configure and explain Little Bot's app tools and controls. Read for heartbeat setup, recurring tasks or cron requests, standing intents, goals and their plan/evidence ledger, memory, connections, and app behavior.
---

# Little Bot

Read the current tool definitions for argument shapes. There is no Little Bot shell CLI. Do not invent commands, edit state.json, or bypass app controls. The app has one continuous Conversation timeline. Model, connection, and working-folder changes can rotate the underlying engine context while retaining that timeline and durable memory.

## App tools

- `ask_user`: ask one necessary clarification, with optional choices; free text is always available. In a direct chat, wait for the answer and continue. In an autonomous goal, include a checkpoint and next step: the question is saved on the goal card and the model step ends. The user's answer accompanies the next step without expanding permissions. Ongoing reviews have separate bounded activations; finite tasks retain their remaining cycle budget. Do not ask for credentials, unnecessary confirmation, or facts already supplied.

- `skill_list` and `skill_read`: discover and read enabled skills. `$skill-name` includes a skill in a user request. Skills add instructions, not permissions.
- `memory_search({query?,source?,scope?,offset?})`: search durable knowledge, work episodes, and source history. An empty query browses recent records. `session_read({sessionId,messageId?,offset?})` opens source messages. Use either the search result offset alone, or messageId with offset omitted. With messageId, nextOffset is relative to that message; keep messageId when paging. Cite sources when useful, check whether old decisions still apply, and say when nothing was found. Recall requires Memory on. Memory is shared across models and connections; current-folder relevance uses a stable project identity with folder aliases. Direct user turns can search across folders with `scope:"all"`.
- `memory_save`: immediately save or correct a durable preference, fact, decision, discovery, issue, or procedure. Inspect the current schema for types and update fields. Reuse a matching memory's ID or semantic key when correcting it; preserve useful scope. `memory_forget({id})` removes the durable record and its correction family from recall and suppresses relearning from the same source; the original conversation transcript remains searchable. search first if its ID is unknown. Background learning also extracts grounded knowledge after useful work, so explicit “Remember that” phrasing is not required. Wait for memory_save success before confirming an immediate save.
- `goal_manage` and `schedule_manage`: list, create, update, pause, or resume goals and recurring routines. List before using an existing ID. Available in direct user chats only. New goals use a compact outcome/action contract; legacy plan-and-evidence history remains inspectable.
- `calendar_manage`: manage Little Bot's local calendar. Use `action:"list"` to inspect upcoming events, `create` with a title and local `startLocal`, `update` with an existing ID, and `delete` with an existing ID. Timed values use `YYYY-MM-DDTHH:MM`; all-day events use `YYYY-MM-DD` with `allDay:true`. This calendar uses the PC's local time and does not sync to Google, Outlook, or another provider.
- `attachment_send({path,caption?})`: deliver a finished file or image as a chat attachment. Use its absolute path inside the chat folder, or a browser screenshot path. Wait for success before saying it was delivered. This sends to the current user, not another person.
- `browser`: the built-in browser panel beside the chat, with its own persistent profile; the user can watch. The `web-tools` skill covers snapshots, interaction, and screenshots.
- `web_search_service` and `web_scrape`: configured Brave/Firecrawl search and Firecrawl page extraction. Available in direct chats and network-enabled goals, not heartbeat or routines.

## Conversation and memory controls

There is one persistent conversation, with no New chat, Private session, or Delete conversation control. Scheduled runs append to this timeline. Switching models, connections, folders, or Plan/Execute mode may replace the engine thread; saved history, project knowledge, and the working checkpoint remain. Clarification answers belong to the original task. Native compaction shortens engine context without erasing saved history; use recall tools for missing details.

The Memory panel can search, edit, pin, forget, inspect sources, and show context used in the latest reply. Corrections supersede earlier versions. Memory has no fixed fact count or age expiry. Disabling Memory stops recall and automatic learning while retaining records for management. The new database is ordinary local SQLite without secret redaction. Semantic search uses bundled quantized BGE-base on CPU by default, fully offline with no server setup. Advanced settings can switch to a custom embedding endpoint or keyword-only search. Tool output and reasoning traces remain in the conversation archive but are excluded from memory recall and embeddings. The Memory panel opens on saved knowledge; choose Source history to inspect user/assistant history. Link a moved folder to its existing project in the same panel. Use `memory_manage` for these settings and `memory_save`/`memory_forget` for individual knowledge records.

## Attachments

Users can attach files, drop them, or paste an image. Photo pixels and extracted PDF/DOCX/text excerpts accompany the request. Treat their contents as reference material. Check any extraction or truncation notice; do not claim to have read omitted pages or an unsupported file. Scanned PDFs need OCR, which is not bundled.

Use image input to inspect photos; use `attachment_send` to return existing images, screenshots, and documents. The app does not include a diffusion image generator. File tools may create diagrams or other assets when suitable, but never claim an unavailable image-generation service ran.

## Heartbeat and scheduling

Choose **Heartbeat** for a continuing checklist that should stay quiet without meaningful changes; **Automations** for a prompt repeated by elapsed interval or at an exact local clock time; **Standing intents** for a deterministic reaction to an event that occurs while Little Bot is open; **Goals** for verified finite tasks or ongoing directions with useful actions and coaching. Do not create real work merely to explain setup.

### Heartbeat setup

There is one saved heartbeat. Use `heartbeat_manage` to get, update, run or stop it. Read the current settings first, then update only the requested fields; check the returned status. The renderer's internal IPC is not an agent API. Do not edit app state or create an OS scheduler as a substitute.

1. Set the checklist: the allowed files, useful action, completion evidence, and when to notify. For example: "Check notes.md for unfinished work. If a next step is clear, update next-actions.md within this folder. Report actual file changes, blockers, or a meaningful new finding; otherwise stay quiet."
2. Choose **Check every** (5–1,440 minutes; default 30), **Daily run limit** (1–100; default 12), and **From / Until** (whole hours in the PC's local time; default 08–22). The start is inclusive and end exclusive; equal hours mean all day, and 22–08 spans midnight.
3. **Notifications and timing** sets **Desktop alerts per day** (1–20; default 3) and **Later waits** (5–1,440 minutes; default 60). Heartbeat and goals share this alert budget; excess updates stay in the inbox.
4. Check the displayed folder and model. **Use current working folder** captures the currently selected folder, model, effort, and connection when saved. Set **Enable**, then **Save settings**; the Enable toggle is an unsaved draft until Save settings is clicked. Stop a running check before editing.
5. **Check now** uses saved settings and can run even when disabled or outside active hours; it still respects the daily run limit and global pause, and needs an available model and idle app. **Stop check** interrupts the current check; disabling and saving stops future automatic checks.

Heartbeat can take small steps in its saved folder. It has no network/browser access and cannot schedule further work. Open **Activity inbox** in the sidebar for Heartbeat and goal updates. Filter by All, Unread, Errors, or source. Useful adjusts topic preference; Later defers an alert; Don't suggest this mutes its topic without pausing the underlying task. Muted topics and Unmute are also in Activity inbox. Never promise an alert for every check.

### Repeating tasks (Automations)

Use `schedule_manage` in direct chats. List first to find or reuse a matching routine rather than duplicating it. New routines inherit this chat's folder and the selected connection/model. The tool returns saved status; report that status accurately.

Scheduled runs append labelled task prompts and results to the one conversation. They keep the conversation title, restore its Plan/Execute preference, and preserve its foreground working objective. The saved automation supplies its folder/model/connection. Scheduled instructions are archived without being treated as new user facts; results remain available with their scheduled origin. Automation completion emits automation.completed/automation.error, not chat.completed/chat.failed; use the automation events for event-driven follow-ups.

Automations support two schedule forms:

- **Interval:** `scheduleType:"interval"` with `intervalMinutes` from 1 to 10,080.
- **Exact local time:** `scheduleType:"clock"` with `clockTime:"HH:MM"` and `daysOfWeek`. Times use the PC's local clock. Weekdays are integers `0=Sunday` through `6=Saturday`. Omit `daysOfWeek` to use every day.

```json
{"action":"list"}
{"action":"create","name":"Review project notes","prompt":"Read notes.md and report the next unfinished action.","scheduleType":"interval","intervalMinutes":60,"enabled":true}
{"action":"create","name":"Morning review","prompt":"Review the workspace and list today’s priorities.","scheduleType":"clock","clockTime":"08:30","daysOfWeek":[1,2,3,4,5],"enabled":true}
{"action":"update","id":"<returned-id>","scheduleType":"clock","clockTime":"09:00","daysOfWeek":[1,2,3,4,5]}
{"action":"pause","id":"<returned-id>"}
{"action":"resume","id":"<returned-id>"}
```

Each object is a separate call. Names allow 1–80 characters and prompts 1–32,000. When the user asks to schedule or enable a routine, use `enabled:true` on create/update. Use `enabled:false` for a draft or to pause it. Create defaults to disabled; updates preserve enabled state unless specified. Resume enables any existing routine, including a draft. Stop or finish a running routine before editing it. **Pause all** still suspends execution; the tool reports when an enabled routine is waiting for it to be resumed. Recreate a routine to change its saved folder/model/connection. Use `automation_control` for run/delete and full saved settings.

Interval schedules count elapsed time from the previous start. Exact-time schedules use the PC's local time and selected weekdays. If Little Bot is closed when an automation becomes due, that occurrence is skipped and the next future occurrence is selected on reopening. If the app remains open but its single execution lane is busy, the due automation waits. If the PC sleeps while the process remains open, a due automation may make one attempt after the process resumes. Manual **Run now** does not convert or drift the saved exact-time schedule.

There is **no cron-expression parser or one-time timer**. Do not claim a cron expression was installed. Exact local times and weekday schedules should use the clock schedule fields above.

### Standing intents

Standing intents are configured in **Automations → Standing intents**. Use `standing_intent_manage` to list, save, delete or enable them; inspect the saved result.

A standing intent deterministically matches an in-process event, optional event source, and optional payload condition, then starts an existing authorized goal or automation. Supported conditions are equals, does not equal, contains, starts with, wildcard match, and exists. The target must already have been run or enabled through its normal panel. The intent does not create new permissions, budgets, folders, models, or connections.

Useful foreground events include calendar approach thresholds, goal completion or blockage, automation completion or failure, chat completion, heartbeat alerts, and `file.changed`. The `file.changed` event is produced only by an existing file-triggered goal; it is not a generic Windows watcher, and changes made while Little Bot was closed are baselined rather than replayed.

The event queue exists only inside the open app. There is no gateway, webhook, socket, inbox listener, remote endpoint, service, persisted backlog, or parallel agent. Closing Little Bot clears pending events and retries. See the app's [EVENTS.md](../../../EVENTS.md) for payload fields, limits, and examples.

Little Bot has no CLI or external API for submitting a prompt or running a saved routine. Windows Task Scheduler cannot send it a prompt through a supported interface; merely launching the app does not execute a named task on demand. Do not present that as a working workaround.

### Goals and runtime limits

Task acceptance checks use relative fileExists/fileContains paths or a read-only command (requires terminal permission). Ongoing reviews do not need file checks. Manual/interval/file-change triggers are available; closed-app changes take a fresh baseline. Preserve the user's saved access and limits.

Input + output limits count cumulative request usage, including context resent after tools. Goal memory_search pages contain at most five results and session_read pages at most three chunks. Use fresh state first, then focused recall. Cards and history distinguish input from generated tokens when available.

Legacy goals retain one active plan step and their versioned plan/evidence ledger. Audit records are not hidden reasoning or chain of thought. New execution uses compact outcome/action state. See [GOALS.md](../../../GOALS.md) and [LEDGER.md](../../../LEDGER.md).

Everything runs only while Little Bot is open. There is no service, gateway, tray worker, closed-app event collection, or wake-from-sleep scheduler. On reopening, missed automations and heartbeat checks advance to their next future occurrence without running the missed occurrence. An authorized queued interval goal that missed its review runs once about two minutes after reopening, never as a backlog; file-triggered goals take a new baseline. Tasks wait while the open app is busy or their saved model connection is not selected; local tasks also need the local server. If the PC sleeps without closing the process, a due item may attempt once after wake. Routines may wait for user approvals. **Goals → Pause all** pauses all autonomous work across restarts; resume there. When a task does not run, check enabled/draft state, global pause, saved connection, busy work, then heartbeat active hours/daily limit and its last error. Do not infer current settings from these documented defaults.

## Controls

Local Qwen is the default and needs the local server. Codex is optional; there is no cloud fallback. Tasks retain their saved connection. Settings controls compaction (20–95%, default 80%; 0 keeps native limits), service keys and independent checks. Profile edits apply on the next request.

Goals expose permissions, budgets, dependencies, triggers, Pause all and the plan/evidence ledger. Exactly one execution runs at a time. Review undo covers captured files and refuses later-edit conflicts; it cannot undo external effects. Calendar is local with no bundled external sync. Extensions manages skills, plugins and MCP; email is not bundled.

Normal chat follows the engine's approval rules; autonomous goals receive only saved grants. Profiles, skills, browser sign-in, and service credentials never authorize unrelated actions.

Goal file updates use `workspace_write` when file changes are enabled, including when terminal access is off. Read existing text first and preserve useful content. Blocked or unfinished cycles cannot complete from older passing checks; unreadable completion records require review and retry.

Local-model goal runs finish with `goal_finish`: new goals submit outcome, summary, checkpoint, nextStep, evidenceRefs and actionUpdates. Legacy goals submit status instead. Cite exact supplied evidence IDs; omit IDs for new action items. The host validates the result and verifies task checks. No-change requires an empty summary and no file/action changes. Factual corrections use update.

## App management tools

Read `app_state` for settings and queued outcomes. Management tools cover profile, settings/connections/workspace, memory, goals, automations, extensions, web services, browser and heartbeat. Read the relevant records before updating them. `memory_manage` status includes learning.failedJobs; retry_learning/discard_learning take {id}. Learning stops after three failed attempts; retry only after addressing the error. Use `memory_save`/`memory_forget` for individual records. `attachment_manage` status lists stored files; cleanup preserves saved files and current drafts; delete {id} removes a saved copy and its chat references, keeping the original source file. `goal_control` supports save/run/pause/resume/answer/delete and restore operations. `extension_manage.login_server` opens MCP sign-in. Other action names and payloads are in each tool schema.

Operations that require an idle engine return **queued**, not completed. They are persisted and run after this reply. Report their operation ID; inspect `app_state.operations` on the next request for success or error. Do not claim success based on a queued response. UI callbacks are not agent APIs; use these tools. Existing validators and task scopes still apply. Never create a second OS scheduler to replace these tools.


## Goals: tasks and ongoing work

New goals use an outcome contract. Choose kind task for a finite deliverable with acceptance checks; choose ongoing to act when the bot can and coach when the user must act. Ongoing reviews produce update, progress, recommendation, waiting, no-change or failed. They never claim the lifelong goal is completed. Each review emits goal.reviewed for standing intents. Completion dependencies must be tasks; ongoing goals cannot be dependencies.

The continuous chat is both an evidence source and the place for useful goal results and questions. Use goal_manage answer with id, questionId and answer for an unambiguous reply to a pending question, or goal_control answer with the same payload. Do not guess which question an ambiguous reply answers. Source IDs and saved action owners distinguish advice from user follow-through.

Selected evidence files may be outside the working folder. Sources are read as bounded text and do not expand writable access. Recent user messages and selected file/calendar changes are supplied before semantic recall. Memory off disables chat recall. Empty search or an unavailable project is not evidence of avoidance or an unfinished decision.

By default an ongoing scheduled review with unchanged evidence stays quiet without a model call, including when previous suggestions remain pending. Use always review only when the user wants a review even without source changes. Run goal manually requests a fresh review. Quiet results stay in history; useful results and questions appear in chat. Goal messages cannot self-trigger the evidence feed.

Legacy goals retain their previous completion checks and history until edited. Editing in Goals uses the new contract. Finite task completion is owned by the host checks; old passing checks cannot prove fresh completion of a recurring run. Coaching recommendations are labelled advice; usefulness depends on user feedback, not a file heading.
