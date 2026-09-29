'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { groupConversation, summarize } = require('../src/renderer/action-groups.js');

const tool = (id, status = 'completed', kind = 'command') => ({ id, role: 'tool', kind, status, text: id });
const assistant = id => ({ id, role: 'assistant', status: 'completed', text: id });
const user = id => ({ id, role: 'user', status: 'completed', text: id });

test('groups consecutive calls and gives single tools the same compact presentation', () => {
  const messages = [
    user('u1'),
    tool('t1'),
    tool('t2', 'running', 'file'),
    assistant('a1'),
    tool('t3'),
    assistant('a2'),
  ];
  const units = groupConversation(messages);
  assert.equal(units.length, 5);
  assert.equal(units[0].type, 'message');
  assert.equal(units[1].type, 'actions');
  assert.deepEqual(units[1].tools.map(item => item.message.id), ['t1', 't2']);
  assert.equal(units[1].key, 't1');
  assert.equal(units[2].message.id, 'a1');
  assert.equal(units[3].type, 'actions');
  assert.equal(units[3].tools[0].message.id, 't3');
});

test('assistant and user messages split action groups', () => {
  const units = groupConversation([
    tool('t1'), tool('t2'), assistant('a1'), tool('t3'), tool('t4'), user('u1'), tool('t5'), tool('t6'),
  ]);
  const groups = units.filter(unit => unit.type === 'actions');
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(group => group.tools.map(item => item.message.id)), [
    ['t1', 't2'], ['t3', 't4'], ['t5', 't6'],
  ]);
});

test('summary exposes running and failures without expanding details', () => {
  assert.deepEqual(summarize([
    tool('a', 'completed'),
    tool('b', 'running'),
    tool('c', 'failed'),
  ]), {
    count: 3,
    running: 1,
    failed: 1,
    completed: 1,
    status: '1 running · 1 failed',
    label: '3 actions',
  });
  assert.equal(summarize([tool('a'), tool('b')]).status, 'Completed');
});

test('progress between calls stays in order inside the group; trailing progress and final answers remain visible', () => {
  const progress = { ...assistant('progress'), phase: 'commentary' };
  const reasoning = { ...assistant('reasoning'), kind: 'reasoning', phase: 'analysis' };
  const tail = { ...assistant('tail'), phase: 'commentary' };
  const units = groupConversation([user('u'), tool('t1'), progress, reasoning, tool('t2'), tail, assistant('final')]);
  assert.deepEqual(units[1].entries.map(item => item.message.id), ['t1', 'progress', 'reasoning', 't2']);
  assert.deepEqual(units[1].tools.map(item => item.message.id), ['t1', 't2']);
  assert.deepEqual(units.slice(2).map(item => item.message.id), ['tail', 'final']);
  assert.equal(groupConversation([tool('t1')])[0].key, units[1].key);
});

test('renderer loads action grouping helper before app code', () => {
  const html = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const helper = html.indexOf('./action-groups.js');
  const app = html.indexOf('./app.js');
  assert.ok(helper >= 0);
  assert.ok(app >= 0);
  assert.ok(helper < app);
});
