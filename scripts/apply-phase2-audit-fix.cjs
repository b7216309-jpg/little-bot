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
  `    const action = event.payload?.action || intent.action;`,
  `    // Resolve the current saved action at execution time. A debounced event may\n    // outlive an edit; stale queued payload must not launch the old target.\n    const action = intent.action;`,
  'current standing-intent action',
);

const testFile = 'test/event-runtime.test.cjs';
const testSource = read(testFile);
const testAddition = `\n\ntest('a debounced action resolves the current target after the intent is edited', async () => {\n  const { runtime, bus, store, calls, advance } = fixture();\n  store.data.automations.push({ id: 'automation-2', authorized: true, lastStatus: 'never' });\n  const intent = runtime.saveIntent({\n    name: 'Editable target', enabled: true, debounceMs: 1000,\n    when: { type: 'file.changed', filters: [] },\n    action: { type: 'goal.run', goalId: 'goal-1' },\n  });\n  runtime.start();\n  runtime.publish({ type: 'file.changed', source: 'goal.runner', payload: { path: 'reports/latest.csv' } });\n  await bus.drain();\n  assert.equal(bus.state.queued, 1);\n\n  runtime.saveIntent({ ...intent, action: { type: 'automation.run', automationId: 'automation-2' } });\n  advance(1000);\n  await drain(bus);\n\n  assert.deepEqual(calls, [['automation', 'automation-2']]);\n});\n`;
if (!testSource.includes("test('a debounced action resolves the current target after the intent is edited'")) {
  fs.writeFileSync(testFile, testSource.trimEnd() + testAddition, 'utf8');
}

replaceOnce(
  'EVENTS.md',
  `When the single execution lane is temporarily busy, an intent action can retry every 15 seconds, at most 20 times, while the same foreground app session remains open. Closing Little Bot discards those retries.`,
  `When the single execution lane is temporarily busy, an intent action can retry every 15 seconds, at most 20 times, while the same foreground app session remains open. Closing Little Bot discards those retries. A debounced or waiting action resolves the intent's current saved target when it executes, so editing or disabling the intent does not launch a stale target.`,
  'standing-intent action documentation',
);
