# Agent tools and terminal execution

## Tool families and ownership

[AgentTools](../../src/agent-tools.cjs) defines dynamic tools registered with the native engine. It validates inputs and dispatches them to their application owners.

At dispatch, inputs are normalized against each live tool schema: numeric and boolean strings, case-insensitive enum values, scalar-to-list values, common field aliases, and common local date formats are repaired before validation. Attachment paths expand `~` and resolve relative to the current workspace. When a call still fails, its tool error is returned to the model as short text with a corrected example; unknown tool and action names include the closest valid name. Large tool results are capped while keeping their beginning and end, and empty memory/web searches say that no results were found.

For local models, AgentTools also records a generic lesson when it repairs an argument. Controller watches each turn for a failed app-tool call followed by a successful same-intent retry, and for failed native commands followed by a PowerShell or path correction. The Strata adapter records its `apply_patch` and unknown-tool rewrites directly. Lessons are per model and explained in [04-memory.md](04-memory.md); a matching app-tool error gets the stored lesson appended as one line.

| Family | Implementation |
| --- | --- |
| memory_search / session_read | Recall / MemoryService |
| memory_save / memory_forget | Durable memory |
| skill_list / skill_read | Enabled skills and plugin ownership |
| calendar_list / calendar_manage | Local calendar handlers |
| goal_manage / schedule_manage | Goal drafts and recurring schedule management |
| ask_user | Persisted question/request routing |
| attachment_send | Workspace/browser-output import and visible delivery |
| browser / web_search_service / web_scrape | EmbeddedBrowser / WebServices |
| windows_ui | WindowsUia (other Windows apps through UI Automation) |
| screen_capture / clipboard / document_render | [DesktopTools](../../src/desktop-tools.cjs): screen and window captures, clipboard text and images, HTML to PDF/PNG |
| app_state and *_manage / *_control | AppManagement and registered main handlers |

The read-only set contains skills, recall and calendar_list. Direct full chat receives the broader tool set. Heartbeat, goals and Independent Check do not inherit every direct-chat management operation. Goals use their own permitted workspace/write/terminal/network/MCP tools.

**Desktop tools.**
- `screen_capture` grabs one display (primary first) or one window, by the handle from `windows_ui list_windows`, through Electron's desktopCapturer. Small windows are scaled up to the same 1600-pixel cap.
- `clipboard` reads and writes text and reads a copied image, through Electron 44's asynchronous clipboard API.
- Captured and copied images are resized to at most 1600 pixels and saved as JPEG in `data/screenshots` (the last 20 are kept), where attachment_send can deliver them.
- The pixels go back to the engine as an `inputImage` content item, carried beside the JSON result under a Symbol key so the 25,000-character text cap never meets the base64.
- Screen and clipboard work only for the user's running conversation or a scheduled task, never for heartbeat or goals.
- `document_render` loads an HTML file from the working folder in a hidden window, with scripts off and every non-file request cancelled, and saves `printToPDF` output (preferring CSS `@page` size) or an offscreen PNG. Browsers on the PC are not used: Edge can be missing, and a headless third-party Chromium browser hung on `--print-to-pdf` during testing.

[AppManagement](../../src/app-management.cjs) exposes richer settings, goals, heartbeat, attachments and extension controls. app_state gives a compact overview; management get/list actions return details. Configuration needing an idle engine is queued until the reply ends.

## Optional plugins load on demand

The optional built-in plugins (the CAD workshop, draughts and torrents) are not in a conversation's tool list just because they are switched on. [AgentTools.pluginSpecs](../../src/agent-tools.cjs) offers one small `plugin_load` tool instead, with one line per plugin that is on and not yet loaded. Its `name` is an enum of those plugins. Once every plugin that is on is loaded, `plugin_load` is left out.

A plugin joins a conversation in two ways:

- The model calls `plugin_load`. This works only in the user's own running conversation or a scheduled task, never in heartbeat or goals. Plan mode keeps `plugin_load` and the loaded plugins' tools (`specs({ readOnly, plugins: true })`, and [AgentTools.pluginTool](../../src/agent-tools.cjs) lets them through the controller's Plan mode gate), since designing a part, playing a move or searching for a torrent changes nothing on the PC; its other write tools stay out. [Controller](../../src/controller.cjs) answers the call with the conversation's new tool list in `dynamicTools`. The [engine](../../src/engine/index.cjs) takes that list for its next model step, so the plugin's tool can be called in the same reply. The thread's signature is updated too, so the next turn does not reload the thread for it.
- The user sends a message while the plugin's panel is open, or with something pointed at in it (CAD selections, a draughts move or squares). `Controller.send` loads it before the turn starts.

Loaded plugins are kept on the conversation as `plugins: [{ name, usedAt }]` (normalized in [store.cjs](../../src/store.cjs)). `usedAt` moves forward on each call of the plugin's tool and each time its panel is used. When a compaction completes, `dropIdlePlugins` removes a plugin whose panel is closed and that was not used during the last five user turns. The prompt is rebuilt by the compaction anyway, so dropping it costs nothing. The next turn reloads the thread with the shorter list. A plugin that is switched off leaves every conversation's tool list at once, even though it stays in `plugins`.

With a local model, the tool list sits at the top of the prompt. Loading a plugin therefore makes the server read the conversation again once. This replaces the cost of every enabled plugin's full definition on every request (about 900 tokens for CAD and 500 each for draughts and torrents).

## Deferred operations

Queued jobs are stored in app-operations.json; UI state exposes recent outcomes. Startup marks previously running jobs interrupted. A finished handler whose final save fails is retried for persistence without replaying that handler. This behavior was fixed in the previous review.

A different enqueue failure remains: call adds the job before saving and does not remove it when saving throws. A rejected operation can therefore execute later (R1 in the [review](review.md)). A queued response never means the operation has completed.

## Terminal and file actions

Foreground Execute uses the [engine](19-engine.md)'s exec_command, write_stdin and patch heredoc with full local access; each command is approved by the app before it runs. [shell-conduct.cjs](../../src/shell-conduct.cjs) supplies Windows command guidance and keeps command-output transcripts coherent. The guidance includes writing text files as UTF-8: Windows PowerShell 5.1 otherwise writes ANSI (Set-Content) or UTF-16 (Out-File, >), and accents and dashes come out corrupted. Browser, web, goal file writes and MCP calls are separately owned; not every operation is a shell command.

Tool results are capped at 25,000 characters by the controller, and the engine sends at most 12,000 characters of any tool result to the model, keeping its beginning and end. Browser page output has its own head-and-tail cap.

Goal terminal use depends on its saved shell permission and budgets; completion commands are host-verified through the executor. Plan mode and heartbeat use different execution policies. Native terminal capability does not mean every desired application integration has a typed tool.

## Tool changes

The engine sends the current tool list with every request, including after a resume, so a changed or removed tool never lingers in an existing conversation.

## Verification

[engine](../../test/engine.test.cjs).

