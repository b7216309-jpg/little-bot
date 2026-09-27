'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.thread = 0;
    this.turn = 0;
  }
  async start() {}
  async close() {}
  async request(method, params = {}, timeoutMs) {
    this.calls.push({ method, params: structuredClone(params), timeoutMs });
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
  notice(method, params) { this.emit('notification', method, params); }
  async respond() {}
  async reject() {}
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-system-prompt-'));
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  Object.assign(store.data.settings, {
    connection: 'codex',
    model: 'gpt-test',
    codexModel: 'gpt-test',
    workspace: root,
    effort: 'low',
  });
  const client = new FakeClient();
  const controller = new Controller({ store, client });
  await controller.start();
  t.after(async () => {
    await controller.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, filePath, store, client, controller };
}

function finish(client, chat, id = 'turn-1') {
  client.notice('turn/completed', {
    threadId: chat.threadId,
    turn: { id, status: 'completed' },
  });
}

test('custom system prompt fully replaces built-in developer instructions without reducing full access', async t => {
  const { controller, client } = await fixture(t);
  const custom = 'You are My Local Assistant. Follow my concise custom behavior exactly.';
  const state = controller.saveSettings({ systemPrompt: custom });
  assert.equal(state.settings.systemPrompt, custom);
  assert.equal(state.settings.systemPromptCustomized, true);

  const { chatId } = await controller.send({ text: 'Inspect this workspace.' });
  const chat = controller.chat(chatId);
  const thread = client.calls.find(call => call.method === 'thread/start').params;
  const turn = client.calls.find(call => call.method === 'turn/start').params;

  assert.equal(thread.developerInstructions, custom);
  assert.equal(thread.approvalPolicy, 'never');
  assert.equal(thread.sandbox, 'danger-full-access');
  assert.equal(turn.approvalPolicy, 'never');
  assert.deepEqual(turn.sandboxPolicy, { type: 'dangerFullAccess' });
  finish(client, chat);
});

test('changing the prompt reloads an existing idle engine thread before the next turn', async t => {
  const { controller, client } = await fixture(t);
  const { chatId } = await controller.send({ text: 'First turn.' });
  const chat = controller.chat(chatId);
  finish(client, chat);

  const custom = 'Replacement prompt for subsequent turns.';
  controller.saveSettings({ systemPrompt: custom });
  await controller.send({ chatId, text: 'Second turn.' });

  const unsubscribe = client.calls.find(call => call.method === 'thread/unsubscribe');
  const resume = client.calls.find(call => call.method === 'thread/resume');
  const turns = client.calls.filter(call => call.method === 'turn/start');

  assert.ok(unsubscribe);
  assert.ok(resume);
  assert.equal(resume.params.developerInstructions, custom);
  assert.equal(resume.params.approvalPolicy, 'never');
  assert.equal(resume.params.sandbox, 'danger-full-access');
  assert.equal(turns.at(-1).params.approvalPolicy, 'never');
  assert.deepEqual(turns.at(-1).params.sandboxPolicy, { type: 'dangerFullAccess' });
});

test('restore default removes the override and state exposes the effective built-in prompt', async t => {
  const { controller } = await fixture(t);
  controller.saveSettings({ systemPrompt: 'Temporary custom prompt.' });
  const restored = controller.saveSettings({ systemPrompt: null });
  assert.equal(restored.settings.systemPromptCustomized, false);
  assert.notEqual(restored.settings.systemPrompt, 'Temporary custom prompt.');
  assert.match(restored.settings.systemPrompt, /Little Bot runs in full-access local mode/);
});

test('custom prompt survives Store persistence and renderer exposes the editor', async t => {
  const { root, filePath, store } = await fixture(t);
  store.data.settings.systemPrompt = 'Persist this custom prompt.';
  store.flush();

  const restored = new Store({ filePath, defaultWorkspace: root });
  assert.equal(restored.data.settings.systemPrompt, 'Persist this custom prompt.');

  const html = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(html, /id="system-prompt-settings-form"/);
  assert.match(html, /Editing it replaces Little Bot’s built-in instructions/);
  assert.match(app, /renderSystemPromptSettings/);
  assert.match(app, /saveSettings\(\{ systemPrompt: value \}\)/);
  // Existing merged renderer infrastructure must remain present after the rebase.
  assert.match(html, /\.\/chat-scroll\.js/);
  assert.match(html, /\.\/action-groups\.js/);
  assert.match(app, /reportRendererError/);
});
