# Connections

Little Bot runs on a local model only. It starts with **Local Qwen** at `http://127.0.0.1:8080/v1`. Start the existing Qwen launcher, open Settings, and choose **Check connection**. The model ID and server address can be changed there. Only loopback addresses are accepted.

Little Bot's engine sends standard Chat Completions requests to the local server and supplies tools, approvals, streaming and compaction itself. No account or cloud service is involved, and a failed local connection never falls back to one. Nothing starts, stops, downloads, or replaces the user's model server.

When the selected server identifies itself as Strata in `/props`, or has Strata's `/health` shape, Little Bot marks the connection as Strata: it reads the context size and vision support from `/health` and offers Strata's reasoning levels. Strata parses the model's tool calls and streams reasoning separately; other servers that do the same work unchanged.

For a detected Strata connection, the composer replaces the legacy local Thinking On/Off switch with **None / Low / Medium / High** reasoning levels. None disables thinking; Low, Medium, and High enable thinking and pass that effort through to Strata. The existing On/Off control remains unchanged for non-Strata local models.

The composer has a **Thinking On/Off** switch for Qwen. It defaults to on and saves one preference for all local chats, goals, automations, heartbeat, and compaction requests. Changes are accepted between runs, including in an existing chat.

In direct conversations, native reasoning events appear in a collapsed **Thinking…** disclosure. Opening it shows the streamed text; completed **Thoughts** stays in the saved conversation. Raw Qwen content takes precedence over duplicate summaries. Reasoning is separate from final answers and excluded from memory capture and history search. Interrupted reasoning is marked as stopped. Compaction and internal heartbeat reasoning are not added to the chat transcript.

The installed Qwen template requires `chat_template_kwargs.enable_thinking` as a Boolean; `reasoning.effort` does not switch thinking off on this server. A small in-process HTTP relay supplies the template flag. For recognized Qwen3.6 model IDs, it also applies the model's general-use sampling recommendations: temperature/top-p **1/0.95** with thinking, **0.7/0.8** without; top-k **20**, min-p **0**, presence penalty **1.5**, repetition penalty **1** in both modes. These are general defaults, not a measured optimum for every task or quantization. Other model IDs retain their generation settings.

Qwen3.6 output is capped at **15,360 tokens**, with at most **12,288** for reasoning so the model has room to answer. Tighter request limits are preserved; smaller output limits reserve up to one fifth for the answer. Thinking Off uses a reasoning budget of zero. Token-count requests receive only the template flag. These request settings apply to Little Bot without altering the shared server launcher. See [Qwen's recommendations](https://huggingface.co/Qwen/Qwen3.6-35B-A3B#best-practices).

The relay also supplies the missing `content_index: 0` on llama.cpp's single-part reasoning deltas so the engine can stream them. Other response events remain unchanged. It binds to loopback on a random port, uses private random routes mapped to validated loopback servers, and closes with the app. It adds no dependency or persistent service.

## Usage display

**Settings → Connection** shows read-only local performance. The app shows transient whole-turn timing and engine-reported token counts. Output tokens already include the reasoning-token subset, so reasoning is displayed separately without being counted twice. Tool-containing turns remain visible but are omitted from the rolling throughput average; compaction, failed, interrupted, and empty-output turns are excluded.

These values are not saved to conversations, Memory, or `state.json`. They disappear when the app closes, and switching local models clears prior local samples. Goal token, time, action, run, and retry limits remain separate application controls. See [USAGE.md](USAGE.md).

The conversation, the Quick session and each saved session keep their timelines. Changing the model, local server, or working folder rotates the engine context as needed while preserving the visible timeline. A recent-history bridge and relevant durable memory accompany the next request. Memory searches work across models. Goals, routines, and heartbeat keep their saved server; when the server loads another model, they move to it.

Manual compaction follows the selected model. Switching from IQ2_XS to IQ3_S reloads the same native history with IQ3_S before summarizing it, including when compaction is the first action after the switch. The visible transcript is preserved, and the next chat turn continues with the compacted history.

Image-input support is checked per model. Discovery uses catalog capability hints and the selected server’s `/props` vision state (Strata: `/health`), with the server's answer taking precedence for the active model. The installed Qwen server reports image support and a 147,456-token window. Little Bot disables provider-hosted web search for local inference; the app's browser and its built-in web search and page-reading tools remain available according to their normal permissions.

The installed server accepts images in incoming messages but rejects image-valued tool results. Little Bot disables the native `view_image` tool for the local connection using `features.view_image = false`. Attach photos to inspect them; returning image files and browser screenshots still works. MCP tools that return image content have the same server limitation.

The engine reaches the relay as a custom model provider using `wire_api = "responses"` and `requires_openai_auth = false`.

Official Strata 0.1.30 and later provide optional automatic conversation parking in RAM. The local 0.1.33 engine adds temporary SSD storage using its current snapshot implementation. Little Bot sends standard requests with full histories and needs no custom slot metadata in either mode. See the [integration guide](integrations/strata/README.md) for configuration, the versioned SSD patch and update instructions.
