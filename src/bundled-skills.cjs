'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseSkill, LIMITS } = require('./extensions.cjs');

const VERSION = 8;
const BUNDLES = [
  { name: 'little-bot', introduced: 1 }, { name: 'meeting-prep', introduced: 1 },
  { name: 'research-brief', introduced: 1 }, { name: 'web-tools', introduced: 2 },
];
const ORIGINAL_HASHES = {
  'little-bot': [
    '415638e8246f5b16a2cc8657572939f0681076023d89d589f715d4bb75e7947e', // starter guide v7 / package 0.8.8
    '9eb37b731594ffb5b5c142762d27ff830976a1e1545fbe0928a58e3102f6edde', // v0.6
    '2505dee9010535a4d865c32fc9a95bd2aef7e2222814125c2da52b069cd7f608', // v0.7
    '871fb7c3cd629f4990116661d73bd21f400ee01d9fe7678d69e8520854f8b49c', // v0.8
    '44ceaaee746a996fab351aa297d10347d445e1b130ed9d888d3263e2e0f8c49e', // v0.8.1
    '650d9146590bea6923d740505afd6d31fb6b7ea671a103dc9675b0383ffd4b96', // v0.8.2–0.8.8
  ],
  'web-tools': ['ddc0f9422378b1ef3ac91d8332b6316fe63bcdbbc8bcf98c3c5e22be61ac789e'],
};
const instructionHash = skill => createHash('sha256').update(JSON.stringify({
  name: skill.name, description: skill.description, content: skill.content,
})).digest('hex');

// Install each bundle once. Upgrade only a byte-identical original guide;
// preserve user edits, disabled state, IDs, and deletions from earlier versions.
async function installBundledSkills(store, root = path.join(__dirname, '..', 'resources', 'skills')) {
  const extensions = store.data.extensions;
  const installedVersion = extensions.starterSkillsVersion || 0;
  if (installedVersion >= VERSION) return;
  const next = [...extensions.skills];
  for (const bundle of BUNDLES) {
    const index = next.findIndex(existing => existing.name === bundle.name);
    const existing = next[index];
    const upgradeGuide = existing?.bundled === true
      && ORIGINAL_HASHES[bundle.name]?.includes(instructionHash(existing));
    if (!upgradeGuide && (existing || installedVersion >= bundle.introduced)) continue;
    const skill = parseSkill(await fs.readFile(path.join(root, bundle.name, 'SKILL.md'), 'utf8'));
    if (skill.name !== bundle.name) throw new Error(`Bundled skill name does not match ${bundle.name}.`);
    if (upgradeGuide) next[index] = { ...existing, description: skill.description, content: skill.content, updatedAt: Date.now() };
    else next.push({ ...skill, bundled: true });
  }
  if (next.length > LIMITS.skills) throw new Error('There is not enough room for the starter skills. Remove an unused skill and reopen Little Bot.');
  const previous = extensions.skills;
  const previousVersion = extensions.starterSkillsVersion;
  try {
    extensions.skills = next;
    extensions.starterSkillsVersion = VERSION;
    store.save();
  } catch (error) {
    extensions.skills = previous;
    if (previousVersion === undefined) delete extensions.starterSkillsVersion;
    else extensions.starterSkillsVersion = previousVersion;
    throw error;
  }
}

module.exports = { installBundledSkills };
