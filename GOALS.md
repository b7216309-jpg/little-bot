# Goals: tasks and ongoing work

> Two kinds of goals: this page covers **background goals**, which Little Bot works on by itself over days (open the Goals page, or type `/goals` in the chat). To have it keep working on something *right now in the conversation* until it is done, type `/goal <what must be true when it is done>`, like in Claude Code. See [the system guide](docs/system-guide/02-chat-context.md#goal-keep-working-until-it-is-done).

Goals share Little Bot's continuous conversation. A **Task** has a finite outcome and acceptance checks. An **Ongoing** goal acts when Little Bot can do useful work and coaches when the user must act. An ongoing review ending does not complete the overall goal.

## Create a goal

Open **Tools → Goals → New goal**, or type `/goals` with an objective. The editor has six tabs: Basics (type and outcome), Evidence, Checks, Access, Limits and Schedule. Save the draft and choose **Run**. New goals use the outcome contract; legacy goals retain their history and behavior until edited.

The continuous chat is enabled as a source by default, together with upcoming calendar events. Optional **Files** on the Evidence tab are absolute paths to regular text files, each up to 2 MiB. They may live outside the goal's working folder. The collector supplies bounded excerpts, source IDs and versions; inaccessible files are reported as coverage gaps. They do not expand writable access. Memory off disables recent chat recall and semantic memory access.

Ongoing goals can provide advice without file checks. Tasks require at least one acceptance check. A **fileExists** or **fileContains** check verifies an artifact; a **command** check runs read-only with network disabled, requires terminal permission and has a 20-second timeout. Choose checks that establish the actual outcome: a heading alone cannot prove substantive progress. A recurring task cannot claim fresh completion from checks that already passed unless this run produced observable file changes.

## Fresh evidence and quiet reviews

Before model work, Little Bot collects a chronological page of new user messages, versions of selected evidence files, and upcoming/due calendar events. Scheduled automation prompts and goal messages are excluded from user evidence. Initial chat context includes a bounded recent page; subsequent pages use a durable message cursor. Source versions and cursors are saved with the review result.

Timed calendar events also become fresh evidence when they enter the 24-hour, one-hour, and fifteen-minute preparation windows, or start. The excerpt reports the current window; ordinary clock ticks within the same window stay quiet. All-day events do not use minute-level preparation windows. These changes are detected at the goal's next activation, so an hourly goal can still notice a fifteen-minute window late. This does not add exact-time triggers or closed-app execution.

An ongoing goal defaults to **Review when evidence changes**. After the first review, unchanged evidence produces a quiet review with no model call and no state-file rewrite. **Review at every scheduled activation** requests a model review even without changes. Manually running a goal requests a fresh review. Memory retrieval supplements a specific missing fact; it does not replace new conversation evidence.

Absence of a source or an empty search does not establish user failure, avoidance or an unresolved decision. Saved checkpoints are historical interpretations and may be corrected by fresh evidence.

## Results and chat

Runs have explicit outcomes: **update**, **progress**, **completed**, **recommendation**, **waiting**, **no-change** or **failed**. Only Tasks can be completed. Updates correct stale facts or priorities. Recommendations are advice, not proof that the user acted. The host checks source IDs and acceptance checks; progress without observable evidence is kept as a recommendation, and unsupported completion records are rejected. Source references make claims inspectable but do not mechanically prove that coaching advice is useful.

Useful outcomes and questions appear as labelled goal messages in the existing chat. Quiet reviews remain in the goal's history. Cards show the latest meaningful result, last review outcome, proposed actions and upcoming activation. Agent messages cannot trigger their own review as user evidence.

A pending question has an answer form in both chat and the Goals panel. Either form saves the answer against the same exact goal/question ID, then queues continuation with existing access; finite tasks retain their cycle budget. Chat tools can answer with `goal_manage` action `answer`, or `goal_control` action `answer`, using `id`, `questionId` and `answer`. An ambiguous reply must not be silently assigned to a goal.

Proposed actions record an owner: bot or user. A verified user action needs a cited user confirmation; bot action verification needs passing task checks and fresh evidence. These source checks establish provenance, not an independent semantic judgment of every statement. Goal state accompanies direct chat requests, so the conversation can discuss or update goals without recovering a separate transcript.

## Scheduling and interruption

One goal step runs at a time and shares the engine execution lane with chat, heartbeat and automations. Chat has priority. A chat message pauses active goal work; no competing turn is submitted to the same engine thread. Questions wait for answers. Failed or malformed outcomes block for review rather than repeatedly claiming success.

Manual, interval and stable file-change triggers remain available. Interval goals use their saved minute interval; an ongoing review returns to its next activation rather than declaring the lifelong goal complete. The app must be open: there is no background Windows service, closed-app backlog or wake-from-sleep scheduler. Missed intervals advance to a future occurrence on reopening. The **Background** switch in the sidebar (also **Pause background** here, in the widget menu and on the phone) persists and pauses goals, heartbeat, routines, night shift, memory learning and page watches; turning it back on skips what fell due meanwhile.

Heartbeat handles its checklist and small event-driven actions. It should not duplicate the goal's full daily review. Configure one owner for a recurring task instead of creating copies in goals and heartbeat.

The optional **Night shift** setting (off by default in Heartbeat) can chain useful next steps for an authorized local goal while you are away. Each step still uses GoalRunner's checks, saved permissions, budgets and active-hours rules; only the spacing between useful steps is shortened. Returning or sending a message interrupts the local request and leaves unfinished work queued for recovery. Goal results are held for one return summary.

## Access, budgets and history

Existing saved access and budget controls remain. On a local model the token budget counts new prompt tokens and output; rereading the cached prompt is free and does not count. Goals can read/write selected workspace paths, use terminal and network when enabled, and call individually granted MCP tools. A writable folder that does not exist yet, such as `reports/`, is created inside the working folder before the first step. Goal model threads remain internal bounded execution threads; the public conversation and evidence are shared, without injecting the entire audit history into each model request.

New goals have no token, time or action limit by default (0 means no limit), with 10 model runs and 2 retries. Each model step still stops after 10 minutes. Input + output limits count cumulative reported usage across model requests. Cards and history show generated tokens separately when available. Each activation is bounded by token, action, time and model-run limits. An ongoing review resets its activation usage after a valid result; failure preserves usage. A request already in flight can exceed the last displayed limit before cancellation settles.

The existing plan/evidence audit history and scoped file snapshots are retained for compatibility and Undo. New execution receives a compact outcome/action state rather than the entire legacy ledger. Undo restores captured file contents, refuses later-edit conflicts and cannot reverse external service actions. Interrupted external operations remain subject to the existing effect review; do not blindly repeat a booking or message.

See [docs/GOALS-V2-DESIGN.md](docs/GOALS-V2-DESIGN.md) for the foundation and acceptance scenarios. Unit, production renderer and isolated local-model tests cover the redesigned behavior. Actual coaching effectiveness still depends on user feedback.

## Plan and evidence ledger

Legacy goals retain exactly one active step and their earlier plan/evidence records. New goals execute the outcome contract while retaining that audit history and Undo. See [LEDGER.md](LEDGER.md) and [EVENTS.md](EVENTS.md) for legacy records and foreground event behavior. File triggers take a fresh baseline on reopening.

Ongoing reviews emit `goal.reviewed`, which finishes the standing intent’s run while the ongoing goal remains scheduled. A later event can request another review; duplicate active launches are skipped. Completion dependencies accept tasks only. Existing impossible dependencies block with an edit instruction instead of waiting forever. Calendar evidence retains complete timestamps and timezone information.
