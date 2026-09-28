'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, 'apply-phase3-ledger-hardening.cjs');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
const marker = "\nfs.writeFileSync('test/goal-ledger-lifecycle.test.cjs'";
const index = source.indexOf(marker);
if (index < 0) throw new Error('Could not isolate the Phase 3 hardening patch.');
const temporary = path.join(__dirname, '.phase3-ledger-hardening-runtime.cjs');
try {
  fs.writeFileSync(temporary, source.slice(0, index) + '\n', 'utf8');
  require(temporary);
} finally {
  fs.rmSync(temporary, { force: true });
}
