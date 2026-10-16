'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Profiles, MAIN_ID } = require('../src/profiles.cjs');
const { Store } = require('../src/store.cjs');

function base(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-profiles-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('an install without profiles runs the main profile from the base folder', t => {
  const root = base(t);
  const profiles = new Profiles({ base: root });
  assert.equal(profiles.data.active, MAIN_ID);
  assert.equal(profiles.root(MAIN_ID), root);
  assert.deepEqual(profiles.state().profiles.map(({ id, active }) => [id, active]), [[MAIN_ID, true]]);
  assert.equal(fs.existsSync(path.join(root, 'profiles.json')), false, 'nothing is written until a profile is created');
});

test('a new profile starts fresh but reaches the same model', t => {
  const root = base(t);
  const profiles = new Profiles({ base: root });
  const settings = { connection: 'local', localBaseUrl: 'http://127.0.0.1:8080/v1', localModel: 'test-model', model: 'test-model', effort: 'high', systemPrompt: 'Main profile prompt', workspace: 'C:\\Main', activityAwareness: true };
  const created = profiles.create({ name: '  Nova   Bot ', settings });
  assert.equal(created.name, 'Nova Bot');
  const folder = profiles.root(created.id);
  assert.equal(path.dirname(folder), path.join(root, 'Profiles'));
  const store = new Store({ filePath: path.join(folder, 'data', 'state.json'), defaultWorkspace: path.join(folder, 'Workspace'), protector: { encryptString: value => Buffer.from(value), decryptString: value => value.toString('utf8') } });
  assert.equal(store.warning, null);
  assert.equal(store.data.settings.localModel, 'test-model');
  assert.equal(store.data.settings.effort, 'high');
  assert.equal(store.data.settings.systemPrompt, undefined, 'the system prompt belongs to each profile');
  assert.equal(store.data.settings.activityAwareness, false);
  assert.equal(store.data.settings.workspace, path.join(folder, 'Workspace'));
  assert.equal(store.data.chats.length, 0);
  store.save();
  store.close();
  assert.ok(JSON.parse(fs.readFileSync(store.filePath, 'utf8')).protected, 'the first save encrypts the state');
});

test('profiles rename, switch and delete, and the registry survives a restart', t => {
  const root = base(t);
  const profiles = new Profiles({ base: root });
  const other = profiles.create({ name: 'Other' });
  profiles.rename(MAIN_ID, 'Original');
  profiles.select(other.id);
  const reopened = new Profiles({ base: root });
  assert.equal(reopened.data.active, other.id);
  assert.deepEqual(reopened.data.profiles.map(item => item.name), ['Original', 'Other']);
  assert.throws(() => reopened.remove(other.id), /Switch to another profile/);
  assert.throws(() => reopened.remove(MAIN_ID), /cannot be deleted/);
  assert.throws(() => reopened.rename(other.id, '   '), /name/);
  reopened.select(MAIN_ID);
  reopened.remove(other.id);
  assert.equal(fs.existsSync(reopened.root(other.id)), false);
  assert.deepEqual(new Profiles({ base: root }).data.profiles.map(item => item.id), [MAIN_ID]);
});

test('a profile folder removed by hand drops out and the main profile takes over', t => {
  const root = base(t);
  const profiles = new Profiles({ base: root });
  const gone = profiles.create({ name: 'Gone' });
  profiles.select(gone.id);
  fs.rmSync(profiles.root(gone.id), { recursive: true });
  fs.writeFileSync(path.join(root, 'profiles.json'), JSON.stringify({ ...profiles.data, profiles: [...profiles.data.profiles, { id: '../escape', name: 'Bad' }] }));
  const reopened = new Profiles({ base: root });
  assert.equal(reopened.data.active, MAIN_ID);
  assert.deepEqual(reopened.data.profiles.map(item => item.id), [MAIN_ID]);
});

test('each personality fits SOUL.md and its prompt keeps the app rules', t => {
  const { listPresets, loadPreset, presetPrompt } = require('../src/profile-presets.cjs');
  const { ProfileFiles, PROFILE_FILE_LIMIT } = require('../src/profile.cjs');
  const presets = listPresets();
  assert.equal(presets.length, 5);
  assert.equal(new Set(presets.map(item => item.name)).size, 5);
  for (const { id } of presets) {
    const preset = loadPreset(id);
    assert.ok(preset.soul.length > 500 && preset.soul.length <= PROFILE_FILE_LIMIT, `${id} SOUL.md fits the editor`);
    assert.ok(preset.tagline && preset.intro.includes(preset.name.replace(/^The /, '')), `${id} has a tagline and an intro`);
  }
  assert.equal(presetPrompt('You are Zib.', 'You are Little Bot.\n\nRULES'), 'You are Zib. Use tools when useful and do not inspect files for ordinary conversation; give brief progress updates on longer tasks.\n\nRULES');
  const root = base(t);
  const mochi = loadPreset('mochi');
  const created = new Profiles({ base: root }).create({ name: mochi.name, soul: mochi.soul, systemPrompt: 'MOCHI PROMPT' });
  const files = new ProfileFiles({ root: path.join(root, 'Profiles', created.id, 'data', 'profile') }).getState();
  assert.equal(files.soul, mochi.soul);
  assert.match(files.user, /About the user/, 'USER.md still starts from the default');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'Profiles', created.id, 'data', 'state.json'), 'utf8')).settings.systemPrompt, 'MOCHI PROMPT');
});
