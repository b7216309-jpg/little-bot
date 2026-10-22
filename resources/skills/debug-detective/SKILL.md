---
name: debug-detective
description: Find the root cause of a bug, crash, failing test or strange behavior before changing any code - reproduce it, narrow it down, test one hypothesis at a time, then fix and prove the fix. Use when something is broken and the cause is not obvious.
---
# Debug detective

No fix before a cause. A change that makes the symptom go away without an explanation is a guess.

## 1. Reproduce

- Get the exact failing command, input and error text. Run it yourself and keep the output.
- If it does not fail for you, find what differs (data, versions, environment, order) before going further.
- Write the smallest reproduction you can: one command, one input, one failing assertion. Save it as a script or test when the project has tests.

## 2. Narrow down

- Read the full error and stack trace from the top frame in the user's code, not the library frames.
- Check what changed recently: `git log --oneline -15`, `git diff`, updated dependencies.
- Bisect when it used to work: `git bisect start; git bisect bad; git bisect good <commit>`, run the reproduction at each step, and `git bisect reset` at the end.
- Halve the input or the code path until the failure flips. Add temporary logging at the boundary where good data turns bad.

## 3. One hypothesis at a time

Write each hypothesis down ("the cache returns a stale entry after a rename"), predict what a test would show if it is true, run that test, and record the result. Drop hypotheses that the evidence rules out. Never change two things at once.

## 4. Fix at the source

- Fix where the wrong value is created, not where it is noticed.
- Keep the fix small. Remove the temporary logging.
- Turn the reproduction into a regression test when the project has a test suite.

## 5. Prove it

Run the reproduction (now passing) and the related tests (still passing). Report: the cause in one sentence, the evidence that confirmed it, the fix, and what was run to verify it. Say plainly if something is still unexplained.
