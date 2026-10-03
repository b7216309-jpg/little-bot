'use strict';
// The bundled agent engine uses only this mock HTTP server; no model is loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const sourceRoot = process.env.LITTLE_BOT_TEST_SOURCE_ROOT || path.join(__dirname, '..', 'src');
const { CodexClient } = require(path.join(sourceRoot, 'codex.cjs'));
const { Controller } = require(path.join(sourceRoot, 'controller.cjs'));
const { Store } = require(path.join(sourceRoot, 'store.cjs'));

test('bundled engine compacts IQ2 history with IQ3 and continues chat through the Strata relay', { timeout: 45000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-model-compaction-'));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const content = requests.length === 2 ? 'The user said the secret word is violet. Preserve this context.' : 'The secret word is violet.';
    res.end('data: ' + JSON.stringify({ id: 'fixture', model: body.model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })
      + '\n\ndata: ' + JSON.stringify({ id: 'fixture', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 50, completion_tokens: 12, total_tokens: 62 } }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
  Object.assign(store.data.settings, { connection: 'local', localBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    model: 'qwen3.8-flash-next-iq2_xs', localModel: 'qwen3.8-flash-next-iq2_xs' });
  const client = new CodexClient({ homeDir: path.join(root, 'engine'), cwd: root });
  const controller = new Controller({ store, client });
  t.after(async () => {
    await controller.close(); await new Promise(resolve => server.close(resolve));
    // The engine process may still hold files for a moment after close on Windows; a leftover temp folder is not a failure.
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch {}
  });
  await client.start(); await controller.localModelRelay.start();
  controller.runtime = { status: 'ready' }; controller.account = { status: 'connected' };
  controller.connection = { adapter: 'strata', contextWindow: 262144 };
  controller.models = [{ id: 'qwen3.8-flash-next-iq2_xs' }, { id: 'qwen3.8-flash-next-iq3_s' }];
  const { chatId } = await controller.send({ text: 'The secret word is violet.' });
  assert.equal((await controller.waitForChat(chatId)).error, null);
  const chat = controller.chat(chatId), threadId = chat.threadId;
  const transcript = structuredClone(chat.messages);
  Object.assign(store.data.settings, { model: 'qwen3.8-flash-next-iq3_s', localModel: 'qwen3.8-flash-next-iq3_s' });
  await controller.compact({ chatId });
  assert.equal((await controller.waitForChat(chatId)).error, null);
  assert.equal(chat.compaction.count, 1);
  assert.equal(chat.threadId, threadId);
  assert.deepEqual(chat.messages, transcript);
  assert.equal(requests[1].model, 'qwen3.8-flash-next-iq3_s');
  assert.match(JSON.stringify(requests[1].messages), /secret word is violet/);
  await controller.send({ text: 'What was the secret word?' });
  assert.equal((await controller.waitForChat(chatId)).error, null);
  assert.equal(chat.threadId, threadId);
  assert.equal(requests[2].model, 'qwen3.8-flash-next-iq3_s');
  assert.match(JSON.stringify(requests[2].messages), /Preserve this context/);
  assert.equal(requests.length, 3);
});
