# Questions and Independent Check

## User questions

[user-questions.cjs](../../src/user-questions.cjs) validates ask_user questions, up to three optional suggested answers and persisted goal clarifications. Users can type their own answer; a suggested option is not automatically submitted.

In direct chat, the controller maps a dynamic tool request to a visible question and engine response. Native tool-input/MCP form requests use their own schemas and [mcp-forms.cjs](../../src/mcp-forms.cjs) conversion. Cancelled requests are settled; a late answer cannot restart a cancelled tool call.

For a goal, ask_user saves a checkpoint/question and ends the model step. The goal becomes blocked until its exact question ID is answered. The shared chat can show/answer it, while the Goals panel remains the owner. A stale question ID or skipped question must not be treated as a new valid answer.

## Independent Check

[independent-check.cjs](../../src/independent-check.cjs) collects bounded answer/request context, applies auto/always/off policy and validates the review record. [IndependentCheckRunner](../../src/independent-check-runner.cjs) runs a separate ephemeral, read-only model session, with tools disabled, in cache slot 3 and a five-minute timeout.

Users access **Challenge this answer** through the message's right-click/context menu. It is no longer a permanently displayed button on every chat answer. A forced challenge bypasses the automatic policy decision but still needs an eligible completed answer and an available execution lane.

The original answer/hash is retained. A valid corrective review can replace the displayed answer with a revision; timeout, interruption or invalid output preserves the original and records failure. The review's public result explains confidence/changes. It is another pass by the configured model, not an independent human or guaranteed independent model.

## What can prevent operation

No eligible final answer, active chat/background work, unavailable model, malformed schema, insufficient bounded context or review timeout. An answer check cannot browse/read fresh evidence with tools disabled and does not prove factual correctness. Old messages can have insufficient paired request context for a useful challenge.

User-question routing depends on live engine ownership; R3 in the [review](review.md) describes a lost-acknowledgement case that can suppress the old turn. Goal answers persist, whereas a direct live RPC wait does not survive as the same active request across an engine restart.

