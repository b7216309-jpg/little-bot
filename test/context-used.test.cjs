'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm, readFile } = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');

class FakeClient extends EventEmitter {
  constructor() { super(); this.calls = []; this.thread = 0; this.turn = 0; }
  async start() {}
  async close() {}
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } };
    if (method === 'model/list') return { data: [{
      id: 'gpt-test', model: 'gpt-test', displayName: 'Test', isDefault: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
    }] };
    if (method === 'thread/start') return { thread: { id: `thread-${++this.thread}` } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'thread/unsubscribe') return {};
    if (method === 'turn/start') return { turn: { id: `turn-${++this.turn}`, status: 'inProgress' } };
    if (method === 'turn/interrupt') return {};
    throw new Error(`Unexpected request: ${method}`);
  }
  async respond() {}
  async reject() {}
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-context-used-'));
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  Object.assign(store.data.settings, {
    connection: 'codex',
    model: 'gpt-test',
    codexModel: 'gpt-test',
    workspace: root,
    effort: 'low',
  });
  store.data.memory.facts.push({
    id: 'memory-context-test',
    text: 'Reports should use metric units.',
    scope: 'global',
    workspace: '',
    source: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  store.data.extensions.skills.push({
    id: 'skill-context-test',
    name: 'inspect',
    description: 'Inspect carefully.',
    content: 'SKILL CONTEXT SENTINEL 7713',
    enabled: true,
  });

  const client = new FakeClient();
  const controller = new Controller({ store, client });
  await controller.start();
  controller.profileFiles = {
    buildContext: () => 'PROFILE CONTEXT SENTINEL 9321',
    getState: () => ({ user: '', soul: '', root: '', files: {}, errors: {}, limits: { perFile: 4000, total: 8000 }, updatedAt: null }),
  };
  t.after(async () => {
    await controller.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, filePath, store, client, controller };
}

test('context-used snapshot exactly mirrors developer instructions and turn text blocks', async t => {
  const { controller, client } = await fixture(t);
  const { chatId } = await controller.send({ text: '$inspect Review reports and metric units.' });
  const chat = controller.chat(chatId);
  const snapshot = controller.contextUsedFor(chatId);
  const thread = client.calls.find(call => call.method === 'thread/start').params;
  const turn = client.calls.find(call => call.method === 'turn/start').params;

  assert.ok(snapshot);
  assert.equal(snapshot.chatId, chatId);
  assert.equal(snapshot.at, chat.contextUsedAt);
  assert.equal(snapshot.developerInstructions, thread.developerInstructions);
  assert.equal(snapshot.inputBlocks.map(block => block.text).join('\n\n'), turn.input[0].text);
  assert.deepEqual(snapshot.inputBlocks.map(block => block.kind), ['profile', 'skills', 'memory', 'shell', 'request']);
  assert.match(snapshot.inputBlocks.find(block => block.kind === 'profile').text, /PROFILE CONTEXT SENTINEL 9321/);
  assert.match(snapshot.inputBlocks.find(block => block.kind === 'skills').text, /SKILL CONTEXT SENTINEL 7713/);
  assert.match(snapshot.inputBlocks.find(block => block.kind === 'memory').text, /Reports should use metric units/);
  assert.match(snapshot.memoryStatus, /Relevant memory was injected/);
});

test('private session snapshot explains that saved memory was skipped', async t => {
  const { controller } = await fixture(t);
  const { chatId } = await controller.send({ text: 'Review reports and metric units.', privateSession: true });
  const snapshot = controller.contextUsedFor(chatId);
  assert.equal(snapshot.private, true);
  assert.equal(snapshot.inputBlocks.some(block => block.kind === 'memory'), false);
  assert.match(snapshot.memoryStatus, /Skipped in Private session/);
});

test('context snapshot is live-only and never serialized into state.json', async t => {
  const { controller, store, filePath } = await fixture(t);
  const { chatId } = await controller.send({ text: '$inspect Review reports and metric units.' });
  assert.ok(controller.contextUsedFor(chatId));
  store.flush();

  const serialized = await readFile(filePath, 'utf8');
  assert.equal(serialized.includes('PROFILE CONTEXT SENTINEL 9321'), false);
  assert.equal(serialized.includes('contextUsedAt'), false);
  assert.equal(serialized.includes('developerInstructionsLabel'), false);
});

test('renderer and IPC expose the on-demand context inspector', () => {
  const root = path.join(__dirname, '..');
  const html = readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const app = readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const preload = readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');
  const main = readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');

  assert.match(html, /id="inspector-context-used"/);
  assert.match(html, /id="inspector-memory-status"/);
  assert.match(app, /function loadContextUsed\(chat/);
  assert.match(app, /function renderContextUsedSnapshot\(snapshot, chat\)/);
  assert.match(preload, /getContextUsed: invoke\('getContextUsed'\)/);
  assert.match(main, /register\('getContextUsed'/);
});
