# Memory and CPU embeddings

## How it works

[MemoryService](../../src/memory-service.cjs) owns the SQLite database. [memory.cjs](../../src/memory.cjs) supplies compatibility, automatic explicit-remember handling, episodic capture and prompt-context construction. [recall.cjs](../../src/recall.cjs) exposes memory_search and session_read to the agent.

Records carry a type, scope, project, status, source references and optional key/pin. Corrections supersede earlier records rather than silently erasing their provenance. Forgetting creates suppression so automatic learning does not simply reintroduce the same fact. Project aliases keep knowledge linked when a workspace moves. Search can favor the current project or cover all projects.

The visible timeline is separately indexed in chunks. Routine tool outputs and reasoning are excluded from normal searchable conversation text; source/session reading can reveal the original saved material when requested. Therefore “tools are not learned as personal facts” does not mean “tools are absent from all stored history.”

## Automatic learning

A completed direct turn can create an extraction job; a message of only common words ("ok thanks", "oui vas-y") creates neither a job nor a work episode, and an episode keeps at most 1,500 characters of the request and 3,000 of the outcome. [MemoryConsolidator](../../src/memory-consolidator.cjs) waits for the shared execution lane, runs an ephemeral model session in cache slot 1, validates a small candidate schema and requires references to the job's source messages before saving facts. It is shown the existing records closest to the message as well as the newest, since a model can only avoid or correct what it can see.

Failures retry at most three times with backoff, then remain visible as failed learning jobs. UI controls and memory_manage expose Retry and Discard. The extraction model is the selected language model, not the embedding encoder. Foreground work pauses/cancels extraction.

A valid response with no candidates is allowed. Tool-less local extraction uses Strata schema-constrained decoding; a malformed or invalid result gets one corrective turn before the normal three-attempt job backoff. Candidates without valid provenance or with unusable supersession targets are skipped. Consequently, a completed job is not a guarantee that every important fact was extracted. Raw conversation recall remains available. Automated selection is a quality limit, not proof of perfect memory curation.

## What a request gets

[buildContext](../../src/memory-service.cjs) writes plain lines, `- type (short id, date): text`, under one line saying this is reference data. Everything in it is sent once per context: the controller passes the ids the context already holds (`contextSent.memory`) and gets the new ones back. The default budget is 4,000 characters.

1. Pins and preferences, up to 60% of the budget.
2. If the message has meaningful words (`significantTerms`: common English and French words left out), at most six facts that `clearlyRelated` accepts: similarity of 0.6; or 0.45 with a shared word; or half of the message's meaningful words, at least two unless it has only one or two; or 0.5 and 0.08 clear of the next best. A fixed cut-off does not work with the bundled encoder: on made-up sentences, related English scored 0.46–0.63 and unrelated French up to 0.55.
3. At most two work episodes, clipped to 400 characters, with similarity of 0.6, or 0.5 and two shared words. Ones from this chat still in its context are left out.

Raw history is never added on its own. `memory_search` and `session_read` reach it, and tool results now carry only what the model needs (`recallSearch`), so later results are not pushed out of the output. The memory tools accept the short id (`resolveId`). The Memory page has **Show more**. The working checkpoint that used to go with every message is gone: it repeated the last exchange, and its table is dropped at startup.

## Keeping it small

- **Near duplicates** (`nearDuplicate`, automatic saves only): a memory with no meaningful word that a kept record lacks is dropped; one with every word of a kept record and more replaces it. It is strict because one different word can be the whole correction: "on Mondays" is a different fact from "on Fridays", and a memory and its negation are never compared. Pinned records are never replaced.
- **Nightly tidy** (`mergeLearned`, `retireLearned`): see Dreaming below.
- **Stored vectors** are rounded to five decimals, about half the size. Existing rows keep their form until they are next embedded.

## Learning quality and visibility

Each turn saves at most three memories, and the prompt asks only for what will still matter weeks later. In real use before this change, users removed almost half of the automatically learned records. Newly learned memories appear in the conversation as one quiet line: a pin, "Remembered", and the memory (or "Remembered 3 things"). A click opens the full text, with a **Forget** button for each memory that deletes it at once, the same way the Memory page does, without a model turn. The notice keeps what it learned as a `memories` list (`{ id, text, type, forgotten? }`, normalized in [proactive-chat.cjs](../../src/proactive-chat.cjs)). Notices from before 0.53.0 are read from their text. However a memory is forgotten (this button, the Memory page or memory_forget), `markForgotten` strikes it through in every notice that announced it. The phone shows the same memories without ids, labelled "Little Bot · remembered".

The model still gets the full notice, ids included. The next user turn carries it, so "that's wrong" can be corrected with memory_save or memory_forget. These notes are not recalled as history and are not goal evidence.

Learning output wrapped in reasoning tags, prose or code fences is parsed through the shared [model-json](../../src/model-json.cjs) helper, which also repairs trailing commas and single-quoted strings. Dreaming uses the same schema-constrained and repair path. Heartbeat and goal runs yield the idle lane while a learning job is ready; a job waiting in backoff does not hold them back.

## Local model tool lessons

[lessons.cjs](../../src/lessons.cjs) keeps compact, imperative tool-use lessons per local model ID. A failed call followed in the same turn by a successful retry can teach a PowerShell equivalent, a corrected workspace path, an app-tool argument shape or a corrected tool name. The Strata adapter reports its patch and unknown-tool rewrites, and AgentTools reports schema normalizations, as they happen. These rules are deterministic and do not add a model request. A covered app-tool error includes the lesson on one short line; three repeated failures in threads that received that lesson retire it.

The first local thread for a model starts with three Windows/PowerShell and patch-form seeds. Every new local thread, including Quick, `/goal`, heartbeat, Independent Check, extraction and night work, receives one `Lessons from this PC` developer-instruction block capped at 1,000 characters. A direct chat saves the block with its engine thread and reuses it byte-for-byte on resume; new lessons wait for the next thread, preserving Strata's prompt prefix.

Lessons are part of the protected `state.json` payload beside conversations, memory and companion data. Each entry tracks recoveries and its last-seen time. Duplicate keys update the existing entry; each model keeps at most 12, and entries unseen for 100 days expire. The Memory page lists lessons by model and lets the user remove one. Removing a seed does not add it back to that model.

## Backups and resets

[backups.cjs](../../src/backups.cjs) saves one restore point per local day: a `VACUUM INTO` copy of `memory.sqlite` and the encrypted `state.json`. Points are kept for seven days under `data/backups`; Memory → Search settings → Backups can make one now. Restore writes a marker and restarts the app. Before the Store opens anything, the current files are copied to a `before-restore-*` safety point, then the backup is copied in. Backups never leave the PC.

If `memory.sqlite` is missing while the conversation has messages, startup warns once and logs a diagnostic. This happens, for example, when the file was deleted outside the app or a development copy reset the shared data folder. Every app copy, including development checkouts, uses `%APPDATA%\Little Bot` unless `LITTLE_BOT_DATA_DIR` points elsewhere.

A memory object that loses its database link re-attaches to the on-disk database with a warning. It no longer writes silently to a throwaway in-memory database.

## Embeddings

[local-embeddings.cjs](../../src/local-embeddings.cjs) manages a worker; [local-embeddings-worker.cjs](../../src/local-embeddings-worker.cjs) runs ONNX Runtime with the **CPU** execution provider, at most two intra-operation threads, and one inter-operation thread.

The [manifest](../../resources/embeddings/manifest.json) pins quantized **BGE-base-en-v1.5**, 768 dimensions, CLS pooling and a 512-token model window. The ONNX file is 110,083,337 bytes; its identity, checksum, download revision and MIT licence declaration are recorded there. Query instructions are added only to queries. Long passages are encoded across all 510-token content windows, combined by token-weighted averaging and normalized.

Semantic vectors supplement lexical/history search. Changing encoder identity invalidates/rebuilds compatible vectors. Embedding failures fall back to text retrieval rather than making the language model unavailable. The default encoder mainly targets English; equal French performance is not promised.

## What can prevent useful recall

Memory is off; scope points at another project; aliases are absent; no relevant record exists; extraction is failed or waiting; the embedding worker/assets are unavailable; or the model chooses no fact. Search result/page limits require pagination for a large archive. Embeddings improve matching, not truth or completeness.

## Verification

[consolidation](../../test/memory-consolidator.test.cjs).

## Dreaming and intentions

[Dreaming](../../src/dreaming.cjs) runs in the memory learning lane ([MemoryConsolidator](../../src/memory-consolidator.cjs)), so it never overlaps a conversation and stops when the user sends a message. It is due once at least four new user messages exist and either it is night (before 06:00, 16 hours since the last dream, PC idle 15 minutes) or 30 hours passed and the PC has been idle 10 minutes; **Dream now** on the Memory page skips the wait. It reads the recent conversation, remembered facts, the last diary entries, open intentions, the next four days of calendar, recent heartbeat notes and the heartbeat agenda, and returns a diary entry, at most three memories, at most three intentions, at most three merges of overlapping facts and at most five facts that are out of date. A memory is saved only when it cites the user's own messages, so the bot's claims cannot become facts. A merge names two or more facts it was shown and one text to replace them; an out-of-date fact must cite the user's own messages. Both apply only to active facts that Little Bot learned by itself and that are not pinned, in one scope, and the old records stay findable as superseded. The diary entry shows how many were tidied.

[Intentions](../../src/companion.cjs) are prospective memory: something to bring up later, triggered by the next chat, a topic keyword, a date or a moment (back at the PC, got home, left home). Chat turns get matching ones as a context block; the heartbeat gets the ones due now or matching the presence event that woke it, and speaking up spends an offer. Each is offered at most once per 20 hours and three times, and expires (14 days from a dream, 30 from chat). The `intention_manage` tool lets the chat and the wild heartbeat create, list, finish or cancel them; the Quick session and goals cannot. Diary and intentions live in `state.json`'s encrypted part next to chats and memory.
