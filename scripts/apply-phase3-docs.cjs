'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { parseSkill } = require('../src/extensions.cjs');

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const write = (file, content) => fs.writeFileSync(file, content, 'utf8');

function replaceOnce(file, before, after, label) {
  const input = read(file);
  const count = input.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  write(file, input.replace(before, after));
}

function replaceRegexOnce(file, pattern, after, label) {
  const input = read(file);
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...input.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) throw new Error(`${label}: expected one match, found ${matches.length}.`);
  write(file, input.replace(pattern, after));
}

const skillPath = 'resources/skills/little-bot/SKILL.md';
const previousSkill = parseSkill(read(skillPath));
const previousGuideHash = createHash('sha256').update(JSON.stringify({
  name: previousSkill.name,
  description: previousSkill.description,
  content: previousSkill.content,
})).digest('hex');

replaceRegexOnce('README.md', /^- \*\*Goals:\*\*.*$/m,
  '- **Goals:** define an objective, checks, permissions, and budget. Every goal keeps a versioned one-active-step plan plus bounded assumptions, observations, decisions, and verification evidence that survive restart and chat compaction. Review undo records restored file evidence. See [GOALS.md](GOALS.md) and [LEDGER.md](LEDGER.md).',
  'README goal feature');

replaceOnce('GOALS.md',
  'Open **Goals → New goal**, describe the outcome, and add completion checks. Save the draft, review its access and budget, then choose **Run**. The app saves its checkpoint, next step, usage, and history between runs. A model claiming success cannot mark a goal complete: every saved check must pass.',
  'Open **Goals → New goal**, describe the outcome, and add completion checks. Save the draft, review its access and budget, then choose **Run**. The app saves its checkpoint, usage, history, and versioned plan-and-evidence ledger between runs. A model claiming success cannot mark a goal complete: every saved check must pass.',
  'Goals introduction');

replaceOnce('GOALS.md',
  '## Completion and recovery',
  `## Plan and evidence ledger

Each goal has a bounded ledger with a current plan, assumptions, observations, decisions, and host evidence. A non-completed goal has exactly one active step. The model may see later steps as context, but it is instructed to execute only the active step; Little Bot still runs one agent task at a time.

The initial objective and suggested steps become plan version 1. Editing the objective or steps, revising the approach from new evidence, rerunning a completed goal, or repairing an exhausted malformed plan creates a new version. Unfinished work in the older version becomes superseded and remains visible under **Earlier plan versions** rather than being rewritten.

Preflight and final completion checks become structured observations. Writable runs add bounded file-snapshot evidence, and **Review undo** adds restore evidence plus a user decision. The model can add concise public assumptions, observations, and decisions, but not a private reasoning or chain-of-thought transcript. Confirmed and rejected assumptions accompany later runs so disproved information is not silently forgotten.

The ledger is stored on the goal itself, so it survives restart, pause, clarification, interval or file-triggered continuation, and conversation compaction. Interrupted local work keeps the same active recovery target; externally capable work retains the existing effect-review block. Expand **Plan, evidence, and history** on a goal card to inspect the current plan, evidence, decisions, activity history, and earlier versions. See [LEDGER.md](LEDGER.md) for the data model, limits, and recovery rules.

## Completion and recovery`,
  'Goals ledger section');

replaceOnce('GOALS.md',
  'Before writable goal work, Little Bot stores scoped local file copies outside the goal\'s writable folders. Run history records the resulting file changes. Choose **Review undo** to inspect affected paths and restore them. Undo refuses to overwrite a file changed after that run, and leaves the goal paused. Restore writes each file atomically; if a conflict arises during a multi-file restore, the activity log reports partial progress.',
  'Before writable goal work, Little Bot stores scoped local file copies outside the goal\'s writable folders. Run history and the evidence ledger record the resulting file changes. Choose **Review undo** to inspect affected paths and restore them. Undo records the restored-path evidence and leaves the goal paused. It refuses to overwrite a file changed after that run. Restore writes each file atomically; if a conflict arises during a multi-file restore, the activity log reports partial progress.',
  'Goals undo evidence');

write('NEXT.md', `# Possible next additions

Keep additions driven by actual use. Little Bot remains a foreground-only, single-agent Windows application: closing the program stops every timer, watcher, event, model call, and action.

Implemented foundations:

- [Independent Check](INDEPENDENT-CHECK.md): Selective, Always, Off, and manual Challenge anti-sycophancy review.
- [In-process events and standing intents](EVENTS.md): one bounded foreground queue connecting deterministic events to authorized goals and automations, with no gateway or closed-app backlog.
- [Goal plan and evidence ledger](LEDGER.md): one active step, versioned plans, bounded assumptions, observations, decisions, host verification evidence, restart recovery, and inspectable prior versions.

1. **Windows UI Automation.** Add inspectable foreground control of native Windows applications through the accessibility tree, with one action between observations and screenshots only as fallback.
2. **Provider usage display.** Show reliable provider limits or local performance when available; existing token, time, and action budgets remain independent of a pricing service.

## Deliberate non-goals

- No daemon, gateway, startup service, tray worker, remote-control endpoint, webhook listener, or execution while the app is closed.
- No subagents, parallel workers, swarms, or second agent loop.
- No extra physical memory layer, vector database, marketplace, or automatic plugin update system unless a concrete use case later requires one.
`);

replaceOnce(skillPath,
  "description: Configure and explain Little Bot's app tools and controls. Read for heartbeat setup, recurring tasks or cron requests, standing intents, goals, memory, connections, and app behavior.",
  "description: Configure and explain Little Bot's app tools and controls. Read for heartbeat setup, recurring tasks or cron requests, standing intents, goals and their plan/evidence ledger, memory, connections, and app behavior.",
  'skill description');

replaceOnce(skillPath,
  '- `goal_manage` and `schedule_manage`: list, create, update, pause, or resume goals and recurring routines. List before using an existing ID. Available in direct user chats only.',
  '- `goal_manage` and `schedule_manage`: list, create, update, pause, or resume goals and recurring routines. List before using an existing ID. Available in direct user chats only. Goal work uses a saved, versioned plan-and-evidence ledger; the tool does not directly edit ledger records.',
  'skill app tool ledger');

replaceOnce(skillPath,
  'Goals need an objective and observable checks: `fileExists`, `fileContains`, or `command`. Paths are relative to the chat folder; command checks require terminal permission. `goal_manage` creates/updates drafts. The user reviews permissions, budget, and trigger in **Goals**, then starts the first run. Triggers are manual, interval, or selected file changes. Interval goals advance unfinished work; completed goals stop. File-triggered goals record a new baseline whenever the app opens, so closed-app changes do not wake them. Tools cannot set these trigger/permission/budget fields or enlarge existing grants.',
  `Goals need an objective and observable checks: \`fileExists\`, \`fileContains\`, or \`command\`. Paths are relative to the chat folder; command checks require terminal permission. \`goal_manage\` creates/updates drafts. The user reviews permissions, budget, and trigger in **Goals**, then starts the first run. Triggers are manual, interval, or selected file changes. Interval goals advance unfinished work; completed goals stop. File-triggered goals record a new baseline whenever the app opens, so closed-app changes do not wake them. Tools cannot set these trigger/permission/budget fields or enlarge existing grants.

Every goal has one active plan step. The model must work only on that step; future steps are context, not parallel work. User edits, evidence-driven revisions, and reruns after completion create new plan versions while earlier versions remain inspectable. Assumptions, observations, decisions, verification results, file snapshots, recovery notes, and Review undo evidence persist on the goal across restart and conversation compaction. These are concise public audit records, not hidden reasoning or chain of thought. Inspect them under **Plan, evidence, and history**. See [GOALS.md](../../../GOALS.md) and [LEDGER.md](../../../LEDGER.md).`,
  'skill goals ledger');

replaceOnce(skillPath,
  '- **Goals:** permissions, budgets, dependencies, triggers, Pause all, and Review undo. Undo covers captured files and refuses later-edit conflicts; external effects cannot be undone.',
  '- **Goals:** permissions, budgets, dependencies, triggers, Pause all, Review undo, and the versioned plan/evidence ledger. Exactly one step is active; earlier plans and restored-file evidence remain inspectable. Undo covers captured files and refuses later-edit conflicts; external effects cannot be undone.',
  'skill controls ledger');

let bundles = read('src/bundled-skills.cjs');
if (!bundles.includes(`'${previousGuideHash}'`)) {
  const anchor = "  'little-bot': [\n";
  const count = bundles.split(anchor).length - 1;
  if (count !== 1) throw new Error(`bundled guide hash: expected one anchor, found ${count}.`);
  bundles = bundles.replace(anchor, `${anchor}    '${previousGuideHash}', // starter guide v7 / package 0.8.8\n`);
}
if (!/const VERSION = 7;/.test(bundles)) throw new Error('Bundled skill version 7 was not found.');
bundles = bundles.replace('const VERSION = 7;', 'const VERSION = 8;');
write('src/bundled-skills.cjs', bundles);

for (const file of ['package.json', 'package-lock.json']) {
  const json = JSON.parse(read(file));
  json.version = '0.8.9';
  if (json.packages?.['']) json.packages[''].version = '0.8.9';
  write(file, `${JSON.stringify(json, null, 2)}\n`);
}

replaceOnce('VALIDATION.md',
  '# Version 0.8.8 verification',
  `# Version 0.8.9 verification

Checked on 28 September 2026 with Node 24 on the Windows runner. This phase used deterministic executor fixtures rather than a live model-provider call.

- A new persisted goal ledger enforces one active step for every non-completed goal. Focused tests covered initial migration, malformed state with multiple active steps, bounded plan history, a full exhausted plan, user objective and step edits, evidence-driven revisions, and rerunning a completed goal as a fresh plan version.
- The real GoalRunner path was exercised with a deterministic fake model that wrote a file, returned structured assumptions, observations, and decisions, and then passed the app-owned completion check. Preflight and final verification, file snapshots, blockers, answers, restart recovery, global pause, budget-stop completion, and Review undo all produced bounded inspectable records.
- The executor receives the current version, exactly one active step, current assumption states, recent observations, and recent decisions. Its structured response is limited to concise public ledger records and an optional complete replacement plan. No private reasoning or chain-of-thought transcript is requested or stored.
- Goal-card rendering passed pure-model checks and a sandboxed Electron fixture covering the active step, completed and pending steps, earlier versions, confirmed assumptions, failed verification evidence, decisions, restored-path evidence, and the public-record notice. Legacy goals retain a safe renderer fallback while persisted state migrates through the host.
- Recursive JavaScript syntax checks, the complete Node suite, and every retained Electron integration test passed after each runtime, UI, and lifecycle increment. The pull-request workflow also validates the portable ZIP, Setup EXE, silent installation, Apps & Features registration, Start Menu shortcut, and real uninstall path.

The ledger improves continuity and auditability; model observations remain claims until supported by host evidence. Completion still requires every saved check to pass. Closing Little Bot still stops execution, and the ledger adds no gateway, daemon, service, subagent, parallel worker, vector store, or extra physical memory layer.

## Earlier 0.8.8 verification`,
  'validation version');

const docsTest = String.raw`'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const previousGuideHash = '${previousGuideHash}';

test('Phase 3 documentation links the implemented ledger consistently', () => {
  const readme = read('README.md');
  const goals = read('GOALS.md');
  const ledger = read('LEDGER.md');
  const next = read('NEXT.md');
  assert.match(readme, /\[LEDGER\.md\]\(LEDGER\.md\)/);
  assert.match(goals, /## Plan and evidence ledger/);
  assert.match(goals, /exactly one active step/i);
  assert.match(ledger, /A goal that is not complete has exactly one active plan step/);
  assert.match(ledger, /not a chain-of-thought transcript/i);
  assert.match(next, /Implemented foundations:[\s\S]*Goal plan and evidence ledger/);
  assert.doesNotMatch(next, /^\d+\. \*\*Plan and evidence ledger/m);
  assert.match(next, /^1\. \*\*Windows UI Automation/m);
});

test('the bundled operating guide migrates only the original previous guide', () => {
  const bundled = read('src/bundled-skills.cjs');
  const skill = read('resources/skills/little-bot/SKILL.md');
  assert.match(bundled, /const VERSION = 8;/);
  assert.ok(bundled.includes(previousGuideHash));
  assert.match(skill, /plan\/evidence ledger/i);
  assert.match(skill, /Exactly one step is active/);
  assert.match(skill, /not hidden reasoning or chain of thought/i);
  assert.match(skill, /\[LEDGER\.md\]\(\.\.\/\.\.\/\.\.\/LEDGER\.md\)/);
});

test('package and validation records advance to 0.8.9', () => {
  const packageJson = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const validation = read('VALIDATION.md');
  assert.equal(packageJson.version, '0.8.9');
  assert.equal(lock.version, '0.8.9');
  assert.equal(lock.packages[''].version, '0.8.9');
  assert.match(validation, /^# Version 0\.8\.9 verification/);
  assert.match(validation, /deterministic fake model/);
  assert.match(validation, /No private reasoning or chain-of-thought transcript/);
});
`;
write('test/goal-ledger-docs.test.cjs', docsTest);
