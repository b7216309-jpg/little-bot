'use strict';
// The real bundled engine talks only to this ephemeral HTTP fixture, never Strata.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CodexClient } = require(process.env.LITTLE_BOT_TEST_ENGINE_MODULE || '../src/codex.cjs');
const { responsesToChat, StrataStreamAdapter } = require('../src/strata-responses-adapter.cjs');

test('bundled engine receives structured output and reports a token cutoff as failure with partial text', { timeout: 45000 }, async t => {
  // Keep native-engine files outside AppData/Temp MSIX virtualization on Windows.
  const root = fs.mkdtempSync(path.resolve(__dirname, '..', '..', 'engine-reliability-'));
  const client = new CodexClient({ homeDir: path.join(root, 'engine'), cwd: root });
  if (process.platform === 'win32') assert(client.command.startsWith('\\\\?\\'), 'Windows engine launch must support long package paths.');
  const requests = [], completed = [], messages = [], errors = [];
  client.on('notification', (method, params) => {
    if (method === 'turn/completed') completed.push(params.turn);
    if (method === 'item/completed' && params.item?.type === 'agentMessage') messages.push(params.item.text);
    if (method === 'error') errors.push(params.error?.message || JSON.stringify(params));
  });
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.url !== '/v1/responses') { res.writeHead(404); res.end(); return; }
    const body = JSON.parse(raw); requests.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const adapter = new StrataStreamAdapter(); adapter.pipe(res);
    const first = requests.length === 1;
    const chunk = { id: 'fixture', model: 'local-fixture', choices: [{ index: 0,
      delta: { content: first ? '{"uniqueSchemaField":"valid"}' : 'Partial useful answer before the limit.' }, finish_reason: null }] };
    adapter.write('data: ' + JSON.stringify(chunk) + '\n\n');
    chunk.choices[0] = { index: 0, delta: {}, finish_reason: first ? 'stop' : 'length' };
    chunk.usage = { prompt_tokens: 25, completion_tokens: 9, total_tokens: 34 };
    adapter.end('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await client.close(); await new Promise(resolve => server.close(resolve));
    console.log('Engine fixture closed: ' + root);
  });
  await client.start();
  const started = await client.request('thread/start', {
    cwd: root, model: 'local-fixture', ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', config: {
      model_provider: 'fixture', 'model_providers.fixture': { name: 'Isolated fixture', base_url: `http://127.0.0.1:${server.address().port}/v1`,
        wire_api: 'responses', requires_openai_auth: false, supports_websockets: false, request_max_retries: 0, stream_max_retries: 0 },
      'features.apps': false, 'features.plugins': false, 'features.shell_tool': false, 'features.unified_exec': false,
      'features.js_repl': false, 'features.code_mode': false, 'features.multi_agent': false, web_search: 'disabled',
    },
  });
  const waitTurn = async count => {
    const deadline = Date.now() + 15000;
    while (completed.length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(completed.length, count, 'Real engine must terminate the turn.');
  };
  const schema = { type: 'object', properties: { uniqueSchemaField: { type: 'string' } }, required: ['uniqueSchemaField'], additionalProperties: false };
  await client.request('turn/start', { threadId: started.thread.id, cwd: root, model: 'local-fixture',
    input: [{ type: 'text', text: 'Return the requested JSON.' }], approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' }, outputSchema: schema });
  await waitTurn(1);
  assert.equal(completed[0].status, 'completed');
  assert.equal(requests[0].text.format.type, 'json_schema');
  const translated = responsesToChat(requests[0]).body;
  assert.deepEqual(translated.response_format.json_schema.schema, schema);
  assert(translated.messages.some(message => message.content.includes(JSON.stringify(schema))));
  assert(messages.includes('{"uniqueSchemaField":"valid"}'));
  await client.request('turn/start', { threadId: started.thread.id, cwd: root, model: 'local-fixture',
    input: [{ type: 'text', text: 'Answer this new request.' }], approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } });
  await waitTurn(2);
  assert.equal(completed[1].status, 'failed');
  assert.match(JSON.stringify({ turn: completed[1], errors }), /output token limit/);
  assert(messages.includes('Partial useful answer before the limit.'));
  assert.equal(requests.length, 2, 'Cutoff must not trigger a hidden retry.');
});
