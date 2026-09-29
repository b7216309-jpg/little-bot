'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('public documentation describes foreground-only event semantics consistently', () => {
  const readme = read('README.md');
  const goals = read('GOALS.md');
  const events = read('EVENTS.md');
  const skill = read('resources/skills/little-bot/SKILL.md');
  const next = read('NEXT.md');
  for (const value of [readme, goals, skill, next]) assert.match(value, /EVENTS\.md/);
  assert.match(events, /no event collection/i);
  assert.match(events, /not a gateway/i);
  assert.match(events, /no replay of a closed-app backlog/i);
  assert.doesNotMatch(readme, /runs once when available/i);
  assert.doesNotMatch(skill, /closed, busy, or the PC is asleep/i);
  assert.match(goals, /fresh baseline/i);
  assert.match(next, /Implemented foundations/);
});

test('bundled operating guide migration advances for the standing-intent documentation', () => {
  const bundled = read('src/bundled-skills.cjs');
  assert.match(bundled, /const VERSION = 13;/);
  assert.match(bundled, /v0\.8\.2–0\.8\.8/);
});
