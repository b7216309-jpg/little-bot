'use strict';

const fs = require('node:fs');

function source(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function replaceOnce(file, before, after, label) {
  const input = source(file);
  const count = input.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, input.replace(before, after), 'utf8');
}

replaceOnce('src/goal-ledger.cjs',
`  const stepStatus = ['continue', 'completed', 'blocked'].includes(input.stepStatus) ? input.stepStatus
    : status === 'blocked' ? 'blocked' : status === 'verify' ? 'completed' : 'continue';`,
`  const stepStatus = status === 'blocked' ? 'blocked' : status === 'verify' ? 'completed'
    : ['continue', 'completed', 'blocked'].includes(input.stepStatus) ? input.stepStatus : 'continue';`,
'authoritative executor outcome');

replaceOnce('src/goals.cjs',
`const { questionInput, questionText, pendingQuestion, clarifications } = require('./user-questions.cjs');`,
`const { questionInput, questionText, pendingQuestion, clarifications } = require('./user-questions.cjs');
const {
  normalizeGoalLedger, reconcileGoalLedger, applyGoalLedgerUpdate,
  recordVerificationEvidence, recordSnapshotEvidence, recordGoalBlock,
  recordGoalPause, recordUserAnswer, completeGoalLedger, recoverGoalLedger,
} = require('./goal-ledger.cjs');`,
'goal ledger imports');

replaceOnce('src/goals.cjs',
`  if (result.dependsOn.includes(id)) throw new Error('A goal cannot depend on itself.');`,
`  result.ledger = reconcileGoalLedger(input.ledger ?? existing?.ledger, existing, result, now);
  if (result.dependsOn.includes(id)) throw new Error('A goal cannot depend on itself.');`,
'goal validation ledger');

replaceOnce('src/goals.cjs',
`      if (input.needsEffectReview === true) goal.needsEffectReview = true;
      if (recovering && goal.status === 'running') {`,
`      if (input.needsEffectReview === true) goal.needsEffectReview = true;
      goal.ledger = normalizeGoalLedger(input.ledger ?? goal.ledger, goal, Date.now());
      if (recovering && goal.status === 'running') {`,
'goal ledger normalization');

replaceOnce('src/goals.cjs',
`        goal.history = historyOf([...goal.history, { at: Date.now(), kind: 'recovery', summary: goal.nextStep, status: goal.status }]);`,
`        goal.history = historyOf([...goal.history, { at: Date.now(), kind: 'recovery', summary: goal.nextStep, status: goal.status }]);
        recoverGoalLedger(goal, goal.nextStep, { now: Date.now() });`,
'goal ledger recovery');

replaceOnce('src/goals.cjs',
`    goal.authorized = true; goal.status = 'queued'; goal.nextRunAt = Date.now(); delete goal.pauseReason; delete goal.needsEffectReview;`,
`    goal.ledger = normalizeGoalLedger(goal.ledger, goal);
    goal.authorized = true; goal.status = 'queued'; goal.nextRunAt = Date.now(); delete goal.pauseReason; delete goal.needsEffectReview;`,
'goal queue ledger');

replaceOnce('src/goals.cjs',
`    const goal = this.goal(id); goal.status = 'paused'; delete goal.pauseReason;
    this.record(goal, 'paused', 'Paused by you.'); this.changed();`,
`    const goal = this.goal(id); goal.status = 'paused'; delete goal.pauseReason;
    recordGoalPause(goal, 'Paused by you.');
    this.record(goal, 'paused', 'Paused by you.'); this.changed();`,
'goal pause ledger');

replaceOnce('src/goals.cjs',
`    const previous = structuredClone(goal);
    goal.clarifications = clarifications([...(goal.clarifications || []), { id: question.id, question: question.question, answer: reply, answeredAt: Date.now() }]);`,
`    const previous = structuredClone(goal);
    recordUserAnswer(goal, question.question, reply);
    goal.clarifications = clarifications([...(goal.clarifications || []), { id: question.id, question: question.question, answer: reply, answeredAt: Date.now() }]);`,
'goal answer ledger');

replaceOnce('src/goals.cjs',
`    goal.status = 'blocked'; goal.nextStep = reason; this.record(goal, 'blocked', reason, { status: 'blocked', ...extra }); this.changed();`,
`    goal.status = 'blocked'; goal.nextStep = reason;
    recordGoalBlock(goal, reason, { runId: extra.runId || '', source: 'system' });
    this.record(goal, 'blocked', reason, { status: 'blocked', ...extra }); this.changed();`,
'goal block ledger');

replaceOnce('src/goals.cjs',
`    goal.status = 'completed'; goal.nextStep = ''; delete goal.pendingQuestion;
    this.record(goal, 'completed', 'Goal completed and verified after the final allowed action.', { runId, status: 'completed' });`,
`    goal.status = 'completed'; goal.nextStep = ''; delete goal.pendingQuestion;
    completeGoalLedger(goal, 'Goal completed and verified after the final allowed action.', { runId, now: Date.now() });
    this.record(goal, 'completed', 'Goal completed and verified after the final allowed action.', { runId, status: 'completed' });`,
'budget completion ledger');

replaceOnce('src/goals.cjs',
`    const runId = randomUUID(), startedAt = Date.now(), before = usageOf(goal.usage), checkpointBefore = \`${'${goal.checkpoint}'}\\n${'${goal.nextStep}'}\`;`,
`    const runId = randomUUID(), startedAt = Date.now(), before = usageOf(goal.usage), checkpointBefore = \`${'${goal.checkpoint}'}\\n${'${goal.nextStep}'}\`;
    goal.ledger = normalizeGoalLedger(goal.ledger, goal, startedAt);`,
'run ledger initialization');

replaceOnce('src/goals.cjs',
`      let checked = await this.verify(goal, action => { if (action) verificationActions++; updateUsage(); }); updateUsage();
      if (this.stopReason || goal.status === 'paused' || this.closing) return;`,
`      let checked = await this.verify(goal, action => { if (action) verificationActions++; updateUsage(); }); updateUsage();
      recordVerificationEvidence(goal, checked.results, { runId, phase: 'preflight', now: Date.now() }); this.changed();
      if (this.stopReason || goal.status === 'paused' || this.closing) return;`,
'preflight ledger evidence');

replaceOnce('src/goals.cjs',
`        const summary = 'Verified: the completion conditions already pass. No model call was needed.';
        this.record(goal, 'completed', summary, { runId, status: 'completed', verification: checked.results }); this.changed();`,
`        const summary = 'Verified: the completion conditions already pass. No model call was needed.';
        completeGoalLedger(goal, summary, { runId, now: Date.now() });
        this.record(goal, 'completed', summary, { runId, status: 'completed', verification: checked.results }); this.changed();`,
'preflight completion ledger');

replaceOnce('src/goals.cjs',
`      if (result?.checkpoint) goal.checkpoint = text(result.checkpoint, 'Checkpoint', 4000);
      if (result?.nextStep != null) goal.nextStep = text(result.nextStep, 'Next step', 2000);
      if (result?.clarification) this.saveQuestion(goal, result.clarification, result.checkpoint, result.nextStep);
      const actions = Array.isArray(result?.actions) ? result.actions.slice(0, 30).map(clean) : [];`,
`      if (result?.checkpoint) goal.checkpoint = text(result.checkpoint, 'Checkpoint', 4000);
      if (result?.nextStep != null) goal.nextStep = text(result.nextStep, 'Next step', 2000);
      if (result?.clarification) this.saveQuestion(goal, result.clarification, result.checkpoint, result.nextStep);
      applyGoalLedgerUpdate(goal, result?.ledger, { runId, now: Date.now(), status: result?.status,
        summary: result?.summary, nextStep: goal.nextStep });
      const actions = Array.isArray(result?.actions) ? result.actions.slice(0, 30).map(clean) : [];`,
'executor ledger update');

replaceOnce('src/goals.cjs',
`      if (snapshot) snapshot = await files.finishSnapshot(goal, this.backupRoot, runId);
      this.record(goal, 'run', clean(result?.summary) || 'Goal step ended.', { runId, usage: { ...modelUsage, actions: modelUsage.actions + verificationActions }, actions, snapshot }); this.changed();`,
`      if (snapshot) {
        snapshot = await files.finishSnapshot(goal, this.backupRoot, runId);
        recordSnapshotEvidence(goal, snapshot, { runId, now: Date.now() });
      }
      this.record(goal, 'run', clean(result?.summary) || 'Goal step ended.', { runId, usage: { ...modelUsage, actions: modelUsage.actions + verificationActions }, actions, snapshot }); this.changed();`,
'run snapshot ledger');

replaceOnce('src/goals.cjs',
`      checked = await this.verify(goal, action => { if (action) verificationActions++; updateUsage(); }); updateUsage();
      this.record(goal, 'verification', checked.passed ? 'All completion conditions passed.' : 'Completion conditions have not all passed.', { runId, verification: checked.results });`,
`      checked = await this.verify(goal, action => { if (action) verificationActions++; updateUsage(); }); updateUsage();
      recordVerificationEvidence(goal, checked.results, { runId, phase: 'completion', now: Date.now() });
      this.record(goal, 'verification', checked.passed ? 'All completion conditions passed.' : 'Completion conditions have not all passed.', { runId, verification: checked.results });`,
'completion ledger evidence');

replaceOnce('src/goals.cjs',
`        goal.status = 'completed'; goal.nextStep = ''; const summary = 'Goal completed and verified.';
        this.record(goal, 'completed', summary, { runId, status: 'completed' });`,
`        goal.status = 'completed'; goal.nextStep = ''; const summary = 'Goal completed and verified.';
        completeGoalLedger(goal, summary, { runId, now: Date.now() });
        this.record(goal, 'completed', summary, { runId, status: 'completed' });`,
'normal completion ledger');

replaceOnce('src/goals.cjs',
`      if (snapshot) try { snapshot = await files.finishSnapshot(goal, this.backupRoot, runId); this.record(goal, 'snapshot', 'Saved file evidence after an interrupted or failed step.', { runId, snapshot }); } catch (snapshotError) { this.record(goal, 'snapshot-error', \`Undo is unavailable: ${'${clean(snapshotError)}'}\`, { runId }); }`,
`      if (snapshot) try {
        snapshot = await files.finishSnapshot(goal, this.backupRoot, runId);
        recordSnapshotEvidence(goal, snapshot, { runId, now: Date.now() });
        this.record(goal, 'snapshot', 'Saved file evidence after an interrupted or failed step.', { runId, snapshot });
      } catch (snapshotError) { this.record(goal, 'snapshot-error', \`Undo is unavailable: ${'${clean(snapshotError)}'}\`, { runId }); }`,
'failed snapshot ledger');

replaceOnce('src/goals.cjs',
`        goal.nextStep = external ? 'Review possible external effects before resuming.' : 'Verify existing results before continuing after restart.';
      }`,
`        goal.nextStep = external ? 'Review possible external effects before resuming.' : 'Verify existing results before continuing after restart.';
        recoverGoalLedger(goal, goal.nextStep, { now: Date.now() });
      }`,
'close recovery ledger');

replaceOnce('src/goals.cjs',
`      if (goal.status === 'running') { goal.status = 'paused'; this.record(goal, 'stopped', this.stopReason || 'Goal execution ended before completion.', { runId }); }`,
`      if (goal.status === 'running') {
        goal.status = 'paused';
        recordGoalPause(goal, this.stopReason || 'Goal execution ended before completion.', { source: 'system' });
        this.record(goal, 'stopped', this.stopReason || 'Goal execution ended before completion.', { runId });
      }`,
'unexpected stop ledger');

replaceOnce('src/goal-executor.cjs',
`const { questionInput, questionSpec, clarifications } = require('./user-questions.cjs');`,
`const { questionInput, questionSpec, clarifications } = require('./user-questions.cjs');
const { EXECUTOR_LEDGER_SCHEMA, goalLedgerContext, normalizeExecutorLedgerUpdate } = require('./goal-ledger.cjs');`,
'executor ledger imports');

replaceOnce('src/goal-executor.cjs',
`const schema = { type: 'object', properties: {
  status: { type: 'string', enum: ['continue', 'blocked', 'verify'] },
  summary: { type: 'string' }, checkpoint: { type: 'string' }, nextStep: { type: 'string' },
}, required: ['status', 'summary', 'checkpoint', 'nextStep'], additionalProperties: false };`,
`const schema = { type: 'object', properties: {
  status: { type: 'string', enum: ['continue', 'blocked', 'verify'] },
  summary: { type: 'string' }, checkpoint: { type: 'string' }, nextStep: { type: 'string' },
  ledger: EXECUTOR_LEDGER_SCHEMA,
}, required: ['status', 'summary', 'checkpoint', 'nextStep', 'ledger'], additionalProperties: false };`,
'executor output schema');

replaceOnce('src/goal-executor.cjs',
`Follow only the saved objective, checkpoint, permissions, and budget. The userClarifications field`,
`Follow only the saved objective, checkpoint, permissions, and budget. Work on only the single active step in planLedger; do not start a later step while it remains active. Revise the remaining plan only when evidence invalidates it, and return the complete replacement sequence. The userClarifications field`,
'active step instructions');

replaceOnce('src/goal-executor.cjs',
`Report actual outcomes, next step, and a concise checkpoint that lets a fresh turn resume safely.`,
`Report actual outcomes, next step, and a concise checkpoint that lets a fresh turn resume safely. The ledger output is a concise public audit record of assumptions, observations, and decisions—not private reasoning or chain of thought.`,
'public ledger instructions');

replaceOnce('src/goal-executor.cjs',
`      const prompt = { objective: goal.objective, steps: goal.steps, checkpoint: goal.checkpoint || '', nextStep: goal.nextStep || '', userClarifications: clarifications(goal.clarifications), checks: goal.checks || [],
        workspace: operation.workspace, shellWorkingDirectory: operation.cwd, writableFolders: writableRoots,`,
`      const prompt = { objective: goal.objective, steps: goal.steps, checkpoint: goal.checkpoint || '', nextStep: goal.nextStep || '',
        planLedger: goalLedgerContext(goal.ledger, goal), userClarifications: clarifications(goal.clarifications), checks: goal.checks || [],
        workspace: operation.workspace, shellWorkingDirectory: operation.cwd, writableFolders: writableRoots,`,
'ledger prompt context');

replaceOnce('src/goal-executor.cjs',
`        operation.outcome = { status: 'blocked', summary: operation.clarification.question, clarification: operation.clarification,
          checkpoint: operation.questionCheckpoint, nextStep: operation.questionNextStep, usage: this.usage(operation), actions: [...operation.actions.values()].slice(-30) };`,
`        operation.outcome = { status: 'blocked', summary: operation.clarification.question, clarification: operation.clarification,
          checkpoint: operation.questionCheckpoint, nextStep: operation.questionNextStep,
          ledger: normalizeExecutorLedgerUpdate(null, { status: 'blocked', summary: operation.clarification.question }),
          usage: this.usage(operation), actions: [...operation.actions.values()].slice(-30) };`,
'clarification ledger outcome');

replaceOnce('src/goal-executor.cjs',
`          operation.outcome = { status: 'blocked', summary: clarification.question, clarification,
            checkpoint: goal.checkpoint || '', nextStep: goal.nextStep || '', usage: this.usage(operation), actions: [] };`,
`          operation.outcome = { status: 'blocked', summary: clarification.question, clarification,
            checkpoint: goal.checkpoint || '', nextStep: goal.nextStep || '',
            ledger: normalizeExecutorLedgerUpdate(null, { status: 'blocked', summary: clarification.question }),
            usage: this.usage(operation), actions: [] };`,
'plain question ledger outcome');

replaceOnce('src/goal-executor.cjs',
`      operation.outcome = { status: parsed.status, summary: safe(parsed.summary).slice(0, 2000), checkpoint: safe(parsed.checkpoint).slice(0, 4000), nextStep: safe(parsed.nextStep).slice(0, 2000), usage: this.usage(operation), actions: [...operation.actions.values()].slice(-30) };`,
`      const ledger = normalizeExecutorLedgerUpdate(parsed.ledger, { status: parsed.status, summary: parsed.summary });
      operation.outcome = { status: parsed.status, summary: safe(parsed.summary).slice(0, 2000), checkpoint: safe(parsed.checkpoint).slice(0, 4000), nextStep: safe(parsed.nextStep).slice(0, 2000), ledger, usage: this.usage(operation), actions: [...operation.actions.values()].slice(-30) };`,
'parsed ledger outcome');

fs.writeFileSync('test/goal-ledger-integration.test.cjs', String.raw`'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateGoal, normalizeAutonomy, GoalRunner } = require('../src/goals.cjs');
const { currentPlan, activeStep } = require('../src/goal-ledger.cjs');

function settings(workspace) {
  return { workspace, model: '', connection: 'codex', effort: 'low' };
}

function draft(workspace) {
  return {
    name: 'Build report', objective: 'Create and verify done.txt',
    steps: ['Inspect inputs', 'Create done.txt', 'Verify done.txt'],
    workspace, model: '', connection: 'codex', effort: 'low', priority: 3,
    checks: [{ type: 'fileExists', path: 'done.txt' }],
    permissions: { write: true, writePaths: ['.'], shell: false, network: false, mcpTools: [] },
    limits: { maxTokens: 50000, maxMinutes: 30, maxActions: 50, maxRuns: 10, maxRetries: 2 },
    trigger: { type: 'manual', intervalMinutes: 30, paths: [] }, dependsOn: [],
  };
}

test('goal validation creates and versions a persisted plan ledger', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-ledger-validation-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const created = validateGoal(draft(workspace), null, settings(workspace));
  assert.equal(currentPlan(created.ledger).version, 1);
  assert.equal(activeStep(created.ledger).text, 'Inspect inputs');
  const edited = validateGoal({ ...created, steps: ['Collect evidence', 'Create done.txt', 'Verify done.txt'] }, created, settings(workspace));
  assert.equal(currentPlan(edited.ledger).version, 2);
  assert.equal(currentPlan(edited.ledger).source, 'user');
  assert.equal(activeStep(edited.ledger).text, 'Collect evidence');
});

test('restart normalization records interrupted execution in the durable ledger', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-ledger-recovery-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const created = validateGoal(draft(workspace), null, settings(workspace));
  created.status = 'running'; created.authorized = true;
  const restored = normalizeAutonomy({ paused: false, goals: [created] }, settings(workspace), true).goals[0];
  assert.equal(restored.status, 'queued');
  assert.equal(restored.needsRecoveryCheck, true);
  assert.equal(restored.ledger.observations.at(-1).source, 'system');
  assert.match(restored.ledger.observations.at(-1).text, /Verify existing results/i);
  assert.equal(currentPlan(restored.ledger).steps.filter(step => step.status === 'active').length, 1);
});

test('one goal run advances the active plan and records model, file, and verification evidence', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-ledger-runner-'));
  const backupRoot = path.join(workspace, 'backups');
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const goal = validateGoal(draft(workspace), null, settings(workspace));
  goal.status = 'queued'; goal.authorized = true; goal.nextRunAt = Date.now();
  const store = { data: { settings: settings(workspace), autonomy: { paused: false, goals: [goal] } }, save() {} };
  let runs = 0;
  const runner = new GoalRunner({
    store, backupRoot, canRun: () => true, onChange() {}, onAlert() {},
    verifyCommand: async () => ({ passed: false, detail: 'unused' }),
    run: async () => {
      runs++;
      await fs.writeFile(path.join(workspace, 'done.txt'), 'done');
      return {
        status: 'verify', summary: 'Created done.txt.', checkpoint: 'done.txt exists.', nextStep: '',
        ledger: {
          stepStatus: 'completed', stepSummary: 'Created the verified output.', revisionReason: '', revisedSteps: [],
          assumptions: [{ text: 'The workspace is writable.', status: 'confirmed' }],
          observations: [{ text: 'done.txt was written.' }],
          decisions: [{ text: 'Use a minimal marker file.', rationale: 'The saved check requires only file existence.' }],
        },
        usage: { tokens: 12, actions: 1, elapsedMs: 5 }, actions: ['Wrote done.txt'],
      };
    },
  });
  await runner.tick();
  assert.equal(runs, 1);
  assert.equal(goal.status, 'completed');
  assert.equal(activeStep(goal.ledger), null);
  assert.ok(goal.ledger.observations.some(item => item.source === 'agent' && /done.txt was written/.test(item.text)));
  assert.ok(goal.ledger.observations.some(item => item.source === 'verification' && item.evidence?.passed === true));
  assert.ok(goal.ledger.observations.some(item => item.evidence?.type === 'snapshot'));
  assert.ok(goal.ledger.decisions.some(item => item.source === 'agent' && /minimal marker/.test(item.text)));
  assert.equal(goal.ledger.assumptions.at(-1).status, 'confirmed');
  assert.equal(currentPlan(goal.ledger).steps.filter(step => step.status === 'active').length, 0);
});
`, 'utf8');
