# Memory and CPU embeddings

## How it works

[MemoryService](../../src/memory-service.cjs) owns the SQLite database. [memory.cjs](../../src/memory.cjs) supplies compatibility, automatic explicit-remember handling, episodic capture and prompt-context construction. [recall.cjs](../../src/recall.cjs) exposes memory_search and session_read to the agent.

Records carry a type, scope, project, status, source references and optional key/pin. Corrections supersede earlier records rather than silently erasing their provenance. Forgetting creates suppression so automatic learning does not simply reintroduce the same fact. Project aliases keep knowledge linked when a workspace moves. Search can favor the current project or cover all projects.

The visible timeline is separately indexed in chunks. Routine tool outputs and reasoning are excluded from normal searchable conversation text; source/session reading can reveal the original saved material when requested. Therefore “tools are not learned as personal facts” does not mean “tools are absent from all stored history.”

## Automatic learning

A completed direct turn can create an extraction job. [MemoryConsolidator](../../src/memory-consolidator.cjs) waits for the shared execution lane, runs an ephemeral model session in cache slot 1, validates a small candidate schema and requires references to the job's source messages before saving facts.

Failures retry at most three times with backoff, then remain visible as failed learning jobs. UI controls and memory_manage expose Retry and Discard. The extraction model is the selected language model, not the embedding encoder. Foreground work pauses/cancels extraction.

A valid response with no candidates is allowed. Candidates without valid provenance or with unusable supersession targets are skipped. Consequently, a completed job is not a guarantee that every important fact was extracted. Raw conversation recall remains available. Automated selection is a quality limit, not proof of perfect memory curation.

## Learning quality and visibility

Each turn saves at most three memories, and the prompt asks only for what will still matter weeks later. In real use before this change, users removed almost half of the automatically learned records. Newly learned memories appear in the conversation as a "Little Bot · learned" message showing each memory's ID. The next user turn carries that message to the model, so "that's wrong" can be corrected with memory_save or memory_forget. These notes are not recalled as history and are not goal evidence.

Learning output wrapped in reasoning tags or prose is parsed through the shared [model-json](../../src/model-json.cjs) helper. Heartbeat and goal runs yield the idle lane while a learning job is ready; a job waiting in backoff does not hold them back.

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

[Dreaming](../../src/dreaming.cjs) runs in the memory learning lane ([MemoryConsolidator](../../src/memory-consolidator.cjs)), so it never overlaps a conversation and stops when the user sends a message. It is due once at least four new user messages exist and either it is night (before 06:00, 16 hours since the last dream, PC idle 15 minutes) or 30 hours passed and the PC has been idle 10 minutes; **Dream now** on the Memory page skips the wait. It reads the recent conversation, remembered facts, the last diary entries, open intentions, the next four days of calendar, recent heartbeat notes and the heartbeat agenda, and returns a diary entry, at most three memories and at most three intentions. A memory is saved only when it cites the user's own messages, so the bot's claims cannot become facts.

[Intentions](../../src/companion.cjs) are prospective memory: something to bring up later, triggered by the next chat, a topic keyword, a date or a moment (back at the PC, got home, left home). Chat turns get matching ones as a context block; the heartbeat gets the ones due now or matching the presence event that woke it, and speaking up spends an offer. Each is offered at most once per 20 hours and three times, and expires (14 days from a dream, 30 from chat). The `intention_manage` tool lets the chat and the wild heartbeat create, list, finish or cancel them; the Quick session and goals cannot. Diary and intentions live in `state.json`'s encrypted part next to chats and memory.
