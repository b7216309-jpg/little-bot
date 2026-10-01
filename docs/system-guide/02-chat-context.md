# Chat, streaming and context

## How it works

The send path is renderer → `bot:send` → [Controller.send](../../src/controller.cjs) → `thread/start` or `thread/resume` → `turn/start`. The public timeline stays continuous when the model, provider, workspace or Plan/Execute mode changes. Those changes may rotate the underlying engine thread.

A rotation bridges the last 24 non-tool, non-reasoning messages, bounded to 24,000 characters. Older history remains in the app and can be searched through memory tools. Native engine tools can still have their own persisted history.

Each accepted request builds context from current goals, continuity text, profile, selected skills, relevant memory, attachment excerpts, shell guidance and the current request. The **Context used** inspector records this composition for the current process; it is not a dump of the engine's complete hidden context and is not durable history.

The controller reserves the public chat before asynchronous preparation. Engine notifications append streamed answers, reasoning, tool actions, plans and user questions. Delta UI updates are batched around 40 ms; stream persistence is throttled around two seconds. Completion records task timing and activity, resolves waiting schedules, and submits eligible completed direct turns for memory learning.

## Plan, Execute and stopping

Execute uses native full-access execution. Plan uses the engine's read-only sandbox and a reduced dynamic-tool set. Scheduled prompts carry their own origin labels and restore the previous conversation mode afterward. Private sessions and multiple public conversation creation are no longer supported.

Stop requires an established turn ID; during early preparation it can ask the user to retry. Normal completion rejects late events belonging to completed turns. A lost start acknowledgement currently has an ownership defect: the host can release the lane while the engine continues. See R3 in the [review](review.md).

## Compaction

[compaction.cjs](../../src/compaction.cjs) tracks engine-reported context usage and compaction events. Automatic post-turn compaction defaults to 80%; 0 disables it and configured thresholds accept 20–95%. Manual compaction resumes the existing native thread and asks the engine to compact it, with a ten-minute completion watchdog and a stop watchdog.

Compaction uses the selected provider/model through the engine. The CPU embedding model does not write conversation summaries. Compaction changes the engine's working context; it does not delete the visible app timeline or its searchable archive. A context reading can be stale after rotation until the engine reports new usage.

## What can prevent operation

Engine/account readiness, a missing workspace, active background work, extension changes, unsupported image input, lost RPC acknowledgements and unavailable provider streams. Maximum direct input is 32,000 characters and eight attachments. Provider output cutoffs are failures with partial output retained, not successful final answers.

## Verification

[Controller](../../test/controller.test.cjs), [single session](../../test/single-session.test.cjs), [Plan mode](../../test/plan-mode.test.cjs), [compaction](../../test/compaction.test.cjs), [context inspector](../../test/context-used.test.cjs) and [stream scrolling](../../test/chat-scroll.test.cjs).
