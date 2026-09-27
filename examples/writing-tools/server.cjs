'use strict';
// Minimal local MCP example: it handles supplied text and never opens files or the network.
const readline = require('node:readline');
const MAX_LINE = 200000;
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const tool = { name: 'text_stats', description: 'Count characters, words, and lines in supplied text. Does not read or change files.',
  inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 100000 } }, required: ['text'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } };
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  if (line.length > MAX_LINE) { input.close(); process.exitCode = 1; return; }
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.id == null) return;
  const result = value => send({ jsonrpc: '2.0', id: request.id, result: value });
  if (request.method === 'initialize') result({ protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'little-bot-writing-tools', version: '1.0.0' } });
  else if (request.method === 'ping') result({});
  else if (request.method === 'tools/list') result({ tools: [tool] });
  else if (request.method === 'tools/call') {
    const text = request.params?.arguments?.text;
    if (request.params?.name !== 'text_stats' || typeof text !== 'string' || text.length > 100000) {
      result({ isError: true, content: [{ type: 'text', text: 'Provide a text_stats request with a text string of at most 100,000 characters.' }] });
      return;
    }
    result({ content: [{ type: 'text', text: JSON.stringify({ characters: [...text].length, words: (text.match(/\S+/g) || []).length, lines: text ? text.split(/\r\n|\r|\n/).length : 0 }) }] });
  } else if (request.method === 'resources/list') result({ resources: [] });
  else if (request.method === 'resources/templates/list') result({ resourceTemplates: [] });
  else send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not supported.' } });
});
