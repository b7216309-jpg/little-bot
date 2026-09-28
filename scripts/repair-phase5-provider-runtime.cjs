'use strict';

const fs = require('node:fs');
const file = 'scripts/apply-phase5-provider-runtime.cjs';
const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const before = `  assert.match(read('src/provider-usage.cjs'), /account\\/rateLimits\\/read/);`;
const after = `  assert.ok(read('src/provider-usage.cjs').includes('account/rateLimits/read'));`;
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`runtime assertion repair: expected one anchor, found ${count}.`);
fs.writeFileSync(file, source.replace(before, after), 'utf8');
