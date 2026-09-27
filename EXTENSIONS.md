# Little Bot extensions

Version 0.3 adds one Extensions panel with four tabs.

| Tab | Purpose |
| --- | --- |
| Tools | Inspect built-in capabilities and discovered MCP tools; enable or disable individual external tools. |
| Skills | Save reusable instructions, import a SKILL.md file, and invoke a skill explicitly in chat. |
| MCP servers | Add local stdio programs or remote HTTP endpoints, inspect connection results, and start OAuth where supported. |
| Plugins | Import a local folder bundling skills and MCP server declarations; enable or remove the bundle together. |

Changing extensions requires active tasks to finish or stop. Idle engine contexts are released so the next message loads the current tool configuration. Existing conversations remain available. No additional model call is used for extension discovery or skill selection.

## Try the included plugin

1. Open **Extensions → Plugins → Import plugin**.
2. Select `examples/writing-tools` beside this guide.
3. Enable **writing-tools**, then click **Refresh**.
4. Open **Tools** to inspect `text_stats`, including its input schema. The example uses the `node` executable on your PATH.
5. In a connected chat, write: `$writing-review Review this passage and count its words: ...`

The example tool accepts text and returns character, word, and line counts. It does not read files or access the network. The skill offers editing instructions. The plugin is provided as source; it is not automatically installed into your normal app profile.

## Skills

Create a skill with a name, description, and instruction body, or import a file named **SKILL.md** with frontmatter:

```markdown
---
name: concise-review
description: Review supplied text for clarity and concision.
---
Preserve the author's meaning. Offer a revised passage and explain the main edits.
```

Use `$concise-review` in your message, or click **Use in chat**. That button only adds the invocation to your draft. Enabled skills are applied only when explicitly invoked; their full bodies are not automatically added to every conversation. Up to three skills can be selected per message, with a combined 30,000-character limit. A disabled skill or disabled parent plugin cannot be invoked.

Imports snapshot the instruction body into local app state. Standalone skill imports do not copy supporting scripts or reference files. Plugin instruction changes require removing and reimporting the plugin. This version supports simple quoted or block-scalar name/description frontmatter, not arbitrary YAML features.

## MCP servers

For **Local stdio**, enter an executable and a JSON array of separate arguments. For example, command `node` with arguments `["C:\\Tools\\my-server.cjs"]`. This is not a shell command line. Enable the connection, then refresh to discover its tools. The external runtime must already be installed.

For **Remote HTTP**, enter a clean HTTPS MCP endpoint. Plain HTTP is supported only for loopback addresses. Legacy SSE endpoints are not a separate transport option. URLs containing credentials, query strings, or fragments are rejected.

For credentials, enter environment-variable **names**, never token values. Local connections can forward named environment variables; HTTP connections can use a bearer-token environment variable. Set those values in the environment before launching Little Bot, then restart the app. For OAuth-capable HTTP servers, **Sign in** opens the server's authorization page; the engine manages its credentials. Refresh after completing sign-in. OAuth provider flows still need real-provider verification.

**Refresh** creates a temporary engine context, discovers tools, then releases it. “Connection verified” reports the last check, not a permanently running connection. A normal chat starts its own configured server connections as needed. Disabled tools stay visible so they can be re-enabled.

The engine is configured to prompt for each model-initiated MCP tool call. Little Bot displays tool events, approval questions, and supported primitive MCP forms. There is no direct tool-execution endpoint exposed to the renderer. Local MCP programs have your Windows user permissions and may perform work outside the selected workspace; enable only connections you trust. Heartbeat explicitly disables every effective MCP server and verifies an empty tool inventory before requesting a model turn.

## Plugin format

A supported local plugin has root **plugin.json**, or compatibility **.codex-plugin/plugin.json**, plus optional skill and MCP files:

```text
writing-tools/
  plugin.json
  mcp.json
  server.cjs
  skills/
    writing-review/
      SKILL.md
```

```json
{
  "name": "writing-tools",
  "version": "1.0.0",
  "description": "Reusable writing tools",
  "skills": "./skills"
}
```

MCP declarations use **mcp.json** or **.mcp.json**:

```json
{
  "mcpServers": {
    "writing-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["${PLUGIN_ROOT}/server.cjs"]
    }
  }
}
```

A manifest can instead point `mcpServers` at a relative JSON file. `${PLUGIN_ROOT}` and `${CODEX_PLUGIN_ROOT}` are supported at the start of command/argument paths and resolve to existing files inside the selected plugin folder. The source folder must remain available for local server scripts. Importing validates and snapshots declarations; it does not execute scripts, install dependencies, copy assets, or start servers.

Supported manifests contain descriptive metadata and skills/MCP declarations. Hooks, arbitrary executable extension entrypoints, inline credentials, and unsupported capabilities are rejected. This is a deliberately limited local package format, not full compatibility with every public Codex/Claude/Agent Plugins package. There is no remote marketplace or automatic update mechanism.

Removing a plugin removes its app records, not its original files. Imports reject duplicate names, traversal, escaping links, and oversized packages. Limits are 20 plugins, 100 skills, 30 MCP servers, and 20 instruction skills per plugin.

Native protocol references: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp), and [plugin packaging](https://developers.openai.com/plugins/build/plugins).
