# Model connections, reasoning and Strata

## How it works

[connections.cjs](../../src/connections.cjs) normalizes local-server bindings and probes a local server's model and capabilities (`/v1/models`, `/props`, and Strata's `/health` for its context size and vision). A saved task retains its local base URL and model. Records saved by the retired cloud connection move to the local server. When the server loads another model, background jobs whose model is gone follow the loaded one; otherwise a task cannot silently move to another server.

The [engine](19-engine.md) sends standard Chat Completions requests straight to the local server and streams the answer ([model.cjs](../../src/engine/model.cjs)). Any OpenAI-compatible server works; Strata is the tuned one:

- **Tool calls:** Strata parses Qwen's tool calls itself (its XML form, and since 0.2.2 calls opened with the wrong tag) and streams them as standard `tool_calls`.
- **Reasoning:** streamed separately as `reasoning_content`. `reasoning_effort` (none, low, medium, high) maps onto the model's template, and `chat_template_kwargs.enable_thinking` follows the local thinking setting.
- **Sampling:** the Settings choices (temperature, top-p, top-k, max tokens, seed) go into each request; otherwise Strata's own settings apply. An unset output limit lets Strata fit the answer to the room left in the context.
- **Usage:** the final chunk reports prompt, cached and completion tokens; the engine records them for the Usage page and the context meter.
- **One request at a time:** Strata serves one sequence behind a queue; closing the connection cancels the request.

## Structured output and stream failures

A tool-less request with an output schema sends it as `response_format`. Strata prompts for the format and validates afterwards (`constrained_decoding: false` in `/v1/status`); it does not constrain the model while it writes. Tool-enabled turns (heartbeat, goals) put the schema in the prompt, and every caller still repairs and validates the result with [model-json](../../src/model-json.cjs).

A prompt longer than the context is refused with HTTP 400; the engine names it as an overflow, compacts once and retries. An answer that loops is cut at its second repeat. An empty answer, or an output limit reached before any text, fails the turn with a message.

## Cache ownership

Strata reuses any earlier request's token prefix, and with conversation parking keeps whole conversations (in RAM, or on the SSD with the local patch) for later. Reuse needs the new prompt to start exactly like the old one, so the engine keeps each thread's system message and tool list byte-stable, writes request JSON with sorted keys, and stores every assistant turn exactly as it streamed: Qwen's template puts earlier reasoning back into the prompt. A compaction request carries the same tool block, because the template renders tools at the top of the prompt. Changing instructions, tools, profile or model needs a fresh prefill. Cached token counts are server-reported; a short delay alone does not prove a cache hit.

The [integration guide](../../integrations/strata/README.md) covers the SSD conversation-cache patch, its build and the cache check.

## Verification and limits

[engine.test.cjs](../../test/engine.test.cjs) runs the engine against a fake Strata stream. Live SSD-cache checks are recorded in [VALIDATION.md](../../VALIDATION.md); vision rotation and other hardware need separate live validation.

**Images.** Local servers accept images only in user messages. Images that tools return (screen captures, copied images) follow the tool results as one user message; a server started without its vision encoder rejects them.
