# Connections

Little Bot starts with **Local Qwen** at `http://127.0.0.1:8080/v1`. Start the existing Qwen launcher, open Settings, and choose **Check connection**. The model ID and server address can be changed there. Only loopback addresses are accepted.

Local inference uses the installed llama.cpp server's native Responses API. The existing pinned Codex runtime still supplies tools, sandboxing, approval handling, streaming, and compaction. An OpenAI account is not needed for the local connection. Nothing starts, stops, downloads, or replaces the user's model server.

The composer has a **Thinking On/Off** switch for Qwen. It defaults to on and saves one preference for all local chats, goals, automations, heartbeat, and compaction requests. Changes are accepted between runs, including in an existing chat. Codex retains its separate effort setting.

In direct conversations, native reasoning events appear in a collapsed **Thinking…** disclosure. Opening it shows the streamed text; completed **Thoughts** stays in the saved conversation. Raw Qwen content takes precedence over duplicate summaries. Reasoning is separate from final answers and excluded from memory capture and history search. Interrupted reasoning is marked as stopped. Compaction and internal heartbeat reasoning are not added to the chat transcript.

The installed Qwen template requires `chat_template_kwargs.enable_thinking` as a Boolean; `reasoning.effort` does not switch thinking off on this server. A small in-process HTTP relay supplies the template flag. For recognized Qwen3.6 model IDs, it also applies the model's general-use sampling recommendations: temperature/top-p **1/0.95** with thinking, **0.7/0.8** without; top-k **20**, min-p **0**, presence penalty **1.5**, repetition penalty **1** in both modes. These are general defaults, not a measured optimum for every task or quantization. Other model IDs retain their generation settings.

Qwen3.6 output is capped at **15,360 tokens**, with at most **12,288** for reasoning so the model has room to answer. Tighter request limits are preserved; smaller output limits reserve up to one fifth for the answer. Thinking Off uses a reasoning budget of zero. Token-count requests receive only the template flag. These request settings apply to Little Bot without altering the shared server launcher. See [Qwen's recommendations](https://huggingface.co/Qwen/Qwen3.6-35B-A3B#best-practices).

The relay also supplies the missing `content_index: 0` on llama.cpp's single-part reasoning deltas so Codex can stream them. Other response events remain unchanged. It binds to loopback on a random port, uses private random routes mapped to validated loopback servers, and closes with the app. It adds no dependency or persistent service.

**Codex** remains available in Settings with ChatGPT sign-in or an OpenAI API key. Switching connections preserves saved sign-in credentials. A failed local connection never falls back to a cloud model.

## Usage display

**Settings → Connection** shows connection-specific, read-only usage information.

For Codex, Little Bot reads the pinned app-server's `account/rateLimits/read` response. It supports one default bucket or multiple named buckets, primary and secondary windows, reset times, provider plan labels, and provider-reported limit state. Sparse rolling notifications trigger a full refetch so a partial event cannot erase the last complete display. Little Bot does not infer which bucket belongs to the selected model or convert allowance into a price.

For Local Qwen, the app shows transient whole-turn timing and engine-reported token counts. Output tokens already include the reasoning-token subset, so reasoning is displayed separately without being counted twice. Tool-containing turns remain visible but are omitted from the rolling throughput average; compaction, failed, interrupted, and empty-output turns are excluded.

These values are not saved to conversations, Memory, or `state.json`. They disappear when the app closes, and switching local models clears prior local samples. Goal token, time, action, run, and retry limits remain separate application controls. See [USAGE.md](USAGE.md).

Each chat, goal, routine, and heartbeat keeps its connection. Earlier records remain bound to Codex. Select their saved connection before continuing them; create a new chat to use another connection. Changing the local server also requires a new chat or returning to the saved address. This avoids silently sending an existing conversation to a different provider.

Image-input support is normalized per model across connections. Codex model discovery uses the pinned app-server `inputModalities` field; local discovery uses catalog capability hints and the selected server’s `/props` vision state, with `/props` taking precedence for the active model. The installed Qwen server reports image support and a 147,456-token window. Little Bot disables provider-hosted web search for local inference; the app's browser, Firecrawl, and Brave tools remain available according to their normal permissions.

The installed server accepts images in incoming messages but rejects image-valued tool results. Little Bot disables the native `view_image` tool for the local connection using `features.view_image = false`. Attach photos to inspect them; returning image files and browser screenshots still works. MCP tools that return image content have the same server limitation. Codex keeps its normal image-viewing tool.

Configuration follows [Codex custom model providers](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers): a separate provider using `wire_api = "responses"` and `requires_openai_auth = false`.
