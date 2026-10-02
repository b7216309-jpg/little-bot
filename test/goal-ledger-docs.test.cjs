'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const previousGuideHash = '415638e8246f5b16a2cc8657572939f0681076023d89d589f715d4bb75e7947e';

test('Phase 3 documentation links the implemented ledger consistently', () => {
  const readme = read('README.md');
  const goals = read('GOALS.md');
  const ledger = read('LEDGER.md');
  const next = read('NEXT.md');
  assert.match(readme, /\[LEDGER\.md\]\(LEDGER\.md\)/);
  assert.match(goals, /## Plan and evidence ledger/);
  assert.match(goals, /exactly one active step/i);
  assert.match(ledger, /A goal that is not complete has exactly one active plan step/);
  assert.match(ledger, /chain-of-thought transcript/i);
  assert.match(next, /Implemented foundations:[\s\S]*Goal plan and evidence ledger/);
  assert.doesNotMatch(next, /^\d+\. \*\*Plan and evidence ledger/m);
  assert.match(next, /^1\. \*\*Windows UI Automation/m);
});

test('the bundled operating guide migrates only the original previous guide', () => {
  const bundled = read('src/bundled-skills.cjs');
  const skill = read('resources/skills/little-bot/SKILL.md');
  assert.match(bundled, /const VERSION = 20;/);
  assert.ok(bundled.includes(previousGuideHash));
  assert.match(skill, /plan\/evidence ledger/i);
  assert.match(skill, /one active plan step/);
  assert.match(skill, /not hidden reasoning or chain of thought/i);
  assert.match(skill, /\[LEDGER\.md\]\(\.\.\/\.\.\/\.\.\/LEDGER\.md\)/);
});

test('package and validation records advance to 0.17.2', () => {
  const packageJson = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const validation = read('VALIDATION.md');
  assert.equal(packageJson.version, '0.17.2');
  assert.equal(lock.version, '0.17.2');
  assert.equal(lock.packages[''].version, '0.17.2');
  assert.match(validation, /^# Version 0.17.2 verification/);
  assert.match(validation, /deterministic fake model/);
  assert.match(validation, /No private reasoning or chain-of-thought transcript/);
});

test('the shipped operating guide parses within the actual importer limits', () => {
 const {parseSkill}=require('../src/extensions.cjs');
 const skill=parseSkill(read('resources/skills/little-bot/SKILL.md'));
 assert.equal(skill.name,'little-bot');
 assert.match(skill.content,/heartbeat_manage/);
 assert.match(skill.content,/memory_manage/);
});
