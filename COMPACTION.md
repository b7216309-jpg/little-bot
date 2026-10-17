# Context compaction

Little Bot follows Hermes Agent's **native app-server compaction path**. The bundled engine owns the model's conversation context, so the engine must compact it. Summarizing only the Electron app's transcript would leave the actual model context unchanged.

## Use it

In **Settings**, choose an **Auto-compaction threshold** from 20% to 95% of the usable context window. The default is 50%. The engine compacts the conversation when it reaches that threshold, both while a turn is still working (a long task that reads many files or runs many commands) and after a final response. A turn compacted mid-way carries on from the summary and finishes normally. Set the value to 0 to use only the engine's own limit, at 90% of the window. That native limit remains active at every setting. Changes take effect with the next reply, including existing conversations; no app restart is needed. An already running reply finishes with the setting it started with.

No timer or second model service is added. Open **Conversation** and choose **Compact now** to request compaction before continuing. Wait for completion or use **Stop** to interrupt it. Compaction needs the same connected account as chatting and may consume model tokens.

The context strip shows the latest engine-reported context tokens and window size when available. It does not show cumulative billable tokens or money spent. Reports can lag the next request and include engine estimates. Unknown values remain unknown; a stale reading after compaction is not presented as a new, smaller context.

Completed compactions have a count and timestamp. Failure or interruption is shown without erasing the visible transcript. The same thread, working folder, tool configuration, and permission policy are retained. You can scroll back through the app's original messages after compaction; the model may need to reopen files for details that its compacted context no longer retains.

## How it works

- Manual compaction resumes the existing thread if needed, then calls `thread/compact/start`.
- Automatic compaction sets two engine options from `settings.autoCompactPercent`: `model_post_turn_compact_threshold_percent`, checked when a turn ends, and `model_auto_compact_token_limit`, checked after every model request inside a turn. The token limit is the same percentage of the usable window (95% of the local server's context), so both fire at the same point. Before 0.32.0 only the turn-end check was set, so a long tool-using turn grew to the native 90% limit before anything compacted. It applies to the conversation, the Quick session and scheduled turns. Newly opened engine contexts receive the current setting. Ephemeral goal and heartbeat threads retain native hard limits without this extra turn-end compaction because their context is discarded after the turn.
- Existing loaded chats are detached and resumed between turns when the percentage or the token limit changes. This is necessary because the pinned engine ignores configuration overrides on a subscribed session. The same thread and history are retained; no background compaction loop or transcript-based token estimate is used.
- The empty RPC acknowledgment means the request was accepted. Completion is tracked through the matching native turn and `contextCompaction` item events.
- Compaction and a user reply cannot overlap in the same chat. Native compaction inside an ordinary reply does not prematurely finish that reply.
- `thread/tokenUsage/updated` supplies `tokenUsage.last.totalTokens` and `modelContextWindow`; cumulative `tokenUsage.total` is not used for the context meter.
- Compaction leaves the app transcript intact. It does not create a recent-work note or durable fact. Durable SQLite memory, source history, and working-state checkpoints are maintained separately. Relevant records can be retrieved again with `memory_search` and `session_read` even when native context no longer includes the original details.
- On restart, interrupted work returns to an idle state with an interruption message; it is not counted as successful compaction.

The percentage is provided by the native engine rather than Hermes's provider-specific auxiliary summarizers or micro-compaction. Native compaction is a lossy summary, not a guarantee that every earlier detail remains in the model's context.

## Upstream reference

Both settings are defined by the [pinned engine's 0.157.1 configuration schema](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/core/config.schema.json), which defines the percentage as a turn-end threshold of the usable context window and the token limit as the in-turn auto-compaction point. See also the [engine configuration reference](https://developers.openai.com/codex/config-reference/).

Reviewed Hermes Agent at commit `d0288be5b3330d2442e3907185b8e9d0958297bb`:

- [App-server compaction transport and event handling](https://github.com/NousResearch/hermes-agent/blob/d0288be5b3330d2442e3907185b8e9d0958297bb/agent/transports/codex_app_server_session.py)
- [Native compaction routing](https://github.com/NousResearch/hermes-agent/blob/d0288be5b3330d2442e3907185b8e9d0958297bb/agent/conversation_compression.py)
- [Hermes compaction documentation](https://github.com/NousResearch/hermes-agent/blob/d0288be5b3330d2442e3907185b8e9d0958297bb/website/docs/developer-guide/context-compression-and-caching.md)

The behavior is adapted to Little Bot's JavaScript controller and the pinned engine protocol. Hermes's Python runtime is not bundled. Its MIT notice is retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
