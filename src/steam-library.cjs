'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Read-only view of the local Steam library: installed games, last played and playtime.
// Nothing leaves the PC; only files Steam already keeps are read.
const CACHE_MS = 10 * 60000;
const NOT_GAMES = /redistributable|steamworks|steamvr|proton|steam linux runtime|dedicated server|soundtrack|sdk\b/i;

// Minimal VDF (Valve KeyValues) reader: quoted keys, quoted values and nested braces.
function parseVdf(text) {
  const tokens = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let match;
  while ((match = pattern.exec(String(text || '')))) tokens.push(match[2] || { value: match[1].replace(/\\(.)/g, '$1') });
  let index = 0;
  const object = () => {
    const result = {};
    while (index < tokens.length) {
      const token = tokens[index++];
      if (token === '}') return result;
      if (typeof token !== 'object') continue;
      const next = tokens[index];
      if (next === '{') { index++; result[token.value] = object(); }
      else if (next && typeof next === 'object') { index++; result[token.value] = next.value; }
    }
    return result;
  };
  return object();
}

function child(node, name) {
  if (!node || typeof node !== 'object') return undefined;
  const key = Object.keys(node).find(item => item.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : node[key];
}

function readVdf(file) {
  try { return parseVdf(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function steamRoot() {
  if (process.platform === 'win32') {
    try {
      const output = spawnSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).stdout || '';
      const found = output.match(/SteamPath\s+REG_SZ\s+(.+)/i)?.[1]?.trim();
      if (found && fs.existsSync(found)) return path.normalize(found);
    } catch { /* Fall back to the default install folder. */ }
  }
  for (const candidate of ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']) if (fs.existsSync(candidate)) return candidate;
  return null;
}

function scan(root) {
  const libraries = new Set([root]);
  const folders = child(readVdf(path.join(root, 'steamapps', 'libraryfolders.vdf')), 'libraryfolders') || {};
  for (const entry of Object.values(folders)) {
    const location = typeof entry === 'object' ? child(entry, 'path') : entry;
    if (typeof location === 'string' && location) libraries.add(path.normalize(location));
  }
  const games = new Map();
  for (const library of libraries) {
    let names = [];
    try { names = fs.readdirSync(path.join(library, 'steamapps')).filter(name => /^appmanifest_\d+\.acf$/i.test(name)); } catch { continue; }
    for (const name of names) {
      const state = child(readVdf(path.join(library, 'steamapps', name)), 'AppState');
      const appid = String(child(state, 'appid') || '');
      const title = String(child(state, 'name') || '');
      if (!/^\d+$/.test(appid) || !title || NOT_GAMES.test(title)) continue;
      games.set(appid, { appid, name: title, lastPlayed: null, playtimeHours: null });
    }
  }
  let users = [];
  try { users = fs.readdirSync(path.join(root, 'userdata')); } catch { /* No signed-in profile data. */ }
  for (const user of users) {
    const config = readVdf(path.join(root, 'userdata', user, 'config', 'localconfig.vdf'));
    const apps = child(child(child(child(child(config, 'UserLocalConfigStore'), 'Software'), 'Valve'), 'Steam'), 'apps') || {};
    for (const [appid, info] of Object.entries(apps)) {
      const game = games.get(appid);
      if (!game) continue;
      const played = Number(child(info, 'LastPlayed')) * 1000;
      const minutes = Number(child(info, 'Playtime'));
      if (played > 0 && (!game.lastPlayed || played > Date.parse(game.lastPlayed))) game.lastPlayed = new Date(played).toISOString();
      if (Number.isFinite(minutes) && minutes > 0) game.playtimeHours = Math.max(game.playtimeHours || 0, Math.round(minutes / 6) / 10);
    }
  }
  return [...games.values()].sort((left, right) => (Date.parse(right.lastPlayed || 0) || 0) - (Date.parse(left.lastPlayed || 0) || 0) || left.name.localeCompare(right.name));
}

let cache = null;
function listGames({ limit = 40, refresh = false, root = null } = {}) {
  const now = Date.now();
  if (refresh || root || !cache || now - cache.at > CACHE_MS) {
    const found = root || steamRoot();
    cache = { at: now, root: found, games: found ? scan(found) : [] };
  }
  return { steamFound: Boolean(cache.root), count: cache.games.length, games: cache.games.slice(0, Math.max(1, Math.min(200, limit))) };
}

function installedGame(appid) {
  return listGames({ limit: 200 }).games.find(game => game.appid === String(appid)) || null;
}

module.exports = { parseVdf, listGames, installedGame };
