# Goals: task execution and ongoing reviews

## How it works

[GoalRunner](../../src/goals.cjs) owns saved goals, status, triggers, dependencies, budgets and recovery. [goal-contract.cjs](../../src/goal-contract.cjs) defines the v2 task/ongoing contract and evidence collection. [GoalExecutor](../../src/goal-executor.cjs) runs the model step and mediates goal tools. See [GOALS.md](../../GOALS.md) for user controls and [the design record](../GOALS-V2-DESIGN.md) for rationale.

A goal names an objective, workspace, saved model binding, sources, review policy, checks, tool permissions and token/time/action/run/retry budgets. Drafts do not run. User Run authorizes a goal; tool-created drafts cannot silently enlarge permissions or budgets. Only one goal step executes at a time, sharing the lane with chat, memory, heartbeat and answer checks.

Task goals aim at a finite result. Their completion checks are evaluated by the host, and v2 execution must provide observable evidence. An ongoing goal performs bounded reviews and stays available for later reviews; it does not become completed merely because one cycle finishes. Ongoing goals cannot be completion dependencies for other tasks.

## Reviews that produce useful outcomes

A review collects configured chat, calendar and text-file evidence, compares versions and runs according to changes/always policy. An unchanged changes-policy review makes no model call. Evidence also includes what Little Bot said since the last review: its replies, heartbeat suggestions and goal posts (up to six). This content is for reference only. It never marks a review as changed and never confirms a user action. Scheduled reviews wait for the Heartbeat active hours unless the goal opts out. An explicit Run, an answer or a recovery check is never held back. A goal with the `feedback` source ("Read your reactions and the heartbeat log") also receives the user's one-click reactions and the heartbeat run log since its last review. It re-reviews only after a new reaction, which makes a weekly self-review goal possible. A user message that directly follows a goal's post brings that goal's next review forward to about ten minutes. An authorized interval goal whose review was missed while the app was closed runs once about two minutes after reopening, never as a backlog. The initial calendar excerpt is bounded to eight events; calendar_list remains available to retrieve additional evidence. File input is limited to the configured regular text files and their size limits.

A cycle can act through the permitted tools, deliver a finding/action/coaching summary, ask one persisted question, or report no change. The host checks citations and progress rather than accepting a repeated motivational report as completed work. A failed, unreadable or over-budget ongoing cycle retries after 15 minutes, 1 hour and 4 hours, then blocks for attention. Each retry starts a fresh cycle budget. Questions, possible external effects and save failures block immediately. Questions are answered by exact goal/question ID and can appear in the shared chat. Results and questions are delivered into the conversation, queued while a turn is busy, and carried to the model with the next user message (see [delivery](08-heartbeat-inbox.md#delivery-into-the-conversation)). Goal context is also supplied to ordinary foreground messages.

Ongoing reviews emit goal.reviewed so waiting standing intents settle. New source changes or an authorized later run can cause another review. “No change” is an intentional result when evidence has not changed, not a promise of daily new advice. Set **Speak up after · hours quiet** (`maxQuietHours`, 0–720, 0 = off) so that an ongoing goal with no meaningful result for that long reviews anyway, even without new evidence. That run is told to make one concrete contribution.

## Recovery and failure conditions

A task can remain draft, queued, paused, blocked or completed. Work waits for the selected saved connection, an available execution lane, valid dependencies and a usable workspace. Global Pause all persists across restarts. A pending question prevents continuing until answered; budgets and retry limits can block further work. Chat evidence collection also respects the Memory toggle, so disabling Memory can remove a configured review's conversation evidence.

An interrupted local goal verifies existing effects before continuing. Goals with possible network/MCP effects require review rather than blindly repeating the action. File-triggered goals baseline changes made while the app was closed.

**Confirmed defect:** failed goal save/run persistence can leave a new goal or authorized queued run active in memory. See R2 in the [review](review.md). R3 can also make lane readiness inaccurate after a lost foreground turn acknowledgement.

## Verification

[Contract](../../test/goal-contract.test.cjs).

