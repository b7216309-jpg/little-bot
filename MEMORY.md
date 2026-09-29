# Continuous conversation and memory

Little Bot 0.9 uses one persistent conversation. New messages, scheduled runs, workspace changes, and model changes retain that timeline. There are no New chat, Private session, or Delete conversation controls. Changing a model, provider, working folder, or tool mode can replace the underlying engine thread. The app carries recent conversation context and retrieved memory into the replacement thread. Native compaction still manages the engine's live context independently of the saved timeline.

## Storage

`memory.sqlite` lives beside `state.json` in the app data directory. It is an ordinary local SQLite database with full-text indexes. The memory database is not encrypted or redacted. It is shared by all model connections. Existing state-file encryption is separate and does not encrypt this database. No remote database or embedding service is required.

The database keeps:

- Facts, preferences, decisions, discoveries, procedures, and unresolved issues.
- One work episode for each completed turn, with source links.
- Searchable conversation and tool text, including earlier text after engine compaction.
- A working checkpoint describing the latest objective, status, outcome, and answer.
- Searchable goal ledger evidence, whose authoritative record remains the goal itself.
- Stable project IDs and folder aliases, so moving a project does not orphan its knowledge.
- Durable extraction jobs that resume after interruption or restart.

There is no 100-fact cap, 30-episode cap, or automatic 30-day expiry. The memory panel and prompt use bounded selections; those presentation limits do not delete database records. This redesign does not import the old fact/episode arrays. Conversation state and memory have separate storage lifecycles.

## Learning

After a completed turn, Little Bot queues a memory extraction job. While the foreground execution lane is idle, an ephemeral engine turn extracts useful durable knowledge using the selected model. This consumes model tokens. The extraction job receives the source messages and existing records; it does not run tools. User messages take priority: a new message interrupts extraction and waits for its terminal acknowledgment before starting. Interrupted jobs remain pending. Failed jobs retain their error and retry later.

Every automatically extracted memory cites original message IDs. Suggestions should not be stored as accepted decisions. Automatic extraction can still make mistakes; the panel exposes the original sources and lets you correct them. No private reasoning or chain-of-thought transcript is requested by the extraction prompt.

Use `memory_save` for immediate explicit remembering, correction, or pinning; `memory_forget` forgets a record by ID. The familiar "Remember that ..." prefix also saves immediately. Other languages and phrasings can use the model's memory tool or automatic extraction.

Editing a memory creates a new version and marks the previous version superseded. Pin changes preserve the record ID. Search normally selects active records; historical versions can be requested explicitly. Stable semantic keys let later extraction update an existing subject rather than accumulate contradictory copies.

Forget removes the selected durable record and its correction family from retrieval. It stores suppression fingerprints, keys, and source references to prevent the same source being automatically learned again. It does not erase the original conversation transcript. Explicitly saving a new memory is still possible.

## Retrieval

Each request receives a bounded selection of relevant project/global memories, pinned records, preferences, and the working checkpoint. Full-text search supports precise terms, commands, and filenames. `memory_search` returns source-linked results; `session_read` can jump directly to a message and page surrounding history. `scope: "all"` searches across projects, regardless of which model originally produced the record.

Optional semantic search uses an OpenAI-compatible `/v1/embeddings` endpoint configured under Memory's advanced settings. Enter the endpoint base URL, model, and optional key. Embeddings are generated in background batches and stored locally. Changing endpoint or model invalidates their identity. When an embedding endpoint is unavailable, keyword retrieval continues to work. The app does not install or download an embedding model.

The Memory panel supports search, type filtering, edit, pin/unpin, forget, source inspection, and the context used in the latest reply. Pausing memory stops recall and automatic learning while keeping saved records available for management. Folder aliases can attach a moved working folder to an existing project.

## Validation

Run `npm run ci`. The focused memory tests exercise durable storage, supersession, forgetting and source suppression, project aliases, current-session history, direct source paging, background extraction/preemption, and a real local HTTP embedding fixture. Electron tests exercise the conversation UI and memory controls. Deterministic fake model responses verify orchestration; extraction quality still depends on the selected model.
