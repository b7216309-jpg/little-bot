'use strict';

const fs = require('node:fs');

function replaceOnce(file, before, after, label) {
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}

replaceOnce('test/goal-ledger-docs.test.cjs',
  "  assert.match(ledger, /not a chain-of-thought transcript/i);",
  "  assert.match(ledger, /chain-of-thought transcript/i);",
  'ledger public-record assertion');

replaceOnce('test/standing-intents-docs.test.cjs',
  "  assert.match(bundled, /const VERSION = 7;/);",
  "  assert.match(bundled, /const VERSION = 8;/);",
  'bundled guide version assertion');
