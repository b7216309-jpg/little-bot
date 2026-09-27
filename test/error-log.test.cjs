'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, readFile, stat } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { ErrorLog, redact, sanitizeMetadata } = require('../src/error-log.cjs');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-error-log-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('redaction removes common credentials and secret query parameters', () => {
  const source = [
    'sk-supersecret_123456789',
    'Bearer eyJ.private.token',
    'api_key=my-private-key',
    'access_token=token-secret',
    'https://example.test/?token=url-secret&ok=1',
  ].join(' ');
  const clean = redact(source);
  for (const secret of ['supersecret', 'eyJ.private.token', 'my-private-key', 'token-secret', 'url-secret']) {
    assert.equal(clean.includes(secret), false, secret);
  }
  assert.match(clean, /\[redacted\]/);
});

test('metadata omits prompt-like payloads and redacts nested secrets', () => {
  const result = sanitizeMetadata({
    method: 'turn/start',
    prompt: 'private conversation',
    nested: { api_key: 'secret-value', count: 3 },
    input: [{ text: 'private input' }],
  });
  assert.equal(result.prompt, '[omitted]');
  assert.equal(result.input, '[omitted]');
  assert.equal(JSON.stringify(result).includes('private conversation'), false);
  assert.equal(JSON.stringify(result).includes('private input'), false);
  assert.equal(JSON.stringify(result).includes('secret-value'), false);
  assert.equal(result.nested.count, 3);
});

test('capture writes bounded JSONL without retaining secrets', async t => {
  const root = await fixture(t);
  const logger = new ErrorLog({ root, appVersion: 'test-version' });
  const error = new Error('Provider failed with sk-private-key-123456 and api_key=another-secret');
  error.stack = 'Error: Bearer bearer-private-token\n    at secret-file.js:1:1';
  const entry = logger.capture('engine-crash', error, {
    status: 500,
    url: 'https://service.test/path?token=query-secret',
    body: 'conversation payload',
  });
  assert.ok(entry);

  const raw = await readFile(logger.filePath, 'utf8');
  const parsed = JSON.parse(raw.trim());
  assert.equal(parsed.source, 'engine-crash');
  assert.equal(parsed.appVersion, 'test-version');
  assert.equal(parsed.metadata.status, 500);
  assert.equal(parsed.metadata.body, '[omitted]');
  for (const secret of ['private-key', 'another-secret', 'bearer-private-token', 'query-secret', 'conversation payload']) {
    assert.equal(raw.includes(secret), false, secret);
  }
});

test('log rotation bounds the active file and preserves recent backups', async t => {
  const root = await fixture(t);
  const logger = new ErrorLog({ root, maxBytes: 1024, backups: 2 });
  for (let index = 0; index < 20; index++) {
    logger.capture('rotation-test', new Error(`failure-${index} ${'x'.repeat(180)}`), { index });
  }
  const active = await stat(logger.filePath);
  const backup = await stat(`${logger.filePath}.1`);
  assert.ok(active.size <= 1400, `active log unexpectedly large: ${active.size}`);
  assert.ok(backup.size > 0);
});


test('controller forwards engine crashes to the diagnostic logger callback', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-error-log-controller-'));
  const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
  const client = new EventEmitter();
  client.close = async () => {};
  const events = [];
  const controller = new Controller({
    store,
    client,
    onError: (source, error, metadata) => events.push({ source, message: error?.message, metadata }),
  });
  t.after(async () => {
    await controller.close();
    await rm(root, { recursive: true, force: true });
  });

  client.emit('crash', new Error('engine exploded'));
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'engine-crash');
  assert.equal(events[0].message, 'engine exploded');
  assert.equal(controller.state().runtime.status, 'error');
});
