'use strict';

const fs = require('node:fs');

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); }
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }
function replaceOnce(file, before, after, label) {
  const source = read(file);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  write(file, source.replace(before, after));
}

replaceOnce('src/event-runtime.cjs',
  `const { StandingIntentStore } = require('./standing-intents.cjs');`,
  `const { StandingIntentStore } = require('./standing-intents.cjs');\nconst { advanceMissedSchedules, missedCount } = require('./missed-schedules.cjs');`,
  'missed schedule import');
replaceOnce('src/event-runtime.cjs',
  `  start() {\n    if (this.bus.state.started) return false;\n    this.unsubscribers = [`,
  `  start() {\n    if (this.bus.state.started) return false;\n    const skipped = advanceMissedSchedules(this.store.data, this.now());\n    if (missedCount(skipped)) {\n      this.store.save();\n      this._changed(true);\n    }\n    this.unsubscribers = [`,
  'missed schedule startup');

replaceOnce('src/renderer/index.html',
  `  <link rel="stylesheet" href="./styles.css">`,
  `  <link rel="stylesheet" href="./styles.css">\n  <link rel="stylesheet" href="./standing-intents.css">`,
  'standing intents stylesheet');
replaceOnce('src/renderer/index.html',
  `  <script src="./independent-check.js" defer></script>\n  <script src="./app.js" defer></script>`,
  `  <script src="./independent-check.js" defer></script>\n  <script src="./standing-intents-ui.js" defer></script>\n  <script src="./app.js" defer></script>\n  <script src="./standing-intents-panel.js" defer></script>`,
  'standing intents scripts');

const runtimeTestFile = 'test/event-runtime.test.cjs';
const runtimeTest = read(runtimeTestFile);
const runtimeAddition = `\n\ntest('startup advances overdue schedules instead of replaying closed-app work', async () => {\n  const { runtime, bus, store, goalsData, calls, now } = fixture();\n  store.data.automations[0] = { id: 'automation-1', name: 'Missed routine', enabled: true, authorized: true,\n    scheduleType: 'interval', intervalMinutes: 60, nextRunAt: now() - 1, lastStatus: 'never' };\n  store.data.heartbeat = { enabled: true, checklist: 'Check notes', intervalMinutes: 30, nextRunAt: now() - 1 };\n  Object.assign(goalsData[0], { status: 'queued', trigger: { type: 'interval', intervalMinutes: 45 }, nextRunAt: now() - 1 });\n  runtime.start();\n  await drain(bus);\n  assert.deepEqual(calls, []);\n  assert.ok(store.data.automations[0].nextRunAt > now());\n  assert.ok(store.data.heartbeat.nextRunAt > now());\n  assert.ok(goalsData[0].nextRunAt > now());\n});\n`;
if (!runtimeTest.includes("test('startup advances overdue schedules")) write(runtimeTestFile, runtimeTest.trimEnd() + runtimeAddition);

const panelTestFile = 'test/standing-intents-panel.test.cjs';
const panelTest = read(panelTestFile);
const panelAddition = `\n\ntest('the app loads the standing-intent helper, panel, and stylesheet in dependency order', () => {\n  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');\n  assert.match(html, /standing-intents\\.css/);\n  assert.match(html, /standing-intents-ui\\.js/);\n  assert.match(html, /standing-intents-panel\\.js/);\n  assert.ok(html.indexOf('standing-intents-ui.js') < html.indexOf('standing-intents-panel.js'));\n});\n`;
if (!panelTest.includes("test('the app loads the standing-intent helper")) write(panelTestFile, panelTest.trimEnd() + panelAddition);
