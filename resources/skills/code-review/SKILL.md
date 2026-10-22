---
name: code-review
description: Review code changes or a file for real problems - bugs, broken edge cases, security holes, data loss, performance traps - and report them ranked by severity with the exact line and a concrete fix. Use when the user asks for a review, a second look, or "is this safe to merge?".
---
# Code review

Find what would actually break. Style opinions are not findings.

## Get the change

- Uncommitted work: `git diff` (and `git diff --staged`). A branch: `git diff main...HEAD`. A single file: read it whole.
- Read enough surrounding code to know how the changed functions are called. A finding about code you have not read is a guess.

## Look for

- **Correctness:** wrong conditions, off-by-one, null or empty inputs, async ordering, errors swallowed or thrown in the wrong place, state left half-updated.
- **Edge cases:** empty lists, huge inputs, unicode and paths with spaces, time zones, concurrent calls, retries.
- **Security:** untrusted input reaching a shell, SQL, file path or HTML; secrets in code or logs; missing permission checks.
- **Data:** writes that can lose or corrupt data, migrations without a way back, deletes without confirmation.
- **Performance:** work inside loops that could run once, unbounded reads, N+1 queries.
- **Tests:** behavior changed without a test that would catch it breaking again.

## Verify before reporting

For each candidate, trace a concrete input through the code to the wrong result. If you cannot describe the failing input, drop it or mark it as a question. Run the tests when there are any.

## Report

Rank by severity: **Must fix**, **Should fix**, **Consider**. For each: `file:line`, what goes wrong with which input, and the smallest fix. End with what you checked and what you did not. Do not rewrite the code unless the user asks for the fixes.
