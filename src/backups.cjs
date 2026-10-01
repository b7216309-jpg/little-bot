'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Daily restore points of the memory database and app state. They live beside the data and
// are never uploaded. Restoring happens on the next start, before anything opens the files.
const KEEP_DAYS = 7;
const KEEP_SAFETY = 3;
const DAY_ID = /^\d{4}-\d{2}-\d{2}$/;
const SAFETY_ID = /^before-restore-\d+$/;
const MARKER = 'restore-pending.json';
const DATA_FILES = ['memory.sqlite', 'state.json'];

function localDay(nowMs) {
  const date = new Date(nowMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const rootOf = stateDir => path.join(stateDir, 'backups');

function listBackups(stateDir) {
  const root = rootOf(stateDir);
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  return names.filter(name => DAY_ID.test(name) || SAFETY_ID.test(name)).map(id => {
    const dir = path.join(root, id);
    let manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { /* Older or partial folder. */ }
    const files = DATA_FILES.filter(file => fs.existsSync(path.join(dir, file)));
    const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join(dir, file)).size, 0);
    return { id, kind: SAFETY_ID.test(id) ? 'safety' : 'daily', createdAt: Number(manifest.createdAt) || fs.statSync(dir).mtimeMs, files, bytes };
  }).filter(item => item.files.includes('memory.sqlite')).sort((left, right) => right.createdAt - left.createdAt);
}

function prune(stateDir) {
  const root = rootOf(stateDir);
  const all = listBackups(stateDir);
  for (const [kind, keep] of [['daily', KEEP_DAYS], ['safety', KEEP_SAFETY]]) {
    for (const item of all.filter(entry => entry.kind === kind).slice(keep)) fs.rmSync(path.join(root, item.id), { recursive: true, force: true });
  }
}

// One restore point per local day; `force` replaces today's.
function createBackup({ stateDir, memoryService, nowMs = Date.now(), force = false }) {
  if (!memoryService?.db) throw new Error('The memory database is not open.');
  const root = rootOf(stateDir), id = localDay(nowMs), dir = path.join(root, id);
  if (fs.existsSync(path.join(dir, 'memory.sqlite')) && !force) return null;
  const staging = path.join(root, `${id}.partial-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    // VACUUM INTO writes a consistent copy of the live WAL database without stopping the app.
    memoryService.db.exec(`VACUUM INTO '${path.join(staging, 'memory.sqlite').replace(/'/g, "''")}'`);
    const state = path.join(stateDir, 'state.json');
    if (fs.existsSync(state)) fs.copyFileSync(state, path.join(staging, 'state.json'));
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({ createdAt: nowMs, files: DATA_FILES }, null, 2));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  prune(stateDir);
  return listBackups(stateDir).find(item => item.id === id);
}

function requestRestore(stateDir, id) {
  if (typeof id !== 'string' || !listBackups(stateDir).some(item => item.id === id)) throw new Error('Choose an existing backup.');
  fs.writeFileSync(path.join(stateDir, MARKER), JSON.stringify({ id, requestedAt: Date.now() }));
  return { id };
}

// Runs before the Store opens anything. The current files are kept as a safety restore point first.
function applyPendingRestore(stateDir, nowMs = Date.now()) {
  const marker = path.join(stateDir, MARKER);
  let request;
  try { request = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { return null; }
  fs.rmSync(marker, { force: true });
  const source = path.join(rootOf(stateDir), String(request?.id || ''));
  if (!request?.id || !(DAY_ID.test(request.id) || SAFETY_ID.test(request.id)) || !fs.existsSync(path.join(source, 'memory.sqlite'))) {
    return { error: 'The selected backup no longer exists; nothing was restored.' };
  }
  const safety = path.join(rootOf(stateDir), `before-restore-${nowMs}`);
  fs.mkdirSync(safety, { recursive: true });
  for (const file of DATA_FILES) {
    const current = path.join(stateDir, file);
    if (fs.existsSync(current)) fs.copyFileSync(current, path.join(safety, file));
  }
  fs.writeFileSync(path.join(safety, 'manifest.json'), JSON.stringify({ createdAt: nowMs, files: DATA_FILES }, null, 2));
  for (const suffix of ['-wal', '-shm']) fs.rmSync(path.join(stateDir, `memory.sqlite${suffix}`), { force: true });
  for (const file of DATA_FILES) {
    const saved = path.join(source, file);
    if (fs.existsSync(saved)) fs.copyFileSync(saved, path.join(stateDir, file));
  }
  prune(stateDir);
  return { restored: request.id, safety: path.basename(safety) };
}

module.exports = { listBackups, createBackup, requestRestore, applyPendingRestore, KEEP_DAYS };
