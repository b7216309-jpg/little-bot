'use strict';

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
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-test-backups-'));
  t.after(() => fs.rm(backupRoot, { recursive: true, force: true }));
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
  assert.equal(runs, 1, goal.nextStep);
  assert.equal(goal.status, 'completed');
  assert.equal(activeStep(goal.ledger), null);
  assert.ok(goal.ledger.observations.some(item => item.source === 'agent' && /done.txt was written/.test(item.text)));
  assert.ok(goal.ledger.observations.some(item => item.source === 'verification' && item.evidence?.passed === true));
  assert.ok(goal.ledger.observations.some(item => item.evidence?.type === 'snapshot'));
  assert.ok(goal.ledger.decisions.some(item => item.source === 'agent' && /minimal marker/.test(item.text)));
  assert.equal(goal.ledger.assumptions.at(-1).status, 'confirmed');
  assert.equal(currentPlan(goal.ledger).steps.filter(step => step.status === 'active').length, 0);
});
