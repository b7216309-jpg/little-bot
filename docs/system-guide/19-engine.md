# Engine

Little Bot runs its own agent engine, [src/engine](../../src/engine/index.cjs), inside the main process. Since 0.45.0 it replaces the Codex CLI app-server that Little Bot used before. It talks to the local model server directly and runs everything the model asks for itself.

## How it works

The controller and the background runners talk to the engine with requests and hear back through notifications and requests of its own:

- **Requests from the app:** `thread/start`, `thread/resume`, `thread/unsubscribe`, `turn/start`, `turn/interrupt`, `turn/steer`, `thread/compact/start`, `command/exec`, `mcpServerStatus/list`, `mcpServer/tool/call` and `mcpServer/oauth/login`.
- **Notifications:** `turn/started`, `item/started` and `item/completed` (reasoning, agent message, command, file change, app tool, MCP tool, compaction), streaming deltas (reasoning, answer, and a command's output while it runs), `thread/tokenUsage/updated`, `error` and `turn/completed`.
- **Requests to the app:** approval of a command, file change or MCP call, app tool calls (`item/tool/call`), and forms an MCP server asks the user to fill (`mcpServer/elicitation/request`). A stopped turn settles a waiting request and announces it with `serverRequest/resolved`.

A turn sends the conversation to the model, runs the tool calls it makes one at a time, appends their results and asks again, until the model answers without tools. [model.cjs](../../src/engine/model.cjs) streams Chat Completions: reasoning, answer text and tool calls arrive separately (Strata parses Qwen's tool calls itself). It cuts a looping answer at its second repeat, names a context overflow as one, and records usage (input, cached and output tokens) for the Usage page.

## Tools the model gets

- **exec_command and write_stdin** ([shell.cjs](../../src/engine/shell.cjs)): Windows PowerShell 5.1 with UTF-8 output, run through an encoded script so quoting never breaks. A command still running after its wait becomes a session the model can read or type into. Stop kills the whole process tree. Exit code: the command's own `exit`, else a failing program's code, else 1 if PowerShell reported an error.
- **File edits** ([patch.cjs](../../src/engine/patch.cjs)): the `apply_patch <<'PATCH'` heredoc sent as a command (BASE.md describes it). Add, Delete and Update File with hunks; a patch that does not apply writes nothing; Windows line endings are kept.
- **App tools:** the dynamic tools each thread is given, answered by the app.
- **MCP tools** ([mcp.cjs](../../src/engine/mcp.cjs)): `mcp__<server>__<tool>`, from local servers over stdio and remote ones over Streamable HTTP. OAuth sign-in uses discovery, dynamic client registration, PKCE and a loopback redirect; tokens are refreshed and saved encrypted in `data/engine/mcp-auth.json`. A thread's servers start together, with 30 seconds each unless `startup_timeout_sec` says otherwise, since `npx` and `uvx` can download a server on its first start. A form a server asks for during a call goes to the app: the user fills it in a conversation, and background work and Plan mode decline it. Time spent on the form does not count toward the call's timeout.

Every tool result goes back to the model capped at 12,000 characters, beginning and end kept. Images from tools follow the results as one user message, since local servers accept images only from the user.

## Safety

No sandbox, by design. In a conversation the engine asks the app to approve each command, file change and MCP call before it runs (`untrusted` policy); the app refuses one that would send a personal detail or the owner code off the PC (see [PROMPT-SECURITY.md](../../PROMPT-SECURITY.md)). Plan mode runs only commands whose every statement reads (Get-ChildItem, Get-Content, rg, git status ...); anything else, input to a session and patches are refused before they run. Background work (goals, heartbeat) uses its saved permissions: without shell permission it gets no command tool.

## Context and history

The system message (base prompt, instructions, working folder) and the tool list stay byte-stable for a thread, and request JSON is written with sorted keys, so Strata's prompt cache keeps matching. Each assistant turn is stored exactly as it streamed, reasoning included, because Qwen's template puts earlier reasoning back into the prompt.

Before each model call, when the last context reaches the thread's compaction limit, the engine asks the model for a summary (with the same tool block, so the cache still matches) and keeps only that summary plus the request being worked on. A context overflow from the server compacts once and retries. `thread/compact/start` does the same on request.

Conversations are saved after every step in `data/engine/threads/<id>.thread`, encrypted with Windows secure storage; Quick sessions and background runs are not saved. Deleting a session deletes its file. On first start the engine removes the old Codex files from `data/engine`; a conversation whose engine history is gone continues from the visible timeline.

## Verification

[engine.test.cjs](../../test/engine.test.cjs) runs turns against a fake Strata: streaming and usage, approvals and declined commands with live output, patches, app tools with images, Plan mode, Stop during a command, overflow and manual compaction, steering, MCP over stdio, MCP forms, cancelled app requests and removal of the old files. Commands that should finish wait up to 2 minutes, so a loaded machine that is slow to start PowerShell gives the same result.
