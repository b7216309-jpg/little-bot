# Runtime and storage

## How it works

[main.cjs](../../src/main.cjs) owns Electron startup, window lifecycle, IPC registration and component wiring. [preload.cjs](../../src/preload.cjs) exposes the `window.bot` calls used by the renderer. [Controller](../../src/controller.cjs) starts and coordinates the bundled [Codex app-server client](../../src/codex.cjs); Little Bot supplies the interface, state and tools, while the engine supplies native agent execution.

The normal Windows user-data folder is `%APPDATA%/Little Bot`. Its `data` directory contains:

| Location | Owner / contents |
| --- | --- |
| `state.json` | Store: settings, public timeline, goals, schedules, calendar, heartbeat, extension metadata |
| `memory.sqlite` | MemoryService: records, sources, projects, indexed history, vectors and learning jobs |
| `engine/` | Bundled engine configuration, authentication and native session history |
| `attachments/` | Imported copies, image derivatives and extracted text |
| `goal-backups/` | Workspace file snapshots and manifests |
| `profile/` | USER.md and SOUL.md |
| `browser/`, `services/`, `extensions/` | Browser profile, service vault and managed plugin files |
| `app-operations.json`, `logs/` | Deferred app operations and diagnostics |

See [Store](../../src/store.cjs) for normalization and persistence. Production uses Electron safeStorage for the chats and memory metadata fields. Goals, calendar, schedules and other configuration remain ordinary state fields; the SQLite memory database and workspace files are separate stores and are not covered by that envelope.

## Saving and recovery

Store serializes a normalized copy and replaces the state file using a temporary file. It indexes saved conversations and goals into SQLite. The JSON file and database are **not one transaction**. Invalid shapes produce recovery warnings; unreadable encrypted state is locked and preserved rather than overwritten. A valid large encrypted conversation can now be read back without the previous 50 MiB reader limit.

On restart, transient chat execution is reset and interrupted goals are normalized for recovery. External-effect goals require effect review; local goals verify results before continuing. Deferred operations left running become interrupted. Imported draft attachments are not restored and unreferenced copies are pruned.

## What can prevent operation

An unavailable user-data folder, unavailable Windows decryption, unreadable encrypted state or a missing engine executable can block startup. An unavailable workspace blocks a turn even when the model is connected. Disk failures can leave memory and disk disagreeing in some mutation paths: see R1 and R2 in the [review](review.md). Settings and extension updates have their own rollback paths; do not assume all editors do.

Moving only state.json does not migrate native engine sessions, memory, attachment copies or profile files. Copying protected data between Windows accounts also does not ensure it can be decrypted.

## Verification

[Store tests](../../test/store.test.cjs), [session encryption](../../test/session-encryption.test.cjs), [Codex transport](../../test/codex.test.cjs), [Windows distribution](../../test/windows-distribution.test.cjs) and [reliability regressions](../../test/reliability-regressions.test.cjs).
