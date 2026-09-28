# Goal plan and evidence ledger

Every Little Bot goal now keeps a bounded, versioned record of **what it intends to do, what it observed, what it assumed, and why it changed direction**. The ledger belongs to the saved goal. It is not a second agent, another memory service, or a transcript of private model reasoning.

## Core invariant

A goal that is not complete has exactly one active plan step.

```text
completed steps
→ one active step
→ pending steps
```

The goal runner gives the model only that active step as executable work. Later steps remain visible context, but the model is told not to start them in parallel. Little Bot still has one agent and one execution lane shared with chat, heartbeat, and automations.

A completed goal has no active step. Starting that completed goal again creates a fresh plan version rather than reopening its finished history.

## Plan versions

The first saved goal definition becomes plan version 1. A new version is created when:

- the user changes the objective or suggested steps;
- evidence causes the model to replace the remaining approach;
- a completed goal is run again;
- recovery finds a full plan with no valid remaining step.

Unfinished steps in an older plan become `superseded`. They remain inspectable under **Earlier plan versions**. Completed steps are never silently rewritten into a new plan.

Each step has one of these states:

- `active` — the only step the next model run may execute;
- `pending` — visible future work;
- `completed` — finished work with an optional concise result;
- `skipped` — no longer needed because the goal completed another way;
- `superseded` — replaced by a newer plan version.

The model may revise the plan only by returning a complete replacement sequence and a concise reason. The host performs the version change and repairs malformed persisted state so multiple active steps cannot survive loading.

## Ledger records

### Assumptions

Assumptions are claims the work currently relies on, such as “the source file is UTF-8.” Their status can be:

- `open`;
- `confirmed`;
- `rejected`;
- `superseded`.

A later record with the same normalized text replaces the earlier current status while preserving the history. Open, confirmed, and rejected assumptions accompany later goal steps so disproved information is not treated as unknown again.

### Observations

Observations are concise findings from the model, the host, or verification. Examples include:

- a row count found in an input file;
- a saved completion check passing or failing;
- file changes captured by the snapshot system;
- paths restored through **Review undo**;
- a restart recovery note.

When available, an observation carries structured evidence such as check type, path, pass/fail status, detail, changed-file count, or restored-path count.

### Decisions

Decisions record a concise action and rationale, for example:

```text
Decision: Recalculate the totals before publishing.
Rationale: The saved content check failed.
```

User edits, answers, pauses, undo operations, plan revisions, blockers, reruns, and verified completion can all create decisions.

## Execution flow

A normal goal step remains sequential:

```text
load the saved ledger
→ run preflight completion checks
→ record check evidence
→ execute only the active step
→ receive bounded public ledger records
→ capture file-change evidence
→ run completion checks
→ complete, block, or queue the next active step
→ save the goal and ledger
```

A model claiming completion is not enough. The app still owns completion and marks the goal complete only after every saved check passes.

The model’s structured ledger response contains only:

- active-step status and concise result;
- an optional full replacement plan and reason;
- bounded assumptions;
- bounded observations;
- bounded decisions and rationales.

It does not request or save a chain-of-thought transcript. The ledger is designed as an inspectable public audit record.

## Recovery and persistence

The ledger is saved in the existing goal record and therefore survives:

- application restart;
- conversation compaction;
- deletion of unrelated chats;
- pause and resume;
- a waiting clarification;
- scheduled interval or file-triggered continuation.

If local work is interrupted, the existing active step remains the recovery target and Little Bot records that results must be checked before continuing. If the interrupted goal could have made external effects, the existing goal recovery rules still block it for review.

Closing Little Bot stops execution. The ledger does not create a background worker, replay queue, or closed-app model call.

## Goal interface

Expand **Plan, evidence, and history** on a goal card to inspect:

- the current plan version and why it exists;
- the active, pending, completed, skipped, or superseded steps;
- current assumption states;
- recent observations and structured evidence;
- recent decisions and rationales;
- archived earlier plan versions;
- the existing activity history and undo controls.

The interface shows the latest 20 assumptions, observations, and decisions in each category. The persisted bounds are larger so recent context survives normal use without unbounded state growth.

## Bounds

Per goal, Little Bot retains at most:

- 20 plan versions;
- 20 steps in one plan version;
- 100 assumption records;
- 150 observation records;
- 100 decision records;
- 12 assumptions, observations, and decisions from one model step in each category.

Text fields are length-limited and common credential patterns are redacted before ledger records are stored. Invalid persisted entries are normalized or omitted rather than executed.

## Scope and limitations

- The ledger improves continuity and inspectability; it does not make a model’s observation true. Completion checks remain the authoritative host evidence.
- File snapshots describe scoped file changes and support bounded undo. They do not reverse external service, registry, permission, or process side effects.
- The ledger is attached to goals only. Ordinary chat plans are not converted into autonomous goal plans.
- There is no semantic database, vector index, additional physical memory layer, or separate planner agent.
- There is no parallel plan execution. Exactly one goal step can run, and only one application task uses the execution lane at a time.
- There is no gateway, daemon, service, tray worker, or execution after Little Bot closes.

## Validation

Phase 3 includes focused tests for migration, malformed-state repair, the one-active-step invariant, bounded records, plan revisions, objective edits, completed-goal reruns, recovery, user answers, blockers, global pause, verification evidence, file snapshots, Review undo, and budget-stop completion.

The renderer model and a sandboxed Electron fixture verify current and archived plans, assumption status, pass/fail evidence, decisions, and the public-record notice. The complete retained Node, Electron, and Windows distribution suites run before the phase is considered ready to merge.
