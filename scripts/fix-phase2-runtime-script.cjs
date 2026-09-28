'use strict';

const fs = require('node:fs');
const file = 'scripts/apply-phase2-runtime-integration.cjs';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const helper = `function replaceFirst(file, before, after, label) {\n  const source = read(file);\n  if (!source.includes(before)) throw new Error(\`${'${label}'}: anchor not found.\`);\n  write(file, source.replace(before, after));\n}\n`;
const helperAnchor = `function replaceOnce(file, before, after, label) {\n  const source = read(file);\n  const count = source.split(before).length - 1;\n  if (count !== 1) throw new Error(\`${'${label}'}: expected one anchor, found ${'${count}'}.\`);\n  write(file, source.replace(before, after));\n}\n`;
if (!source.includes('function replaceFirst(')) {
  if (!source.includes(helperAnchor)) throw new Error('replaceOnce helper anchor not found.');
  source = source.replace(helperAnchor, `${helperAnchor}${helper}`);
}
const ambiguous = `replaceOnce('src/main.cjs',\n  \`    onChange: () => controller.changed(),\\n    onAlert: item => {\`,`;
const narrowed = `replaceFirst('src/main.cjs',\n  \`    onChange: () => controller.changed(),\\n    onAlert: item => {\`,`;
if (!source.includes(narrowed)) {
  const count = source.split(ambiguous).length - 1;
  if (count !== 1) throw new Error(`Heartbeat publish call anchor count: ${count}.`);
  source = source.replace(ambiguous, narrowed);
}
fs.writeFileSync(file, source, 'utf8');
