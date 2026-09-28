'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('standing-intent panel stays modular and uses only exposed IPC methods', () => {
  const panel = fs.readFileSync(path.join(root, 'src', 'renderer', 'standing-intents-panel.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');
  for (const method of ['saveStandingIntent', 'deleteStandingIntent', 'toggleStandingIntent']) {
    assert.match(panel, new RegExp(`window\\.bot\\.${method}`));
    assert.match(preload, new RegExp(`${method}: invoke\\('${method}'\\)`));
  }
  assert.match(panel, /automations-view/);
  assert.match(panel, /Foreground only/);
  assert.doesNotMatch(panel, /fetch\(|WebSocket|http:\/\/|https:\/\//);
});
