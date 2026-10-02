'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseModelJson } = require('../src/model-json.cjs');

test('small-model JSON is recovered from reasoning, fences, prose and a cut-off ending', () => {
  assert.deepEqual(parseModelJson('<think>hmm</think>```json\n{"memories":[]}\n```'), { memories: [] });
  assert.deepEqual(parseModelJson('Here it is: {"a":1} done'), { a: 1 });
  // Seen from the local model: the final brace never arrives.
  assert.deepEqual(parseModelJson('{"memories":[{"text":"Likes emoji","key":"a}b"}]'), { memories: [{ text: 'Likes emoji', key: 'a}b' }] });
  assert.deepEqual(parseModelJson('{"a":[1,2,'), { a: [1, 2] });
  assert.deepEqual(parseModelJson('{"a":{"b":"x\\"y"'), { a: { b: 'x"y' } });
  // A value cut off mid-string is never completed into a made-up memory.
  assert.throws(() => parseModelJson('{"a":"unterminated', 'unreadable'), /unreadable/);
  assert.throws(() => parseModelJson('no json here', 'unreadable'), /unreadable/);
});
