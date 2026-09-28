'use strict';

const fs = require('node:fs');
const file = 'scripts/apply-phase2-final-polish.cjs';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const pattern = /assert\.match\(panel, \/intent [^\n]+debounceMs : 30000\/\);/g;
const matches = source.match(pattern) || [];
if (matches.length !== 1) throw new Error(`Expected one debounce assertion generator, found ${matches.length}.`);
source = source.replace(pattern, "assert.ok(panel.includes('intent ? intent.debounceMs : 30000'));");
fs.writeFileSync(file, source, 'utf8');
