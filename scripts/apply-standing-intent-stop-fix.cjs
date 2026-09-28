'use strict';

const fs = require('node:fs');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function replaceOnce(file, before, after, label) {
  const source = read(file);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}

replaceOnce(
  'src/event-runtime.cjs',
  `        filter: event => ['goal.completed', 'goal.blocked'].includes(event.type), handler: event => this._settleGoal(event) }),`,
  `        filter: event => ['goal.completed', 'goal.blocked', 'goal.paused', 'goal.removed'].includes(event.type), handler: event => this._settleGoal(event) }),`,
  'goal settlement subscription',
);

replaceOnce(
  'src/event-runtime.cjs',
  `    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();\n    this.pendingGoals.clear();`,
  `    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();\n    this._cancelQueuedGoalActions();\n    this.pendingGoals.clear();`,
  'foreground stop cancellation',
);

replaceOnce(
  'src/event-runtime.cjs',
  `        this._pending(this.pendingGoals, goal.id).set(id, event.intentTrace || [id]);\n        this.intents.record(id, { status: 'queued', event });`,
  `        this._pending(this.pendingGoals, goal.id).set(id, {\n          trace: event.intentTrace || [id],\n          previous: {\n            status: goal.status, nextRunAt: goal.nextRunAt ?? null,\n            pauseReason: goal.pauseReason || null, needsEffectReview: goal.needsEffectReview === true,\n          },\n        });\n        this.intents.record(id, { status: 'queued', event });`,
  'goal launch checkpoint',
);

replaceOnce(
  'src/event-runtime.cjs',
  `  _settleGoal(event) {\n    const goalId = event.payload?.goalId;\n    if (typeof goalId !== 'string') return;\n    const pending = this.pendingGoals.get(goalId);\n    if (!pending) return;\n    for (const [intentId] of pending) this.intents.record(intentId, {\n      status: event.type === 'goal.completed' ? 'completed' : 'error', event,\n      error: event.type === 'goal.blocked' ? String(event.payload?.reason || 'The target goal was blocked.') : '',\n    });\n    this.pendingGoals.delete(goalId);\n  }`,
  `  _cancelQueuedGoalActions() {\n    let restored = false;\n    for (const [goalId, pending] of this.pendingGoals) {\n      let goal;\n      try { goal = this.goals.goal(goalId); } catch { continue; }\n      if (this.goals.activeId === goalId || goal.status !== 'queued') continue;\n      const launch = [...pending.values()].find(value => object(value) && object(value.previous));\n      if (!launch) continue;\n      const previous = launch.previous;\n      goal.status = previous.status;\n      goal.nextRunAt = previous.nextRunAt;\n      if (previous.pauseReason) goal.pauseReason = previous.pauseReason; else delete goal.pauseReason;\n      if (previous.needsEffectReview) goal.needsEffectReview = true; else delete goal.needsEffectReview;\n      this.goals.forceRuns?.delete(goalId);\n      this.goals.record?.(goal, 'skipped', 'Standing-intent launch was skipped because foreground event processing stopped before the goal started.');\n      for (const intentId of pending.keys()) {\n        try { this.intents.record(intentId, { status: 'skipped', error: 'Foreground event processing stopped before the target goal started. The launch was not replayed.' }); }\n        catch (error) { this._error(error); }\n      }\n      restored = true;\n    }\n    if (restored) {\n      try { this.store.save(); } catch (error) { this._error(error); }\n      this._changed(true);\n    }\n  }\n\n  _settleGoal(event) {\n    const goalId = event.payload?.goalId;\n    if (typeof goalId !== 'string') return;\n    const pending = this.pendingGoals.get(goalId);\n    if (!pending) return;\n    const skipped = ['goal.paused', 'goal.removed'].includes(event.type);\n    for (const [intentId] of pending) this.intents.record(intentId, {\n      status: event.type === 'goal.completed' ? 'completed' : skipped ? 'skipped' : 'error', event,\n      error: event.type === 'goal.blocked'\n        ? String(event.payload?.reason || 'The target goal was blocked.')\n        : event.type === 'goal.paused'\n          ? String(event.payload?.reason || 'The target goal was paused.')\n          : event.type === 'goal.removed' ? 'The target goal was removed.' : '',\n    });\n    this.pendingGoals.delete(goalId);\n  }`,
  'goal cancellation and settlement',
);

replaceOnce(
  'src/event-runtime.cjs',
  `      for (const value of map.get(key)?.values() || []) add(value);`,
  `      for (const value of map.get(key)?.values() || []) add(Array.isArray(value) ? value : value?.trace);`,
  'pending intent trace metadata',
);

replaceOnce(
  'src/goals.cjs',
  `    this.record(goal, 'paused', 'Paused by you.'); this.changed();\n    if (id === this.activeId) {`,
  `    this.record(goal, 'paused', 'Paused by you.'); this.changed();\n    this.emit('goal.paused', goal, { reason: 'Paused by you.', pausedAt: Date.now() });\n    if (id === this.activeId) {`,
  'individual goal pause event',
);

replaceOnce(
  'src/goals.cjs',
  `    if (this.activeId) { const goal = this.goal(this.activeId); goal.status = 'paused'; goal.pauseReason = 'all'; this.record(goal, 'paused', 'Paused with all goals.'); }\n    this.changed();`,
  `    if (this.activeId) { const goal = this.goal(this.activeId); goal.status = 'paused'; goal.pauseReason = 'all'; this.record(goal, 'paused', 'Paused with all goals.'); }\n    this.changed();\n    if (this.activeId) this.emit('goal.paused', this.goal(this.activeId), { reason: 'All goals are paused.', pausedAt: Date.now() });`,
  'global goal pause event',
);

replaceOnce(
  'src/goals.cjs',
  `    this.data.goals = this.data.goals.filter(item => item.id !== id); this.forceRuns.delete(id); this.filePending.delete(id); this.fileSessionBaselines.delete(id); this.changed(); return { ok: true };`,
  `    this.data.goals = this.data.goals.filter(item => item.id !== id); this.forceRuns.delete(id); this.filePending.delete(id); this.fileSessionBaselines.delete(id); this.changed();\n    this.emit('goal.removed', goal, { removedAt: Date.now() });\n    return { ok: true };`,
  'goal removal event',
);

const runtimeTestFile = 'test/event-runtime.test.cjs';
const runtimeTests = read(runtimeTestFile);
const runtimeAddition = `\n\ntest('stopping foreground events restores a goal queued by an intent before it started', async () => {\n  const { runtime, bus, store, goalsData } = fixture();\n  const intent = runtime.saveIntent({\n    name: 'Foreground-only goal', enabled: true,\n    when: { type: 'file.changed', filters: [] },\n    action: { type: 'goal.run', goalId: 'goal-1' },\n  });\n  runtime.start();\n  runtime.publish({ type: 'file.changed', source: 'goal.runner', payload: { path: 'report.csv' } });\n  await drain(bus);\n  assert.equal(goalsData[0].status, 'queued');\n  assert.equal(store.data.standingIntents.intents.find(item => item.id === intent.id).lastStatus, 'queued');\n\n  runtime.stop();\n\n  assert.equal(goalsData[0].status, 'paused');\n  const saved = store.data.standingIntents.intents.find(item => item.id === intent.id);\n  assert.equal(saved.lastStatus, 'skipped');\n  assert.match(saved.lastError, /not replayed/);\n});\n\ntest('pausing a standing-intent goal settles the intent as skipped', async () => {\n  const { runtime, bus, store } = fixture();\n  const intent = runtime.saveIntent({\n    name: 'Pause-aware goal', enabled: true,\n    when: { type: 'file.changed', filters: [] },\n    action: { type: 'goal.run', goalId: 'goal-1' },\n  });\n  runtime.start();\n  runtime.publish({ type: 'file.changed', source: 'goal.runner', payload: { path: 'report.csv' } });\n  await drain(bus);\n  runtime.publish({ type: 'goal.paused', source: 'goal.runner', payload: { goalId: 'goal-1', reason: 'Paused by you.' } });\n  await drain(bus);\n\n  const saved = store.data.standingIntents.intents.find(item => item.id === intent.id);\n  assert.equal(saved.lastStatus, 'skipped');\n  assert.match(saved.lastError, /Paused by you/);\n});\n`;
if (!runtimeTests.includes("test('stopping foreground events restores a goal queued by an intent before it started'")) {
  fs.writeFileSync(runtimeTestFile, runtimeTests.trimEnd() + runtimeAddition, 'utf8');
}

const goalTestFile = 'test/goal-events.test.cjs';
if (!fs.existsSync(goalTestFile)) {
  fs.writeFileSync(goalTestFile, `'use strict';\n\nconst test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { GoalRunner } = require('../src/goals.cjs');\n\ntest('pausing a goal publishes its foreground lifecycle event', async () => {\n  const events = [];\n  const goal = { id: 'goal-1', name: 'Demo', workspace: 'C:\\\\Work', status: 'queued', history: [], dependsOn: [] };\n  const store = { data: { autonomy: { paused: false, goals: [goal] }, settings: {} }, save() {} };\n  const runner = new GoalRunner({ store, backupRoot: 'C:\\\\Backups', publish: event => { events.push(event); return { accepted: true }; } });\n\n  await runner.pause(goal.id);\n\n  assert.equal(events.length, 1);\n  assert.equal(events[0].type, 'goal.paused');\n  assert.equal(events[0].payload.goalId, goal.id);\n  assert.equal(events[0].payload.reason, 'Paused by you.');\n});\n`, 'utf8');
}

replaceOnce(
  'EVENTS.md',
  `Closing the application clears queued events. They are not saved for replay.`,
  `Closing the application clears queued events. They are not saved for replay. If a standing intent queued a goal but that goal never entered execution, Little Bot restores the goal's earlier state and records the intent as skipped.`,
  'foreground goal replay documentation',
);

replaceOnce(
  'EVENTS.md',
  `matched\n→ queued\n→ completed | error | skipped`,
  `matched\n→ queued\n→ completed | error | skipped`,
  'action lifecycle anchor',
);
