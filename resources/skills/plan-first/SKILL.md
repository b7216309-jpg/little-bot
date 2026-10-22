---
name: plan-first
description: Think a project through before building it - clarify what the user really wants, compare two or three approaches, then write a step-by-step plan with checks into PLAN.md. Use before any feature, app, script or bigger change, or when the user says "help me plan" or "how should I do this?".
---
# Plan first

A good plan is short, ordered and testable. Building starts only when the user agrees with it.

## 1. Understand

- Restate the goal in one sentence and list what "done" looks like from the user's side.
- Read what already exists (files, README, the code that will change) before proposing anything.
- Ask at most three questions, only about things that change the plan: who uses it, constraints (time, budget, tools, platform), and what must not break. Offer a sensible default for each.

## 2. Compare approaches

Give two or three options, each with: how it works in one line, effort (small, medium, large), main risk, and what it rules out later. Recommend one and say why. Skip this step when only one approach makes sense.

## 3. Write the plan

Save `PLAN.md` in the working folder:

```markdown
# <Goal>
Done when: <observable outcome>

## Steps
1. <Step> — check: <how we know it worked>
2. ...

## Risks
- <Risk> — <how we limit it>

## Not now
- <Thing deliberately left out>
```

Steps should each take one sitting and end in something that can be checked: a command that passes, a page that loads, a file that exists. Put the riskiest step early.

## 4. Hand over

Show the plan, ask for a go-ahead, then work through it in order, ticking steps (`- [x]`) in PLAN.md as they pass their check. If a step's check fails twice, stop and revisit the plan with the user instead of pushing on.
