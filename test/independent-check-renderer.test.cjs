'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { eligible } = require('../src/renderer/independent-check.js');

test('only completed assistant answers and plans expose Independent Check actions', () => {
  assert.equal(eligible({ role: 'assistant', text: 'Final answer', status: 'completed' }), true);
  assert.equal(eligible({ role: 'assistant', kind: 'plan', text: 'Implementation plan', status: 'completed' }), true);

  for (const message of [
    { role: 'assistant', phase: 'commentary', text: 'Working on it', status: 'completed' },
    { role: 'assistant', phase: 'analysis', text: 'Private reasoning', status: 'completed' },
    { role: 'assistant', kind: 'reasoning', text: 'Reasoning', status: 'completed' },
    { role: 'assistant', kind: 'compaction', text: 'Compacted', status: 'completed' },
    { role: 'assistant', text: 'Streaming', status: 'running' },
    { role: 'tool', text: 'Tool output', status: 'completed' },
    { role: 'user', text: 'User text', status: 'completed' },
    { role: 'assistant', text: '   ', status: 'completed' },
  ]) assert.equal(eligible(message), false, JSON.stringify(message));
});
