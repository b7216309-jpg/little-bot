# Goal ledger, verification and file restore

## How it works

[goal-ledger.cjs](../../src/goal-ledger.cjs) stores the current versioned plan, one active step, assumptions, observations, decisions, blocks, verification and snapshot evidence. Old plans remain historical. [renderer panels](../../src/renderer/goal-ledger-panel.js) display this public execution record; it is not hidden chain-of-thought.

[goal-files.cjs](../../src/goal-files.cjs) resolves writable roots, performs goal-owned text writes, checks files, fingerprints trigger paths and creates/restores snapshots. The runner attaches evidence and status to the ledger after each step.

Checks support fileExists, fileContains and a permitted command. A command requires the goal's saved terminal permission. Text containment checks support regular files up to 2 MiB. A path merely existing does not prove that its contents are correct; choose a stronger check when correctness matters.

## Snapshots and restore

Before writable local work, the app captures the configured write scope under data/goal-backups. A snapshot is bounded to 2,000 files and 25 MiB; total backup storage is capped at 250 MiB. Metadata also has an 8 MiB limit. Broad folders can exceed these caps before a model step starts.

After execution, the app records file hashes and changes. Preview Restore compares current files with the recorded after-state. Restore is available only when verified changes exist and current files have not diverged. It validates backup bytes, rechecks each target, removes files created by that run, and restores previous copies of changed/deleted files. Unrelated later files are left alone.

Restore is a file operation sequence, not a filesystem-wide transaction. A mid-restore error reports the number restored and stopping path. It cannot undo messages, purchases, API writes, database side effects, commands outside the snapshot scope or unrecorded external work. An unfinished final snapshot has no verified automatic restore path.

## What can prevent operation

Missing/changed workspace, invalid write roots, unavailable files, links/nonregular destinations, exhausted backup quota, oversized verification inputs, missing snapshot contents or later edits that conflict with the recorded after-state. A successful model report cannot override a failed host check.

A file-triggered goal observes filesystem metadata changes through its own watcher/fingerprints. It is not a general computer-wide watcher and does not replay changes from a closed-app session.

