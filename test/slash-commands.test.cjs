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
