# Context compaction

The [engine](docs/system-guide/19-engine.md) owns the model's working conversation, so the engine compacts it. Summarizing only the app's transcript would leave the model's context unchanged.

## Use it

In **Settings**, choose an **Auto-compaction threshold** from 20% to 95% of the usable context window. The default is 50%. The engine compacts when the conversation reaches that threshold, checked before every model request, so a long task that reads many files or runs many commands is compacted while it works.

Open **Conversation** and choose **Compact now** to compact before continuing. Wait for completion or use **Stop** to interrupt it. Compaction uses the local model and its tokens.

The context strip shows the latest context tokens reported by the model server and the window size. It does not show cumulative tokens. After a compaction the reading is marked stale until the next request reports again.

Completed compactions have a count and timestamp. Failure or interruption is shown without erasing the visible transcript. You can scroll back through the app's original messages after compaction; the model keeps only the summary.

## How it works

- The engine asks the model for a summary of the conversation so far: requests and preferences, what was done, decisions, what is open and the next step, with names, paths and numbers kept exact. The request carries the same system message and tool block as the conversation, so the server's prompt cache still matches and only the new instruction is read.
- The summary replaces the earlier messages. During a turn, the request being worked on stays after the summary so the work continues.
- `settings.autoCompactPercent` becomes the thread's `model_auto_compact_token_limit`: that percentage of the usable window (95% of the context). A context overflow from the server also compacts once and retries the request.
- Manual compaction is `thread/compact/start`: a turn with a `contextCompaction` item and `turn/completed`. Compaction and a reply cannot overlap in the same chat.
- `thread/tokenUsage/updated` supplies `tokenUsage.last.totalTokens` and `modelContextWindow` for the context meter.
- Compaction leaves the app transcript, durable memory and source history intact; `memory_search` and `session_read` still reach earlier detail. A summary is lossy: not every earlier detail stays in the model's context.

## Attribution

The controller's compaction tracking (manual compaction, stop, timeouts, the context meter) was adapted from Hermes Agent at commit `d0288be5b3330d2442e3907185b8e9d0958297bb`; its MIT notice is retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
