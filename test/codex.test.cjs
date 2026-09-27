'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CodexClient } = require('../src/codex.cjs');

const mockServer = String.raw`
  const readline = require('node:readline');
  const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
  let initialized = false;
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') return send({ id: msg.id, result: { userAgent: 'mock' } });
    if (msg.method === 'initialized') { initialized = true; return; }
    if (msg.method === 'echo') return send({ id: msg.id, result: { ...msg.params, initialized, home: process.env.CODEX_HOME, electronNode: process.env.ELECTRON_RUN_AS_NODE } });
    if (msg.method === 'wait') return setTimeout(() => send({ id: msg.id, result: msg.params }), msg.params.delay);
    if (msg.method === 'ignore') return;
    if (msg.method === 'events') {
      send({ method: 'item/agentMessage/delta', params: { delta: 'Hello 👋' } });
      send({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { command: 'pwd' } });
      send({ id: msg.id, result: {} }); return;
    }
    if (msg.method === 'unsupported') { send({ id: 'unknown-1', method: 'unsupported/action', params: {} }); send({ id: msg.id, result: {} }); return; }
    if (msg.id === 'approval-1' || msg.id === 'unknown-1') return send({ method: 'mock/response', params: msg });
    if (msg.method === 'fragmented') {
      const output = Buffer.from(JSON.stringify({ id: msg.id, result: { text: 'café 👋' } }) + '\n');
      let position = 0;
      const tick = () => { if (position < output.length) { process.stdout.write(output.subarray(position, ++position)); setImmediate(tick); } };
      tick(); return;
    }
    if (msg.method === 'diagnostic') {
      const secret = msg.params.apiKey;
      process.stderr.write('Authorization: Bear');
      setTimeout(() => {
        process.stderr.write('er ' + secret + '\napiKey="' + secret + '"\nhttps://example.test?code=private-code&state=private-state\n');
        process.stderr.write('x'.repeat(20000) + '\n');
        for (let i = 0; i < 20; i++) process.stderr.write('normal diagnostic '.repeat(150) + '\n');
        setTimeout(() => send({ id: msg.id, result: {} }), 30);
      }, 10); return;
    }
    if (msg.method === 'fail') return send({ id: msg.id, error: { code: -32000, message: 'apiKey="' + msg.params.apiKey + '" was rejected' } });
    if (msg.method === 'malformed') return process.stdout.write('{not-json}\n');
    if (msg.method === 'oversize') return process.stdout.write('x'.repeat(8 * 1024 * 1024 + 1));
    if (msg.method === 'exit') return process.exit(7);
    send({ id: msg.id, result: {} });
  });
  rl.on('close', () => process.exit(0));
`;

async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-codex-'));
  const client = new CodexClient({ homeDir: path.join(root, 'isolated-home'), cwd: root, command: process.execPath, args: ['-e', mockServer], ...options });
  const crashes = [];
  client.on('crash', (error) => crashes.push(error));
  t.after(async () => { await client.close(); await rm(root, { recursive: true, force: true }); });
  return { client, root, crashes };
}

test('startup is shared and requests wait for the handshake in an isolated home', async (t) => {
  const { client, root } = await setup(t, { env: { CODEX_HOME: 'must-be-overridden', ELECTRON_RUN_AS_NODE: '0' } });
  const first = client.start();
  assert.equal(client.start(), first);
  const result = await client.request('echo', { value: 42 });
  assert.equal(result.initialized, true);
  assert.equal(result.value, 42);
  assert.equal(result.home, path.join(root, 'isolated-home'));
  assert.equal(result.electronNode, '1');
  assert.equal(client.ready, true);
});

test('out-of-order responses retain correlation; timeout and late reply do not poison the stream', async (t) => {
  const { client } = await setup(t);
  await client.start();
  const slow = client.request('wait', { delay: 60, name: 'slow' });
  const fast = client.request('wait', { delay: 5, name: 'fast' });
  assert.equal((await fast).name, 'fast');
  assert.equal((await slow).name, 'slow');
  await assert.rejects(client.request('wait', { delay: 30 }, 5), /timed out/);
  await client.request('wait', { delay: 50 });
  assert.equal((await client.request('echo', { value: 'alive' })).value, 'alive');
});

test('streamed UTF-8, notification routing, server approvals, and unsupported requests', async (t) => {
  const { client } = await setup(t);
  await client.start();
  assert.equal((await client.request('fragmented')).text, 'café 👋');
  const notice = once(client, 'notification');
  const approval = once(client, 'request');
  await client.request('events');
  assert.deepEqual(await notice, ['item/agentMessage/delta', { delta: 'Hello 👋' }]);
  const [request] = await approval;
  assert.equal(request.id, 'approval-1');
  const accepted = once(client, 'notification');
  await client.respond(request.id, { decision: 'decline' });
  assert.deepEqual((await accepted)[1], { id: 'approval-1', result: { decision: 'decline' } });
  await assert.rejects(client.respond(request.id, {}), /no longer pending/);
  await client.request('unsupported');
  const rejected = once(client, 'notification');
  await client.reject('unknown-1', 'Unsupported action');
  assert.deepEqual((await rejected)[1], { id: 'unknown-1', error: { code: -32601, message: 'Unsupported action' } });
});

test('diagnostics are bounded and secrets are scrubbed across stderr chunks and RPC errors', async (t) => {
  const { client } = await setup(t);
  const lines = [];
  client.on('diagnostics', (line) => lines.push(line));
  const secret = 'test-custom-credential-123456';
  await client.request('diagnostic', { apiKey: secret });
  assert.ok(lines.length > 3);
  const all = lines.join('\n');
  for (const privateValue of [secret, 'private-code', 'private-state']) assert.equal(all.includes(privateValue), false);
  assert.ok(all.includes('[REDACTED]'));
  assert.ok(all.includes('Oversized diagnostic line omitted'));
  assert.ok(client.diagnostics.length <= 16384);
  assert.ok(lines.every((line) => line.length <= 2048));
  await assert.rejects(client.request('fail', { apiKey: secret }), (error) => error.code === -32000 && !error.message.includes(secret));
});

for (const method of ['malformed', 'oversize', 'exit']) {
  test(`${method} fails pending work once and closes the transport`, async (t) => {
    const { client, crashes } = await setup(t);
    await client.start();
    const pending = client.request('ignore');
    const assertPending = assert.rejects(pending, /Codex/);
    await assert.rejects(client.request(method), /Codex/);
    await assertPending;
    await client.close();
    assert.equal(crashes.length, 1);
    assert.equal(client.ready, false);
    await assert.rejects(client.request('echo'), /Codex/);
  });
}

test('spawn failures reject startup and requests without an unhandled child error', async (t) => {
  const { client, crashes } = await setup(t, { command: path.join(os.tmpdir(), 'missing-little-bot-executable-1234') });
  await assert.rejects(client.start(), /Could not start Codex/);
  assert.equal(crashes.length, 1);
  await assert.rejects(client.request('echo'), /Could not start Codex/);
});

test('intentional shutdown rejects pending work and is idempotent without a crash', async (t) => {
  const { client, crashes } = await setup(t);
  await client.start();
  const pending = assert.rejects(client.request('ignore'), /closed/);
  const close = client.close();
  assert.equal(client.close(), close);
  await close;
  await pending;
  assert.equal(crashes.length, 0);
  assert.equal(client.state, 'closed');
});

test('oversized outgoing input is rejected without damaging the connection', async (t) => {
  const { client } = await setup(t);
  await assert.rejects(client.request('echo', { text: 'x'.repeat(8 * 1024 * 1024) }), /size limit/);
  assert.equal((await client.request('echo', { value: 'still-alive' })).value, 'still-alive');
});
