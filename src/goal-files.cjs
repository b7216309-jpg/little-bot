'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_FILES = 2000;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_BACKUP_BYTES = 250 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const forbidden = name => /^(?:\.git|node_modules|\.ssh|\.aws|\.gnupg|\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|id_rsa|id_ed25519)$/i.test(name);
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)); };

function relativePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\0-\x1f:]/.test(value) || /^[\\/]/.test(value)) throw new Error('Use a relative path inside the working folder.');
  const parts = value.trim().split(/[\\/]/).filter(part => part && part !== '.');
  if (parts.some(part => part === '..' || forbidden(part))) throw new Error('Paths cannot leave the working folder or target credentials, Git data, or node_modules.');
  return parts.join('/') || '.';
}

async function workspaceRoot(goal) {
  if (typeof goal.workspace !== 'string' || !path.isAbsolute(goal.workspace)) throw new Error('Choose an absolute working folder.');
  const root = await fs.realpath(goal.workspace);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('The goal working folder is unavailable.');
  return root;
}

async function checkedPath(root, relative, { missing = false } = {}) {
  relative = relativePath(relative);
  let cursor = root;
  const parts = relative === '.' ? [] : relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try { stat = await fs.lstat(cursor); } catch (error) {
      if (missing && error.code === 'ENOENT') return path.join(cursor, ...parts.slice(index + 1));
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('Goal paths cannot contain symbolic links or directory junctions.');
    if (stat.isFile() && stat.nlink > 1) throw new Error('Goal paths cannot include hard-linked files.');
    const real = await fs.realpath(cursor);
    if (!inside(root, real)) throw new Error('A goal path escaped the working folder.');
    if (forbidden(path.basename(real))) throw new Error('Goal paths cannot target credentials, Git data, or node_modules.');
  }
  return cursor;
}

async function resolveWriteRoots(goal) {
  if (!goal.permissions?.write) return [];
  if (!Array.isArray(goal.permissions.writePaths) || !goal.permissions.writePaths.length) throw new Error('Choose at least one writable folder for this goal.');
  const root = await workspaceRoot(goal);
  const roots = [];
  for (const relative of goal.permissions.writePaths) {
    const target = await checkedPath(root, relative);
    if (!(await fs.stat(target)).isDirectory()) throw new Error('Writable paths must name existing directories.');
    if (!roots.some(item => inside(item, target))) {
      for (let index = roots.length - 1; index >= 0; index--) if (inside(target, roots[index])) roots.splice(index, 1);
      roots.push(target);
    }
  }
  return roots;
}

async function scan(goal, roots, { contents = false, metadataOnly = false } = {}) {
  const root = await workspaceRoot(goal);
  const entries = [], directories = [];
  let bytes = 0;
  async function visit(target) {
    const relative = path.relative(root, target).split(path.sep).join('/') || '.';
    await checkedPath(root, relative);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error('Snapshots cannot include symbolic links or directory junctions. Choose a narrower writable folder.');
    if (stat.isDirectory()) {
      directories.push(relative);
      if (directories.length > MAX_FILES) throw new Error('Snapshot folder limit exceeded. Choose a narrower writable folder.');
      const children = await fs.readdir(target, { withFileTypes: true });
      if (children.length + entries.length > MAX_FILES) throw new Error('Snapshot file limit exceeded. Choose a narrower writable folder.');
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        if (forbidden(child.name)) throw new Error(`Snapshot scope contains protected data (${child.name}). Choose a narrower writable folder.`);
        await visit(path.join(target, child.name));
      }
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (entries.length >= MAX_FILES || bytes > MAX_BYTES) throw new Error('Snapshot limit is 2,000 files and 25 MiB. Choose a narrower writable folder.');
      if (metadataOnly) { entries.push({ path: relative, hash: hash(`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`), size: stat.size }); return; }
      const buffer = await fs.readFile(target);
      const after = await fs.lstat(target);
      if (after.isSymbolicLink() || buffer.length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('Files changed while creating the snapshot. Try again after writes finish.');
      entries.push({ path: relative, hash: hash(buffer), size: buffer.length, ...(contents ? { buffer } : {}) });
    } else throw new Error('Snapshots support regular files and directories only.');
  }
  for (const target of roots) {
    if (!inside(root, target)) throw new Error('Snapshot scope escaped the working folder.');
    try { await visit(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { root, entries, directories, bytes };
}

function snapshotDirectory(backupRoot, goalId, runId) {
  for (const value of [goalId, runId]) if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid snapshot identifier.');
  const root = path.resolve(backupRoot), directory = path.resolve(root, goalId, runId);
  if (!inside(root, directory) || directory === root) throw new Error('Invalid snapshot directory.');
  return directory;
}

async function writeManifest(directory, manifest) {
  const temporary = path.join(directory, 'manifest.tmp');
  const handle = await fs.open(temporary, 'w', 0o600);
  try { await handle.writeFile(JSON.stringify(manifest)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, path.join(directory, 'manifest.json'));
}

async function backupUsage(directory) {
  let bytes = 0;
  let children;
  try { children = await fs.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('Backup folders cannot contain links.');
  for (const child of children) {
    const target = path.join(directory, child.name);
    if (child.isSymbolicLink()) throw new Error('Backup folders cannot contain links.');
    bytes += child.isDirectory() ? await backupUsage(target) : (await fs.stat(target)).size;
  }
  return bytes;
}

async function discardSnapshot(backupRoot, goalId, runId) {
  const directory = snapshotDirectory(backupRoot, goalId, runId);
  // The exact resolved target has been checked against the dedicated backup root.
  await backupUsage(path.dirname(directory));
  await fs.rm(directory, { recursive: true, force: true });
}

async function removeGoalSnapshots(backupRoot, goalId) {
  const goalDirectory = path.dirname(snapshotDirectory(backupRoot, goalId, 'checked'));
  const root = path.resolve(backupRoot);
  if (!inside(root, goalDirectory) || path.dirname(goalDirectory) !== root) throw new Error('Invalid goal backup directory.');
  await backupUsage(goalDirectory);
  await fs.rm(goalDirectory, { recursive: true, force: true });
}

async function retainLatestSnapshots(backupRoot, goalId, currentRunId) {
  const directory = path.dirname(snapshotDirectory(backupRoot, goalId, currentRunId));
  const snapshots = [];
  for (const child of await fs.readdir(directory, { withFileTypes: true })) {
    if (!child.isDirectory()) continue;
    const target = snapshotDirectory(backupRoot, goalId, child.name);
    try { const manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8')); snapshots.push({ id: child.name, at: manifest.createdAt || 0 }); } catch { /* An incomplete snapshot is not silently discarded. */ }
  }
  const retired = [];
  for (const snapshot of snapshots.sort((a, b) => a.id === currentRunId ? -1 : b.id === currentRunId ? 1 : b.at - a.at).slice(3)) {
    if (snapshot.id === currentRunId) continue;
    await discardSnapshot(backupRoot, goalId, snapshot.id); retired.push(snapshot.id);
  }
  return retired;
}

async function createSnapshot(goal, backupRoot, runId) {
  const roots = await resolveWriteRoots(goal);
  if (!roots.length) return null;
  const captured = await scan(goal, roots, { contents: true });
  const directory = snapshotDirectory(backupRoot, goal.id, runId);
  const manifestsRoot = path.resolve(backupRoot);
  if (roots.some(root => inside(root, manifestsRoot))) throw new Error('Backups must be outside the goal writable folders.');
  if (await backupUsage(manifestsRoot) + captured.bytes + MAX_MANIFEST_BYTES > MAX_BACKUP_BYTES) throw new Error('The 250 MiB backup limit is reached. Remove an older snapshot before continuing.');
  await fs.mkdir(path.join(directory, 'files'), { recursive: true });
  const files = [];
  for (const [index, entry] of captured.entries.entries()) {
    const copy = `files/${String(index).padStart(5, '0')}.bin`;
    const handle = await fs.open(path.join(directory, copy), 'wx', 0o600);
    try { await handle.writeFile(entry.buffer); await handle.sync(); } finally { await handle.close(); }
    files.push({ path: entry.path, hash: entry.hash, size: entry.size, copy });
  }
  const manifest = { version: 1, goalId: goal.id, runId, workspace: captured.root, scopes: roots.map(root => path.relative(captured.root, root).split(path.sep).join('/') || '.'), before: files, directories: captured.directories, after: null, createdAt: Date.now(), restoredAt: null };
  await writeManifest(directory, manifest);
  const retiredRunIds = await retainLatestSnapshots(backupRoot, goal.id, runId);
  return { runId, fileCount: files.length, bytes: captured.bytes, changes: 0, undoAvailable: false, retiredRunIds };
}

async function loadSnapshot(goal, backupRoot, runId) {
  const directory = snapshotDirectory(backupRoot, goal.id, runId);
  const file = path.join(directory, 'manifest.json');
  for (const target of [path.resolve(backupRoot), path.dirname(directory), directory, file]) if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('Backup paths cannot contain links.');
  const stat = await fs.stat(file);
  if (stat.size > MAX_MANIFEST_BYTES) throw new Error('Invalid snapshot metadata.');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  if (manifest.version !== 1 || manifest.goalId !== goal.id || manifest.runId !== runId || manifest.workspace !== await workspaceRoot(goal) || !Array.isArray(manifest.before) || !Array.isArray(manifest.scopes)) throw new Error('Snapshot does not match this goal and working folder.');
  return { directory, manifest };
}

function changesFor(manifest) {
  const before = new Map(manifest.before.map(entry => [entry.path, entry]));
  const after = new Map((manifest.after || []).map(entry => [entry.path, entry]));
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(file => before.get(file)?.hash === after.get(file)?.hash ? [] : [{ path: file, kind: !before.has(file) ? 'created' : !after.has(file) ? 'deleted' : 'modified' }]);
}

async function finishSnapshot(goal, backupRoot, runId) {
  const { directory, manifest } = await loadSnapshot(goal, backupRoot, runId);
  const root = await workspaceRoot(goal);
  const roots = await Promise.all(manifest.scopes.map(relative => checkedPath(root, relative, { missing: true })));
  const after = await scan(goal, roots);
  manifest.after = after.entries;
  manifest.finishedAt = Date.now();
  await writeManifest(directory, manifest);
  const changes = changesFor(manifest);
  return { runId, fileCount: manifest.before.length, bytes: manifest.before.reduce((sum, entry) => sum + entry.size, 0), changes: changes.length, undoAvailable: changes.length > 0 };
}

async function previewRestore(goal, backupRoot, runId) {
  const { manifest } = await loadSnapshot(goal, backupRoot, runId);
  if (!manifest.after) return { changes: [], canRestore: false, conflicts: ['This run has no verified final snapshot.'] };
  const changes = changesFor(manifest), conflicts = [];
  if (manifest.restoredAt) conflicts.push('This snapshot was already restored.');
  const root = await workspaceRoot(goal);
  const after = new Map(manifest.after.map(entry => [entry.path, entry]));
  for (const change of changes) {
    try {
      const target = await checkedPath(root, change.path, { missing: true });
      let current = null;
      try { const stat = await fs.lstat(target); if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('File type changed'); current = hash(await fs.readFile(target)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current !== (after.get(change.path)?.hash || null)) conflicts.push(`${change.path}: changed since this run`);
    } catch (error) { conflicts.push(`${change.path}: ${error.message}`); }
  }
  return { changes, canRestore: changes.length > 0 && conflicts.length === 0, conflicts };
}

async function currentFileHash(root, file) {
  const target = await checkedPath(root, file, { missing: true });
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('File type changed.');
    return hash(await fs.readFile(target));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function restoreSnapshot(goal, backupRoot, runId) {
  const preview = await previewRestore(goal, backupRoot, runId);
  if (!preview.canRestore) throw new Error(preview.conflicts.join('\n') || 'There are no file changes to restore.');
  const { directory, manifest } = await loadSnapshot(goal, backupRoot, runId);
  const root = await workspaceRoot(goal), before = new Map(manifest.before.map(entry => [entry.path, entry])), after = new Map(manifest.after.map(entry => [entry.path, entry]));
  // Validate every backup before changing user files. Per-file current hashes are
  // checked again immediately before writes; unrelated later files are untouched.
  const buffers = new Map();
  for (const change of preview.changes) {
    const entry = before.get(change.path);
    if (!entry) continue;
    if (!/^files\/\d{5}\.bin$/.test(entry.copy)) throw new Error('Invalid snapshot copy path.');
    const buffer = await fs.readFile(path.join(directory, entry.copy));
    if (hash(buffer) !== entry.hash) throw new Error('Snapshot contents failed verification.');
    buffers.set(change.path, buffer);
  }
  let restored = 0;
  for (const change of preview.changes) {
    try {
      // Recheck only this path: re-reading every file on every write would make
      // a 2,000-file restore quadratic and could read tens of gigabytes.
      if (await currentFileHash(root, change.path) !== (after.get(change.path)?.hash || null)) throw new Error(`${change.path} changed after preview.`);
      const target = await checkedPath(root, change.path, { missing: true });
      if (change.kind === 'created') await fs.unlink(target);
      else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await checkedPath(root, path.relative(root, path.dirname(target)).split(path.sep).join('/') || '.');
        const temporary = path.join(path.dirname(target), `.little-bot-restore-${runId}.tmp`);
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(buffers.get(change.path)); await handle.sync(); } finally { await handle.close(); }
        try { await fs.rename(temporary, target); } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
      }
      restored++;
    } catch (error) {
      const failure = new Error(`Restored ${restored} files; stopped at ${change.path}: ${error.message}`);
      failure.restored = restored; throw failure;
    }
  }
  manifest.restoredAt = Date.now();
  await writeManifest(directory, manifest);
  return { restored: preview.changes.length, changes: preview.changes };
}

async function verifyFile(goal, check) {
  const root = await workspaceRoot(goal);
  try {
    const target = await checkedPath(root, check.path, { missing: true });
    const stat = await fs.stat(target);
    if (check.type === 'fileExists') return { passed: stat.isFile() || stat.isDirectory(), detail: 'Path exists.' };
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return { passed: false, detail: 'Text verification supports regular files up to 2 MiB.' };
    const passed = (await fs.readFile(target, 'utf8')).includes(check.contains);
    return { passed, detail: passed ? 'Required text found.' : 'Required text not found.' };
  } catch (error) { return { passed: false, detail: error.code === 'ENOENT' ? 'Path does not exist.' : error.message }; }
}

async function fingerprintPaths(goal) {
  const root = await workspaceRoot(goal), roots = [];
  for (const relative of goal.trigger.paths || []) roots.push(await checkedPath(root, relative, { missing: true }));
  // File triggers observe metadata changes; full content hashes remain reserved
  // for snapshots and undo, avoiding repeated 25 MiB reads during quiet polling.
  const state = await scan(goal, roots, { metadataOnly: true });
  return hash(JSON.stringify({ files: state.entries.map(entry => [entry.path, entry.hash]), directories: state.directories }));
}

module.exports = { relativePath, resolveWriteRoots, createSnapshot, finishSnapshot, previewRestore, restoreSnapshot, discardSnapshot, removeGoalSnapshots, verifyFile, fingerprintPaths, MAX_FILES, MAX_BYTES, MAX_BACKUP_BYTES };
