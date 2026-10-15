'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseModelJson, normalizeModelOutput } = require('../src/model-json.cjs');
const parseLocal = (text, message) => parseModelJson(text, message, { local: true });

test('small-model JSON is recovered from reasoning, fences, prose and a cut-off ending', () => {
  assert.deepEqual(parseLocal('<think>hmm</think>```json\n{"memories":[]}\n```'), { memories: [] });
  assert.deepEqual(parseLocal('Here it is: {"a":1} done'), { a: 1 });
  // Seen from the local model: the final brace never arrives.
  assert.deepEqual(parseLocal('{"memories":[{"text":"Likes emoji","key":"a}b"}]'), { memories: [{ text: 'Likes emoji', key: 'a}b' }] });
  assert.deepEqual(parseLocal('{"a":[1,2,'), { a: [1, 2] });
  assert.deepEqual(parseLocal('{"a":{"b":"x\\"y"'), { a: { b: 'x"y' } });
  assert.deepEqual(parseLocal("Result: {'status':'ALERT','summary':'Done', 'topic':'build',}"), { status: 'ALERT', summary: 'Done', topic: 'build' });
  assert.deepEqual(parseLocal("{'summary':'I don't know',"), { summary: "I don't know" });
  // A value cut off mid-string is never completed into a made-up memory.
  assert.throws(() => parseLocal('{"a":"unterminated', 'unreadable'), /unreadable/);
  assert.throws(() => parseLocal('no json here', 'unreadable'), /unreadable/);
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.throws(() => parseModelJson("Result: {'a':1}", 'unreadable'), /unreadable/);
});

test('shared model output repair applies aliases and small type corrections against a schema', () => {
  const schema = { type: 'object', properties: { status: { type: 'string', enum: ['quiet', 'alert'] }, summary: { type: 'string' }, met: { type: 'boolean' }, memories: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, type: { type: 'string', enum: ['fact', 'preference'] } } } } } };
  assert.deepEqual(normalizeModelOutput({ state: 'ALERT', message: 4, complete: 'yes', memories: { content: 'Likes tea', category: 'Preference' } }, schema), {
    state: 'ALERT', message: 4, complete: 'yes', memories: [{ content: 'Likes tea', category: 'Preference', text: 'Likes tea', type: 'preference' }],
    status: 'alert', summary: '4', met: true,
  });
});
