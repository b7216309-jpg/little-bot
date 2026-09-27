'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('agent activity panel is wired into the current chat UI', () => {
  const root = path.join(__dirname, '..');
  const html = readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const app = readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const css = readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');

  for (const id of [
    'agent-inspector-toggle', 'agent-inspector', 'agent-inspector-close',
    'inspector-status', 'inspector-mode', 'inspector-elapsed', 'inspector-model',
    'inspector-context', 'inspector-current', 'inspector-actions', 'inspector-files',
  ]) assert.match(html, new RegExp(`id="${id}"`));

  assert.match(app, /function renderAgentInspector\(\)/);
  assert.match(app, /function inspectorFilePaths\(chat\)/);
  assert.match(app, /function inspectorActionLabel\(message\)/);
  assert.match(app, /taskRun\?\.startedAt/);
  assert.match(app, /context\.usedTokens/);
  assert.match(app, /message\.kind === 'plan'/);
  assert.match(app, /message\.kind !== 'file'/);
  assert.match(css, /\.agent-inspector\{/);
  assert.match(css, /\.inspector-list-item/);
});

test('side panel reuses existing state instead of adding a new backend protocol', () => {
  const root = path.join(__dirname, '..');
  const preload = readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');
  const main = readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
  assert.doesNotMatch(preload, /agentInspector/i);
  assert.doesNotMatch(main, /agentInspector/i);
});
