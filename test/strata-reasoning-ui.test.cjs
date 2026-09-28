'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');

test('Strata gets None/Low/Medium/High while other local models keep the old toggle', () => {
  assert.match(html, /id="effort-none" value="none" hidden>None<\/option>/);
  assert.match(app, /const isStrataLocal = \(\) => connectionType\(\) === 'local' && state\?\.connection\?\.adapter === 'strata'/);
  assert.match(app, /'effort-select'\)\.classList\.toggle\('hidden', local && !strata\)/);
  assert.match(app, /'thinking-toggle'\)\.classList\.toggle\('hidden', !local \|\| strata\)/);
  assert.match(app, /none\.hidden = !strata/);
  assert.match(app, /if \(strata\) \$\('effort-select'\)\.value = enabled \? \(state\.settings\.effort \|\| 'low'\) : 'none'/);
});

test('Strata reasoning selector maps None to thinking off and levels to saved effort', () => {
  assert.match(app, /const localThinking = value !== 'none'/);
  assert.match(app, /\.\.\.\(localThinking \? \{ effort: value \} : \{\}\)/);
  assert.match(app, /connectionType\(\) !== 'local' \|\| isStrataLocal\(\) \|\| thinkingChangeBlocked\(\)/);
  assert.match(app, /Reasoning none/);
  assert.match(app, /Reasoning \$\{effort \|\| 'low'\}/);
});
