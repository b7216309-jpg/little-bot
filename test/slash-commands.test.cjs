'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { commands, parse, helpText } = require('../src/renderer/slash-commands.js');

test('slash command parser recognizes supported commands and arguments', () => {
  assert.deepEqual(parse('/plan'), { known: true, name: 'plan', args: '', command: commands.find(item => item.name === 'plan') });
  const goal = parse('/goal Build a release checklist');
  assert.equal(goal.known, true);
  assert.equal(goal.name, 'goal');
  assert.equal(goal.args, 'Build a release checklist');
  assert.equal(parse('normal chat'), null);
});

test('slash command aliases map to the canonical app command', () => {
  assert.equal(parse('/goals').name, 'goal');
  assert.equal(parse('/automation').name, 'schedule');
  assert.equal(parse('/automations').name, 'schedule');
  assert.equal(parse('/exec').name, 'execute');
  assert.equal(parse('/incognito').name, 'private');
  assert.equal(parse('/inspector').name, 'activity');
  assert.equal(parse('/cal').name, 'calendar');
});

test('unknown slash commands are distinguished from normal chat', () => {
  const unknown = parse('/does-not-exist whatever');
  assert.equal(unknown.known, false);
  assert.equal(unknown.name, 'does-not-exist');
  assert.equal(unknown.args, 'whatever');
});

test('help lists the basic command surface', () => {
  const help = helpText();
  for (const command of ['/help', '/new', '/plan', '/execute', '/private', '/goal [objective]', '/schedule [task]', '/calendar', '/memory', '/activity', '/settings', '/clear']) {
    assert.equal(help.includes(command), true, command);
  }
});
