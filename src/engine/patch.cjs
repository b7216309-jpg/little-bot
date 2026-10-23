'use strict';

// Applies the model's file edits in the "*** Begin Patch" format: Add File, Delete File and Update File (with an
// optional Move to), where each @@ hunk lists context lines (" "), removed lines ("-") and added lines ("+").

const fs = require('node:fs');
const path = require('node:path');

function parsePatch(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let index = lines.findIndex(line => line.trim() === '*** Begin Patch');
  if (index < 0) throw new Error('A patch starts with "*** Begin Patch".');
  const operations = [];
  let current = null, hunk = null;
  const finishHunk = () => { if (hunk && (hunk.lines.length)) current.hunks.push(hunk); hunk = null; };
  for (index += 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === '*** End Patch') { finishHunk(); return operations; }
    let match;
    if ((match = /^\*\*\* (Add|Delete|Update) File: (.+)$/.exec(line))) {
      finishHunk();
      current = { kind: match[1].toLowerCase(), path: match[2].trim(), lines: [], hunks: [], moveTo: null };
      operations.push(current);
      continue;
    }
    if (!current) { if (line.trim()) throw new Error(`Unexpected patch line before a file header: ${line.slice(0, 80)}`); continue; }
    if ((match = /^\*\*\* Move to: (.+)$/.exec(line)) && current.kind === 'update') { current.moveTo = match[1].trim(); continue; }
    if (line.trim() === '*** End of File') continue;
    // Local models sometimes drop the "+" of an added file's line or the space of a context line; read them as meant.
    if (current.kind === 'add') { current.lines.push(line.startsWith('+') ? line.slice(1) : line); continue; }
    if (current.kind === 'delete') continue;
    if (line.startsWith('@@')) { finishHunk(); hunk = { anchor: line.slice(2).trim(), lines: [] }; continue; }
    hunk ||= { anchor: '', lines: [] };
    if (line === '') { hunk.lines.push({ op: ' ', text: '' }); continue; }
    const op = line[0];
    if ([' ', '-', '+'].includes(op)) hunk.lines.push({ op, text: line.slice(1) });
    else hunk.lines.push({ op: ' ', text: line });
  }
  throw new Error('A patch ends with "*** End Patch".');
}

function findSequence(lines, wanted, from) {
  if (!wanted.length) return from;
  const passes = [value => value, value => value.trimEnd(), value => value.trim()];
  for (const normalize of passes) {
    const target = wanted.map(normalize);
    for (let start = from; start + target.length <= lines.length; start++) {
      let found = true;
      for (let offset = 0; offset < target.length; offset++) if (normalize(lines[start + offset]) !== target[offset]) { found = false; break; }
      if (found) return start;
    }
  }
  return -1;
}

function applyHunks(original, hunks, file) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const endsWithNewline = original.endsWith('\n');
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  if (endsWithNewline) lines.pop();
  let cursor = 0;
  for (const hunk of hunks) {
    // Trailing blank context lines are often an artifact of how the patch was written.
    while (hunk.lines.length && hunk.lines.at(-1).op === ' ' && hunk.lines.at(-1).text === '') hunk.lines.pop();
    const before = hunk.lines.filter(line => line.op !== '+').map(line => line.text);
    const after = hunk.lines.filter(line => line.op !== '-').map(line => line.text);
    let start = cursor;
    if (hunk.anchor) {
      const anchor = findSequence(lines, [hunk.anchor], cursor);
      if (anchor >= 0) start = anchor;
    }
    let at = findSequence(lines, before, start);
    if (at < 0 && start !== 0) at = findSequence(lines, before, 0);
    if (at < 0) throw new Error(`Could not find these lines in ${file}:\n${before.slice(0, 6).join('\n')}`);
    lines.splice(at, before.length, ...after);
    cursor = at + after.length;
  }
  return lines.join(eol) + (endsWithNewline || !original ? eol : '');
}

function resolveInside(cwd, target) {
  return path.resolve(cwd, String(target).trim().replace(/^["']|["']$/g, ''));
}

function diffText(operation) {
  if (operation.kind === 'add') return operation.lines.map(line => `+${line}`).join('\n');
  if (operation.kind === 'delete') return '';
  return operation.hunks.map(hunk => [`@@ ${hunk.anchor}`.trim(), ...hunk.lines.map(line => `${line.op}${line.text}`)].join('\n')).join('\n');
}

// Checks every operation before writing anything, so a patch that cannot apply leaves the files as they were.
function applyPatch(text, cwd) {
  const operations = parsePatch(text);
  if (!operations.length) throw new Error('The patch changes no files.');
  const writes = [];
  for (const operation of operations) {
    const file = resolveInside(cwd, operation.path);
    if (operation.kind === 'add') {
      writes.push({ file, content: operation.lines.join('\n') + (operation.lines.length ? '\n' : ''), kind: 'add', operation });
    } else if (operation.kind === 'delete') {
      if (!fs.existsSync(file)) throw new Error(`Cannot delete ${operation.path}: it does not exist.`);
      writes.push({ file, delete: true, kind: 'delete', operation });
    } else {
      if (!fs.existsSync(file)) throw new Error(`Cannot update ${operation.path}: it does not exist. Use "*** Add File:" for a new file.`);
      const content = applyHunks(fs.readFileSync(file, 'utf8'), operation.hunks, operation.path);
      const target = operation.moveTo ? resolveInside(cwd, operation.moveTo) : file;
      writes.push({ file: target, content, kind: 'update', operation, from: operation.moveTo ? file : null });
    }
  }
  for (const write of writes) {
    if (write.delete) { fs.rmSync(write.file, { force: true }); continue; }
    fs.mkdirSync(path.dirname(write.file), { recursive: true });
    fs.writeFileSync(write.file, write.content, 'utf8');
    if (write.from && write.from !== write.file) fs.rmSync(write.from, { force: true });
  }
  return writes.map(write => ({ path: write.file, kind: write.kind, diff: diffText(write.operation) }));
}

// Changes a patch would make, without writing (for approval and the timeline).
function previewPatch(text, cwd) {
  return parsePatch(text).map(operation => ({ path: resolveInside(cwd, operation.moveTo || operation.path), kind: operation.kind, diff: diffText(operation) }));
}

// `apply_patch <<'EOF' ... EOF` (or the patch quoted) sent through the shell is the same edit.
function patchFromCommand(command) {
  const text = String(command || '').trim();
  if (!/^apply_patch\b/.test(text)) return null;
  const heredoc = /^apply_patch\s*<<\s*['"]?(\w+)['"]?\s*\r?\n([\s\S]*?)\r?\n\1\s*$/.exec(text);
  if (heredoc) return heredoc[2];
  const quoted = /^apply_patch\s+(['"])([\s\S]*)\1\s*$/.exec(text);
  if (quoted) return quoted[2];
  const inline = text.indexOf('*** Begin Patch');
  return inline >= 0 ? text.slice(inline) : null;
}

module.exports = { applyPatch, previewPatch, parsePatch, patchFromCommand };
