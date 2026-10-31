# Context compaction

The [engine](docs/system-guide/19-engine.md) owns the model's working conversation, so the engine compacts it. Summarizing only the app's transcript would leave the model's context unchanged.

## Use it

In **Settings**, choose an **Auto-compaction threshold** from 20% to 95% of the usable context window. The default is 50%. The engine compacts when the conversation reaches that threshold. It checks right after an answer, so you can read the reply while it summarizes and your next message starts at once, and before every model request, so a long task that reads many files or runs many commands is compacted while it works. A threshold of 0 leaves only a limit at 90% of the window.

Open **Conversation** and choose **Compact now** to compact before continuing. Wait for completion or use **Stop** to interrupt it. Compaction uses the local model and its tokens.

The context strip shows the latest context tokens reported by the model server and the window size. It does not show cumulative tokens. After a compaction the reading is marked stale until the next request reports again.

Failure or interruption is shown without erasing the visible transcript. You can scroll back through the app's original messages after compaction; the model keeps the summary and the newest messages.

## How it works

- The engine asks the model for notes under fixed headings: the user's requests and preferences, what was done, decisions, what is open and the next step, carrying over what still matters from any earlier summary, with names, paths and numbers kept exact. The request carries the same system message and tool block as the conversation, so the server's prompt cache still matches and only the new instruction is read. It runs with thinking off, a low temperature and at most 4,096 tokens: a summary is exact work, and reasoning over a full context took minutes.
- The notes replace the earlier messages, but not all of them. The newest messages stay word for word (at most 32,000 characters, a fifth of the limit, or a quarter of what was there), with long tool results clipped and stored reasoning dropped, whole tool steps only. During a turn, the request being worked on stays too.
- What the app calls standing context (shell rules, profile, the session note) goes to the engine with every turn as `standing`, is saved with the thread and is put back at the top after a compaction. Goals, memory and the app guide are sent again with the next message.
- The notes say that the whole conversation is still reachable with `memory_search` and `session_read`, when the thread has those tools.
- `settings.autoCompactPercent` becomes the thread's `model_auto_compact_token_limit`: that percentage of the usable window (95% of the context). When a server reports no usage, the context is measured from the text.
- A context overflow from the server compacts and retries once. If the summary request does not fit either, it is sent again with old tool results cut short, then with only the newest half. If nothing fits, the conversation goes on from its newest messages and says that older ones were removed.
- A compaction that fails while there is still room does not end the turn. It tries again once the context has grown by another 5%.
- Manual compaction is `thread/compact/start`: a turn with a `contextCompaction` item and `turn/completed`. Compaction and a reply cannot overlap in the same chat.
- `thread/tokenUsage/updated` supplies `tokenUsage.last.totalTokens` and `modelContextWindow` for the context meter.
- Compaction leaves the app transcript, durable memory and source history intact; `memory_search` and `session_read` still reach earlier detail. A summary is lossy: not every earlier detail stays in the model's context.

## Attribution

The controller's compaction tracking (manual compaction, stop, timeouts, the context meter) was adapted from Hermes Agent at commit `d0288be5b3330d2442e3907185b8e9d0958297bb`; its MIT notice is retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
