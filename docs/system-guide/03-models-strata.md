# Model connections, reasoning and Strata

## How it works

[connections.cjs](../../src/connections.cjs) normalizes Codex/local bindings and probes a local server's model and capabilities. A saved task retains its connection, local base URL and model. It cannot silently move to another local model or provider: select its saved binding or edit the task.

The bundled engine expects Responses. [local-model-relay.cjs](../../src/local-model-relay.cjs) creates a loopback relay and routes calls to the configured local provider. [strata-responses-adapter.cjs](../../src/strata-responses-adapter.cjs) translates Responses input, tool calls, reasoning and streaming events to Strata's Chat Completions protocol. [responses-namespace-compat.cjs](../../src/responses-namespace-compat.cjs) handles tool-namespace compatibility for relevant local providers. [local-generation.cjs](../../src/local-generation.cjs) applies its Qwen-specific generation defaults only to the aliases it recognizes, not every custom model.

The thinking selector and reasoning effort are different controls. The local thinking setting controls the local adapter's thinking behavior; effort is chosen from the model's supported engine efforts. Unsupported settings must not be interpreted as evidence that the model actually used that effort.

## Structured output and stream failures

The Strata adapter forwards JSON output schemas through response_format and developer instructions. Current Strata does not guarantee schema-constrained decoding. Memory, heartbeat, goals and answer checks must parse and validate the actual response; asking for JSON is not enough.

SSE parsing reconstructs function arguments before releasing a tool call. An output length cutoff produces response.failed with partial text and usage, without exposing incomplete tool calls. Disconnections can interrupt a turn; they are not evidence that its tools never ran. The engine RPC acknowledgement problem is described in R3 of the [review](review.md).

## Cache ownership

Little Bot requests separate Strata cache slots:

| Slot | Work |
| --- | --- |
| 0 | Foreground conversation / shared scheduled conversation |
| 1 | Automatic memory extraction |
| 2 | Goals and heartbeat |
| 3 | Independent Check |

These hints do not implement a cache inside Little Bot. Strata must support the corresponding request metadata and cache rotation. The relevant upstream work is [Strata PR 175](https://github.com/Niko1221/Strata/pull/175); SSD offload of inactive cache state also depends on the matching Strata implementation/configuration. A stock or incompatible Strata build cannot gain that behavior from this UI alone. The [integration guide](../../integrations/strata/README.md) records the patch, build steps and separate-server slot/needle/cancellation checks. See also the [README](../../README.md) cache section.

Caching reuses compatible prompt prefixes. Changed tool definitions, profile, instructions, model or session context can require fresh prefill. Cached token counts are provider-reported; low RAM usage or a short delay alone does not prove a cache hit.

## Verification and limits

[Strata probing](../../test/connections-strata.test.cjs), [adapter](../../test/strata-responses-adapter.test.cjs), [relay](../../test/local-model-relay-strata.test.cjs), [namespace compatibility](../../test/responses-namespace-compat.test.cjs) and [vision](../../test/provider-vision.test.cjs). The same application revision also passed the earlier installed-app live Strata checks recorded in [VALIDATION.md](../../VALIDATION.md). This review did not benchmark SSD offload or exercise a paid Codex account.
