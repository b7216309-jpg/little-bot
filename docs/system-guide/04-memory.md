# Memory and CPU embeddings

## How it works

[MemoryService](../../src/memory-service.cjs) owns the SQLite database. [memory.cjs](../../src/memory.cjs) supplies compatibility, automatic explicit-remember handling, episodic capture and prompt-context construction. [recall.cjs](../../src/recall.cjs) exposes memory_search and session_read to the agent.

Records carry a type, scope, project, status, source references and optional key/pin. Corrections supersede earlier records rather than silently erasing their provenance. Forgetting creates suppression so automatic learning does not simply reintroduce the same fact. Project aliases keep knowledge linked when a workspace moves. Search can favor the current project or cover all projects.

The visible timeline is separately indexed in chunks. Routine tool outputs and reasoning are excluded from normal searchable conversation text; source/session reading can reveal the original saved material when requested. Therefore “tools are not learned as personal facts” does not mean “tools are absent from all stored history.”

## Automatic learning

A completed direct turn can create an extraction job. [MemoryConsolidator](../../src/memory-consolidator.cjs) waits for the shared execution lane, runs an ephemeral model session in cache slot 1, validates a small candidate schema and requires references to the job's source messages before saving facts.

Failures retry at most three times with backoff, then remain visible as failed learning jobs. UI controls and memory_manage expose Retry and Discard. The extraction model is the selected language model, not the embedding encoder. Foreground work pauses/cancels extraction.

A valid response with no candidates is allowed. Candidates without valid provenance or with unusable supersession targets are skipped. Consequently, a completed job is not a guarantee that every important fact was extracted. Raw conversation recall remains available. Automated selection is a quality limit, not proof of perfect memory curation.

## Embeddings

[local-embeddings.cjs](../../src/local-embeddings.cjs) manages a worker; [local-embeddings-worker.cjs](../../src/local-embeddings-worker.cjs) runs ONNX Runtime with the **CPU** execution provider, at most two intra-operation threads, and one inter-operation thread.

The [manifest](../../resources/embeddings/manifest.json) pins quantized **BGE-base-en-v1.5**, 768 dimensions, CLS pooling and a 512-token model window. The ONNX file is 110,083,337 bytes; its identity, checksum, download revision and MIT licence declaration are recorded there. Query instructions are added only to queries. Long passages are encoded across all 510-token content windows, combined by token-weighted averaging and normalized.

Semantic vectors supplement lexical/history search. Changing encoder identity invalidates/rebuilds compatible vectors. Embedding failures fall back to text retrieval rather than making the language model unavailable. The default encoder mainly targets English; equal French performance is not promised.

## What can prevent useful recall

Memory is off; scope points at another project; aliases are absent; no relevant record exists; extraction is failed or waiting; the embedding worker/assets are unavailable; or the model chooses no fact. Search result/page limits require pagination for a large archive. Embeddings improve matching, not truth or completeness.

## Verification

[Memory](../../test/memory.test.cjs), [consolidation](../../test/memory-consolidator.test.cjs), [real embeddings](../../test/local-embeddings.test.cjs), [Electron memory runtime](../../test/memory-runtime-electron.cjs) and [retry regressions](../../test/reliability-regressions.test.cjs).
