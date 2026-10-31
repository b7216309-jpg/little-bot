'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseSkill, LIMITS } = require('./extensions.cjs');

const VERSION = 27;
// Skills from 26 on arrive disabled: they wait in Extensions until the user turns one on, and
// a disabled skill is not named in requests, so they cost nothing until then.
const OPTIONAL_SKILLS = [
  'debug-detective', 'code-review', 'plan-first', 'webapp-check', 'email-drafter', 'meeting-notes', 'writing-coach',
  'trip-planner', 'meal-planner', 'deal-hunter', 'budget-tracker', 'language-tutor', 'flashcards',
  'generative-art', 'story-studio', 'songwriter', 'svg-illustrator', 'naming-studio',
  'pc-security-checkup', 'home-network-check', 'phishing-check', 'home-safety-plan',
];
const BUNDLES = [
  { name: 'little-bot', introduced: 1 }, { name: 'meeting-prep', introduced: 1 },
  { name: 'research-brief', introduced: 1 }, { name: 'web-tools', introduced: 2 },
  ...['pc-care', 'documents', 'data-analysis', 'file-organizer', 'voice', 'game-master', 'journal', 'morning-brief'].map(name => ({ name, introduced: 21 })),
  ...OPTIONAL_SKILLS.map(name => ({ name, introduced: 26, enabled: false })),
];
const ORIGINAL_HASHES = {
  'little-bot': [
    '34c1e581669115bd383e5a19c1ac8a0e791bc9588ed37558cbda1ad111e61e7a', // 0.40.0 guide, trimmed under the 20,000-character limit
    // The 0.35–0.39 guide was 81 characters over the limit, so it never installed and needs no entry.
    '672f705dc596f7b1605c01da595fd6378b9b91569074cf22673e62ba029ed942', // 0.33–0.34 guide (Brave/Firecrawl web tools)
    '578812660fcb35a8fa1c4874f74fe192471b1bc1d4bea2f057f369a59732f839', // 0.32.0 local-only guide
    '6a819e2ffc463d961094056097ad4e85a226b9368b3b8c329acd84b74fdcd046', // 0.11–0.31 guide (README refresh)
    '119d553e9c4d52fba2a3b3aafb912fbe94f178a6c36515ea209f28eea21236d1', // ongoing-goal catch-up guide
    '5fd21656949aef5ab6b67cf521cc5f62934511d5d01ad7c8a71cdee483dbe949', // 0.10.1 guide
    '5d419696b2515c1ea16a85c296cd3a803b25ce8b87b7bd23d8c64c9104cbae1c', // 0.10.0 goal contract guide
    '9416b284a31d501a3cc237e789a426366e3ceb5cc17e635430ac7b5de1fd2c3c', // final 0.9.2 shipped operating guide
    'dfeab748c01278be68d9b794b0271b6d5c541ebb75366f32065d093359b6dd8e', // prior installed operating guide
    'c8ebd19c60f5598ff3f8530b73eed9a4488e78c2cb1be9f367e3615590efb4ff', // prior installed operating guide
    '112dc7402b0f435113a79ff4b45898a120fd9ca704999a77e3d120c2af2d723e', // previous app guide, before goal contracts
    '93630f6271a517d8859617f5966cce8760ef82c15e2fb3184390a18c24791c1d', // goal completion tool guide
    'ee2ea52caa25991d6413a21731e8c3c0fdd0faace2c6bf84f5e85343a47fd177', // interim goal writer guide
    'b94c97e9aa9e99faa090788d6903437d0f912c651f15486c7bcaf1ec643d5683', // interim goal usage guide
    'cafd0511925fbdf3e2d646eaddd2e65c0cd9f4733fe5c17bbdff295fd6afb643', // v0.9.2 CPU memory guide
    'cd648d7e9ffe8aecc59e885996e5e46513c8b1b3c68902926a4c540b98cd3d89', // interim 0.9.1 MiniLM guide
    '49b7160f1d5e5b4f97dd234a62fafea23eadb32c66df6cf83b4ec2dfa7925f6f', // v0.9.0 continuous memory guide
    '3c5398aebe83acc9388b4482888fe2387442986bbb456eb1d725eec775cf9cd5', // v0.8.9 with activity inbox and scheduling
    '3575e11bc0e88d824144e85dbc52483160dc852532becd06d401879023bb04d6', // initial continuous-memory guide
    '613a2f87c45bf3d931a9718c1f055f175d28d97dd9c4d793e20835c872cc1817', // v0.8.9
    '415638e8246f5b16a2cc8657572939f0681076023d89d589f715d4bb75e7947e', // starter guide v7 / package 0.8.8
    '9eb37b731594ffb5b5c142762d27ff830976a1e1545fbe0928a58e3102f6edde', // v0.6
    '2505dee9010535a4d865c32fc9a95bd2aef7e2222814125c2da52b069cd7f608', // v0.7
    '871fb7c3cd629f4990116661d73bd21f400ee01d9fe7678d69e8520854f8b49c', // v0.8
    '44ceaaee746a996fab351aa297d10347d445e1b130ed9d888d3263e2e0f8c49e', // v0.8.1
    '650d9146590bea6923d740505afd6d31fb6b7ea671a103dc9675b0383ffd4b96', // v0.8.2–0.8.8
  ],
  'web-tools': [
    '78bb25a5228c702bc74d168024ffc4f2eefeebc921354cff39b0897bdd728b3d', // 0.35.1–0.54 guide
    '63cb092d0ae58de008f692dbf52cec92318fe0dc9dc02605df4660c99a3d53ff', // 0.35.0 guide (built-in web tools)
    '266e0d314cd8d31a58feabb3a2c1c5bfc57f819ddff15051ccbb44a6da2da9a4', // 0.8.9–0.34 guide (Brave/Firecrawl web tools)
    'ddc0f9422378b1ef3ac91d8332b6316fe63bcdbbc8bcf98c3c5e22be61ac789e',
  ],
};
const instructionHash = skill => createHash('sha256').update(JSON.stringify({
  name: skill.name, description: skill.description, content: skill.content,
})).digest('hex');

// Install each bundle once. Upgrade only a byte-identical original guide;
// preserve user edits, disabled state, IDs, and deletions from earlier versions.
// One unreadable skill, or a full skill list, skips only what cannot be installed: the others still arrive,
// and the result names what was skipped so the app can say so.
async function installBundledSkills(store, root = path.join(__dirname, '..', 'resources', 'skills')) {
  const extensions = store.data.extensions;
  const installedVersion = extensions.starterSkillsVersion || 0;
  if (installedVersion >= VERSION) return { skipped: [] };
  const next = [...extensions.skills];
  const skipped = [];
  for (const bundle of BUNDLES) {
    const index = next.findIndex(existing => existing.name === bundle.name);
    const existing = next[index];
    const upgradeGuide = existing?.bundled === true
      && ORIGINAL_HASHES[bundle.name]?.includes(instructionHash(existing));
    if (!upgradeGuide && (existing || installedVersion >= bundle.introduced)) continue;
    let skill;
    try {
      skill = parseSkill(await fs.readFile(path.join(root, bundle.name, 'SKILL.md'), 'utf8'));
      if (skill.name !== bundle.name) throw new Error(`Bundled skill name does not match ${bundle.name}.`);
    } catch (error) { skipped.push({ name: bundle.name, reason: error.message }); continue; }
    if (upgradeGuide) next[index] = { ...existing, description: skill.description, content: skill.content, updatedAt: Date.now() };
    else if (next.length >= LIMITS.skills) skipped.push({ name: bundle.name, reason: `The skill list is full (${LIMITS.skills}).` });
    else next.push({ ...skill, bundled: true, enabled: bundle.enabled !== false });
  }
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
  return { skipped };
}

module.exports = { installBundledSkills };
