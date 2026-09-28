'use strict';

const fs = require('node:fs');
const file = 'scripts/apply-phase2-intent-tracing.cjs';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const anchor = `const runtimeTestFile = 'test/event-runtime.test.cjs';\nconst runtimeTest = read(runtimeTestFile);`;
const replacement = `const runtimeTestFile = 'test/event-runtime.test.cjs';\nreplaceOnce(runtimeTestFile,\n  \`  return { runtime, bus, store, goalsData, calls, advance, now: () => now, intervalHandlers };\`,\n  \`  return { runtime, bus, store, goalsData, scheduler, calls, advance, now: () => now, intervalHandlers };\`,\n  'event runtime scheduler fixture');\nconst runtimeTest = read(runtimeTestFile);`;
const count = source.split(anchor).length - 1;
if (count !== 1) throw new Error(`Expected one runtime-test anchor, found ${count}.`);
source = source.replace(anchor, replacement);
fs.writeFileSync(file, source, 'utf8');
