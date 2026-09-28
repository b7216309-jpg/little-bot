'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { LocalModelRelay } = require('../src/local-model-relay.cjs');

function jsonResponse(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(data.length) });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
}

function responseEvents(text) {
  return text.split(/\r?\n/).filter(line => line.startsWith('data: '))
    .map(line => line.slice(6)).filter(data => data !== '[DONE]').map(data => JSON.parse(data));
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test('Strata adapter translates Responses streaming to Chat Completions without touching the native path', async t => {
  const model = 'qwen3.8-flash-next-iq2_xs';
  const upstreamRequests = [];
  const upstream = await listen(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return jsonResponse(res, 404, { error: 'wrong path' });
    const body = await readJson(req);
    upstreamRequests.push({ url: req.url, body });
    const wantsTool = body.messages.some(message => typeof message.content === 'string' && message.content.includes('call tool'));
    if (wantsTool) {
      const toolName = body.tools[0].function.name;
      return sse(res, [
        { id: 'chat-tool', model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
        { id: 'chat-tool', model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: toolName, arguments: '' } }] }, finish_reason: null }] },
        { id: 'chat-tool', model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"notes.txt"}' } }] }, finish_reason: null }] },
        { id: 'chat-tool', model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 25, completion_tokens: 7, total_tokens: 32 } },
      ]);
    }
    sse(res, [
      { id: 'chat-text', model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
      { id: 'chat-text', model, choices: [{ index: 0, delta: { reasoning_content: 'thinking ' }, finish_reason: null }] },
      { id: 'chat-text', model, choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }] },
      { id: 'chat-text', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 9, total_tokens: 20 } },
    ]);
  });
  t.after(upstream.close);

  const relay = new LocalModelRelay({ thinking: () => false });
  await relay.start();
  t.after(() => relay.close());
  const endpoint = relay.endpoint(upstream.baseUrl, 'strata');

  const textResponse = await fetch(`${endpoint}/responses`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      model, instructions: 'be useful', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
    }),
  });
  assert.equal(textResponse.status, 200);
  const textEvents = responseEvents(await textResponse.text());
  assert.equal(upstreamRequests[0].url, '/v1/chat/completions');
  assert.equal(upstreamRequests[0].body.stream, true);
  assert.equal(upstreamRequests[0].body.chat_template_kwargs.enable_thinking, false);
  assert.equal(upstreamRequests[0].body.messages[0].role, 'developer');
  assert.equal(textEvents.find(event => event.type === 'response.reasoning_text.delta').content_index, 0);
  assert.equal(textEvents.find(event => event.type === 'response.output_text.delta').delta, 'hello');
  assert.equal(textEvents.find(event => event.type === 'response.completed').response.usage.total_tokens, 20);

  const toolResponse = await fetch(`${endpoint}/responses`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      model,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'call tool' }] }],
      tools: [{ type: 'namespace', name: 'files', description: 'Files', tools: [{
        type: 'function', name: 'read', description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      }] }],
    }),
  });
  assert.equal(toolResponse.status, 200);
  const toolEvents = responseEvents(await toolResponse.text());
  assert.match(upstreamRequests[1].body.tools[0].function.name, /^files__read/);
  const toolDone = toolEvents.find(event => event.type === 'response.output_item.done' && event.item?.type === 'function_call');
  assert.equal(toolDone.item.namespace, 'files');
  assert.equal(toolDone.item.name, 'read');
  assert.equal(toolDone.item.arguments, '{"path":"notes.txt"}');

  const beforeCount = upstreamRequests.length;
  const countResponse = await fetch(`${endpoint}/responses/input_tokens`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: 'count me' }),
  });
  assert.equal(countResponse.status, 200);
  const count = await countResponse.json();
  assert.equal(count.object, 'response.input_tokens');
  assert.ok(count.input_tokens > 0);
  assert.equal(upstreamRequests.length, beforeCount);
});
