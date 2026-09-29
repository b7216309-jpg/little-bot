# Goals and autonomous work

Open **Goals → New goal**, describe the outcome, and add completion checks. Save the draft, review its access and budget, then choose **Run**. The app saves its checkpoint, usage, history, and versioned plan-and-evidence ledger between runs. A model claiming success cannot mark a goal complete: every saved check must pass.

When information is missing, the model can use `ask_user`. Its question appears on the goal card with up to three suggested answers and a free-text field. **Answer & continue** saves your answer to that goal and queues its next step. The question and answer survive app restarts. Waiting releases the model and does not spend the execution budget; asking and continuing still count as model steps. The last five answers accompany subsequent steps.

Answering preserves permissions and remaining budgets. **Pause all** still prevents execution; an individually paused goal stays paused. A depleted budget or interrupted external operation can still require review before retrying. An answer resolves a question, not an access request. Ordinary chats use the existing question dialog and resume their live turn; closing the app interrupts that chat turn as usual.

Local Qwen may also ask a short question in plain text before taking any action; the app can save that as a free-text clarification. After tools run, a plain-text final report still has to pass the saved completion checks. Cloud goals keep their structured final-output requirement.

## Plan and evidence ledger

Each goal has a bounded ledger with a current plan, assumptions, observations, decisions, and host evidence. A non-completed goal has exactly one active step. The model may see later steps as context, but it is instructed to execute only the active step; Little Bot still runs one agent task at a time.

The initial objective and suggested steps become plan version 1. Editing the objective or steps, revising the approach from new evidence, rerunning a completed goal, or repairing an exhausted malformed plan creates a new version. Unfinished work in the older version becomes superseded and remains visible under **Earlier plan versions** rather than being rewritten.

Preflight and final completion checks become structured observations. Writable runs add bounded file-snapshot evidence, and **Review undo** adds restore evidence plus a user decision. The model can add concise public assumptions, observations, and decisions, but not a private reasoning or chain-of-thought transcript. Confirmed and rejected assumptions accompany later runs so disproved information is not silently forgotten.

The ledger is stored on the goal itself, so it survives restart, pause, clarification, interval or file-triggered continuation, and conversation compaction. Interrupted local work keeps the same active recovery target; externally capable work retains the existing effect-review block. Expand **Plan, evidence, and history** on a goal card to inspect the current plan, evidence, decisions, activity history, and earlier versions. See [LEDGER.md](LEDGER.md) for the data model, limits, and recovery rules.

## Completion and recovery

- **Path exists:** the relative path must exist inside the working folder.
- **File contains text:** a regular text file, up to 2 MiB, must contain the specified text.
- **Command succeeds:** a PowerShell command must exit with code zero. This requires terminal permission, but verification always runs read-only with network disabled and a 20-second timeout. Use a check that does not need to build files or install dependencies. Returned detail is limited to 8,000 characters; history keeps a shorter excerpt.

Checks run before work and after each successful step. A manual goal completes without a model call when its checks already pass, except **Run again** starts a fresh cycle and does real work before verifying again. Interval and file-triggered goals treat checks as per-cycle verification: a verified cycle is recorded, its work budget resets, and the goal stays active for the next trigger. Failed verification and lack of progress consume the retry allowance. Repeating the same actions three times without file progress blocks the current cycle.

After interrupted local work, Little Bot checks existing results before continuing. If the interrupted goal had network or MCP access, it stays blocked so you can review possible external effects before resuming. Local file snapshots cannot reverse an external service action.

## Access

Goals start read-only, with terminal, network, and external tools disabled. Enable only the capabilities a goal needs. Writable paths must name existing directories relative to its working folder; `.` grants that entire folder. The engine working directory is set to a granted writable directory. Windows sandboxing restricts writes; it is not a complete restriction on reads.

Snapshots refuse symbolic links, junctions, hard-linked files, and scopes containing protected data such as `.git`, `node_modules`, `.env` files, and common credential locations. Choose a small output directory instead of a whole project when that project contains these files.

External MCP tools require individually saved server/tool grants. The model accesses those tools through a checked app broker; its own native MCP connections are disabled and verified before execution. MCP servers run with their own permissions, outside the goal's Windows file sandbox. Network permission governs the goal's native web and command access; an explicitly granted external tool may itself use a network connection.

Autonomous goal runs cannot grant themselves more access, request escalation, or create other goals, routines, or subagents.

## Budgets

The default work budget is **50,000 tokens, 30 minutes, 50 actions, 10 model runs, and 2 retries**. Edit these in Advanced settings. Usage persists across pause and restart within the current cycle. **Run again** on a completed manual goal starts a fresh budget, and interval/file-triggered goals reset their budget after each verified cycle. Increasing a limit adds room without erasing usage from the current cycle.

Tokens use cumulative usage reported by the engine. Actions include model tool invocations and verification commands. Time includes checks and run setup. Each model step has a maximum duration of ten minutes, within the goal's remaining time budget. Reaching a limit stops further work and records the reason.

These are execution controls, not a prepaid or monetary cap. An in-flight provider request or native operation can finish before cancellation and exceed the latest reported limit. Already dispatched external tool calls may need to settle before a pause finishes.

## Scheduling and proactivity

Only one goal step runs at a time, sharing the engine with chat, heartbeat, and routines. A chat message pauses the active goal. Queued goals use priority 1 first and wait for their dependencies to complete; dependency cycles are rejected.

- **Manual:** Run starts the goal and it continues through bounded steps until completed, blocked, or paused. **Run again** starts a new verified cycle even if the previous checks still pass.
- **Interval:** each due time starts a new cycle. Passing the checks verifies that cycle, resets its work budget, and schedules the next one.
- **File changes:** watched relative paths are checked every five seconds using file metadata. A stable change starts a new cycle; passing the checks verifies that cycle and returns the goal to watching. Each foreground app session starts with a fresh baseline, so changes made while Little Bot was closed do not wake the goal. The baseline is also refreshed after its own run to avoid a self-trigger loop. Quiet checks make no model calls. Stable changes publish the foreground-only `file.changed` event described in [EVENTS.md](EVENTS.md).

Completed manual goals stop until you run them again. Interval and file-triggered goals remain active until paused or blocked. When Little Bot reopens, an overdue authorized interval goal advances to its next future step without running the missed step. File-triggered goals establish a new baseline instead of reacting to closed-app changes. If Little Bot remains open but busy, queued work waits for the one execution lane. There is no tray worker, Windows service, closed-app event backlog, or wake-from-sleep mechanism.

Standing intents can react to foreground goal, file, calendar, automation, chat, heartbeat, and app-open events. They can start only an already authorized goal or automation and do not expand its permissions, budget, folder, model, or connection. Configure them under **Automations → Standing intents**; there is no agent management tool for them yet. See [EVENTS.md](EVENTS.md).

**Pause all** persists across restarts and stops goals, heartbeat, and routines. It leaves normal chat available. Resume all preserves goals you paused individually, including goals paused by Undo.

## File history and Undo

Before writable goal work, Little Bot stores scoped local file copies outside the goal's writable folders. Run history and the evidence ledger record the resulting file changes. Choose **Review undo** to inspect affected paths and restore them. Undo records the restored-path evidence and leaves the goal paused. It refuses to overwrite a file changed after that run. Restore writes each file atomically; if a conflict arises during a multi-file restore, the activity log reports partial progress.

Storage is bounded: at most 50 goals, 50 history entries per goal, three retained snapshots per goal, 2,000 files and 25 MiB per snapshot, and 250 MiB across backups. Old snapshots are retired only after a new snapshot is saved. A full backup budget blocks new writable work until you remove a backup. Undo covers regular file contents and created/deleted files, not external services, registry changes, file permissions, or arbitrary process side effects.

## Agent management tools

In a **new chat**, the agent can list, create, update, pause, and resume goals and routines, and discover/read enabled skills. New goals stay drafts and new routines stay disabled until you start or enable them in their panel. Chat can resume previously authorized work only in that chat's working folder. Editing a routine prompt through chat requires enabling the updated routine again.

Older chats retain the engine tool list with which they were created. Start a new chat to use management tools. Autonomous runs get skill discovery but cannot recursively schedule new work.

All goal state lives in the app's existing data directory. It adds no database, indexing service, runtime dependency, or extra memory layer. Memory remains conversation, recent work, and durable facts.

## Reading goal usage

The input + output token limit is cumulative across model requests, so repeated context counts again after each tool call. It is not the number of generated tokens or the context-window size. Cards and history show input and generated tokens separately when the provider reports them, and running cards show the current tool action. Goal recall uses small pages (up to five search results or three conversation chunks), with further pages available for a specific missing fact. An interrupted run cannot reuse checks that already passed before the run as evidence of fresh completion.


Goals expose `workspace_write` for authorized UTF-8 file updates without terminal access. Blocked or unfinished results cannot reuse older passing verification to claim a completed cycle. Malformed completion records remain blocked for review.
