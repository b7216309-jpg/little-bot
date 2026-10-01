# Model connections, reasoning and Strata

## How it works

[connections.cjs](../../src/connections.cjs) normalizes Codex/local bindings and probes a local server's model and capabilities. A saved task retains its connection, local base URL and model. It cannot silently move to another local model or provider: select its saved binding or edit the task.

The bundled engine expects Responses. [local-model-relay.cjs](../../src/local-model-relay.cjs) creates a loopback relay and routes calls to the configured local provider. [strata-responses-adapter.cjs](../../src/strata-responses-adapter.cjs) translates Responses input, tool calls, reasoning and streaming events to Strata's Chat Completions protocol. [responses-namespace-compat.cjs](../../src/responses-namespace-compat.cjs) handles tool-namespace compatibility for relevant local providers. [local-generation.cjs](../../src/local-generation.cjs) applies its Qwen-specific generation defaults only to the aliases it recognizes, not every custom model.

The thinking selector and reasoning effort are different controls. The local thinking setting controls the local adapter's thinking behavior; effort is chosen from the model's supported engine efforts. Unsupported settings must not be interpreted as evidence that the model actually used that effort.

## Structured output and stream failures

The Strata adapter forwards JSON output schemas through response_format and developer instructions. Current Strata does not guarantee schema-constrained decoding. Memory, heartbeat, goals and answer checks must parse and validate the actual response; asking for JSON is not enough.

SSE parsing reconstructs function arguments before releasing a tool call. An output length cutoff produces response.failed with partial text and usage, without exposing incomplete tool calls. Disconnections can interrupt a turn; they are not evidence that its tools never ran. The engine RPC acknowledgement problem is described in R3 of the [review](review.md).

## Cache ownership

Little Bot sends each workflow's full conversation through the same standard Strata relay. Chat, extraction, goals, heartbeat and Independent Check retain their own histories; the relay does not assign cache slots or add `strata_cache_slot`.

Official Strata 0.1.30 and later select compatible token/image prefixes automatically when conversation parking is enabled. Strata owns the snapshot state, count, storage budget and admission checks. The local 0.1.33 engine adds `--conversation-cache-storage ssd`, using private temporary files for inactive recurrent state, checkpoints and K/V. The normal 262K configuration has a 16 GiB disk budget, eight histories and a 1 GiB free-RAM floor. Active model state still occupies RAM/VRAM, and the operating system may cache disk reads in reclaimable RAM. Caching stays off unless configured on the server. The [integration guide](../../integrations/strata/README.md) includes the versioned patch, build and update instructions; an official engine replacement needs this addition rebuilt.

Caching reuses compatible prompt prefixes. Changed tool definitions, profile, instructions, model or session context can require fresh prefill. Cached token counts are provider-reported; low RAM usage or a short delay alone does not prove a cache hit.

## Verification and limits

[Strata probing](../../test/connections-strata.test.cjs), [adapter](../../test/strata-responses-adapter.test.cjs), [relay](../../test/local-model-relay-strata.test.cjs), [namespace compatibility](../../test/responses-namespace-compat.test.cjs) and [vision](../../test/provider-vision.test.cjs). Live relay and SSD engine checks are recorded in [VALIDATION.md](../../VALIDATION.md). The GPU fixtures compare RAM and SSD restores byte for byte across supported KV formats; live inference uses RTX 4070 Ti, int8 streaming KV and MTP. Image rotation and other hardware require separate live validation.
