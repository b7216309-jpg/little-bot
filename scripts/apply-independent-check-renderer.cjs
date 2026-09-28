'use strict';

const fs = require('node:fs');

function replaceOnce(file, before, after, label) {
  const source = fs.readFileSync(file, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}

replaceOnce('src/renderer/app.js', `  const eligible = message.role === 'assistant' && !['reasoning', 'compaction'].includes(message.kind)\n    && !['running', 'waiting', 'failed', 'interrupted', 'inProgress'].includes(message.status)\n    && Boolean(String(message.text || '').trim());`, `  const eligible = window.LittleBotIndependentCheck.eligible(message);`, 'renderer eligibility');

replaceOnce('src/renderer/index.html', `  <script src="./slash-commands.js" defer></script>\n  <script src="./app.js" defer></script>`, `  <script src="./slash-commands.js" defer></script>\n  <script src="./independent-check.js" defer></script>\n  <script src="./app.js" defer></script>`, 'renderer helper script');

const testFile = 'test/independent-check-renderer.test.cjs';
const test = fs.readFileSync(testFile, 'utf8');
const addition = `\n\ntest('the renderer loads and uses the eligibility helper', () => {\n  const fs = require('node:fs');\n  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');\n  const app = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');\n  assert.match(html, /independent-check\\.js[^>]*defer/);\n  assert.ok(html.indexOf('independent-check.js') < html.indexOf('app.js'));\n  assert.match(app, /LittleBotIndependentCheck\\.eligible\\(message\\)/);\n});\n`;
if (!test.includes("test('the renderer loads and uses the eligibility helper'")) fs.writeFileSync(testFile, test.trimEnd() + addition, 'utf8');
