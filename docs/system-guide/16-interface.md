# Interface, panels and commands

## How it works

[index.html](../../src/renderer/index.html) creates the desktop shell. [app.js](../../src/renderer/app.js) holds view state, binds controls, applies controller snapshots and renders chat, Goals, Automations, Calendar, Memory, Inbox, Extensions and Settings. Styles live in [styles.css](../../src/renderer/styles.css) and feature CSS files.

Main broadcasts bot:event snapshots and chatUpdate deltas. The renderer tracks revisions so an older snapshot cannot overwrite a newer stream state. Expanded activity groups contain reasoning/tool actions; final answers stay outside the group. [chat-scroll.js](../../src/renderer/chat-scroll.js) preserves position when reading older content and follows the tail when appropriate.

The sidebar's **Background** switch (also in Goals, the widget menu and the phone menu) is the global pause: off stops the active goal, heartbeat check, routine and memory learning, and keeps goals, heartbeat, routines, night shift, learning, dreams and page watches from starting. It persists across restarts. Turning it back on advances missed heartbeat and routine occurrences to their next time (interval goals an hour later), so it never releases a burst of posts. On, its line lists what is active.

Specialized modules implement action groups, the goal ledger, provider usage, standing intents and independent-check presentation. Their panel helpers normalize/bind UI data but do not independently authorize, run or save work. The backend remains the authority.

[slash-commands.js](../../src/renderer/slash-commands.js) parses local convenience commands: help, goal, goals, plan, execute, keep, schedule, calendar, memory, activity, settings and clear, with supported aliases. Typing `/` opens a menu of them above the composer that narrows as you type; arrows pick one, Enter or Tab uses it (a command without arguments runs at once), Escape closes it, and /help reopens it. /clear clears the unsent draft/attachments; it does not erase the saved continuous timeline. Unknown/private commands are rejected.

## Goal drawer and goal editor

The **Goal** button next to **Plan** (or `/goal` alone) opens a drawer above the composer for this chat's goal, in the conversation, a session or the Quick session. Its form takes the condition ("done when…"), an optional check command, and turn and minute budgets; [goalArguments](../../src/renderer/slash-commands.js) turns them into the same `/goal` arguments the chat-goal parser reads, so both paths start the same goal. While a goal runs, the drawer shows its status, a turn meter, the check command and the latest verdicts, with Pause, Resume and Clear; the button carries a dot. The compact goal bar above the composer opens the drawer too, and hides while it is open.

Background goals live on **Tools → Goals**. **New goal** and **Edit** there, or `/goals <objective>`, open the goal editor beside the page, with six tabs: Basics, Evidence, Checks, Access, Limits and Schedule. Tokens, minutes and actions each have a **No limit** switch that saves 0. Saving fails on the tab holding the first invalid field. Switching chats or pages closes the drawer and the editor.

## Glass widget

[DesktopWindows](../../src/desktop-windows.cjs) owns the full window and the floating Glass widget. Both load the same renderer, share one controller, and pass the same strict IPC main-frame check. Switching carries the unsent draft, Plan choice and attachment references; the widget can be pinned on top or collapsed to a pill, and its size, position and mode are saved in `display.json`. See [WIDGET.md](../../WIDGET.md).

## Quick session

The sidebar's **Quick session** (and the phone's Quick tab) is a side chat for one-off tasks. It is the chat marked `private`: [Controller.send](../../src/controller.cjs) keeps it after the main conversation, never saves it, injects no memory, goals, activity or proactive messages, and writes no memory or episodes. [AgentTools](../../src/agent-tools.cjs) leaves out memory, goal, routine, web-watch, follow-up and app-management tools for it. **End session** discards it (`deleteChat`); the main conversation cannot be deleted. **Keep as session** (or /keep), always in its top bar, turns it into a saved session. Before the first message it simply opens a new session and moves the draft there. Otherwise it uses [Controller.saveQuickSession](../../src/controller.cjs): the chat keeps its id, timeline and draft, gets a title from its first message, and its history becomes searchable. Its ephemeral thread with the smaller Quick tool set is dropped, so the next message starts a normal thread carrying the recent history. Memory learns from new turns only. Everything that means "the conversation" (proactive delivery, goals, the phone's main tab) uses `mainChat` from [chats.cjs](../../src/chats.cjs): the first chat that is neither private nor a session.

## Sessions

Under **Sessions** in the sidebar, **New session** (Ctrl+N) opens an empty composer whose first message creates a saved session; the list shows each session with its age and a dot while it works, newest first. With a session open, the top bar offers **Rename** and **Delete** (with a confirmation that its history goes and learned facts stay). The renderer tracks `chatMode` (`main`, `quick`, `session`) and `sessionId`; drafts, attachments and Plan choice are kept per chat. A session deleted elsewhere (the phone) sends the window back to the conversation.

## Settings

Settings show one category at a time: General (working folder, theme), Model (connection, speed, compaction, independent check), Phone, Browser & web, Storage and About. The local-model offline card opens Model directly.

## Usage page

**Tools → Usage** shows every request Little Bot sent to the local model, counted on this PC since 0.34.0. [LocalModelRelay](../../src/local-model-relay.cjs) reads Strata's own token counts when each request finishes: prompt tokens, how many came from Strata's cache, and generated tokens, plus when output began. The engine names the thread in each request's headers (`thread-id`, and `x-codex-turn-metadata` marks compactions); [Controller.usageSource](../../src/controller.cjs) turns that into a source when the request starts: Conversation, Sessions, Quick session, Routines, Heartbeat, Night shift, Goals, Memory learning, Night thoughts, Answer checks, Compaction or Other. [UsageLedger](../../src/usage-ledger.cjs) adds it to a per-day record (requests, input, cached and output tokens per source and model, generated tokens per hour, and generation/prefill timing), keeps 400 days in `state.json` (counts only, never text) and saves at most every 15 seconds.

The page has a range switch (7, 30, 90 days or all), six tiles (generated tokens as the headline, processed, share from cache, requests, average generation speed, active days and streak), generated tokens per day stacked by group (Chats, Background, Memory, Checks, Compaction) with a hover readout and a table view, a by-source table, generated tokens by hour of day, and a by-model table. The chart colors are a validated colorblind-safe set with their own dark steps. A speed only counts requests that reported when output began, so it cannot be inflated by requests without timing.

## Usage and context display

[ProviderUsage](../../src/provider-usage.cjs) normalizes local timing/token samples. Local performance is whole-turn timing, including tools; tool-free samples supply a rolling average. It is not a model benchmark, price estimate or proof of KV-cache reuse.

Context usage and goal budgets measure different things. Engine context usage is a current-window snapshot; goal tokens/time/actions/runs/retries are execution budgets. Missing usage fields mean unavailable, not zero. The Context used panel shows the app's last captured request composition, not the provider's complete context.

## Failure conditions and inconsistencies

Busy controls, pending RPCs, stale state, missing backend readiness or a renderer error can prevent a visible action. UI disabled states are convenience checks; backend validation must remain consistent.

The UI currently permits editing a running automation while schedule_manage refuses the same operation. Its eventual completion can be attributed to the edited name/prompt although the old prompt ran. See R6 in the [review](review.md). A silent “Save failed” also cannot be assumed to mean state was untouched (R1/R2).

No new screenshot/anonymization work was required for this review. Existing README screenshots remain documented examples, not live state captures.

## Themes and chat formatting

Settings › Appearance chooses System (follows Windows), Light or Dark. The choice is a per-PC display preference kept in the renderer's local storage and applied as `html[data-theme]`. The dark theme in [dark.css](../../src/renderer/dark.css) is generated by [build-dark-theme.cjs](../../scripts/build-dark-theme.cjs). For every rule that sets a color in the light stylesheets, it writes a dark twin with mirrored lightness and the same hue; shadows are left alone. After editing any renderer CSS, run `node scripts/build-dark-theme.cjs`. [dark-theme.test.cjs](../../test/dark-theme.test.cjs) fails when the generated file is stale.

Assistant replies render a safe Markdown subset, always built as DOM nodes and never as HTML strings: fenced code, headings, bullet and numbered lists, quotes, rules, bold, italics, inline code and links. Proactive messages (heartbeat, goal, learned, web watch, offer) appear as tinted cards. While the window is in the background, finished replies, questions, approvals, web watches and offers raise a desktop notification.

