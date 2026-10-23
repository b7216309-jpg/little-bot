'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const slash = require('../src/renderer/slash-commands.js');

test('the / menu lists every command, narrows by name and alias, and closes once an argument starts', () => {
  assert.equal(slash.matches('/').length, slash.commands.length);
  assert.deepEqual(slash.matches('/go').map(command => command.name), ['goal', 'goals']);
  assert.deepEqual(slash.matches('/SA').map(command => command.name), ['keep'], 'aliases count and case does not matter');
  assert.deepEqual(slash.matches('/automations').map(command => command.name), ['schedule']);
  assert.deepEqual(slash.matches('/goal '), []);
  assert.deepEqual(slash.matches('hello /go'), []);
  assert.deepEqual(slash.matches('/nothing'), []);
  assert.equal(slash.takesArguments(slash.parse('/goal').command), true);
  assert.equal(slash.takesArguments(slash.parse('/keep').command), false);
  assert.equal(slash.parse('/save').name, 'keep');
});

test('/skill lists matching enabled skills and reads a skill name with its message', () => {
  const skills = [{ name: 'phishing-check', description: 'Is this email a scam?' }, { name: 'pc-security-checkup', description: 'Antivirus and firewall' }, { name: 'trip-planner', description: 'Plan a trip' }];
  assert.deepEqual(slash.skillMatches('/skill ', skills).map(skill => skill.name), ['phishing-check', 'pc-security-checkup', 'trip-planner']);
  assert.deepEqual(slash.skillMatches('/skill p', skills).map(skill => skill.name), ['phishing-check', 'pc-security-checkup', 'trip-planner'], 'names first, then names containing the text');
  assert.deepEqual(slash.skillMatches('/Skill $SCAM', skills).map(skill => skill.name), ['phishing-check'], 'descriptions match too');
  assert.deepEqual(slash.skillMatches('/skill nothing', skills), []);
  assert.equal(slash.skillMatches('/skill phishing-check is this legit', skills), null, 'the list closes once the message starts');
  assert.equal(slash.skillMatches('/skills', skills), null);
  assert.deepEqual(slash.matches('/sk').map(command => command.name), ['skill']);
  assert.deepEqual(slash.skillInvocation('Phishing-Check  is this\nlegit?'), { name: 'phishing-check', message: 'is this\nlegit?' });
  assert.deepEqual(slash.skillInvocation('$trip-planner'), { name: 'trip-planner', message: '' });
  assert.equal(slash.skillInvocation(''), null);
});

test('the goal drawer fields become /goal arguments the goal parser reads back exactly', () => {
  const { parseGoalCommand } = require('../src/chat-goal.cjs');
  const read = fields => parseGoalCommand(slash.goalArguments(fields));
  assert.deepEqual(read({ condition: '  All tests pass\nand the README explains setup ', check: 'npm test -- --grep "parser"', turns: 30, minutes: 120 }),
    { action: 'set', condition: 'All tests pass and the README explains setup', options: { check: 'npm test -- --grep "parser"', maxTurns: 30, maxMinutes: 120 } });
  assert.deepEqual(read({ condition: 'Ship it', check: `echo "it's done"` }).options, { check: `echo "it's done"` }, 'a quote the command uses is avoided');
  assert.deepEqual(read({ condition: 'Ship it', turns: Number.NaN, minutes: Number.NaN }).options, {}, 'empty budgets keep the defaults');
  assert.throws(() => slash.goalArguments({ condition: '  ' }), /Describe what must be true/);
  assert.throws(() => slash.goalArguments({ condition: 'Done --time 5m' }), /Leave --check/);
  assert.throws(() => slash.goalArguments({ condition: 'x', check: `"'\`` }), /quote/);
});

test('a message that only starts with a slash is sent as a message, not taken for a command', () => {
  assert.equal(slash.parse('/etc/hosts has the wrong entry, why?'), null);
  assert.equal(slash.parse('//comment'), null);
  assert.equal(slash.parse(' /goal looks like a command'), null, 'a leading space sends it as written');
  assert.equal(slash.parse('/usr/bin/python is missing'), null);
  assert.deepEqual(slash.parse('/shrug hello'), { known: false, name: 'shrug', args: 'hello', command: null });
  assert.equal(slash.parse('/').known, false);
  assert.equal(slash.parse('/goal tests pass').name, 'goal');
});
