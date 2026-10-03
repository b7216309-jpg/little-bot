'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { localStamp, timeContext, utcOffset } = require('../src/local-time.cjs');

test('times given to the model are local wall-clock time, never raw UTC stamps', () => {
  const at = new Date(2026, 9, 3, 0, 40).getTime(); // local 00:40, which is the previous evening in UTC east of Greenwich
  assert.equal(localStamp(at), 'Sat 2026-10-03 00:40');
  const line = timeContext(at);
  assert.match(line, /^Current local time: Saturday,? 3 October 2026, 00:40 \(.*UTC[+-]\d\d:\d\d\)\./);
  assert.ok(line.includes(utcOffset(at)));
  assert.doesNotMatch(line, /\d{4}-\d\d-\d\dT\d\d:\d\d/, 'no ISO timestamp a small model could misread');
  assert.equal(localStamp(undefined), '');
});
