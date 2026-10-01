'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../../..');
const folder = path.resolve(__dirname, '..');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
const documents = files(folder).filter(file => file.endsWith('.md'));
let links = 0;
for (const file of documents) {
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(source.trim().startsWith('# '), 'Missing document title: ' + file);
  const fences = source.split(/\r?\n/).filter(line => line.startsWith('```'));
  assert.equal(fences.length % 2, 0, 'Unclosed code fence: ' + file);
  for (const match of source.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:)/.test(reference) || reference.startsWith('#')) continue;
    const relative = reference.split('#')[0];
    const target = path.resolve(path.dirname(file), decodeURIComponent(relative));
    assert.ok(fs.existsSync(target), 'Broken link: ' + path.relative(repo, file) + ' -> ' + reference);
    const line = /#L(\d+)$/.exec(reference);
    if (line) assert.ok(Number(line[1]) <= fs.readFileSync(target, 'utf8').split(/\r?\n/).length, 'Invalid source line: ' + reference);
    links++;
  }
}
const owners = JSON.parse(fs.readFileSync(path.join(folder, 'source-map.json'), 'utf8'));
const tracked = execFileSync('git', ['ls-files', 'src', 'scripts', 'examples', 'resources', 'integrations'], { cwd: repo, encoding: 'utf8' }).trim().split(/\r?\n/);
for (const file of tracked) {
  assert.ok(owners[file], 'Unmapped piece: ' + file);
  assert.ok(fs.existsSync(path.join(folder, owners[file])), 'Missing guide for: ' + file);
}
for (const file of Object.keys(owners)) assert.ok(fs.existsSync(path.join(repo, file)), 'Stale source-map entry: ' + file);
console.log(JSON.stringify({ documents: documents.length, relativeLinksChecked: links, mappedPieces: tracked.length, brokenLinks: 0 }));
