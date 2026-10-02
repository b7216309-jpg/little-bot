# Version 0.14.0 verification

0.14.0 adds a dark theme. Settings › Appearance chooses System (follows Windows, the default), Light or Dark. The choice is kept per PC. The window background also follows Windows at startup, so there is no white flash.

The dark theme is generated, not hand-written. `scripts/build-dark-theme.cjs` reads every renderer stylesheet and, for each rule that sets a color, writes a dark twin under `html[data-theme=dark]`:
- Lightness is mirrored (paper becomes charcoal, ink becomes paper) while the hue is kept.
- Strong accents keep their weight.
- Shadows and CSS variable names are left alone.
- CSS variables such as `--paper` and `--ink` get the same treatment, so later style changes stay covered.

`test/dark-theme.test.cjs` checks the color mapping and fails when `dark.css` no longer matches the light stylesheets.

Every main screen (conversation, goals, heartbeat, automations, profile, settings, extensions, memory) was checked in dark screenshots of the real renderer. The full Node suite ran (the only failures are the 11 known `C:\Users\work` extension suites), and `npm run test:electron` passes.

# Version 0.13.3 verification

0.13.3 continues the polish pass.

- **Desktop notifications for everything that needs you.** Before, only heartbeat and goal alerts notified while the window was in the background. Now a finished reply, a question, an approval (with sound), a web-watch change and an offer notify too. They use the same rules as the phone relay. Learned notes stay quiet, and heartbeat and goal alerts keep their own notification, so nothing is duplicated.
- **Little Bot abilities in Extensions.** The Tools tab lists what Little Bot can do on its own: memory, questions, goals and routines, calendar, follow-ups, web watches, games and skills. Before, it showed only Terminal and Files.
- **Settings quick links.** Settings opens with a row of section chips that scroll to each section.

The relay notification test now also covers each note's message kind. The full Node suite ran (the only failures are the 11 known `C:\Users\work` extension suites), and `npm run test:electron` passes. The Extensions and Settings screens were checked in screenshots of the real renderer.

# Version 0.13.2 verification

0.13.2 is a polish release based on a screen-by-screen review of the app with sample data and on the real error log.

- **Proactive ✅ no longer fails while a goal runs.** Choosing ✅ on a proactive message now uses the same send path as a typed message, so an active goal or heartbeat yields first. The error log showed "The goal is still stopping" for one real click.
- **Memory learning keeps what it can.** A small model's near-miss output is repaired: a bare array, a missing scope or key, a capitalized type, extra fields, or missing source IDs (the user's messages in the turn are cited). Only broken items are dropped, instead of failing the whole turn.
- **Chat Markdown.** Replies render headings, bullet and numbered lists, quotes, rules and *italics*, all built as DOM nodes.
- **Look and navigation.**
  - Little Bot's messages carry the Wink mark.
  - Proactive messages (on its own, goal, learned, web watch, offer) appear as tinted cards.
  - Hovering a message shows its time.
  - Opening a tool page expands the Tools group so you can see where you are.
  - Restyled: the Heartbeat initiative menu, the Awareness card, and the inbox spacing and source filter.

New checks: a unit test for memory repair, and a renderer test for Markdown in qol-electron, which also checks that HTML in a reply stays text. The full Node suite ran (the only failures are the 11 known `C:\Users\work` extension suites), and `npm run test:electron` passes.

The remaining `local-model-relay` "aborted" errors are the local server closing connections mid-reply (502). They are outside the app.

# Version 0.13.1 verification

0.13.1 fixes memory learning, the heartbeat and Independent Check with the local model. The local server started rejecting any request that combined a structured response format with the engine's tools ("structured response_format with tools/MCP is not supported"). As a result, every memory-learning job failed three times and every local heartbeat failed. Goals already avoided this. For a local connection, these three runs now ask for the JSON in the prompt, which the heartbeat and Independent Check prompts already did for local models. They no longer send `outputSchema`. Their tolerant parsing handles `<think>` blocks and fences, and Independent Check now falls back to the same tolerant parser.

At startup, learning jobs that failed with exactly this error are queued again, so the conversation turns they missed are still learned. Other failures stay failed for review.

New tests cover the local memory extraction (prompt schema, no `outputSchema`, a fenced reply with `<think>` saved), the local heartbeat turn and the startup retry. Both local tests fail on 0.13.0. The full Node suite ran: the only failures are the 11 known `C:\Users\work` extension suites.

# Version 0.13.0 verification

0.13.0 adds the phone relay: Little Bot's one conversation, live on a paired phone. It is off by default and turned on in Settings › Phone relay.

- **Pairing.** A QR code holds a one-time code that expires after 10 minutes. Each phone gets its own token; only its hash is stored, encrypted with Windows secure storage.
- **Live sync.** Every desktop update is mirrored to the phone as a trimmed view: the conversation, questions, approvals and goal status. Settings, prompt, profile, memory and keys are never sent. Streaming replies type out on both devices at once. Phones send the same actions as the desktop (send, stop, proactive buttons, answers, goal run/pause/resume). Approving tool actions from a phone is a separate opt-in.
- **Phone app.** It is a web app served by Little Bot, using the new Wink icons (192 px, 512 px and maskable).
- **Notifications.** With Tailscale HTTPS (one button in Settings), the phone can be installed as an app and receive Web Push notifications when Little Bot reaches out, replies, or needs an answer while you are away. The encryption is RFC 8291 and the signing is VAPID, with no new dependency besides `qrcode-generator` for the QR code.

The new `relay.test.cjs` covers several things:
- Push messages decrypt the way a browser decrypts them, and the VAPID signature verifies.
- The phone view leaks nothing private.
- The notification rules behave as intended.
- A real server handles pairing, tokens and lockouts, live updates sent as deltas, the action handlers, the approvals opt-in, push gating, static files and restart persistence.

A demo relay was also driven in a phone-sized browser: pairing, live streaming, the proactive buttons, the question card, the goals sheet, and automatic reconnect after the PC went away. Separately, the real app with throwaway data paired a phone over HTTP. Its message reached the controller's send path, and the snapshot carried no private fields.

Codex's Wink icon commit is merged. The docs now map its icon files, and the icon build also emits the phone icons.

# Version 0.12.3 verification

0.12.3 fixes ongoing-goal retries after a budget failure. In real use, two goals hit their 60k-token budget, scheduled a retry, and then blocked again on the next attempt without calling the model. The retry reset the cycle's usage, but the run's final usage tally ran afterwards and restored the old count. Usage tracking now stops once a retry is scheduled.

Blocked-goal notices in the chat no longer carry ✅ / ⏰ / ✖ buttons, which made no sense on an error.

A new runner test reproduces the budget failure followed by a retry. It fails on 0.12.2 ("the retry starts with a fresh cycle budget") and passes with the fix, which also checks that the retry reaches the model. A second test checks that blocked notices have no buttons. The full Node suite ran: the only failures are the 11 known `C:\Users\work` extension suites.

# Version 0.12.2 verification

0.12.2 fixes "dynamic tools must use either canonical or legacy format consistently", reported on the first message after 0.12.1 reset a missing engine thread.

App-management tools were declared without `type: "function"` while every other tool had it. The engine validates the whole list when it creates a thread, so the mix was rejected. Older chats had never shown the problem because they only resumed existing threads. `AgentTools.specs()` now normalizes every source to the canonical form.

The bundled engine was started in a throwaway folder and asked to create a thread with each list. The old mixed list was rejected with the reported error; the normalized list was accepted and the thread was created. A regression test checks the full, read-only and Wild heartbeat lists. 495 Node tests ran: 484 passed. The 11 failures are the known `C:\Users\work` extension suites.

# Version 0.12.1 verification

0.12.1 fixes a startup failure seen on the first real launch of 0.12.0. A tool-list change makes startup migrate each saved engine thread. A conversation restored from elsewhere had no engine thread, so `migrateTools` threw "The saved engine conversation is missing." and the engine never started.

Startup now logs `engine-thread-reset` and clears that chat's engine thread. The next message opens a fresh thread that carries the saved timeline through the existing history bridge.

A new controller test reproduces the missing thread. It fails on 0.12.0 with the reported error and passes with the fix: startup reaches ready, the thread resets, and the next turn includes the earlier conversation. 494 Node tests ran: 483 passed. The 11 failures are the known `C:\Users\work` extension suites.

# Version 0.12.0 verification

0.12.0 gives the agent more ways to be proactive:

- One-click ✅ / ⏰ / ✖ answers on proactive messages, recorded in a reaction log that feeds prompts and goals.
- Opt-in activity awareness: foreground app and idle time, kept in memory only.
- Web watches limited to public pages, with a hand-followed redirect check.
- A read-only Steam library tool.
- Game launch offers that start only on the user's click.
- Standing-intent management for a Wild heartbeat.
- A `feedback` goal source for a self-review goal.

The release includes the concurrently merged #40 (calendar preparation windows) and #41 (Strata conversation matching). On the combined code, the syntax check covered 176 JavaScript files and 493 Node tests ran: 482 passed. The 11 failures are the extension and plugin import suites described under 0.11.0; this machine denies their fixed `C:\Users\work` path.

The store test that lists persisted top-level keys was updated deliberately for `feedbackLog` and `webWatches`. All 14 Electron fixtures passed. The new chat buttons have no Electron fixture yet.

The new tests also found two defects before release:
- `games_list` was missing from the argument allowlist.
- An app's first launch could be suppressed by the repeat-start window.

The Steam reader and the activity probe were exercised against this PC's real Steam folder and foreground window. No live model run is claimed.

# Version 0.11.3 verification

0.11.3 hardens memory after a real data reset:

- Daily restore points of `memory.sqlite` and `state.json` (7 kept), with Back up now and Restore in the Memory panel.
- Restore swaps the files at the next start and keeps a safety copy of the replaced data.
- A one-time warning when the memory database disappeared beside an existing conversation.
- Re-attachment instead of a silent in-memory fallback.
- Tolerant parsing of learning output.
- At most three learned memories per turn, under a stricter prompt.
- "Learned" notes in the chat that the model sees on the next turn.
- Heartbeat and goals yield to ready learning jobs.

The syntax check covered 172 JavaScript files. 483 Node tests ran: 472 passed. The 11 failures are the extension and plugin import suites described under 0.11.0; this machine denies their fixed `C:\Users\work` path.

All 14 Electron fixtures passed. New tests cover:
- Backup creation, daily idempotence, rotation, restore with a safety copy, and a stale marker
- Missing-database detection
- Re-attachment of a detached memory object
- Learning parsed from `<think>` output, the three-memory cap, the chat note and its model bridge
- Backoff not blocking proactive work
- Learned notes excluded from recall and from goal evidence

No live model run is claimed.

# Version 0.11.2 verification

0.11.2 makes ongoing goals feel present:

- **Active hours.** Scheduled goal reviews wait for the Heartbeat active hours. Each goal can opt out, and an explicit Run, an answer or a recovery check is never delayed.
- **Full conversation.** Goal evidence includes what Little Bot itself said since the last review, as reference only. It never triggers a review and never confirms a user action.
- **Quick reaction.** A reply to a goal's post brings that goal's review forward to about ten minutes.

The syntax check covered 170 JavaScript files. 477 Node tests ran: 466 passed. The 11 failures are the extension and plugin import suites described under 0.11.0; this machine denies their fixed `C:\Users\work` path.

The goal form Electron fixture passed with the new active-hours option. New tests cover:
- Active-hours gating and opt-out, with an explicit Run bypassing it
- Reply detection, including first-reply-only, keeping an earlier schedule, and ignoring paused goals
- Bounded bot-message evidence that cannot self-trigger or confirm user actions
- The chat-completion hook

No live model run is claimed.

# Version 0.11.1 verification

0.11.1 delivers proactive work into the conversation and keeps ongoing goals running:

- Every heartbeat alert and goal result is posted to the chat. While a turn is busy, it is queued in an encrypted per-chat outbox and flushed afterwards.
- The next user message carries the proactive messages the model has not seen.
- A missed interval goal review runs once shortly after reopening.
- Failed, unreadable or over-budget ongoing cycles retry after 15 minutes, 1 hour and 4 hours before blocking.
- v2 goal outcomes are recovered from reasoning tags and surrounding prose.
- The missed-run instructions match the implementation (review finding R5).

The syntax check covered 170 JavaScript files. 473 Node tests ran: 462 passed. The 11 failures are the extension and plugin import suites described under 0.11.0; this machine denies their fixed `C:\Users\work` path.

All 14 Electron fixtures passed on the delivery change. The goal-runner change touches no renderer code.

Four existing goal tests were updated deliberately:
- Forged progress and a failed ongoing review now retry with bounded backoff instead of blocking at once. A new test proves the retries stop after three attempts.
- A missed interval goal now expects the two-minute catch-up.
- Save failures still block immediately, with an alert.

No live model run is claimed.

# Version 0.11.0 verification

0.11.0 adds Wild heartbeat initiative, presence wake-ups, in-chat proactive messages, a visible run pulse, recovery of small-model JSON output, a goal quiet limit (`maxQuietHours`), and self-planned follow-ups (`followup_manage`). Calm heartbeat behavior is unchanged and remains covered by the existing tests.

The syntax check covered 168 JavaScript files. 466 Node tests ran: 455 passed. The 11 failures come from the extension and plugin import suites. They create a fixed `C:\Users\work\extension-tests` folder, and this build machine denied that path (EPERM). These suites fail identically on the unmodified 0.10.1 source on the same machine.

All 14 Electron fixtures passed.

New tests cover:
- Initiative validation and the first check within a minute
- Bounded self-chosen wake-ups, with the fixed interval for Calm
- Quiet streaks and the 30-entry pulse
- One-time chat delivery that never interrupts running or waiting chats
- Presence wake-ups and chat-activity debounce
- The wider Wild thread configuration (schema, planning tools, network, effort)
- Planning tools staying blocked for Calm hidden work
- Agenda edits not forcing alerts
- JSON recovery from `<think>` and fenced output
- Forced goal reviews after the quiet limit
- Follow-up limits, due wake-ups, cancellation, and tool time conversion

No live model run is claimed for 0.11.0. Whether a given local model chooses useful agendas, wake times and follow-ups is unverified until real use.

# Version 0.10.1 verification

`npm run ci` passed: 166 JavaScript files syntax-checked, 453 Node tests, and all 14 Electron fixtures. The bundled operating guide also passed the skill validator.

The second functional review on 2026-10-01 repeated the full CI checks and found six further issues through isolated failure probes and source checks: uncertain turn ownership after a lost start acknowledgement, live mutations after failed saves, rejected deferred actions executing later, model runs blocking event dispatch, running-automation edit attribution, and conflicting missed-schedule instructions. These issues remain open in 0.10.1. See the [review and feature coverage](docs/system-guide/review.md) and [system guide](docs/system-guide/README.md); passing CI does not cover those recovery cases.

Regression coverage verifies chat histories above the former encrypted-envelope limit; schema delivery through the actual bundled engine and Strata adapter; bounded memory retries and recovery controls; ongoing-review event settlement; complete calendar dates; deferred-operation recovery before and after handler execution; partial answers and failed status on token cutoff; impossible-dependency rejection; attachment disk cleanup; and guide migration preserving personal edits and deletions. The new Electron fixture executes production attachment and memory IPC registrations with the real preload and renderer.

The bundled engine was tested against an isolated deterministic fake model HTTP server. It completed a schema-conforming response and failed a length-limited response while retaining its partial text, with exactly two HTTP requests and no hidden retry. This proves transport compatibility, not model compliance with a prompted schema. Strata does not enforce JSON grammar; structured-result consumers still validate model output.

Packaging checks additionally reproduced a Windows engine launch failure at a 270-character executable path. Using Windows extended paths fixes the launch. The production local model server was offline during this update; no fresh live Qwen run is claimed. Earlier live-model results below belong to their stated versions.

## Live follow-up: 1 October 2026

After starting the normal Strata server, the installed 0.10.1 modules passed eight live checks against local Qwen3.8-Flash-Next-IQ2_XS. All application state and file writes used a separate test workspace; the saved personal conversation was not used or modified.

- Provider detection and an actual foreground reply passed.
- Memory extraction produced schema-conforming JSON on its first attempt and saved a durable preference with its source citation.
- A finite goal wrote the required file through workspace_write, passed the host's content check, and delivered its result into the isolated conversation.
- An ongoing review cited complete calendar evidence, reported the correct ISO start time and Paris timezone, delivered its result, and settled its standing intent. A later event could queue another review.
- Reviewing unchanged evidence produced zero model turns and zero new chat messages.
- A real eight-token output limit produced a length termination; the Responses adapter retained partial text and usage while reporting failure.

These checks used the real bundled engine, installed controller, goal runner, memory consolidator, event runtime and Strata adapter. Strata stayed running afterward with its existing cache-rotation/SSD patches and normal configuration. They are smoke tests of these paths, not a guarantee of all future model behavior.

# Version 0.10.0 verification

Goals 0.10.0: isolated real local Qwen runs verify a finite file task, fresh correction of an obsolete fact, same-chat output, restart persistence and zero model requests on an unchanged review. Production renderer tests cover goal questions and exact answer routing. Model coaching quality remains subject to user feedback.

Bundled quantized BGE-base-en-v1.5 provides offline CPU embeddings through a worker and an explicitly selected ONNX CPU provider. Real-model tests verify normalized 768-dimensional vectors, paraphrase retrieval, unrelated-result rejection, long-text windows, disabled-mode fallback, and database migration. Tool and reasoning traces remain readable as source history but are excluded from recall and embeddings. The Memory panel defaults to saved knowledge.

The local Node suite passed 396 tests; all ten Electron fixtures passed. The model assets are pinned by revision and SHA-256 and included in the portable package. No model download or embedding server is used at runtime. BGE-base is primarily English; the paraphrase checks are a smoke test, not a general retrieval-quality benchmark.

## Earlier 0.9.0 verification

The continuous-conversation and SQLite memory redesign is verified with source-backed persistence tests, a deterministic fake model transport, and real Electron renderer/IPC fixtures. The memory database stores ordinary local text without redaction; state-file encryption is a separate legacy facility.

- Memory tests cover more than 100 long records, database reopen, supersession and pinning, forgetting and source suppression, project aliases, cross-model history and tool outputs, direct source paging, durable extraction jobs, bounded context, and semantic retrieval using a local HTTP embedding fixture.
- Controller tests cover a single timeline across model/provider/workspace changes, scheduled messages, restarts, engine thread release, Plan-to-Execute tool catalogs, failed lookup cleanup, working checkpoints, and foreground/background exclusion.
- The Electron runtime fixture uses production Store, Controller, AgentTools, MemoryConsolidator, preload, renderer, and production memory IPC handlers. Only model transport is simulated. It verifies extraction, source inspection, pin/edit/forget, embedding configuration, aliases, paused management, continuity, and restart. Electron 44.4.5 exposes SQLite 3.53.4 in this environment.
- No private reasoning or chain-of-thought transcript is requested by the memory extraction task. Source storage is searchable conversation/tool text; the extractor selects durable knowledge from completed turns.
- Existing goal-runner test fixtures were corrected to place backups outside writable roots and await the execution already started by Run now. SQLite-backed fixtures close database handles before Windows directory cleanup.

Live remote model quality is not established by deterministic tests. Optional embeddings require a configured compatible endpoint; full-text recall works without one. Final local verification: npm run ci passed (146 JavaScript files syntax-checked, 393 Node tests, all ten Electron integration fixtures). The Windows portable package builds successfully; the installer was not exercised locally for this change.

## Earlier 0.8.9 verification

Checked on 28 September 2026 with Node 24 on the Windows runner. This phase used deterministic executor fixtures rather than a live model-provider call.

- A new persisted goal ledger enforces one active step for every non-completed goal. Focused tests covered initial migration, malformed state with multiple active steps, bounded plan history, a full exhausted plan, user objective and step edits, evidence-driven revisions, and rerunning a completed goal as a fresh plan version.
- The real GoalRunner path was exercised with a deterministic fake model that wrote a file, returned structured assumptions, observations, and decisions, and then passed the app-owned completion check. Preflight and final verification, file snapshots, blockers, answers, restart recovery, global pause, budget-stop completion, and Review undo all produced bounded inspectable records.
- The executor receives the current version, exactly one active step, current assumption states, recent observations, and recent decisions. Its structured response is limited to concise public ledger records and an optional complete replacement plan. No private reasoning or chain-of-thought transcript is requested or stored.
- Goal-card rendering passed pure-model checks and a sandboxed Electron fixture covering the active step, completed and pending steps, earlier versions, confirmed assumptions, failed verification evidence, decisions, restored-path evidence, and the public-record notice. Legacy goals retain a safe renderer fallback while persisted state migrates through the host.
- Recursive JavaScript syntax checks, the complete Node suite, and every retained Electron integration test passed after each runtime, UI, and lifecycle increment. The pull-request workflow also validates the portable ZIP, Setup EXE, silent installation, Apps & Features registration, Start Menu shortcut, and real uninstall path.

The ledger improves continuity and auditability; model observations remain claims until supported by host evidence. Completion still requires every saved check to pass. Closing Little Bot still stops execution, and the ledger adds no gateway, daemon, service, subagent, parallel worker, vector store, or extra physical memory layer.

## Earlier 0.8.8 verification

Checked on 27 September 2026 with isolated profiles, focused state/UI fixtures, and the packaged app using the existing local Qwen server. No dependencies or model-server settings changed.

- A real normal chat called `ask_user`, showed two choices plus free text, accepted a different name, and used it in its reply. The question and answer were saved in the visible transcript. Focused checks covered duplicate calls, skipped questions, stale responses, stop/crash/shutdown cleanup, and exclusion from hidden runs.
- A real goal asked which label to write, persisted its question, and released the model. Waiting left its budget unchanged. A custom answer resumed the goal with its saved permissions; Qwen ran the file command, read the result, and the app independently verified completion. The successful run used two model steps and zero retries. Both tool-based goal questions and a local plain-text question were observed during verification.
- Earlier local trials exposed final-format problems: Qwen sometimes returned a plan instead of calling tools, or performed the tools but returned prose instead of JSON. Local goal turns now leave tool output unconstrained. A short plain-text question before any action can become a clarification; prose after tool activity requests verification. Completion still requires the saved checks. Cloud goals retain their structured output requirement, and invalid/empty responses outside the narrow local cases still fail. This compatibility handling does not guarantee every future Qwen task succeeds.
- Real Store fixtures covered saved-question recovery, file-trigger continuation after restart, stale/duplicate answers, rollback after a failed save, individual/global pause, unchanged budgets and permissions, exhausted-budget refusal, and interrupted external-effect review. Verified completion clears a pending question so it cannot reappear on restart.
- Focused executor checks covered persistence before acknowledgment, no further dynamic actions after asking, pending calls settling before the execution lane is released, genuine stop/budget precedence, native-question conversion, unchanged permission/MCP handling, and local/cloud final-response boundaries.
- Electron UI checks covered choices and custom text, retained drafts/focus/selection through state updates, keyboard submission, double-submit prevention, failed-save feedback, notification navigation, and 900×620 layout. No renderer errors or horizontal overflow were reported. The operating guide update preserves custom content, prior deletions, IDs, and disabled state.

Normal-chat questions use the live turn; quitting interrupts it as before. Goal questions and the last five accepted answers persist. New direct chats receive the added tool; existing native threads retain their original inventory.

## Earlier 0.8.7 verification

Checked on 27 September 2026 with the packaged Electron app and the existing local Qwen server. No new dependencies or server-launcher changes.

- Actual outgoing Qwen3.6 requests carried the intended Thinking On/Off sampling and **15,360 total / 12,288 reasoning** token limits; Off sent a zero reasoning budget. Focused mock checks covered tighter limits, limit aliases, unknown models, input-token requests, and preserved request/cache fields. The live check confirmed request settings and normal answers, rather than exhausting the full reasoning budget.
- Live Thinking On streamed 510 reasoning characters and answered the arithmetic fixture correctly. Thinking Off then used `memory_search` followed by `session_read` and returned the correct saved phrase, without adding a reasoning row. All four generation requests retained 17 tools and their cache key. Follow-up requests reused 11,079/11,727, 11,755/11,914, and 11,942/12,182 input tokens (94–99%). Completed thoughts persisted immediately and survived renderer reload.
- A synthetic 4.3-second streaming burst sent 3,312 deltas as 69 changed-message patches, with zero full-state broadcasts or profile reads during that burst. Its largest patch was 4,150 bytes versus a 416,696-byte history. Two checkpoint writes were 2,012 ms apart; finish, stop, and crash saved immediately. Full-state ordering, hidden-work exclusion, late-event rejection, and shutdown cleanup passed focused checks.
- A 64-message Electron fixture retained every message root. A text patch caused zero header/sidebar/settings/attachment renders and parsed only the changed answer's Markdown. Reasoning expansion, focus and scroll, tool scroll, plain-text reasoning, stale-state rejection, and single-request recovery for an unknown message passed. The packaged live session emitted 89 patches and 11 structural snapshots; no renderer errors or horizontal overflow were reported.

These checks establish correct behavior and reduced app work; they are not a model throughput or general answer-quality benchmark. Streaming text checkpoints every two seconds, so an abrupt power loss can lose the newest unsaved text.

References: [Qwen3.6 recommended sampling](https://huggingface.co/Qwen/Qwen3.6-35B-A3B#best-practices), [pinned llama.cpp request reasoning budget](https://github.com/ggml-org/llama.cpp/blob/571d0d540/tools/server/server-common.cpp#L1120-L1130).

## Earlier 0.8.6 verification

Checked on 26 September 2026 with the packaged Electron app and local Qwen. No cloud calls or model-server changes.

- A live reply displayed an expandable **Thinking…** row while Qwen generated 426 characters of reasoning. The final answer was correct, the row became **Thoughts**, and the text survived state-file and renderer reload. A subsequent Thinking Off turn created no empty reasoning row.
- The installed llama.cpp stream omits `content_index` from reasoning deltas; pinned Codex ignores those deltas without it. The existing local relay now supplies the single-part index `0` only when missing. Mock checks covered split UTF-8, CRLF, existing indices, unchanged unrelated events, and cancellation. A bounded line buffer passes oversized lines through unchanged.
- Keyboard expansion, safe plain-text rendering, retained DOM/focus/scroll during updates, stopped/completed labels, no duplicate Working indicator, and the 900×620 layout passed focused UI checks. Live streaming and completed views were captured and inspected; no renderer errors or horizontal overflow were reported.
- Focused native-notification fixtures covered raw/summary deduplication, final-item replacement, stale-event rejection, empty-item removal, interruption, a 200,000-character bound, and heartbeat/compaction exclusion. Existing memory capture and history search continue to exclude reasoning.

Sources: [llama.cpp reasoning event](https://github.com/ggml-org/llama.cpp/blob/571d0d540/tools/server/server-task.cpp#L1250-L1257), [Codex's required content index](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/codex-api/src/sse/responses.rs#L376-L382).

## Earlier 0.8.5 verification

Checked on 26 September 2026 with the packaged Electron app and the existing local Qwen server. No cloud calls, dependency additions, or model-server changes.

- The composer's Thinking switch controls the real `chat_template_kwargs.enable_thinking` Boolean. In two successive turns of the same native session, Off produced no reasoning events; On produced 60 characters of reasoning and the correct answer. Both requests retained all 17 tools and the native cache key. The second reused 11,040 of 11,658 input tokens.
- Mouse and Space toggling, state-file reload, renderer reload, default-on migration, rejection of invalid values, busy-task guards, and Codex's retained effort selector passed focused checks. The 900×620 layout was captured and inspected with no overflow or renderer errors. Heartbeat/goals display the local thinking preference rather than an ineffective effort level.
- A focused mock transport pass checked preservation of request fields and split UTF-8 SSE bytes, both thinking flags, input-token requests, cancellation, upstream errors, restricted routes, redirect rejection, and close/restart. The relay has a 96 MiB JSON request limit; very large histories containing repeated image inputs can exceed it even when individual attachments meet their limits.
- The app applies the preference to all local Responses requests, including background work and compaction. Switching is blocked during running work, so a multi-step run keeps the same mode. The existing server launcher and its default reasoning budget were preserved.

References: [llama.cpp thinking flag](https://github.com/ggml-org/llama.cpp/blob/571d0d540/tools/server/server-common.cpp#L1072-L1086), [native Responses conversion](https://github.com/ggml-org/llama.cpp/blob/571d0d540/tools/server/server-chat.cpp#L6-L16), [pinned Codex provider configuration](https://raw.githubusercontent.com/openai/codex/rust-v0.157.1/codex-rs/core/config.schema.json).

## Earlier 0.8.4 verification

Checked on 26 September 2026 with a focused Electron UI pass; no model calls.

- Goals, Automations, Heartbeat, Memory, Profile, and Extensions now share a native collapsible **Tools** group. It starts collapsed and remembers the chosen state locally. All six views remained reachable; mouse/keyboard toggling and preference restoration after renderer reload passed.
- Collapsing reclaimed 256 pixels for the chat list at the default window size. The keyboard hint below the composer and its renderer/style references were removed.
- Normal and minimum-size layouts were captured and inspected. Both disclosure states fit the minimum 900×620 window without horizontal overflow or clipping the settings button/composer. The renderer reported no console errors.

## Earlier 0.8.3 verification

Checked on 26 September 2026 after an engine exit with Windows code `0xC000013A` (console interruption).

- Windows now starts the pinned native `codex.exe` directly with hidden-window settings and piped input/output. The prior npm wrapper spawned another process without those window settings. An isolated comparison confirmed the old path exposed a visible native console while the direct path did not. Both initialized and answered `thread/list`, then exited with code 0 on normal shutdown.
- The existing ten transport checks passed, covering handshake, requests, streaming, failure handling, diagnostic redaction, and shutdown. The packaged app also completed a real local Qwen search/read tool round trip and returned the expected answer. No cloud model calls were made.
- Interruption errors now explain that Windows stopped the engine and instruct the user to reopen Little Bot. There is no automatic replay of interrupted work.
- The new app was opened with the existing data, profile, skills, and local connection preserved. Its native engine is owned directly by the app and remained running after the launch command exited. Source and packaged application files match.

References: [Windows status code](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/596a1078-e883-4972-9bbc-49e60bebca55), [Node child-process options](https://nodejs.org/api/child_process.html).

## Earlier 0.8.2 verification

Checked on 26 September 2026 with focused documentation/context checks and the local Qwen model; no paid calls or scheduling settings changed.

- The existing operating guide now documents heartbeat setup, setting ranges, saved-folder/model behavior, interval routine tools and examples, goal triggers, timing limits, and troubleshooting. Implementation review confirmed there is no agent heartbeat-settings API or native cron/exact-time scheduling.
- Scheduling terms automatically include the enabled operating guide in the actual model request. Ordinary chat does not include it. Disabled/deleted guides stay unavailable, custom content is preserved, and an explicit `$little-bot` does not duplicate it. These context boundaries passed focused checks.
- A live Qwen setup question against packaged app code received the guide automatically and correctly identified manual heartbeat setup and unsupported exact weekday scheduling. It explained Enable before Save settings. No goals, automations, or heartbeat settings changed. This verifies that the guide reaches the model; it is not a guarantee against every possible model error.
- Migration from the previous packaged guide preserved its ID and disabled state, retained customized guides and prior deletions, and ran only once. The app's actual skill parser accepted the updated guide. The separate Python skill validator was unavailable because its PyYAML dependency is absent; no validation dependency was installed.

## Earlier 0.8.1 verification

Checked on 26 September 2026 with focused fixtures and one real local Qwen turn in the packaged Windows app. No paid calls or new runtime dependencies.

- `memory_search` searches explicit facts, recent notes, and full saved user/assistant conversation text; `session_read` pages through the matching source. Long-message pagination, Unicode matching, chronological browsing, deleted-chat removal, secret filtering, and Memory-off refusal passed focused checks.
- The packaged app's real Qwen turn invoked search and then source reading, recovered a decision from a 45-day-old conversation that was absent from injected summaries, and cited its title and exact session ID. Its answer correctly recovered the color, review day, and verification phrase. The rendered answer was inspected.
- Both tool retrieval and automatic conversation excerpts respect the selected connection. Local history also matches the saved endpoint and model. Default retrieval stays in the current folder; only direct chats can request other folders. Explicit saved facts remain shared according to their existing global/folder scope.
- Pinned native Codex 0.157.1 retains the original dynamic tool inventory when resuming or forking a thread. An isolated no-inference probe confirmed that adding tools to resume does not install them. Start a new chat for the updated inventory; old saved chats remain searchable. Fresh heartbeat and goal runs receive the read tools.
- Focused no-inference checks exercised actual heartbeat/goal tool inventory and dispatch: each used its task's saved folder, rejected other-folder and mismatched-connection access, and kept management mutations unavailable. The v4 guide migration preserved IDs, disabled state, custom edits, and deleted guides.
- The packaged 0.8.1 app was opened on the existing local connection. Chat/goal IDs, facts count, working folder, profile hashes, and skill IDs/enabled states matched before and after the update; four starter skills remain. Source and packaged app files matched.

## Earlier 0.8 verification

Checked on this Windows computer on 26 September 2026 using isolated app profiles and the existing local Qwen server. No paid model or web-service requests were made.

- The source app passed the existing UI/IPC, Windows sandbox, MCP, goals, profile, attention, compaction, browser, and service-settings flows. Engine startup was 519 ms; this does not measure model response time.
- The actual llama.cpp server accepted the native Responses connection, completed a tool-call round trip, correctly described a supplied image, produced the explicitly requested autonomous JSON shape, and completed native compaction. It reports a 147,456-token context window and vision support.
- Local inference requires no OpenAI sign-in. Saved chats/tasks retain their provider; background work belonging to another selected connection waits without spending its run budget. The local server does not enforce Responses output schemas, so autonomous prompts include the JSON structure and host validation still rejects invalid output.
- Actual Electron image normalization, thumbnails, clipboard bytes, persistent IDs, PDF/DOCX/text extraction, and returned-file copying passed focused attachment checks. PDF and DOCX code phrases were recovered correctly. Malformed images, oversized dimensions, linked/output paths outside the workspace, and credential output paths were rejected.
- Both source and packaged app attachment flows passed actual picker, disk-backed drag/drop, clipboard, draft removal, attachment-only send, local-image model input, preview protocol, Save dialog/readback, and persistence checks. Saved chat state contains attachment IDs/metadata rather than image bytes.
- The packaged app also passed a real local Qwen turn through the renderer, preload, controller, native engine, and model: it described the red/blue image, recovered both document code phrases, invoked `attachment_send`, and displayed the returned image. This exposed and fixed the server's rejection of image-valued tool results by disabling native `view_image` for local inference; incoming photo attachments remain supported. See CONNECTIONS.md for that server limitation.
- The packaged core/browser/settings checks passed; engine startup was 445 ms. The final attachment compatibility change was rechecked with the focused packaged attachment flow and live local model. No cloud model or paid service was called. Welcome, settings, and returned-image UI were visually inspected.
- Skill migration updates only unchanged original app/web guides and preserves custom edits, disabled state, IDs, and prior deletions. The v3 migration also passed fresh-install, idempotence, and failed-save rollback checks.

### Prompt cache check

Four real local Qwen requests through Little Bot's controller and native engine confirmed prompt reuse. Per-response cached input counts agreed exactly with the llama.cpp processed-token metric (input minus cached); idle `/slots` cache counts reset to zero and are not used as hit-rate evidence.

| Request | Input tokens | Cached tokens | Cached input | Prompt processing |
| --- | ---: | ---: | ---: | ---: |
| First request | 10,139 | 0 | 0% | 6,178 ms |
| Follow-up | 10,747 | 10,135 | 94.3% | 821 ms |
| New chat | 10,245 | 8,087 | 78.9% | 2,047 ms |
| Return to first chat | 11,461 | 9,533 | 83.2% | 1,642 ms |

These are observed results for four short text requests, not promised latency or hit rates. The existing persistent thread, stable instructions/tool definitions, native per-thread cache key, and server cache settings are already working. No cache configuration, launcher, or template change was needed. Compaction and changes to model/tools/context can legitimately reduce reuse. Source references: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [pinned llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/b10068/tools/server/README.md).

## Earlier 0.7 verification

Checked on this Windows computer on 26 September 2026 with isolated app profiles and focused integration flows. No live model or paid web-service requests were made.

- Both source and packaged Windows builds passed the existing app smoke plus the browser/service Settings flow. Packaged engine startup was 707 ms; this does not measure model response time.
- The pinned agent-browser actually navigated a local HTTP fixture, returned accessibility refs, filled a field, clicked a button, read the changed page, and saved a screenshot. A public example.com navigation also succeeded. Non-HTTP navigation and arbitrary eval were rejected. The native engine accepted all new dynamic tool schemas.
- Actual renderer/preload/IPC saved and removed fake Firecrawl/Brave keys using Electron's Windows encryption, preserved a key on blank input, kept the other service when one was removed, and cleared secret drafts. Saved ciphertext decrypted correctly, while ordinary state and renderer responses contained no key. Settings were visually inspected at normal and compact sizes.
- Provider fixtures verified Firecrawl/Brave request and response shapes, one-request/no-fallback behavior, bounded text, oversized-response rejection, public URL filtering, cancellation, and redaction. Real provider credentials, credits, availability, and live responses remain unverified until keys are configured.
- Compaction percentage persistence, range validation, 0/native-default behavior, safe existing-thread reload and unchanged active turns passed focused checks. The real pinned engine accepted 80, 0 and 95, and rejected 101. Native model-driven compaction was not invoked.
- Permission fixtures confirmed that network-enabled goals can call the services within their action budget, duplicate calls dispatch once, stopping aborts goal requests, and browser access remains in direct user conversations. Normal chat service requests already dispatched can finish after Stop, bounded by their request timeout.
- Skill migration adds web-tools once, updates only the unchanged original operating guide, and preserves edited/disabled/deleted skills and IDs. The package contains only agent-browser's Windows executable and retains its upstream license.

## Earlier 0.6 verification

Checked on this Windows computer on 26 September 2026. This update uses focused integration checks, with no new test suite and no added runtime dependencies.

- The 0.6 source Electron smoke passed profile editing through the renderer/preload/IPC into actual USER.md/SOUL.md files; partial saves preserve the other file and unsaved drafts survive state updates. External edits are picked up by the next profile-context read.
- Focused profile checks covered missing-file defaults, preservation of existing content, 4,000-character limits, invalid UTF-8, recovery, and rejection of linked files/directories. Mock engine checks confirmed fresh profile context in existing chats, heartbeat, and goals, plus skill access in heartbeat without management-tool access.
- Attention checks covered Useful preference priority, Later delivery without a model call, per-day notification limits, muted topics, goal inbox routing, retained evidence for muted file changes, pending-alert coalescing, 24-hour expiry after the due time, mark-read cancellation, persistence, and rollback on a failed state save. The UI flow saved settings and exercised Useful, Later, mute, and unmute through actual IPC.
- All three starter skills pass Little Bot's real parser and are installed once without duplicates. The two public adaptations include pinned upstream links and original MIT notices. The optional skill-creator Python validator could not run because the available Python environments lack PyYAML; no package was installed for it.
- Profile and feedback screens were visually inspected. The profile also fits the compact 900 × 720 window without horizontal overflow.
- The packaged 0.6 executable passed the full smoke flow, including the new profile, skill, and feedback checks. Profile and attention controls fit the compact window. The normal 0.6 app was opened after gracefully closing 0.5; existing chats, memory facts, and goal IDs were preserved. Three starter skills and both profile files were confirmed in its real app data.

- The source Electron smoke check passed the real engine handshake, renderer isolation, Windows workspace-write/read-only policies, existing forms, local plugin import, MCP discovery and calls, tool toggles, heartbeat MCP isolation, and the simulated compaction lifecycle.
- The new Goals flow ran through the real renderer, preload, IPC, store, runner, snapshot, and verification paths: save a draft, run one step, verify the resulting file, inspect Undo, restore its previous contents, and globally pause/resume. Its model output and usage were simulated; the file operations and app flow were real.
- Focused runner checks covered completion without a model call when criteria already pass, file verification, refusal to overwrite later edits, restoring created/deleted/modified files, snapshot retention, and interrupted-work recovery.
- Native engine probes checked acceptance of management tool definitions, explicit MCP broker grants, disabled native MCP connections in the goal context, and read-only command verification. The pinned engine's direct command/exec resolves workspace-write against its process configuration; autonomous writes instead use a goal thread whose own working directory and writable roots are configured. Verification commands use read-only mode.
- Goal management checks covered draft creation, partial draft updates, refusal to start an unauthorized draft, skill discovery/read, and disabled routine creation.
- Goals, the goal editor, and Undo were inspected at normal and compact window sizes; the compact layout has no horizontal overflow.
- The preceding 0.5 packaged executable passed the core app, MCP, goal, and compaction smoke flows; 0.6's source run passed those again alongside the new profile and attention flows.

Live model goal execution, reply/checkpoint quality, model-selected tools, and real-account token reporting still require connected-account verification. Smoke checks use isolated profiles and make no model requests. Desktop toast delivery, remote-provider OAuth, and external-tool side effects are not verified by these checks.

The app is an unsigned personal build. It needs an open application and awake PC to run scheduled work. The Windows sandbox restricts writes rather than all reads. Scoped Undo cannot reverse external service operations or arbitrary process side effects. Budgets rely on engine usage reporting and cancellation, so an in-flight request may exceed a limit before stopping.

## Tool availability and Strata cache repair (2026-09-30)

Existing persistent conversations now migrate their app-tool registry before engine startup, with a history backup and byte-preserved message tail. Full chat exposes 26 app tools, including memory writes and management of heartbeat, standing intents, goals, routines, profiles, settings, extensions, services and browser setup. Operations needing an idle engine return a persisted queue ID and report eventual success/failure through app_state. The overview excludes full histories and submitted operation payloads.

Validation: 416 Node tests, all 12 Electron checks, and an additional actual bundled-engine restart/resume test that observes the newly registered tools in the outgoing inference request. The bundled guide is parsed with the production importer and checked against the prior native installation's migration hash.

The local relay now permits ten minutes without model output during long prefills and routes independent Strata cache slots for chat, memory extraction, autonomous work and answer checks. The tested engine patch, build instructions and real-model parity tests are in [integrations/strata](integrations/strata/README.md). The installed RTX 4070 Ti/int8 KV/MTP configuration passed cold-versus-restored output comparisons, retrieval beyond the 32k resident window, and interrupted-stream recovery. Other KV formats and vision cache rotation are not covered by these live tests.

The final native app test used the existing 173k-token conversation: heartbeat_manage, browser_manage and service_manage all completed, and the model confirmed both memory write tools. After background memory extraction and an app restart, the next foreground request restored 178,036 cached tokens in 914 ms and processed only 3,881 new tokens (8.8 s prefill), rather than rereading the whole conversation. The app_state overview then completed successfully. The native bundled guide reached version 18 and all installed source files were hash-checked.

## Official Strata migration — October 1, 2026

The relay and workflow provider configs no longer assign the custom PR #175 cache slots. Standard Chat Completions requests retain each workflow's full history. A regression server rejects custom slot metadata and verifies alternating chat/extraction/goal/review/chat requests, translated Responses completion and cached-token reporting.

Validation: syntax checks passed for 166 JavaScript files, all 456 Node tests passed, and all 14 Electron check programs completed successfully. The portable Little Bot build was regenerated.

The local Strata installation was backed up to `C:\Strata\backups\before-official-0.1.33` and updated to the matching official v0.1.33 source and Windows engine. The installed IQ2_XS model, int8 KV with a 32k resident window, MTP, vision and refusal projection (`project:4-44`, strength 1.0) started successfully. Model weights and runtime dependencies were reused.

An isolated server on port 8081 tested A/B/A histories through the actual Little Bot Responses relay. Both documents contained 16,956 prompt tokens and two distant records. At the original 262K context, correct answers were returned but parking was denied: approximately 2.7 GiB was free, below the configured 4 GiB floor plus the 584 MiB snapshot. Cache counts were 0/0/0. The default launcher retains that context and its admission checks.

At 128K context with a 4 GiB budget, eight slots and the official 2,560 MiB admission floor, free RAM before the requests was approximately 4.6 GiB. Cold A and B returned the expected records with zero cached tokens in 11.038 s and 10.557 s. Returning to A reused 16,949 tokens and returned the same expected records in 0.553 s. This is a synthetic single-GPU text test, not an end-to-end agent benchmark or an image/cancellation/long-context parity claim.

An optional `C:\Strata\Strata-main\run-iq2_xs-cached-128k.bat` launcher uses the verified smaller-context preset on port 8080. Its shorter window can require earlier compaction; it must not run alongside the default launcher on that port. The earlier PR #175 SSD-slot measurements above are historical and do not describe the official RAM cache.

## SSD conversation parking on Strata 0.1.33 — October 2, 2026

The versioned patch `integrations/strata/ssd-conversation-cache-0.1.33.patch` adds optional temporary SSD storage to the official shared snapshot implementation, retaining automatic prefix selection and the standard API. The default storage mode remains RAM. The patch applies cleanly to pristine v0.1.33 source. It was built with MSVC, CUDA 13.3 and architecture 89, and tested with the installed cu13 runtime on an RTX 4070 Ti.

Engine validation passed 4,196 cache/storage checks, 2,038 real-GPU snapshot checks, 972 host validation checks and 25 memory-policy checks. GPU fixtures compare RAM and SSD captures/restores byte for byte for FP16, int8, Q4 and hybrid KV in supported layouts, including main and draft state plus recurrent/index state. Host checks cover disk admission boundaries, prefix matching with offloaded payloads, independent buffer ownership, malformed state rejection, eviction accounting and temporary-file cleanup. Nine focused Little Bot relay/adapter/probing tests and the updated diagnostic script's syntax check also passed; the full app suites had already passed during the migration above.

The initial long test encountered insufficient C: space. Capture failed safely and continued cold; a subsequent change added an upfront disk-space check, oldest-first eviction and a 512 MiB free disk floor. Unknown disk telemetry skips parking. Concurrent disk writers can still cause an I/O miss. The user retained C: as the destination and freed space before final validation.

An isolated 8081 server then used the full 262,144 context, int8 streaming KV with 32,768 resident tokens, MTP, vision and the same projection strength 1.0. A 182,955-token foreground document and a 16,954-token background document went through the actual Little Bot Responses relay. Cold answers returned the expected first and distant records with zero cached tokens in 127.123 s and 15.369 s. Returning to the foreground reused 182,948 tokens and returned the identical answer in 5.453 s. After aborting a third streaming request, the background restored 16,947 tokens in 8.538 s, and the foreground again restored 182,948 tokens in 5.804 s. These times include parking and cancellation completion, not just disk reads.

The long snapshot contained 3,623,057,136 bytes; the small snapshot contained 495,215,316 bytes. Both parked images retained about 3,837 KiB of accounted host metadata instead of their full inactive payloads. Active checkpoint state still uses RAM, and Windows can cache disk I/O in reclaimable memory. The diagnostic GPU read-back verified the restored draft payload and resident ring. This is a synthetic text/cancellation test; image rotation, HIP, other GPUs and all model-output parity scenarios remain unverified.

The official engine, touched source and normal configuration were backed up to `C:\Strata\backups\before-ssd-0.1.33`. The normal 262K launcher now uses SSD storage with a 16 GiB snapshot budget, eight histories and a 1 GiB physical RAM floor. Temporary files close on eviction/exit; cache state does not survive restart. Future official engine replacements require rebuilding this local addition. The 128K RAM preset remains available separately.
