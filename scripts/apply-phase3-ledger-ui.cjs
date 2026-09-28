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

replaceOnce('src/renderer/index.html',
`  <link rel="stylesheet" href="./styles.css">
  <link rel="stylesheet" href="./standing-intents.css">`,
`  <link rel="stylesheet" href="./styles.css">
  <link rel="stylesheet" href="./goal-ledger.css">
  <link rel="stylesheet" href="./standing-intents.css">`,
'goal ledger stylesheet');

replaceOnce('src/renderer/index.html',
`  <script src="./standing-intents-ui.js" defer></script>
  <script src="./app.js" defer></script>`,
`  <script src="./standing-intents-ui.js" defer></script>
  <script src="./goal-ledger-ui.js" defer></script>
  <script src="./goal-ledger-panel.js" defer></script>
  <script src="./app.js" defer></script>`,
'goal ledger scripts');

replaceOnce('src/renderer/app.js',
`    if (goal.steps?.length) {
      const section = element('section', 'goal-detail-section');
      const list = element('ol');
      goal.steps.forEach((step) => list.append(element('li', '', goalText(step))));
      section.append(element('h3', '', 'Suggested steps'), list);
      details.append(section);
    }`,
`    if (!window.LittleBotGoalLedgerPanel?.append(details, goal) && goal.steps?.length) {
      const section = element('section', 'goal-detail-section');
      const list = element('ol');
      goal.steps.forEach((step) => list.append(element('li', '', goalText(step))));
      section.append(element('h3', '', 'Suggested steps'), list);
      details.append(section);
    }`,
'goal ledger panel wiring');

replaceOnce('package.json',
`    "test:electron": "electron test/agent-side-panel-electron.cjs && electron test/calendar-electron.cjs && electron test/chat-scroll-electron.cjs && electron test/slash-commands-electron.cjs && electron test/standing-intents-electron.cjs",`,
`    "test:electron": "electron test/agent-side-panel-electron.cjs && electron test/calendar-electron.cjs && electron test/chat-scroll-electron.cjs && electron test/goal-ledger-electron.cjs && electron test/slash-commands-electron.cjs && electron test/standing-intents-electron.cjs",`,
'goal ledger Electron suite');

fs.writeFileSync('test/goal-ledger-wiring.test.cjs', String.raw`'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('the real renderer loads and mounts the goal ledger before app startup', () => {
  const html = read('src/renderer/index.html');
  const app = read('src/renderer/app.js');
  const cssIndex = html.indexOf('./goal-ledger.css');
  const modelIndex = html.indexOf('./goal-ledger-ui.js');
  const panelIndex = html.indexOf('./goal-ledger-panel.js');
  const appIndex = html.indexOf('./app.js');
  assert.ok(cssIndex > 0);
  assert.ok(modelIndex > 0 && panelIndex > modelIndex && appIndex > panelIndex);
  assert.match(app, /LittleBotGoalLedgerPanel\?\.append\(details, goal\)/);
});

test('the retained Electron suite includes the goal ledger fixture', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.match(packageJson.scripts['test:electron'], /goal-ledger-electron\.cjs/);
});
`, 'utf8');
