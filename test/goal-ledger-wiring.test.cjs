'use strict';

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
