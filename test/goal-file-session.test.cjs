'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { GoalRunner } = require('../src/goals.cjs');

test('file-triggered goals baseline each foreground session and emit only later stable changes', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-file-session-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  await fs.writeFile(path.join(workspace, 'report.txt'), 'before');
  const events = [];
  let runs = 0;
  const goal = {
    id: 'goal-1', name: 'Watch report', status: 'queued', authorized: true, priority: 3, createdAt: 1,
    workspace, connection: 'codex', dependsOn: [], pendingQuestion: null,
    trigger: { type: 'files', intervalMinutes: 30, paths: ['report.txt'] },
    triggerFingerprint: 'persisted-before-close',
  };
  const store = { data: { settings: { connection: 'codex' }, autonomy: { paused: false, goals: [goal] } }, save() {} };
  const runner = new GoalRunner({
    store, backupRoot: path.join(workspace, 'backups'), canRun: () => false,
    run: async () => { runs++; return {}; }, onChange() {}, onAlert() {},
    publish: event => { events.push(event); return { accepted: true }; },
  });

  await runner.tick();
  assert.notEqual(goal.triggerFingerprint, 'persisted-before-close');
  assert.equal(events.length, 0);
  assert.equal(runs, 0);

  await fs.writeFile(path.join(workspace, 'report.txt'), 'after with a different size');
  await runner.tick();
  const pending = runner.filePending.get(goal.id);
  assert.ok(pending);
  pending.at = Date.now() - 2000;
  await runner.tick();

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'file.changed');
  assert.equal(events[0].payload.path, 'report.txt');
  assert.deepEqual(events[0].payload.paths, ['report.txt']);
  assert.equal(runs, 0);
});
