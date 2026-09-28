'use strict';

const fs = require('node:fs');

function replaceOnce(file, before, after, label) {
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}

replaceOnce('src/controller.cjs',
  `    chat.messages.push({ id: messageId, role: 'assistant', text: input.question, status: 'waiting', createdAt: Date.now() });`,
  `    chat.messages.push({ id: messageId, role: 'assistant', kind: 'question', text: input.question, status: 'waiting', createdAt: Date.now() });`,
  'structured question kind');

replaceOnce('src/independent-check.cjs',
  `  return message && message.role === 'assistant' && !['reasoning', 'compaction'].includes(message.kind)\n    && !['analysis', 'commentary'].includes(message.phase)`,
  `  return message && message.role === 'assistant' && !['reasoning', 'compaction', 'question'].includes(message.kind)\n    && !['analysis', 'commentary', 'internal'].includes(message.phase)`,
  'host answer eligibility');

replaceOnce('src/renderer/independent-check.js',
  `      && !['reasoning', 'compaction'].includes(message.kind)`,
  `      && !['reasoning', 'compaction', 'question'].includes(message.kind)`,
  'renderer question eligibility');

replaceOnce('src/renderer/app.js',
  `  if (record?.assessment === 'preference') return 'Independent check: preference';\n  return 'Independent check: mixed';`,
  `  if (record?.assessment === 'preference') return 'Independent check: preference';\n  if (record?.assessment === 'not_applicable') return 'Independent check: no material claim';\n  return 'Independent check: mixed';`,
  'not-applicable summary');

replaceOnce('README.md',
  `- **Memory:** current conversation, recent work, and explicit saved facts—three layers. Say **Remember that ...** or use the Memory panel. The agent can also search and page through saved conversations, including older or compacted chats, using \`memory_search\` and \`session_read\`.\n- **Goals:** define an objective, completion checks, permissions, and budget. Review the draft, then Run. Checkpoints persist; results are verified. Review undo restores eligible captured files.`,
  `- **Memory:** current conversation, recent work, and explicit saved facts—three layers. Say **Remember that ...** or use the Memory panel. The agent can also search and page through saved conversations, including older or compacted chats, using \`memory_search\` and \`session_read\`.\n- **Independent Check:** optional same-model anti-sycophancy review with Off, Selective, and Always modes plus a manual **Challenge this answer** action. It runs sequentially without tools and keeps the completed draft if review fails or is stopped. See [INDEPENDENT-CHECK.md](INDEPENDENT-CHECK.md).\n- **Goals:** define an objective, completion checks, permissions, and budget. Review the draft, then Run. Checkpoints persist; results are verified. Review undo restores eligible captured files.`,
  'README feature link');

const rendererTestFile = 'test/independent-check-renderer.test.cjs';
let rendererTest = fs.readFileSync(rendererTestFile, 'utf8').replace(/\r\n/g, '\n');
replaceOnce(rendererTestFile,
  `    { role: 'assistant', kind: 'compaction', text: 'Compacted', status: 'completed' },\n    { role: 'assistant', text: 'Streaming', status: 'running' },`,
  `    { role: 'assistant', kind: 'compaction', text: 'Compacted', status: 'completed' },\n    { role: 'assistant', kind: 'question', text: 'Which format?', status: 'completed' },\n    { role: 'assistant', text: 'Streaming', status: 'running' },`,
  'renderer structured question test');

const coreTestFile = 'test/independent-check-core.test.cjs';
const coreTest = fs.readFileSync(coreTestFile, 'utf8').replace(/\r\n/g, '\n');
const coreAddition = `\n\ntest('structured assistant questions are not review targets', () => {\n  const chat = { messages: [\n    { id: 'request', role: 'user', text: 'Prepare the report.', status: 'completed' },\n    { id: 'question', role: 'assistant', kind: 'question', text: 'Which format?', status: 'completed' },\n  ] };\n  assert.equal(collectIndependentCheckContext(chat, { targetMessageId: 'question', messageStart: 0 }), null);\n});\n`;
if (!coreTest.includes("test('structured assistant questions are not review targets'")) {
  fs.writeFileSync(coreTestFile, coreTest.trimEnd() + coreAddition, 'utf8');
}
