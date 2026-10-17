# Usage and local performance

## Usage page

Open **Tools → Usage** to see the tokens Little Bot read and wrote on this PC: per day, per source (the conversation, sessions, Quick, routines, heartbeat, night shift, goals, memory learning and dreams, answer checks, compaction), per hour of day and per model, over 7, 30 or 90 days or everything. The counts are Strata's own numbers for every request, recorded as each one finishes, with how much of each prompt came from Strata's cache and the average generation speed. Counting started with 0.34.0; nothing earlier exists. Only counts are kept (in `state.json`, 400 days), never text.

## Local performance panel

Open **Settings → Connection** to see the read-only local performance panel. It reports transient timing and token counts observed from completed local model turns. It does not change permissions, schedules, model settings, or autonomous-goal budgets.

## What it shows

Little Bot measures completed local engine turns in the open app and displays:

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

Local performance is transient runtime state:

- it is not written to `state.json`;
- it is not added to Memory or conversation history;
- it is not sent to the model as instructions;
- it disappears when Little Bot closes;
- switching local models clears samples from the previous model.

Timing uses events and token counts already emitted by the engine for the local model.

## Independent goal budgets

Goal controls remain independent of this panel. The saved limits for tokens, elapsed minutes, actions, model runs, and retries are enforced by Little Bot on their own. The panel does not estimate prices or convert token counts into money.

## Troubleshooting

Complete a normal model turn. A tool-free turn is required before a rolling average appears. Compaction and failed or interrupted turns intentionally produce no sample.
