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
