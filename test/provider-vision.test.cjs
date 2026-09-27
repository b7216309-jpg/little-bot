'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../src/store.cjs');
const { Controller } = require('../src/controller.cjs');
const {
  normalizeModelCapabilities,
  modelSupportsVision,
  probeLocal,
} = require('../src/connections.cjs');

class FakeClient extends EventEmitter {
  constructor(model) {
    super();
    this.model = model;
    this.calls = [];
    this.thread = 0;
    this.turn = 0;
  }
  async start() {}
  async close() {}
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } };
    if (method === 'model/list') return { data: [this.model] };
    if (method === 'thread/start') return { thread: { id: `thread-${++this.thread}` } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'turn/start') return { turn: { id: `turn-${++this.turn}`, status: 'inProgress' } };
    if (method === 'thread/unsubscribe' || method === 'turn/interrupt') return {};
    throw new Error(`Unexpected request: ${method}`);
  }
  async respond() {}
  async reject() {}
}

async function fixture(t, inputModalities) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-vision-'));
  const filePath = path.join(root, 'state.json');
  const model = {
    id: 'catalog-model',
    model: 'vision-test',
    displayName: 'Vision Test',
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
    defaultReasoningEffort: 'low',
    ...(inputModalities === undefined ? {} : { inputModalities }),
  };
  const store = new Store({ filePath, defaultWorkspace: root });
  Object.assign(store.data.settings, {
    connection: 'codex',
    model: 'vision-test',
    codexModel: 'vision-test',
    workspace: root,
    effort: 'low',
  });
  const client = new FakeClient(model);
  const controller = new Controller({ store, client });
  controller.attachments = {
    prepare: async () => ({
      descriptors: [{ id: 'image-1', name: 'photo.png', mime: 'image/png', kind: 'image', size: 10, width: 20, height: 20 }],
      input: [{ type: 'localImage', path: path.join(root, 'photo.png') }],
      text: 'Image attachment metadata.',
    }),
  };
  await controller.start();
  t.after(async () => {
    await controller.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, store, client, controller };
}

test('canonical model inputModalities normalize image support without provider-specific assumptions', () => {
  const vision = normalizeModelCapabilities({ id: 'a', inputModalities: ['text', 'image'] });
  assert.equal(vision.vision, true);
  assert.deepEqual(vision.inputModalities, ['text', 'image']);
  assert.equal(modelSupportsVision(vision), true);

  const textOnly = normalizeModelCapabilities({ id: 'b', inputModalities: ['text'] });
  assert.equal(textOnly.vision, false);
  assert.deepEqual(textOnly.inputModalities, ['text']);
  assert.equal(modelSupportsVision(textOnly), false);

  const unknown = normalizeModelCapabilities({ id: 'c' });
  assert.equal(unknown.vision, null);
  assert.equal(Object.hasOwn(unknown, 'inputModalities'), false);
  assert.equal(modelSupportsVision(unknown), null);

  const localHint = normalizeModelCapabilities({ id: 'd', capabilities: ['completion', 'multimodal'] });
  assert.equal(localHint.vision, true);
  assert.deepEqual(localHint.inputModalities, ['text', 'image']);

  const localOverride = normalizeModelCapabilities(localHint, { vision: false });
  assert.equal(localOverride.vision, false);
  assert.deepEqual(localOverride.inputModalities, ['text']);
});

test('Codex text-only model rejects image input before creating an engine thread', async t => {
  const { controller, client } = await fixture(t, ['text']);
  const stateModel = controller.state().models.find(model => model.id === 'vision-test');
  assert.deepEqual(stateModel, {
    id: 'vision-test',
    displayName: 'Vision Test',
    inputModalities: ['text'],
    vision: false,
  });

  await assert.rejects(
    controller.send({ text: 'Describe this.', attachmentIds: ['image-1'] }),
    /does not support image input/,
  );
  assert.equal(client.calls.some(call => call.method === 'thread/start'), false);
  assert.equal(controller.state().chats.length, 0);
});

test('Codex image-capable model forwards normalized localImage input', async t => {
  const { controller, client } = await fixture(t, ['text', 'image']);
  const { chatId } = await controller.send({ text: 'Describe this.', attachmentIds: ['image-1'] });
  const chat = controller.chat(chatId);
  const turn = client.calls.find(call => call.method === 'turn/start');
  assert.ok(turn);
  assert.equal(turn.params.input.some(item => item.type === 'localImage'), true);
  assert.equal(controller.visionSupport('vision-test'), true);
  assert.equal(chat.messages[0].attachments[0].kind, 'image');
});

test('missing provider capability metadata preserves image compatibility instead of guessing text-only', async t => {
  const { controller, client } = await fixture(t, undefined);
  assert.equal(controller.visionSupport('vision-test'), null);
  await controller.send({ text: 'Try this image.', attachmentIds: ['image-1'] });
  assert.equal(client.calls.some(call => call.method === 'turn/start'), true);
});

test('local /props vision state overrides a multimodal catalog hint for the selected model', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async url => {
    const value = String(url);
    if (value.endsWith('/v1/models')) {
      return new Response(JSON.stringify({
        data: [{ id: 'local-test', meta: { n_ctx: 8192 } }],
        models: [{ model: 'local-test', capabilities: ['completion', 'multimodal'] }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (value.endsWith('/props')) {
      return new Response(JSON.stringify({
        modalities: { vision: false },
        default_generation_settings: { n_ctx: 16384 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected URL ${value}`);
  };

  const result = await probeLocal({
    localBaseUrl: 'http://127.0.0.1:8080/v1',
    localModel: 'local-test',
  });
  assert.equal(result.connection.vision, false);
  assert.deepEqual(result.connection.inputModalities, ['text']);
  assert.equal(result.connection.contextWindow, 16384);
  assert.equal(result.models[0].vision, false);
  assert.deepEqual(result.models[0].inputModalities, ['text']);
});
