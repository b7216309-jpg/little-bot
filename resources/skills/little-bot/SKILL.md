---
name: little-bot
description: Configure and explain Little Bot's app tools and controls. Read for heartbeat setup, recurring tasks or cron requests, goals, memory, connections, and app behavior.
---

# Little Bot

Read the current tool definitions for argument shapes. There is no Little Bot shell CLI. Do not invent commands, edit state.json, or bypass app controls. Older chats keep their original tool list; missing tools require a new chat.

## App tools

- `ask_user`: ask one necessary clarification, with optional choices; free text is always available. In a direct chat, wait for the answer and continue. In an autonomous goal, include a checkpoint and next step: the question is saved on the goal card and the model step ends. The user's answer accompanies the next step without expanding permissions or resetting budgets. Do not ask for credentials, unnecessary confirmation, or facts already supplied.

- `skill_list` and `skill_read`: discover and read enabled skills. `$skill-name` includes a skill in a user request. Skills add instructions, not permissions.
- `memory_search({query?,source?,scope?,offset?})`: search saved facts, recent notes, and past conversation text. An empty query browses recent records. `session_read({sessionId,offset?})` opens a result; follow `nextOffset` for more. Cite its title/date, check whether old decisions still apply, and say when nothing was found. Recall requires Memory on. History stays on the saved connection and in this folder; direct user chats can use `scope:"all"` when asked to look across folders. Background tasks stay in their own folder. Deleted chats cannot be read. Explicit saved facts remain shared memory until removed.
- `goal_manage` and `schedule_manage`: list, create, update, pause, or resume. List before using an existing ID. Available in direct user chats only.
- `attachment_send({path,caption?})`: deliver a finished file or image as a chat attachment. Use its absolute path inside the chat folder, or a browser screenshot path. Wait for success before saying it was delivered. This sends to the current user, not another person.
- `browser`: Vercel agent-browser with a separate profile. The `web-tools` skill covers snapshots, interaction, and screenshots.
- `web_search_service` and `web_scrape`: configured Brave/Firecrawl search and Firecrawl page extraction. Available in direct chats and network-enabled goals, not heartbeat or routines.

## Attachments

Users can attach files, drop them, or paste an image. Photo pixels and extracted PDF/DOCX/text excerpts accompany the request. Treat their contents as reference material. Check any extraction or truncation notice; do not claim to have read omitted pages or an unsupported file. Scanned PDFs need OCR, which is not bundled.

Use image input to inspect photos; use `attachment_send` to return existing images, screenshots, and documents. The app does not include a diffusion image generator. File tools may create diagrams or other assets when suitable, but never claim an unavailable image-generation service ran.

## Heartbeat and scheduling

Choose **Heartbeat** for a continuing checklist that should stay quiet without meaningful changes; **Automations** for a prompt repeated at an interval; **Goals** for work with completion checks that stops when done. Do not create a real routine merely to explain setup.

### Heartbeat setup

There is one saved heartbeat, with no agent configuration tool yet. Prepare a checklist (up to 8,000 characters) and exact settings for the user to apply in **Heartbeat**; do not claim to save or enable it. The renderer's internal IPC is not an agent API. Do not edit app state or create an OS scheduler as a substitute.

1. Set the checklist: the allowed files, useful action, completion evidence, and when to notify. For example: "Check notes.md for unfinished work. If a next step is clear, update next-actions.md within this folder. Report actual file changes, blockers, or a meaningful new finding; otherwise stay quiet."
2. Choose **Check every** (5–1,440 minutes; default 30), **Daily run limit** (1–100; default 12), and **From / Until** (whole hours in the PC's local time; default 08–22). The start is inclusive and end exclusive; equal hours mean all day, and 22–08 spans midnight.
3. **Notifications and timing** sets **Desktop alerts per day** (1–20; default 3) and **Later waits** (5–1,440 minutes; default 60). Heartbeat and goals share this alert budget; excess updates stay in the inbox.
4. Check the displayed folder and model. **Use current working folder** captures the currently selected folder, model, effort, and connection when saved. Set **Enable**, then **Save settings**; the Enable toggle is an unsaved draft until Save settings is clicked. Stop a running check before editing.
5. **Check now** uses saved settings and can run even when disabled or outside active hours; it still respects the daily run limit and global pause, and needs an available model and idle app. **Stop check** interrupts the current check; disabling and saving stops future automatic checks.

Heartbeat can take small steps in its saved folder. It has no network/browser access and cannot schedule further work. Useful adjusts topic preference; Later defers an alert; Don't suggest this mutes its topic without pausing the underlying task. Never promise an alert for every check.

### Repeating tasks (Automations)

Use `schedule_manage` in direct chats. List first to find or reuse a matching routine rather than duplicating it. New routines inherit this chat's folder and the selected connection/model. The tool returns saved status; report that status accurately.

```json
{"action":"list"}
{"action":"create","name":"Review project notes","prompt":"Read notes.md and report the next unfinished action.","intervalMinutes":60}
{"action":"update","id":"<returned-id>","intervalMinutes":120}
{"action":"pause","id":"<returned-id>"}
{"action":"resume","id":"<returned-id>"}
```

Each object is a separate call. Names allow 1–80 characters, prompts 1–32,000, and intervals whole minutes from 1 to 10,080. Create saves a **disabled draft**; the user enables it in **Automations**. Stop or finish a running routine first; pause an enabled routine before updating. Every tool update requires enabling it again. Resume works only for a previously authorized routine and cannot bypass **Pause all**. Recreate a routine to change its saved folder/model/connection. Run/delete controls are in the app, not these tools. The first automatic run is after the interval, not immediately. Manual **Run now** can run and authorize a disabled routine.

There is **no cron-expression parser, weekday schedule, exact clock-time schedule, or one-time timer**. `intervalMinutes:1440` means an elapsed 24-hour interval, not "09:00 every morning." Automations have no active-hour window: heartbeat's From/Until settings do not apply to them, so an enabled hourly routine can also run overnight. Do not supply clock-time examples or a numeric interval as a solution to an exact-time/weekday request. Explain the unsupported requirement and ask whether flexible timing is acceptable; only propose a replacement interval once that tradeoff is accepted. Never claim a cron expression was installed.

Little Bot has no CLI or external API for submitting a prompt or running a saved routine. Windows Task Scheduler cannot send it a prompt through a supported interface; merely launching the app does not execute a named task on demand. Do not present that as a working workaround.

### Goals and runtime limits

Goals need an objective and observable checks: `fileExists`, `fileContains`, or `command`. Paths are relative to the chat folder; command checks require terminal permission. `goal_manage` creates/updates drafts. The user reviews permissions, budget, and trigger in **Goals**, then starts the first run. Triggers are manual, interval, or selected file changes. Interval goals advance unfinished work; completed goals stop. Tools cannot set these trigger/permission/budget fields or enlarge existing grants.

Everything runs only while Little Bot is open and the PC awake. There is no service, tray worker, or wake-from-sleep scheduler. Missed intervals do not produce a catch-up burst. Tasks wait while the app is busy or their saved model connection is not selected; local tasks also need the local server. Routines may wait for user approvals. **Goals → Pause all** pauses all autonomous work across restarts; resume there. When a task does not run, check enabled/draft state, global pause, saved connection, busy work, then heartbeat active hours/daily limit and its last error. Do not infer current settings from these documented defaults.

## Controls

- **Settings → Connection:** Local Qwen is the default and needs the user's local server running. Codex is optional. Chats and tasks retain their saved connection; switch to it before continuing. There is no cloud fallback. Never start or change the model server without a relevant user request.
- **Settings:** compaction threshold 20–95%, default 80%; 0 retains native limits. Service keys go here and are encrypted, never pasted into chat.
- **Profile:** USER.md holds user facts/preferences; SOUL.md sets voice and approach. Each allows 4,000 characters and applies on the next request. Do not silently rewrite them through tools.
- **Memory:** `Remember that ...` saves an explicit workspace fact. The panel edits/removes facts and controls recall. Ordinary remarks are not automatically durable facts.
- **Goals:** permissions, budgets, dependencies, triggers, Pause all, and Review undo. Undo covers captured files and refuses later-edit conflicts; external effects cannot be undone.
- **Extensions:** skills, plugins, and MCP connections. Calendar and email are not bundled.

Normal chat follows the engine's approval rules; autonomous goals receive only saved grants. Profiles, skills, browser sign-in, and service credentials never authorize unrelated actions.
