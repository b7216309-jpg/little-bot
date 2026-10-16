# Settings, workspace and profile

## How it works

[Store](../../src/store.cjs) persists model/provider selection, local base URL/model/thinking, reasoning effort, compaction threshold, answer-check preference, workspace and custom system instructions. [Controller](../../src/controller.cjs) validates settings and probes/refreshes the connection. The main IPC handlers expose these operations to the UI and AppManagement.

A workspace must resolve to an existing directory. A model/workspace/tool-mode change can rotate the native session while preserving the public conversation. Existing goals and automations retain their own saved bindings; changing the foreground setting does not silently rebind every task.

Changing the provider, model or workspace still needs an idle execution lane because it changes the task binding. System prompt, reasoning effort and local thinking changes can be saved during a turn; the active request keeps the settings it already started with, and the next turn picks up the change. System prompt changes reload the idle engine thread before that next turn. Background memory learning continues while ordinary settings are saved.

## Profile files

The Profile view holds everything that defines one profile: the profile list (create, rename, switch, delete; see [Runtime and storage](01-runtime-storage.md#profiles)), USER.md, SOUL.md and the system prompt. The system prompt is still the `systemPrompt` setting, but each profile has its own state, so it moved out of Settings into the Profile view. Ctrl + S saves the system prompt when its editor has focus, otherwise the two profile files.

A new profile can start from one of eight personalities ([profile-presets.cjs](../../src/profile-presets.cjs), texts in `resources/profile/presets/`). Five are for fun: Vesper, a night-owl poet; Zib, an alien anthropologist; Grandma Ottilie, a retired stunt pilot; Mochi, a sarcastic cat; and the Loremaster, a game master. Two are for work: Atlas, a chief of staff, and Forge, a principal engineer. Sage, a growth coach, is for personal development. A preset writes the new profile's SOUL.md and a custom system prompt whose opening identity paragraph is the personality's own; every app rule after that paragraph is the built-in prompt of the version that created it, so a later version's rule changes reach that profile only through Restore default. USER.md starts from the default. The turn context presents SOUL.md as the model's own personality, not as user preferences.

[ProfileFiles](../../src/profile.cjs) owns data/profile/USER.md and SOUL.md. USER.md carries user-supplied facts; SOUL.md carries tone/working preferences. Each is UTF-8 plain text with a 4,000-character limit. The app supplies a current copy to each applicable turn rather than expecting an old profile in the thread to stay current.

Defaults are created only when missing. Invalid/missing content is reported through the profile editor without blocking startup; valid content from the other file still loads. Saves validate destinations and replace each file through a temporary file. Each file is atomic; changing both files is not a two-file transaction.

These files do not replace durable memory or grant new capabilities to goals. Changing them can legitimately invalidate a cached prompt prefix. Memory disabled does not erase the explicit profile.

## What can prevent operation

Busy execution, unavailable selected provider/model, malformed URL, unavailable folder, unavailable local server, unsupported reasoning capability, invalid custom settings or save failure. Profile problems include oversized text, invalid UTF-8, disallowed control characters, linked/nonregular files or an unwritable folder.

An empty model list is not evidence that the thinking UI was removed: the selector depends on current model capabilities. Reset/default controls and Check connection should be distinguished from importing historical settings.

## Verification

[Store](../../test/store.test.cjs), [Profiles](../../test/profiles.test.cjs).

