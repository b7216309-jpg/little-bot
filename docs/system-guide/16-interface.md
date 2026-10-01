# Interface, panels and commands

## How it works

[index.html](../../src/renderer/index.html) creates the desktop shell. [app.js](../../src/renderer/app.js) holds view state, binds controls, applies controller snapshots and renders chat, Goals, Automations, Calendar, Memory, Inbox, Extensions and Settings. Styles live in [styles.css](../../src/renderer/styles.css) and feature CSS files.

Main broadcasts bot:event snapshots and chatUpdate deltas. The renderer tracks revisions so an older snapshot cannot overwrite a newer stream state. Expanded activity groups contain reasoning/tool actions; final answers stay outside the group. [chat-scroll.js](../../src/renderer/chat-scroll.js) preserves position when reading older content and follows the tail when appropriate.

Specialized modules implement action groups, the goal ledger, provider usage, standing intents and independent-check presentation. Their panel helpers normalize/bind UI data but do not independently authorize, run or save work. The backend remains the authority.

[slash-commands.js](../../src/renderer/slash-commands.js) parses local convenience commands: help, plan, execute, goal, schedule, calendar, memory, activity, settings and clear, with supported aliases. /clear clears the unsent draft/attachments; it does not erase the saved continuous timeline. Unknown/private commands are rejected.

## Usage and context display

[ProviderUsage](../../src/provider-usage.cjs) normalizes provider-reported quota windows and local timing/token samples. Codex remaining percentages derive from provider usage. Local performance is whole-turn timing, including tools; tool-free samples supply a rolling average. It is not a model benchmark, price estimate or proof of KV-cache reuse.

Context usage and goal budgets measure different things. Engine context usage is a current-window snapshot; goal tokens/time/actions/runs/retries are execution budgets. Missing usage fields mean unavailable, not zero. The Context used panel shows the app's last captured request composition, not the provider's complete context.

## Failure conditions and inconsistencies

Busy controls, pending RPCs, stale state, missing backend readiness or a renderer error can prevent a visible action. UI disabled states are convenience checks; backend validation must remain consistent.

The UI currently permits editing a running automation while schedule_manage refuses the same operation. Its eventual completion can be attributed to the edited name/prompt although the old prompt ran. See R6 in the [review](review.md). A silent “Save failed” also cannot be assumed to mean state was untouched (R1/R2).

No new screenshot/anonymization work was required for this review. Existing README screenshots remain documented examples, not live state captures.

## Verification

[Side panel Electron](../../test/agent-side-panel-electron.cjs), [scroll Electron](../../test/chat-scroll-electron.cjs), [QoL/inbox Electron](../../test/qol-electron.cjs), [provider usage Electron](../../test/provider-usage-electron.cjs), [slash commands](../../test/slash-commands-electron.cjs) and [standing-intent panel](../../test/standing-intents-electron.cjs).
