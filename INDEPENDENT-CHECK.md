# Independent Check

Independent Check is Little Bot's optional anti-sycophancy review. It asks the same selected model to review a completed answer after the normal turn, without tools, network access, parallel work, or another agent identity.

The feature is intended to reduce conclusion changes caused only by leading wording, repeated confidence, or requests for agreement. It is not intended to make Little Bot disagree reflexively.

## Modes

Choose a mode in **Settings → Independent Check**:

- **Off:** answers finish normally. You can still right-click a completed answer or plan and choose **Challenge this answer**.
- **Selective:** the default. A review runs for agreement pressure and decision-oriented evaluations such as recommendations, architecture choices, predictions, critiques, and “should I/we/you…” questions.
- **Always:** every eligible completed answer or plan receives a review.

Selective mode deliberately skips ordinary operations, explicit memory commands, straightforward factual recall, and personal preferences that do not contain an evaluative claim.

The mode is captured when a turn starts. Changing the setting affects later turns, not work already in progress.

## Execution model

A normal reviewed turn is sequential:

```text
normal answer completes
→ one ephemeral Independent Check turn starts
→ the check confirms or materially revises the answer
→ the conversation becomes idle
```

The check uses the conversation's saved model and connection. It receives only a bounded review package containing:

- the current user request and recent clarifications;
- the previous assistant conclusion, when relevant;
- bounded observable tool evidence from the turn;
- the proposed answer.

The review thread is read-only. Shell, browser, web search, MCP tools, app tools, user-input requests, JavaScript execution, code mode, and multi-agent features are disabled. A tool request from the review thread is rejected by the host.

Only one agent task remains active. While Independent Check runs, the conversation stays busy and another chat or task cannot start in the same execution lane.

## Review result

The check classifies the answer as a fact, prediction, strategy, preference, value judgment, or no material claim. It returns bounded structured metadata:

- assessment;
- whether agreement pressure was detected;
- whether the conclusion remained stable;
- the strongest material counterpoint;
- confidence;
- up to three conditions that would change the conclusion.

If the conclusion remains stable, the draft answer is preserved. A revision is applied only when the check supplies a complete, materially different replacement answer. The earlier draft remains available in the expanded Independent Check panel.

No private reasoning or chain-of-thought transcript is saved as review metadata.

## Failure and interruption

Independent Check fails open to the completed draft:

- malformed or empty review output keeps the draft;
- provider or engine errors keep the draft;
- **Stop** interrupts only the review and keeps the draft;
- closing Little Bot stops the review and keeps the draft;
- a five-minute review timeout keeps the draft.

The saved message records whether the check completed, failed, or was interrupted. A running record recovered after an abrupt restart is converted to an interrupted record.

## Manual Challenge

**Challenge this answer** forces one sequential check even when the automatic mode is Off. It is available only for completed assistant answers and plans—not reasoning, progress commentary, tool output, structured questions, failed messages, or work still streaming.

## Scope and limitations

- Selective detection is deterministic and currently based on English request patterns. It can miss implicit evaluation or activate on unusual phrasing.
- The reviewer is the same model that produced the answer. It can catch framing pressure and unsupported confidence, but it is not an independent source of truth.
- The check does not gather new evidence because tools and network access are disabled. Its judgment is limited to the evidence already available to the normal turn.
- Always mode adds a second model turn to every eligible answer and therefore adds latency and provider usage.

## Tests

Focused tests cover:

- opposite positive and negative framing;
- Selective, Off, Always, and forced modes;
- preferences, operations, memory commands, and factual recall exclusions;
- stable conclusions and material revisions;
- persisted prior drafts and restart normalization;
- rejected review-thread tool calls;
- Stop, malformed output, and fail-open behavior;
- renderer eligibility for final answers and plans only;
- the complete controller lifecycle with the real store.

## Validation record

Checked on 28 September 2026 with Node 24 on the Windows GitHub runner:

- recursive JavaScript syntax checking passed;
- the complete retained Node test suite passed, including core, runner, controller, persistence, and renderer regressions;
- all Electron integration tests passed sequentially;
- the one-shot integration and polish workflows committed changes only after those checks succeeded.

No live provider call was made during this implementation. Model behavior was exercised through deterministic fake-engine responses; the pull request's packaging workflow validates the real Windows distribution, installer registration, and uninstallation path.

## Conversation recall after compaction

The review packet includes earlier user messages (up to 12 messages and 12,000 characters), the current request, prior conclusion and observed tool evidence. Truncated history is marked. Missing facts in that bounded packet alone are not grounds to rewrite a correct recall answer as amnesia. Original history and model context can contain more information than this excerpt.
