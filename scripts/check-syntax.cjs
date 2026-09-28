'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const roots = ['src', 'scripts', 'test', 'examples'];
const extensions = new Set(['.js', '.cjs', '.mjs']);
const ignoredDirectories = new Set(['node_modules', 'dist']);

function collect(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file, files);
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(file);
  }
  return files;
}

const files = roots.flatMap(directory => collect(path.join(root, directory))).sort();
if (!files.length) throw new Error('No JavaScript files were found for syntax checking.');

let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status === 0) continue;
  failures++;
  process.stderr.write(`\nSyntax check failed: ${path.relative(root, file)}\n`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
}

if (failures) {
  process.stderr.write(`\n${failures} file${failures === 1 ? '' : 's'} failed syntax checking.\n`);
  process.exit(1);
}

process.stdout.write(`Syntax checked ${files.length} JavaScript files.\n`);
