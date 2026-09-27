# Goals and autonomous work

Open **Goals → New goal**, describe the outcome, and add completion checks. Save the draft, review its access and budget, then choose **Run**. The app saves its checkpoint, next step, usage, and history between runs. A model claiming success cannot mark a goal complete: every saved check must pass.

When information is missing, the model can use `ask_user`. Its question appears on the goal card with up to three suggested answers and a free-text field. **Answer & continue** saves your answer to that goal and queues its next step. The question and answer survive app restarts. Waiting releases the model and does not spend the execution budget; asking and continuing still count as model steps. The last five answers accompany subsequent steps.

Answering preserves permissions and remaining budgets. **Pause all** still prevents execution; an individually paused goal stays paused. A depleted budget or interrupted external operation can still require review before retrying. An answer resolves a question, not an access request. Ordinary chats use the existing question dialog and resume their live turn; closing the app interrupts that chat turn as usual.

Local Qwen may also ask a short question in plain text before taking any action; the app can save that as a free-text clarification. After tools run, a plain-text final report still has to pass the saved completion checks. Cloud goals keep their structured final-output requirement.

## Completion and recovery

- **Path exists:** the relative path must exist inside the working folder.
- **File contains text:** a regular text file, up to 2 MiB, must contain the specified text.
- **Command succeeds:** a PowerShell command must exit with code zero. This requires terminal permission, but verification always runs read-only with network disabled and a 20-second timeout. Use a check that does not need to build files or install dependencies. Returned detail is limited to 8,000 characters; history keeps a shorter excerpt.

Checks run before work and after each successful step. If the result already exists, the goal completes without a model call. Failed verification and lack of progress consume the retry allowance. Repeating the same actions three times without file progress blocks the goal.

After interrupted local work, Little Bot checks existing results before continuing. If the interrupted goal had network or MCP access, it stays blocked so you can review possible external effects before resuming. Local file snapshots cannot reverse an external service action.

## Access

Goals start read-only, with terminal, network, and external tools disabled. Enable only the capabilities a goal needs. Writable paths must name existing directories relative to its working folder; `.` grants that entire folder. The engine working directory is set to a granted writable directory. Windows sandboxing restricts writes; it is not a complete restriction on reads.

Snapshots refuse symbolic links, junctions, hard-linked files, and scopes containing protected data such as `.git`, `node_modules`, `.env` files, and common credential locations. Choose a small output directory instead of a whole project when that project contains these files.

External MCP tools require individually saved server/tool grants. The model accesses those tools through a checked app broker; its own native MCP connections are disabled and verified before execution. MCP servers run with their own permissions, outside the goal's Windows file sandbox. Network permission governs the goal's native web and command access; an explicitly granted external tool may itself use a network connection.

Autonomous goal runs cannot grant themselves more access, request escalation, or create other goals, routines, or subagents.

## Budgets

The default lifetime budget for a goal is **50,000 tokens, 30 minutes, 50 actions, 10 model runs, and 2 retries**. Edit these in Advanced settings. Usage persists across pause, restart, and editing; increasing a limit adds room without erasing what has already been consumed.

Tokens use cumulative usage reported by the engine. Actions include model tool invocations and verification commands. Time includes checks and run setup. Each model step has a maximum duration of ten minutes, within the goal's remaining time budget. Reaching a limit stops further work and records the reason.

These are execution controls, not a prepaid or monetary cap. An in-flight provider request or native operation can finish before cancellation and exceed the latest reported limit. Already dispatched external tool calls may need to settle before a pause finishes.

## Scheduling and proactivity

Only one goal step runs at a time, sharing the engine with chat, heartbeat, and routines. A chat message pauses the active goal. Queued goals use priority 1 first and wait for their dependencies to complete; dependency cycles are rejected.

- **Manual:** Run starts the goal and it continues through bounded steps until completed, blocked, or paused.
- **Interval:** an unfinished goal takes another step at the configured cadence.
- **File changes:** watched relative paths are checked every five seconds using file metadata. A change must remain stable across checks before it wakes the goal. The baseline is refreshed after its own run to avoid a self-trigger loop. Quiet checks make no model calls.

Completed goals stop monitoring. Use Automations or Heartbeat for an indefinite routine. Missed time while the app is closed does not create a burst of goal runs. Little Bot must remain open and the PC awake; this version has no tray worker or Windows service.

**Pause all** persists across restarts and stops goals, heartbeat, and routines. It leaves normal chat available. Resume all preserves goals you paused individually, including goals paused by Undo.

## File history and Undo

Before writable goal work, Little Bot stores scoped local file copies outside the goal's writable folders. Run history records the resulting file changes. Choose **Review undo** to inspect affected paths and restore them. Undo refuses to overwrite a file changed after that run, and leaves the goal paused. Restore writes each file atomically; if a conflict arises during a multi-file restore, the activity log reports partial progress.

Storage is bounded: at most 50 goals, 50 history entries per goal, three retained snapshots per goal, 2,000 files and 25 MiB per snapshot, and 250 MiB across backups. Old snapshots are retired only after a new snapshot is saved. A full backup budget blocks new writable work until you remove a backup. Undo covers regular file contents and created/deleted files, not external services, registry changes, file permissions, or arbitrary process side effects.

## Agent management tools

In a **new chat**, the agent can list, create, update, pause, and resume goals and routines, and discover/read enabled skills. New goals stay drafts and new routines stay disabled until you start or enable them in their panel. Chat can resume previously authorized work only in that chat's working folder. Editing a routine prompt through chat requires enabling the updated routine again.

Older chats retain the engine tool list with which they were created. Start a new chat to use management tools. Autonomous runs get skill discovery but cannot recursively schedule new work.

All goal state lives in the app's existing data directory. It adds no database, indexing service, runtime dependency, or extra memory layer. Memory remains conversation, recent work, and durable facts.
