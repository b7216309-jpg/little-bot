# Second functional review — 2026-10-01

Application: **Little Bot 0.10.1**. Reviewed source: **c6b9c1ea09a1615fd53469bbbbbd11314d68c4a9**. This pass found **six remaining issues**, grouped by failure mechanism. R2 affects calendar, goals and schedules.

This is a review/documentation change. The issues below remain unfixed in the reviewed application. Personal app data was not modified. Existing passing tests and earlier live tests do not erase the newly reproduced failures.

## Confirmed findings

| ID | Priority | Trigger and effect |
| --- | --- | --- |
| R3 | P2 | Lost turn/start acknowledgement releases the UI execution lane while the engine can still be running; late output is suppressed |
| R2 | P2 | Failed calendar, goal or schedule saves retain mutations in live state; a failed goal Run can still authorize/queue execution |
| R1 | P2 | A deferred action whose enqueue save failed can execute after recovery despite being reported as rejected |
| R4 | P2 | An automation/heartbeat holds all event dispatch until completion; unrelated events wait and a burst can overflow |
| R6 | P3 | UI edits a running automation; completion is attributed to its new definition although its old prompt ran |
| R5 | P3 | Base agent prompt promises missed-run catch-up, contradicting actual reopen behavior and the bundled guide |

P2 means a functional/recovery failure under the stated condition. P3 means a misleading or inconsistent result. Fault-injection findings identify possible recovery behavior; they do not claim that the user's actual disk or provider suffered that failure.

### R3 — lost start acknowledgement leaves turn ownership inconsistent

Sources: [Controller.send catch](../../src/controller.cjs#L628), [finish](../../src/controller.cjs#L801), [completed-turn filtering](../../src/controller.cjs#L956).

**Reproduction:** an isolated fake engine sends turn/started, keeps its turn active, then rejects the pending turn/start RPC as timed out. The real Controller.send catch calls finish. The probe observes app status idle, engine still active, no turn/interrupt request, and ignored late output from that turn.

**Impact:** readiness checks now permit other work even though the engine may still execute tools. The UI reports failure without tracking or displaying subsequent output. This is a simulated lost acknowledgement, not a newly observed live Strata incident.

**Repair direction:** separate uncertain start failure from confirmed terminal completion. Reconcile or interrupt an established engine turn before freeing the lane; retain ownership while status is uncertain. Only mark a turn completed after confirmed termination. Apply a corresponding bounded recovery policy when the turn ID was never received.

### R2 — save errors do not roll back live calendar/goal/schedule changes

Sources: [calendar mutation](../../src/main.cjs#L186), [goal save/Run](../../src/goals.cjs#L168), [chat schedule management](../../src/schedule-management.cjs#L30), [UI automation save](../../src/main.cjs#L448).

**Reproduction:** replace save with an injected failure. The production calendar functions, extracted directly from main.cjs, retain a failed create and remove an event after a failed delete. A later unrelated save persists the failed create, with zero calendar change notifications.

The real GoalRunner retains a failed new goal; a failed Run marks it authorized/queued and keeps its forced-run entry. The real schedule-management function retains a failed enabled routine.

**Impact:** “Save failed” does not mean nothing changed. The UI/intent consumers can disagree with the live data, and queued autonomous work can remain eligible after a rejected Run. Source inspection shows the corresponding UI automation save has the same mutate-before-save order.

**Repair direction:** stage the next state, persist successfully, then commit/publish; or restore all affected records/queues on failure. Include forceRuns and notifications in recovery tests. Store's SQLite indexing occurs before the JSON replacement, so full cross-store consistency also needs explicit handling; a JavaScript rollback alone is not a complete database transaction.

### R1 — rejected deferred operation remains executable

Sources: [AppManagement.call](../../src/app-management.cjs#L47), [tick](../../src/app-management.cjs#L48).

**Reproduction:** call settings_manage/save with an enqueue save failure. The promise rejects, but one queued job remains. Restore saving and tick the real AppManagement; its handler executes once and the job becomes completed.

**Impact:** the agent/user receives an error and may retry or abandon the action, but the original action is still pending. Retrying can create duplicate work.

**Repair direction:** persist a staged job list before exposing the queued job, or remove the exact new job on enqueue failure. Keep the previous fix that retries final persistence without replaying an already finished handler. These are different failure paths.

### R4 — model work blocks the event dispatcher

Sources: [EventBus._drain](../../src/event-bus.cjs#L218), [awaited subscriber](../../src/event-bus.cjs#L265), [due handlers](../../src/event-runtime.cjs#L170), [standing automation action](../../src/event-runtime.cjs#L242).

**Reproduction:** start the real EventRuntime with a scheduler promise held open to represent a long model run. Publish an urgent calendar.created event. Its handler does not run while the automation waits. Publish 105 additional distinct events into the default queue: six events are dropped. After releasing the automation, 100 calendar handlers run.

**Impact:** pure event matching and settlement wait behind a model turn even when they need no model access. The burst is synthetic, not an observed personal-calendar workload; ordinary unrelated event delivery is still delayed until completion. Priority cannot preempt the awaited active handler.

**Repair direction:** event handlers should record/launch owned work and return promptly, with completion/error published separately. Continue enforcing one model execution lane in the runners. Preserve pending intent settlement, loop traces and close/cancellation ownership when changing dispatch behavior.

### R6 — running automation can be edited through the UI but not the chat tool

Sources: [UI Edit control](../../src/renderer/app.js#L2067), [saveAutomation IPC](../../src/main.cjs#L448), [tool refusal](../../src/schedule-management.cjs#L13), [completion bookkeeping](../../src/scheduler.cjs#L191).

**Reproduction:** hold the real Scheduler run open. schedule_manage/update refuses the edit; the production UI save handler accepts the same change. Release the old run. The probe observes executed prompt “Original task,” saved prompt “Edited task,” lastStatus completed and an automation.completed event named “Edited routine.”

**Impact:** last-run status and event consumers see the edited definition attached to results from the previous definition. The shared chat carries the old origin, giving conflicting attribution.

**Repair direction:** use a consistent backend rule that refuses running-definition edits, or version automation definitions and retain the executed version/name/prompt in run status and emitted events. Disabling future schedules while a run finishes can remain a distinct operation.

### R5 — missed-run policy has conflicting instructions

Sources: [base prompt](../../src/controller.cjs#L46), [advanceMissedSchedules](../../src/missed-schedules.cjs), [bundled operating guide](../../resources/skills/little-bot/SKILL.md).

**Reproduction:** inspect both supplied instructions and run the real reopen helper with an overdue exact schedule. The base prompt says “run once when available”; the bundled guide says missed occurrences are skipped, and the helper moves the schedule into the future without running it.

**Impact:** an agent can explain a catch-up behavior the app does not implement, especially when it omits the operating guide. A user expecting a missed appointment check after reopening receives no run.

**Repair direction:** align base instructions with the implemented foreground-only policy: skip occurrences missed while closed; distinguish waiting while open/busy and a possible attempt after sleep. A product change to catch-up would require separate behavior/test changes.

## Feature coverage and failure gates

All source modules are assigned to a guide in the [source map](source-map.md). This table summarizes review evidence; “tests passed” means the cited fixtures, not every possible real-world use.

| Feature | Evidence | Remaining failure gate / finding |
| --- | --- | --- |
| Startup, encrypted state, large history | Store/encryption/reliability suite | Windows decryption, unavailable directories; JSON/SQLite are separate writes |
| Engine transport and resume | Codex/controller tests | Offline engine/provider, R3 uncertain turn ownership |
| Shared conversation and automation origins | Single-session + Electron fixtures | Legitimate thread rotation; R6 definition attribution |
| Streaming, reasoning and tool activity | Controller/UI fixtures | Provider disconnect/cutoff; reasoning capability depends on model |
| Plan/Execute | Plan/full-access tests | Different sandbox/tool set; do not expect writes in Plan |
| Context inspector and compaction | Context/compaction tests | Inspector is process-local; model compaction needs connection |
| Memory records, history and sources | SQLite/recall/Electron tests | Memory toggle, scope, missing sources and selection quality |
| CPU embeddings | Real local encoder test + verified assets | English-focused encoder; CPU latency and fallback to lexical search |
| Automatic learning | Consolidation/retry tests | Failed jobs, no selected facts; no extraction completeness guarantee |
| Task goals and host verification | Contract/ledger/executor tests | Draft, permissions, budgets, dependencies, R2 persistence |
| Ongoing review and shared-chat answers | Goal UI/events tests; earlier live evidence | Unchanged-source short circuit, pending user question |
| Goal ledger and restore | Ledger/files/Electron fixtures | Scoped file-only undo, quota/conflict/partial-restore limits |
| Interval/exact schedules | Scheduler/exact-time/missed tests | App open/awake, saved binding, R2/R4/R5/R6 |
| Heartbeat and attention | Heartbeat/controller/inbox tests | Checklist, hours/caps/muting, offline model, R4 |
| Calendar read/write | Calendar/Electron + new source-handler fault probe | Local-only dates/calendar; R2 missed change events |
| Additional calendar evidence for goals | New internal-task calendar_list probe | Passed: ninth event can be retrieved; no missing-tool finding |
| Standing intents and file events | Bus/runtime/intent tests + R4 probe | Bounded foreground queue, authorized target, watcher ownership |
| App management tools | Management suite + new enqueue probe | Direct-chat scope, idle queue, R1 |
| Attachments and output delivery | Production IPC Electron + vision tests | Quotas, parsing/vision/file-type limits |
| Questions and answer challenge | Controller/goal/check suites | Live RPC ownership, model review quality, tools disabled in checker |
| Skills, plugins and MCP | Extension/runtime/GitHub protocol tests | Enable/import/auth/command/tool availability |
| Browser | Source review + successful native --version launch | End-to-end websites/login not exercised this pass |
| Brave / Firecrawl | Routing/concurrency/cancellation fixtures | No fresh paid-provider calls; keys/quota/network required |
| Profile and settings | Controller/settings/profile source and fixtures | Text limits, busy lane, invalid files/configuration |
| Provider usage | Protocol/UI/Electron tests | Missing provider data is unavailable, not zero; no paid-account probe |
| Renderer navigation, scroll and commands | Electron fixtures | Backend remains authoritative; R6 UI/backend mismatch |
| Packaging and installation | Source + existing distribution fixtures | No rebuild/reinstall or fresh real uninstall this pass |

Bank-account aggregation, mobile calling and a dedicated phone/ROM are ideas, not existing typed app integrations verified by this pass.

## Verification record

Fresh run: **166 JavaScript syntax checks, 453 Node tests, 14 Electron fixtures passed**. Electron emitted GPU diagnostic messages in some fixtures; assertions and process exit status passed. No live Windows notification or paid third-party action was used as evidence.

New isolated probes: eight observed failure manifestations across six findings, plus a passing additional-calendar tool check and a native browser executable-launch check. The saved [machine-readable results](review/evidence.json) and [probe source](review/reproduce.cjs) record actual outcomes. See [reproduction instructions](review/README.md) for what is fake and what is production code.

The previously performed installed-app live Strata checks apply to the same unchanged application code: foreground generation, memory extraction with provenance, host-verified goal file writing, ongoing calendar review, intent settlement, unchanged-review no-call behavior and output-cutoff failure. They are recorded in [VALIDATION.md](../../VALIDATION.md). They were **not rerun or relabelled as new live evidence** here.

This pass does not establish arbitrary prompt quality, future error-free operation, remote OAuth success, real GitHub/API side effects, browser-site compatibility or SSD-cache performance on other configurations.
