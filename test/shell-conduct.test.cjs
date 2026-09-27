'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  COMMAND_OUTPUT_LIMIT,
  SHELL_CONDUCT,
  TRUNCATION_MARKER,
  clipCommandText,
  commandTranscript,
  appendCommandDelta,
} = require('../src/shell-conduct.cjs');

test('shell conduct explicitly requires non-interactive bounded Windows commands', () => {
  assert.match(SHELL_CONDUCT, /non-interactive/i);
  assert.match(SHELL_CONDUCT, /PowerShell/i);
  assert.match(SHELL_CONDUCT, /-NonInteractive/);
  assert.match(SHELL_CONDUCT, /Bound output/i);
  assert.match(SHELL_CONDUCT, /watchers/i);
  assert.match(SHELL_CONDUCT, /entire drive/i);
});

test('large command output keeps useful beginning and end within a hard limit', () => {
  const text = 'BEGIN\n' + 'x'.repeat(COMMAND_OUTPUT_LIMIT * 2) + '\nEND';
  const clipped = clipCommandText(text);
  assert.equal(clipped.length, COMMAND_OUTPUT_LIMIT);
  assert.ok(clipped.startsWith('BEGIN'));
  assert.ok(clipped.endsWith('END'));
  assert.ok(clipped.includes(TRUNCATION_MARKER.trim()));
});

test('streaming deltas remain bounded even after repeated noisy output', () => {
  let text = '';
  for (let index = 0; index < 500; index++) text = appendCommandDelta(text, `line-${index} ${'x'.repeat(300)}\n`);
  assert.ok(text.length <= COMMAND_OUTPUT_LIMIT);
  assert.match(text, /line-499/);
  assert.ok(text.includes(TRUNCATION_MARKER.trim()));
});

test('completed transcript includes command and remains bounded', () => {
  const transcript = commandTranscript('Get-ChildItem', 'z'.repeat(COMMAND_OUTPUT_LIMIT * 2));
  assert.ok(transcript.startsWith('$ Get-ChildItem\n'));
  assert.equal(transcript.length, COMMAND_OUTPUT_LIMIT);
});

test('controller and goals apply the shared shell conduct helper', () => {
  const root = path.join(__dirname, '..', 'src');
  const controller = readFileSync(path.join(root, 'controller.cjs'), 'utf8');
  const goals = readFileSync(path.join(root, 'goal-executor.cjs'), 'utf8');
  assert.match(controller, /SHELL_CONDUCT/);
  assert.match(controller, /developerInstructions: this\.systemPrompt\(\)/);
  assert.match(controller, /prepared\.text,\s*SHELL_CONDUCT/);
  assert.match(controller, /appendCommandDelta/);
  assert.match(controller, /commandTranscript/);
  assert.match(goals, /SHELL_CONDUCT/);
});

test('real PowerShell high-volume output is safely reduced for chat', { skip: process.platform !== 'win32' }, () => {
  const output = execFileSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '1..5000 | ForEach-Object { "row-$($_) " + ("x" * 40) }',
  ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  assert.ok(output.length > COMMAND_OUTPUT_LIMIT);
  const transcript = commandTranscript('powershell.exe test', output);
  assert.ok(transcript.length <= COMMAND_OUTPUT_LIMIT);
  assert.match(transcript, /row-1 /);
  assert.match(transcript, /row-5000 /);
  assert.ok(transcript.includes(TRUNCATION_MARKER.trim()));
});
