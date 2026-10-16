'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '../resources/profile/presets');
let manifest = null;
const presets = () => (manifest ||= JSON.parse(fs.readFileSync(path.join(DIR, 'presets.json'), 'utf8')));

function listPresets() { return presets().map(({ id, name, tagline }) => ({ id, name, tagline })); }
function loadPreset(id) {
  const preset = presets().find(item => item.id === id);
  if (!preset) throw new Error('That personality is not available.');
  return { ...preset, soul: fs.readFileSync(path.join(DIR, `${preset.id}.md`), 'utf8').replace(/\r\n/g, '\n') };
}
// A personality replaces only the opening identity paragraph; the app's working rules that follow stay as they are.
function presetPrompt(intro, defaultPrompt) {
  const rules = defaultPrompt.indexOf('\n\n');
  return `${intro} Use tools when useful and do not inspect files for ordinary conversation; give brief progress updates on longer tasks.${rules < 0 ? '' : defaultPrompt.slice(rules)}`;
}

module.exports = { listPresets, loadPreset, presetPrompt };
