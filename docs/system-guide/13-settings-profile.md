# Settings, workspace and profile

## How it works

[Store](../../src/store.cjs) persists model/provider selection, local base URL/model/thinking, reasoning effort, compaction threshold, answer-check preference, workspace and custom system instructions. [Controller](../../src/controller.cjs) validates settings and probes/refreshes the connection. The main IPC handlers expose these operations to the UI and AppManagement.

A workspace must resolve to an existing directory. A model/workspace/tool-mode change can rotate the native session while preserving the public conversation. Existing goals and automations retain their own saved bindings; changing the foreground setting does not silently rebind every task.

Settings updates that affect the engine need an idle execution lane. The agent can queue such changes after its reply. AppManagement operation status is the evidence that a queued change actually finished. Settings/connection persistence has rollback handling, unlike the confirmed calendar/goal/schedule paths in R2.

## Profile files

[ProfileFiles](../../src/profile.cjs) owns data/profile/USER.md and SOUL.md. USER.md carries user-supplied facts; SOUL.md carries tone/working preferences. Each is UTF-8 plain text with a 4,000-character limit. The app supplies a current copy to each applicable turn rather than expecting an old profile in the thread to stay current.

Defaults are created only when missing. Invalid/missing content is reported through the profile editor without blocking startup; valid content from the other file still loads. Saves validate destinations and replace each file through a temporary file. Each file is atomic; changing both files is not a two-file transaction.

These files do not replace durable memory or grant new capabilities to goals. Changing them can legitimately invalidate a cached prompt prefix. Memory disabled does not erase the explicit profile.

## What can prevent operation

Busy execution, unavailable selected provider/model, malformed URL, unavailable folder, unavailable local server, unsupported reasoning capability, invalid custom settings or save failure. Profile problems include oversized text, invalid UTF-8, disallowed control characters, linked/nonregular files or an unwritable folder.

An empty model list is not evidence that the thinking UI was removed: the selector depends on current model capabilities. Reset/default controls and Check connection should be distinguished from importing historical settings.

## Verification

[System prompt settings](../../test/system-prompt-settings.test.cjs), [Controller settings](../../test/controller.test.cjs), [connections](../../test/connections-strata.test.cjs), [Store](../../test/store.test.cjs) and [personal smoke](../../src/personal-smoke.cjs).
