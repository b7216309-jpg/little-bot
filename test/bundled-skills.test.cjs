'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installBundledSkills } = require('../src/bundled-skills.cjs');
const { skillContext } = require('../src/skill-context.cjs');

const ORIGINAL = ['little-bot', 'meeting-prep', 'research-brief', 'web-tools', 'pc-care', 'documents', 'data-analysis', 'file-organizer', 'voice', 'game-master', 'journal', 'morning-brief'];
const store = extensions => ({ data: { extensions: { servers: [], plugins: [], skills: [], ...extensions } }, saves: 0, save() { this.saves++; } });

test('a fresh install gets every bundled skill, the newer ones disabled', async () => {
  // Every SKILL.md must parse within the limits, or the whole install stops at startup.
  const fresh = store();
  await installBundledSkills(fresh);
  const skills = fresh.data.extensions.skills;
  assert.equal(skills.length, 34);
  assert.ok(skills.every(skill => skill.bundled && skill.content.length <= 100000));
  assert.deepEqual(skills.filter(skill => skill.enabled).map(skill => skill.name).sort(), [...ORIGINAL].sort());
  for (const name of ['phishing-check', 'home-network-check', 'generative-art', 'story-studio', 'debug-detective', 'flashcards']) {
    assert.equal(skills.find(skill => skill.name === name)?.enabled, false, name);
  }
  assert.throws(() => skillContext(fresh.data.extensions, 'is this legit? $phishing-check'), /Enable the phishing-check skill/);
});

test('an upgrade adds the new skills once, disabled, and leaves existing ones and later deletions alone', async () => {
  const mine = { id: 'x', name: 'journal', description: 'My own journal rules', content: 'Edited by me', enabled: false, bundled: true, createdAt: 1, updatedAt: 1 };
  const upgrading = store({ starterSkillsVersion: 25, skills: [mine] });
  await installBundledSkills(upgrading);
  const skills = upgrading.data.extensions.skills;
  assert.equal(skills.find(skill => skill.name === 'journal'), mine, 'an edited, disabled skill is untouched');
  assert.equal(skills.filter(skill => skill.name === 'trip-planner').length, 1);
  assert.ok(skills.filter(skill => skill.name !== 'journal').every(skill => skill.enabled === false));
  assert.equal(upgrading.data.extensions.starterSkillsVersion, 27);

  // Deleting one afterwards is respected on the next launch.
  upgrading.data.extensions.skills = skills.filter(skill => skill.name !== 'trip-planner');
  await installBundledSkills(upgrading);
  assert.equal(upgrading.data.extensions.skills.some(skill => skill.name === 'trip-planner'), false);
});

test('one unreadable starter skill or a full skill list skips only what cannot be installed', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-skills-'));
  try {
    fs.cpSync(path.join(__dirname, '..', 'resources', 'skills'), root, { recursive: true });
    fs.writeFileSync(path.join(root, 'flashcards', 'SKILL.md'), `---\nname: flashcards\ndescription: Too long\n---\n${'x'.repeat(100001)}`);
    const fresh = store();
    const { skipped } = await installBundledSkills(fresh, root);
    assert.deepEqual(skipped.map(item => item.name), ['flashcards']);
    assert.equal(fresh.data.extensions.skills.length, 33, 'every other skill still arrives');

    const crowded = store({ skills: Array.from({ length: 99 }, (_, index) => ({ id: `s${index}`, name: `mine-${index}`, description: 'x', content: 'x', enabled: true })) });
    const full = await installBundledSkills(crowded);
    assert.equal(crowded.data.extensions.skills.length, 100);
    assert.equal(full.skipped.length, 33);
    assert.match(full.skipped[0].reason, /full/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
