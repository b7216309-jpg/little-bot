'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { LocalModelRelay } = require('../src/local-model-relay.cjs');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const data = Buffer.from(JSON.stringify(body));
    const request = http.request(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(data.length),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    request.end(data);
  });
}

test('relay flattens namespace tools for llama and restores namespace in streamed calls', async t => {
  let received;
  const upstream = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const alias = received.tools.find(tool => tool.name !== 'plain_tool').name;
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      const events = [
        {
          type: 'response.output_item.added',
          item: { id: 'fc_1', type: 'function_call', name: alias, arguments: '', call_id: 'call_1', status: 'in_progress' },
        },
        {
          type: 'response.reasoning_text.delta',
          item_id: 'rs_1',
          delta: 'checking',
        },
        {
          type: 'response.output_item.done',
          item: { id: 'fc_1', type: 'function_call', name: alias, arguments: '{"title":"demo"}', call_id: 'call_1', status: 'completed' },
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_1',
            object: 'response',
            status: 'completed',
            output: [
              { id: 'fc_1', type: 'function_call', name: alias, arguments: '{"title":"demo"}', call_id: 'call_1', status: 'completed' },
            ],
          },
        },
      ];
      for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end();
    });
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const relay = new LocalModelRelay({ thinking: () => false });
  await relay.start();
  t.after(() => relay.close());

  const endpoint = relay.endpoint(`http://127.0.0.1:${upstreamPort}/v1`);
  const body = {
    model: 'qwen3.6-test',
    stream: true,
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Create a demo event' }] },
      {
        type: 'function_call',
        namespace: 'mcp__codex_apps__calendar',
        name: 'create_event',
        arguments: '{"title":"old"}',
        call_id: 'call_old',
      },
    ],
    tools: [
      { type: 'function', name: 'plain_tool', description: 'Plain', strict: false, parameters: { type: 'object', properties: {} } },
      {
        type: 'namespace',
        name: 'mcp__codex_apps__calendar',
        description: 'Calendar actions',
        tools: [
          {
            type: 'function',
            name: 'create_event',
            description: 'Create an event',
            strict: false,
            defer_loading: true,
            parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
          },
        ],
      },
    ],
  };

  const result = await postJson(`${endpoint}/responses`, body);
  assert.equal(result.status, 200);
  assert.ok(received);
  assert.equal(received.tools.some(tool => tool.type === 'namespace'), false);
  assert.equal(received.tools.length, 2);
  const flattened = received.tools.find(tool => tool.name !== 'plain_tool');
  assert.equal(flattened.type, 'function');
  assert.notEqual(flattened.name, 'create_event');
  assert.equal(Object.hasOwn(flattened, 'defer_loading'), false);
  assert.match(flattened.description, /Calendar actions/);
  assert.equal(received.input[1].name, flattened.name);
  assert.equal(Object.hasOwn(received.input[1], 'namespace'), false);

  const events = result.text.split(/\r?\n/).filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
  const added = events.find(event => event.type === 'response.output_item.added');
  const reasoning = events.find(event => event.type === 'response.reasoning_text.delta');
  const done = events.find(event => event.type === 'response.output_item.done');
  const completed = events.find(event => event.type === 'response.completed');

  for (const item of [added.item, done.item, completed.response.output[0]]) {
    assert.equal(item.name, 'create_event');
    assert.equal(item.namespace, 'mcp__codex_apps__calendar');
  }
  assert.equal(reasoning.content_index, 0);
});
