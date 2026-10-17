'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// The first profile lives in the base folder itself, so existing installs keep their data where it is.
const MAIN_ID = 'main';
const NAME_LIMIT = 60;
// A new profile reaches the same model straight away; personality, memory, history and tasks start fresh.
const COPIED_SETTINGS = ['connection', 'localBaseUrl', 'localModel', 'localThinking', 'model', 'effort', 'autoCompactPercent', 'independentCheckMode', 'localSampling'];

function profileName(value) {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new Error('Give the profile a name.');
  if (name.length > NAME_LIMIT) throw new Error(`Keep the profile name to ${NAME_LIMIT} characters.`);
  return name;
}

class Profiles {
  constructor({ base }) {
    if (typeof base !== 'string' || !path.isAbsolute(base)) throw new Error('An absolute profiles folder is required.');
    this.base = path.resolve(base);
    this.file = path.join(this.base, 'profiles.json');
    this.data = this.read();
  }
  read() {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* No registry yet: only the main profile exists. */ }
    const profiles = [];
    for (const item of Array.isArray(saved?.profiles) ? saved.profiles : []) {
      if (typeof item?.id !== 'string' || !/^[a-z0-9]{1,40}$/.test(item.id) || profiles.some(profile => profile.id === item.id)) continue;
      // A profile folder removed by hand drops out instead of being recreated empty.
      if (item.id !== MAIN_ID && !fs.existsSync(this.root(item.id))) continue;
      let name;
      try { name = profileName(item.name); } catch { name = item.id === MAIN_ID ? 'Little Bot' : 'Profile'; }
      profiles.push({ id: item.id, name, createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0 });
    }
    if (!profiles.some(profile => profile.id === MAIN_ID)) profiles.unshift({ id: MAIN_ID, name: 'Little Bot', createdAt: 0 });
    return { active: profiles.some(profile => profile.id === saved?.active) ? saved.active : MAIN_ID, profiles };
  }
  write() {
    fs.mkdirSync(this.base, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, this.file);
  }
  root(id) { return id === MAIN_ID ? this.base : path.join(this.base, 'Profiles', id); }
  find(id) {
    const profile = this.data.profiles.find(item => item.id === id);
    if (!profile) throw new Error('That profile no longer exists.');
    return profile;
  }
  state() {
    return { active: this.data.active, profiles: this.data.profiles.map(profile => ({ ...profile, active: profile.id === this.data.active })) };
  }
  // A personality preset supplies the SOUL.md and system prompt; otherwise both start from the defaults.
  create({ name, settings = {}, soul, systemPrompt } = {}) {
    const profile = { id: randomUUID().replace(/-/g, '').slice(0, 12), name: profileName(name), createdAt: Date.now() };
    const dataDir = path.join(this.root(profile.id), 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const copied = Object.fromEntries(COPIED_SETTINGS.filter(key => settings[key] !== undefined).map(key => [key, settings[key]]));
    if (typeof systemPrompt === 'string') copied.systemPrompt = systemPrompt;
    // A plain first state; the Store encrypts it on its first save.
    fs.writeFileSync(path.join(dataDir, 'state.json'), `${JSON.stringify({ settings: copied }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (typeof soul === 'string') {
      fs.mkdirSync(path.join(dataDir, 'profile'), { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'profile', 'SOUL.md'), soul, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    this.data.profiles.push(profile);
    this.write();
    return profile;
  }
  rename(id, name) {
    this.find(id).name = profileName(name);
    this.write();
  }
  select(id) {
    this.find(id);
    this.data.active = id;
    this.write();
  }
  remove(id) {
    const profile = this.find(id);
    if (id === MAIN_ID) throw new Error('The first profile holds the others and cannot be deleted.');
    if (id === this.data.active) throw new Error('Switch to another profile before deleting this one.');
    fs.rmSync(this.root(id), { recursive: true, force: true });
    this.data.profiles = this.data.profiles.filter(item => item !== profile);
    this.write();
  }
}

module.exports = { Profiles, MAIN_ID };
