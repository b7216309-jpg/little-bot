# Agent tools and terminal execution

## Tool families and ownership

[AgentTools](../../src/agent-tools.cjs) defines dynamic tools registered with the native engine. It validates inputs and dispatches them to their application owners.

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
| app_state and *_manage / *_control | AppManagement and registered main handlers |

The read-only set contains skills, recall and calendar_list. Direct full chat receives the broader tool set. Heartbeat, goals and Independent Check do not inherit every direct-chat management operation. Goals use their own permitted workspace/write/terminal/network/MCP tools.

[AppManagement](../../src/app-management.cjs) exposes richer settings, goals, heartbeat, services, attachments and extension controls. app_state gives a compact overview; management get/list actions return details. Configuration needing an idle engine is queued until the reply ends.

## Deferred operations

Queued jobs are stored in app-operations.json; UI state exposes recent outcomes. Startup marks previously running jobs interrupted. A finished handler whose final save fails is retried for persistence without replaying that handler. This behavior was fixed in the previous review.

A different enqueue failure remains: call adds the job before saving and does not remove it when saving throws. A rejected operation can therefore execute later (R1 in the [review](review.md)). A queued response never means the operation has completed.

## Terminal and file actions

Foreground Execute uses native Codex tools with full local access. [shell-conduct.cjs](../../src/shell-conduct.cjs) supplies Windows command guidance and keeps command-output transcripts coherent. Browser, web, goal file writes and MCP calls are separately owned; not every operation is a shell command.

Goal terminal use depends on its saved shell permission and budgets; completion commands are host-verified through the executor. Plan mode and heartbeat use different execution policies. Native terminal capability does not mean every desired application integration has a typed tool.

## Existing thread tool migration

The pinned engine persists dynamic tools when a thread is created. [tool-migration.cjs](../../src/tool-migration.cjs) updates the saved registry before engine startup and keeps a rollout-header backup. It validates thread identity and resolves engine history under its data directory, including relocated histories. [verify-tool-migration.cjs](../../scripts/verify-tool-migration.cjs) is the developer check for that migration.

## Verification

[migration](../../test/tool-migration.test.cjs).

