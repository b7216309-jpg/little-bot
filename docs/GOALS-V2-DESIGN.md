# Goals redesign: foundation

Implemented in 0.10.0. This document records the intended foundation; GOALS.md describes the shipped contract. Tests cover source cursors, outcome validation, chat questions, quiet reviews and restart persistence. Coaching quality still needs user feedback.

## Problem to solve

A goal must help achieve the user's outcome. Updating an internal note, completing a model turn, or passing an old heading check does not establish useful progress.

Observed failure in Bettering my human: cycles 3-5 searched the same embedding-licence topic and saw the same three records. The actual model choice and licence were already present in a separate repository that the goal did not inspect. Cycle 5 consumed 179,963 cumulative tokens and rewrote substantially unchanged advice. Its verification checked only whether Next Best Action existed as a heading.

Current code also separates calendar, goal and heartbeat executions, but their evidence and ownership are not sufficiently explicit. Memory context is selected by relevance to the objective; it does not guarantee a chronological feed of new user evidence. Quiet completion is not a first-class goal outcome.

## Goal contract

Two goal kinds share the same execution system:

- Task: a finite outcome, such as produce a report, fix a defect, or book an appointment. Completion requires evidence appropriate to the outcome.
- Ongoing: a direction, such as improving English or managing spending. Reviews produce actions, recommendations, questions, or a justified no-change result. A review ending never completes the lifelong goal.

Every definition records the desired outcome, usable evidence sources, allowed actions, cadence or triggers, and limits. Finite tasks additionally have acceptance criteria. Ongoing goals have a concise review policy and a way to observe whether an action helped. Do not require users to author a nine-section state file or a plan before the agent can help.

Confirmed user choice: act when Little Bot can do useful work, coach when the user must act. Goals interact with the continuous chat, which is the main place for discussion, questions and useful results. User behavior cannot be inferred from the absence of telemetry.

## Separate the records

Goal definition: stable intent and user choices, versioned when edited.

Run: one activation, cause, source cursor, input snapshot, resource usage, outcome and actual deliverables.

Evidence: source identity and version/time, original statement or observable result, relationship to a claim, visibility gaps. An agent's own previous summary is historical interpretation, not new evidence.

Action: proposed, executing, waiting for user, waiting for external result, verified, failed, or superseded. Record who must perform it and what could establish success. An unanswered recommendation is not automatically a commitment.

Goal runtime: ready, running, waiting, paused, completed or failed. Waiting records a dependency and a wake condition. No repeated model work to rediscover the same dependency.

Use a compact current state for execution and retain a separate bounded audit history. Do not send the full audit ledger or repeat all historical conclusions on every tool request.

## Fresh evidence before model work

1. Host reads new conversation messages since the last processed cursor, including explicit corrections. Respect the Memory setting and selected source scope; explain coverage when sources are unavailable.
2. Collect relevant due calendar facts, action/dependency changes and versions of selected files. A source selection is independent of the writable folder. A repository outside the current folder is explicitly visible or explicitly unavailable.
3. Use source IDs/versions for deduplication. Rewriting a goal's own state file is not a new input. Cursor advances only after the run result is durably saved. Processing tolerates duplicate delivery.
4. A scheduled ongoing goal receives a small chronological evidence digest first. Semantic retrieval supplements a specific missing fact; it does not replace the feed of new evidence.
5. If no relevant input changed, no action became due and no explicit review policy requires a model review, record a cheap quiet skip without a model call or state-file rewrite. Scheduled reviews may still examine persistent opportunities when the user's review policy asks for that.
6. Empty search means evidence was not found. It never proves the user failed, avoided work, or left a decision open.

## Execution loop

Trigger -> collect evidence -> determine whether work is due -> select one action -> execute -> inspect actual result -> persist -> notify if useful.

The model chooses a bounded next action using current evidence and the goal contract. Tool results feed back into that action. Replan when evidence invalidates it. Do not execute a long speculative plan simply because it was generated earlier.

Before external actions, assign an action identity and persist the intent. After interruptions reconcile the observable outcome; do not blindly repeat an appointment booking or message. Cancellation and application restart retain action state and source cursors.

Questions should name the specific missing information and preserve completed work. A waiting goal wakes on the answer, changed dependency, relevant evidence, or an explicit request. Repeated unchanged questions are not useful progress.

## Results and verification

Use explicit run outcomes:

- progress: a useful action or deliverable with evidence; goal remains open.
- completed: finite goal acceptance criteria have been met.
- recommendation: actionable advice based on current evidence; not a claim that the user performed it.
- waiting: named dependency or question prevents useful work.
- no-change: evidence reviewed, no justified intervention or execution.
- failed: execution or verification failed, with a concrete reason.

The host owns factual verification. A model declaring success is insufficient. Output structure proves that a result is well formed, not that it is correct.

Task criteria may use artifact contents, meaningful command results or a service receipt/state read-back. Existing fileExists/fileContains checks remain available as low-level checks, but a pre-existing heading cannot prove new work. Show the criterion and its evidence.

For coaching, verify source references and required result fields; label the recommendation as advice. Human follow-through is verified by explicit user confirmation or a relevant observation. Do not claim psychological usefulness has been mechanically proven.

No-change is legitimate and cheap. It must not be disguised as completed and verified progress. Updating timestamps or documentation alone cannot reset stagnation detection. Detect repeated action identities and unchanged input/evidence across runs.

## Heartbeat, schedules and conversation

The scheduler determines when a goal becomes eligible. Heartbeat dispatches due goals or reacts to relevant changes; it does not run a second copy of the goal's review.

Keep one model execution lane, with chat priority. Preserve in-progress work on interruption. Global pause continues to pause scheduled work. Scheduling a goal while the app is closed does not imply a background worker exists; describe actual foreground-only behavior until a worker is built.

An automation remains a scheduled instruction. A goal tracks an outcome over time. Both use shared scheduling/execution components, with clear ownership so the same event cannot produce duplicate actions.

## Goals in the continuous chat

Confirmed direction: integrate goals with the existing continuous conversation. A goal is durable structured state associated with that conversation, not an isolated chat persona that knows only its own checkpoint.

- Capture new user messages from the linked chat before a review, including corrections, changing priorities and answers. Keep original message IDs and a processed cursor.
- Post a concise message for a useful result, a concrete next action or a necessary question. Attach the goal and run ID so it is identifiable and can be opened from chat. Quiet reviews remain in goal history.
- A reply to a goal message routes explicitly to its pending question/action. Ordinary messages can suggest an update through the normal chat tools. Ambiguous replies do not silently mark an unrelated action complete.
- Let the user discuss, revise, pause or resume a goal naturally through chat. A chat tool operation updates the same durable state as the Goals panel. State changes are reflected in both surfaces.
- Track attribution: user evidence, agent advice and host-verified outcomes are distinct. A goal's own posted message does not become fresh user evidence or trigger another cycle by itself.
- No repeated reminders merely because the user has not replied. Advice does not automatically create an obligation. Waiting and no-change states stay visible without repeated chat messages.
- Chat keeps execution priority. A background goal cannot submit a competing turn to the active engine thread. Stage results while a user turn is running; deliver them in order after that turn settles.
- Separate the continuous visible conversation from model transport decisions. Prefer the linked session where the engine supports scheduling and bounded context, but do not append an entire run ledger or every background tool output to the user-facing chat. The executor must have access to the same relevant evidence regardless of whether a disposable internal thread remains necessary.
- A full context window is handled by conversation compaction plus source-linked goal/action state. The system never rereads the entire conversation for every scheduled review.

Example: Little Bot asks in chat what time the user is available; a direct answer updates that goal and resumes its action. The user says a chore is done; the linked action closes using that user confirmation. A model choice evidenced in the linked project closes the technical action without asking the user to write another note.

## Product interface

Creation: desired outcome, Task or Ongoing, sources, execution choices, schedule and limits. Offer understandable defaults and advanced controls.

Goal card: what it is trying to achieve; current action or wait reason; last meaningful result; next wake condition. Show Quiet review or No new evidence when appropriate, rather than a success badge.

Details: recent evidence, concrete actions/deliverables, unanswered question, verification evidence, input/generated usage, and historical runs. Technical checkpoints and audit ledgers belong in expandable details.

Plain language result example: The embedding model is already bundled. That task is closed. English practice remains a preference; there is no new commitment to remind you about.

## Implementation order

1. Agree on the goal contract and behavior using Bettering my human and one finite task as examples.
2. Implement a standalone typed goal/run/action model, persistence and transitions with a simulated executor. Preserve existing state and histories; keep legacy goals usable during development.
3. Implement chronological evidence collection, source cursors, coverage reporting, input deduplication and cheap quiet skips.
4. Implement bounded action execution, outcome verification and waiting/resume handling. Reuse proven engine transport, file tools, calendar integration and usage tracking.
5. Connect scheduler/heartbeat to the same dispatcher and introduce the new cards/details.
6. Migrate the existing growth goal, retire the resolved embedding gate with repository evidence, and preserve useful personal commitments. Historical claims remain historical.
7. Validate an isolated end-to-end scenario and then observe a real authorized review before describing the system as working.

This is a replacement of the goal behavior and state model, not a promise to discard every working component. No new external service or large model is inherently required.

## Acceptance scenarios

- Previously unresolved model choice is now evidenced in a selected repository: action closes and is not proposed again.
- Same three recall records across repeated reviews: no invented new evidence, no repeated full-state rewrite, no generic progress alert.
- New user correction outranks an older summary while both remain traceable.
- Repository unavailable: coverage gap is shown; no-artifact is not treated as user failure.
- Existing heading plus failed task: task does not become completed.
- Useful ongoing recommendation: labelled recommendation, with no claim of user completion.
- Explicit user confirmation: closes the corresponding action without another unrelated search.
- Reply to a goal question in continuous chat: updates exactly that goal and resumes its action; ambiguous replies remain unresolved.
- Agent goal update posted to chat: does not self-trigger a new run or count as evidence of user follow-through.
- Goal and user turn overlap: no concurrent engine turn; useful result is delivered once, in order.
- Goal changed through chat: panel and scheduler see the same saved definition and runtime state.
- Waiting without changed dependency: no model call; a real answer resumes the action.
- Stale or duplicated events: no duplicate execution or missed committed source cursor.
- Restart or interruption around external work: reconcile before any repeat; no duplicate booking.
- Chat interrupts work: execution lane stays exclusive and work resumes from durable action state.
- Scheduled review with no relevant changes: quiet result; usage remains bounded and visible.
- Budget exhausted: preserve partial results and report remaining work; never pass old checks as fresh completion.
- Model omits or invents evidence: reject the unsupported completion or downgrade to an unverified claim.

Unit/state-machine and simulated tool tests are necessary but insufficient. End-to-end tests use a disposable app profile and a separate Strata server/cache namespace, never the user's live server slots. Assess useful content, verification and resource usage, not merely process exit or JSON validity. Test limits are explicit; model choices remain probabilistic and ongoing coaching effectiveness needs real user feedback.

