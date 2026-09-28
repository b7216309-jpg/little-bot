# Provider usage and local performance

Open **Settings → Connection** to inspect the read-only usage panel for the currently selected connection.

The panel deliberately separates two different kinds of information:

- **Codex provider usage** reports the rate-limit windows returned by the selected Codex account.
- **Local performance** reports transient timing and token counts observed from completed local model turns.

Neither display changes permissions, schedules, provider settings, or autonomous-goal budgets.

## Codex provider usage

When Codex is connected, Little Bot calls the pinned app-server method `account/rateLimits/read`. It displays only fields the provider actually returns:

- named limit buckets, when supplied;
- primary and secondary windows;
- percentage used and percentage remaining;
- window duration;
- reset time;
- provider-reported limit or spend-control state;
- the provider plan label, when present.

A provider may return one default bucket or several independently named buckets. Little Bot does not guess that a bucket belongs to the currently selected model. It shows the provider's bucket name or identifier as reported.

### Rolling updates

The app-server's `account/rateLimits/updated` notification contains one sparse rate-limit snapshot rather than the complete account response. Little Bot therefore keeps the last complete display and requests a fresh `account/rateLimits/read` result. If another sparse notification arrives while that read is running, one follow-up read is queued.

A failed or unsupported rate-limit read changes only the panel to **Unavailable**. It does not disconnect Codex or block chats, goals, heartbeat, automations, or extensions. Common credential patterns are redacted before an error reaches the renderer.

The **Refresh** button performs the same read-only request. It cannot purchase credits, change a plan, reset a limit, select a model, or alter account configuration.

## Local performance

Local connections do not expose a provider quota service. Instead, Little Bot measures completed local engine turns in the open app and displays:

- reported output tokens per second;
- time to first reasoning or answer output;
- total turn duration;
- input and cached-input token counts;
- output tokens;
- reasoning tokens as a subset of output tokens;
- whether the turn used tools.

The output rate divides engine-reported output tokens by the interval from first model output to turn completion. Reasoning tokens are shown separately but are **not added to output tokens again**.

Tool-containing turns remain visible because their end-to-end timing is useful, but they are excluded from the rolling throughput average. Context-compaction turns, interrupted turns, failed turns, and turns with no reported output tokens are not sampled. At most the latest ten completed samples are retained in memory.

These figures are observational, not a controlled benchmark. They can vary with prompt length, reasoning mode, context reuse, model load, hardware, thermal state, tool latency, and server configuration.

## Persistence and privacy

Provider usage and local performance are transient runtime state:

- they are not written to `state.json`;
- they are not added to Memory or conversation history;
- they are not sent to the model as instructions;
- they disappear when Little Bot closes;
- switching local models clears samples from the previous model.

Codex limit data comes from the connected Codex app server. Local timing uses events and token counts already emitted by the selected local engine.

## Independent goal budgets

Goal controls remain independent of this panel. The saved limits for tokens, elapsed minutes, actions, model runs, and retries continue to be enforced by Little Bot even when the provider reports additional allowance. Conversely, a provider limit can prevent a request even when a goal still has application budget remaining.

The panel does not estimate prices, currency cost, future allowance, or time-to-exhaustion. It does not convert token counts into money or infer provider terms that were not returned by the protocol.

## Troubleshooting

For Codex, check that the account is connected and use **Refresh**. An unavailable panel with otherwise working chat usually means the pinned provider did not return a usable rate-limit response; ordinary work remains available unless the provider itself rejects it.

For a local connection, complete a normal model turn. A tool-free turn is required before a rolling average appears. Compaction and failed or interrupted turns intentionally produce no sample.
