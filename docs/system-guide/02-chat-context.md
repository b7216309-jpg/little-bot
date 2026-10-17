# Chat, streaming and context

## How it works

The send path is renderer → `bot:send` → [Controller.send](../../src/controller.cjs) → `thread/start` or `thread/resume` → `turn/start`. The public timeline stays continuous when the model, provider, workspace or Plan/Execute mode changes. Those changes may rotate the underlying engine thread. If a saved native thread has disappeared, the controller starts a fresh thread with recent visible chat history and continues the accepted message.

## Three kinds of chat

[chats.cjs](../../src/chats.cjs) names them. **The conversation** is the one continuous timeline: proactive messages, scheduled runs, goal posts, heartbeat alerts and things to bring up land there, and it cannot be deleted. **The Quick session** (marked `private`) is a side chat for one-off work that is never saved and reads or writes no memory. **Saved sessions** (marked `session`, since 0.33.0) are separate conversations with their own engine thread and saved history: memory recall and learning work in them like in the conversation, but proactive messages and things to bring up do not enter them, and each turn carries a short note naming the session and pointing to `memory_search`/`session_read` for the rest. `send({ session: true })` opens a new one, titled after the first line of its first message (renamable, 80 characters); `send({ chatId })` continues any chat. Only one reply runs at a time across all chats. Up to 200 sessions are kept. Deleting a session (`deleteChat`) unsubscribes its thread and removes its source history, episodes and working state from memory; facts already learned from it stay. The store saves the conversation first, then the sessions, and never the Quick session.

A rotation bridges the last 24 non-tool, non-reasoning messages, bounded to 24,000 characters. Older history remains in the app and can be searched through memory tools. Native engine tools can still have their own persisted history.

Each accepted request builds context with stable shell guidance and the current request first, followed by changing goals, continuity, profile, skills, memory, attachments and time. This keeps the changing material after the reusable prompt prefix. The **Context used** inspector records this composition for the current process; it is not a dump of the engine's complete hidden context and is not durable history.

The controller reserves the public chat before asynchronous preparation. A new send yields to a stopping background goal, heartbeat or answer check; proactive button actions wait for the current chat turn to finish before sending. Engine notifications append streamed answers, reasoning, tool actions, plans and user questions. Delta UI updates are batched around 40 ms; stream persistence is throttled around two seconds. Completion records task timing and activity, resolves waiting schedules, and submits eligible completed direct turns for memory learning.

## /goal: keep working until it is done

`/goal <condition>` (in the conversation, the Quick session or on the phone) works like Claude Code's goal mode. [ChatGoalRunner](../../src/chat-goal.cjs) starts an ordinary turn whose request asks the model to work autonomously toward the condition. When the turn ends, [Controller.finish](../../src/controller.cjs) hands it to the runner:

1. An optional check command (`--check "npm test"`) runs in the working folder with the conversation's own access (Plan mode stays read-only), for up to five minutes.
2. An independent checker, a separate tool-less, read-only model turn in its own ephemeral thread, reads the work since the goal was set (newest turn kept whole) and returns `met`, `impossible`, a one-line reason and the next step. The worker never grades itself, and a failing check command overrides a "met".
3. If not met, the runner starts the next turn with that feedback (a "goal-step" message, shown as a dashed note, never learned as something the user said).

It stops when the condition is met, judged impossible (it needs the user), the budget is used (default 20 turns and 90 minutes; `--turns N`, `--time 2h`), the same reason comes back three times in a row (paused as going in circles), a turn fails or the user presses Stop (paused). `/goal` shows the status; `/goal pause`, `resume` (another round after a budget stop) and `clear` control it, as do the goal bar above the composer and the phone's goal strip. A message the user sends mid-goal is answered first with the goal as context, then the loop continues. Only one goal runs at a time, the goal is saved with the chat, a goal that was running when the app closed comes back paused, and the heartbeat, background goals, routines, learning and dreaming wait while it runs.

## Plan, Execute and stopping

Execute uses native full-access execution. Plan uses the engine's read-only sandbox and a reduced dynamic-tool set. Scheduled prompts carry their own origin labels and restore the previous conversation mode afterward.

Stop requires an established turn ID; during early preparation it can ask the user to retry. Normal completion rejects late events belonging to completed turns. Local turn-start acknowledgements and turn watchdogs allow up to ten minutes for long prompt prefill before reporting a timeout.

## Compaction

[compaction.cjs](../../src/compaction.cjs) tracks engine-reported context usage and compaction events. Automatic compaction defaults to 50% of the usable window (95% of the local model's `/health` `max_context`, 262,144 here, so about 124,500 tokens). It is set twice: as the engine's turn-end threshold and as its in-turn token limit, so a long tool-using turn compacts while it works and then continues. 0 leaves only the engine's own 90% limit; configured thresholds accept 20–95%. Manual compaction resumes the existing native thread and asks the engine to compact it, with a ten-minute completion watchdog and a stop watchdog.

Compaction uses the selected provider/model through the engine; in local mode it follows the loaded local model setting. The CPU embedding model does not write conversation summaries. Compaction changes the engine's working context; it does not delete the visible app timeline or its searchable archive. A context reading can be stale after rotation until the engine reports new usage.

## What can prevent operation

Engine/account readiness, a missing workspace, extension changes, unsupported image input, lost RPC acknowledgements and unavailable provider streams. The engine restarts with increasing delay after a process crash; any turn interrupted by the crash is settled with its accepted message kept in the timeline. Maximum direct input is 32,000 characters and eight attachments. Provider output cutoffs are failures with partial output retained, not successful final answers.

