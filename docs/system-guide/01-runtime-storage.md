# Runtime and storage

## How it works

[main.cjs](../../src/main.cjs) owns Electron startup, window lifecycle, IPC registration and component wiring. [preload.cjs](../../src/preload.cjs) exposes the `window.bot` calls used by the renderer. [Controller](../../src/controller.cjs) starts and coordinates Little Bot's own [engine](../../src/engine/index.cjs) (see [Engine](19-engine.md)): the controller supplies the interface, state and tools, and the engine runs the model's turns.

The normal Windows user-data folder is `%APPDATA%/Little Bot`. Its `data` directory contains:

| Location | Owner / contents |
| --- | --- |
| `state.json` | Store: settings, public timeline, goals, schedules, calendar, heartbeat, extension metadata |
| `chats.journal` | Store ([ChatJournal](../../src/chat-journal.cjs)): the saved conversations, one encrypted record per line, appended as they change (0.57.0) |
| `memory.sqlite` | MemoryService: records, sources, projects, indexed history, vectors and learning jobs |
| `engine/` | The engine's saved conversations (`threads/`, encrypted) and MCP sign-ins (`mcp-auth.json`, encrypted) |
| `attachments/` | Imported copies, image derivatives and extracted text |
| `goal-backups/` | Workspace file snapshots and manifests |
| `profile/` | USER.md and SOUL.md |
| `browser/`, `extensions/` | Browser profile and managed plugin files |
| `app-operations.json`, `logs/` | Deferred app operations and diagnostics |

## Profiles

[Profiles](../../src/profiles.cjs) keeps a registry in `%APPDATA%/Little Bot/profiles.json`. The first profile is the base folder itself, laid out as above, so existing installs keep their data where it is. Every other profile is a complete copy of that layout under `Profiles/<id>/`: its own `data` directory, `Workspace` and Chromium storage (which includes the built-in browser's sign-ins and the theme choice). Before `ready`, main.cjs takes the single-instance lock on the base folder and then points `userData` at the active profile, so exactly one profile runs at a time.

Switching saves the new active id and restarts the app; the restart rebuilds the engine, scheduler, heartbeat, goals and night shift from the other folder, so no task from one profile can post into another. Inactive profiles do not run, and they do not catch up on missed schedules when they wake. A new profile starts with a plain `state.json` holding only the connection, model, effort, compaction, answer-check and sampling settings; the Store encrypts it on the first save. Its personality files start from the defaults and its system prompt from the built-in one. Deleting a profile removes its whole folder. The first profile and the running profile cannot be deleted. Paired phones are stored in the base `data/relay.json` and talk to whichever profile is running.

See [Store](../../src/store.cjs) for normalization and persistence. Production uses Electron safeStorage for the chats and memory metadata fields: each journal line is encrypted on its own, and so is that part of `state.json`. Goals, calendar, schedules and other configuration remain ordinary state fields; the SQLite memory database and workspace files are separate stores and are not covered by that envelope.

## Saving and recovery

Store serializes a normalized copy and replaces the state file using a temporary file. It indexes saved conversations and goals into SQLite. The JSON file and database are **not one transaction**.

Saving is sized for long histories and for the disk (0.56.0, [save-path test](../../test/save-path.test.cjs)):

- Each save reindexes only the messages that changed since the last pass, in one database transaction, and does not write the file again when its content would be unchanged.
- A streaming reply is saved every 15 seconds (`STREAM_SAVE_MS` in [controller.cjs](../../src/controller.cjs)). A finished reply, tool call or command is saved at once, so only a crash mid-reply can lose up to 15 seconds of partial text.
- Conversations are kept in `chats.journal` (0.57.0, [journal test](../../test/chat-journal.test.cjs)). A save appends only what changed: a new message, the latest text of one being streamed, a conversation's own fields, or a new order when messages were removed. A streamed minute writes a few kilobytes whatever the history's size, where rewriting the whole file wrote 18 MB at 5,000 messages. Once superseded lines outweigh the live ones (plus 1 MiB), the journal is rewritten whole through a temporary file.
- `state.json` keeps everything else and `"chatJournal": 1`. Without that marker (a file from 0.56 or earlier, a downgrade, an older restore point) its own conversations are current, and the first save rebuilds the journal from them. If `state.json` is missing, the journal's conversations are kept; if the journal is missing, the app says so and starts with none.
- A torn last line, as a crash mid-save leaves, is dropped. Other unreadable lines are skipped with a warning, and the original journal is kept as `chats.journal.corrupt-…` before it is rewritten. A journal that cannot be decrypted locks saving, like encrypted state from another Windows account. A failed append is never built on: the next save rewrites the file.
- The search index shares each record's rowid, so editing or deleting a record no longer reads the whole index. A database from before 0.56.0, or one whose index drifted (a restored copy, say), is reindexed once when opened.
- The memory page's counts and list come from small indexes and are read again only after the database changed. Invalid shapes produce recovery warnings; unreadable encrypted state is locked and preserved rather than overwritten. A valid large encrypted conversation can now be read back without the previous 50 MiB reader limit.

On restart, transient chat execution is reset and interrupted goals are normalized for recovery. External-effect goals require effect review; local goals verify results before continuing. Deferred operations left running become interrupted. Imported draft attachments are not restored and unreferenced copies are pruned.

## What can prevent operation

An unavailable user-data folder, unavailable Windows decryption, unreadable encrypted state can block startup. An unavailable workspace blocks a turn even when the model is connected. Disk failures can leave memory and disk disagreeing in some mutation paths: see R1 and R2 in the [review](review.md). Settings and extension updates have their own rollback paths; do not assume all editors do.

Moving only state.json (without `chats.journal`) does not move conversations, and it does not migrate native engine sessions, memory, attachment copies or profile files. Copying protected data between Windows accounts also does not ensure it can be decrypted.

## Verification

[Store tests](../../test/store.test.cjs), [Profiles](../../test/profiles.test.cjs), [Windows distribution](../../test/windows-distribution.test.cjs).

