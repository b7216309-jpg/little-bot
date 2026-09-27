'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm, readFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');
const { Scheduler, validateAutomation } = require('../src/scheduler.cjs');

class FakeCodexClient extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.responses = [];
    this.rejections = [];
    this.hooks = new Map();
    this.threadNumber = 0;
    this.turnNumber = 0;
    this.account = { type: 'chatgpt', planType: 'plus', email: 'private@example.test', accessToken: 'account-private-token' };
  }
  async start() { this.started = true; }
  async close() { this.closed = true; }
  async request(method, params = {}, timeoutMs) {
    this.calls.push({ method, params: structuredClone(params), timeoutMs });
    if (this.hooks.has(method)) return this.hooks.get(method)(params);
    switch (method) {
      case 'account/read': return { account: this.account };
      case 'model/list': return { data: [
        { id: 'catalog-id', model: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] },
        { id: 'hidden', model: 'hidden-model', displayName: 'Hidden', hidden: true },
      ] };
      case 'thread/start': return { thread: { id: `thread-${++this.threadNumber}` } };
      case 'thread/resume': return { thread: { id: params.threadId } };
      case 'turn/start': return { turn: { id: `turn-${++this.turnNumber}`, status: 'inProgress' } };
      case 'turn/interrupt': return {};
      case 'account/login/start': return { type: params.type, loginId: 'login-1', authUrl: 'https://auth.openai.com/authorize?state=expected-login-state', apiKey: params.apiKey, accessToken: 'login-private-token', refreshToken: 'refresh-private-token' };
      default: throw new Error(`Unexpected fake request: ${method}`);
    }
  }
  async respond(id, result) {
    this.responses.push({ id, result: structuredClone(result) });
    if (this.responseFailure) throw this.responseFailure;
  }
  async reject(id, message, code = -32601) { this.rejections.push({ id, message, code }); }
  notice(method, params) { this.emit('notification', method, params); }
  ask(id, method, params) { this.emit('request', { id, method, params }); }
}

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-controller-'));
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  const client = new FakeCodexClient();
  const controller = new Controller({ store, client });
  await controller.start();
  t.after(async () => { await controller.close(); await rm(root, { recursive: true, force: true }); });
  return { root, filePath, store, client, controller };
}

async function begin(controller, text = 'Hello there') {
  const { chatId } = await controller.send({ text });
  return controller.chat(chatId);
}

function completed(client, chat, turnId = 'turn-1', status = 'completed') {
  client.notice('turn/completed', { threadId: chat.threadId, turn: { id: turnId, status } });
}

test('begin, streamed output, tool completion, and final answer survive an actual Store round trip', async (t) => {
  const { controller, client, store, filePath, root } = await setup(t);
  const chat = await begin(controller, '  Find the answer  ');
  assert.equal(chat.status, 'running');
  assert.equal(chat.messages[0].text, 'Find the answer');
  const turnCall = client.calls.find(call => call.method === 'turn/start');
  assert.equal(turnCall.params.approvalPolicy, 'on-request');
  assert.equal(turnCall.params.approvalsReviewer, 'user');
  assert.deepEqual(turnCall.params.sandboxPolicy, {
    type: 'workspaceWrite', writableRoots: [chat.workspace], networkAccess: false,
    excludeSlashTmp: true, excludeTmpdirEnvVar: true,
  });
  client.notice('item/started', { threadId: chat.threadId, item: { id: 'command-1', type: 'commandExecution', command: 'pwd', status: 'inProgress' } });
  client.notice('item/commandExecution/outputDelta', { threadId: chat.threadId, itemId: 'command-1', delta: 'working folder' });
  client.notice('item/completed', { threadId: chat.threadId, item: { id: 'command-1', type: 'commandExecution', command: 'pwd', aggregatedOutput: 'working folder', status: 'completed' } });
  client.notice('item/agentMessage/delta', { threadId: chat.threadId, itemId: 'answer-1', delta: 'The answer ' });
  client.notice('item/agentMessage/delta', { threadId: chat.threadId, itemId: 'answer-1', delta: 'is 42.' });
  assert.equal(chat.messages.find(message => message.id === 'answer-1').text, 'The answer is 42.');
  client.notice('item/completed', { threadId: chat.threadId, item: { id: 'answer-1', type: 'agentMessage', text: 'The answer is 42.' } });
  const outcome = controller.waitForChat(chat.id);
  completed(client, chat);
  assert.deepEqual(await outcome, { error: null });
  assert.equal(chat.status, 'idle');
  store.flush();
  const restored = new Store({ filePath, defaultWorkspace: root }).data.chats[0];
  assert.equal(restored.threadId, chat.threadId);
  assert.deepEqual(restored.messages, JSON.parse(JSON.stringify(chat.messages)));
  assert.equal(restored.status, 'idle');
});

test('a persisted conversation is resumed exactly once before subsequent turns', async (t) => {
  const { controller, client } = await setup(t);
  const chat = await begin(controller);
  completed(client, chat);
  controller.resumed.clear(); // Models the next app run, with only Store data retained.
  await controller.send({ chatId: chat.id, text: 'Continue' });
  completed(client, chat, 'turn-2');
  await controller.send({ chatId: chat.id, text: 'Continue again' });
  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 1);
  assert.equal(client.calls.filter(call => call.method === 'thread/resume').length, 1);
  assert.equal(client.calls.filter(call => call.method === 'turn/start').length, 3);
});

test('opaque UI approval IDs are scoped to the right chat and accept/decline maps to original RPC IDs', async (t) => {
  const { controller, client } = await setup(t);
  const first = await begin(controller, 'First task');
  const second = await begin(controller, 'Second task');
  client.ask(12, 'item/commandExecution/requestApproval', { threadId: first.threadId, turnId: 'turn-1', itemId: 'cmd-1', command: 'pwd', cwd: first.workspace });
  client.ask('other-rpc-id', 'item/fileChange/requestApproval', { threadId: second.threadId, turnId: 'turn-2', itemId: 'file-1', reason: 'Write a report' });
  const approvals = controller.state().approvals;
  assert.equal(approvals.length, 2);
  for (const approval of approvals) for (const key of ['rpcId', 'method', 'params']) assert.equal(Object.hasOwn(approval, key), false);
  assert.equal(first.status, 'waiting');
  assert.equal(second.status, 'waiting');
  await assert.rejects(controller.respondApproval({ requestId: '12', decision: 'accept' }), /no longer waiting/);
  await controller.respondApproval({ requestId: approvals.find(a => a.chatId === first.id).requestId, decision: 'accept' });
  assert.deepEqual(client.responses[0], { id: 12, result: { decision: 'accept' } });
  assert.equal(first.status, 'running');
  assert.equal(second.status, 'waiting');
  await controller.respondApproval({ requestId: approvals.find(a => a.chatId === second.id).requestId, decision: 'decline' });
  assert.deepEqual(client.responses[1], { id: 'other-rpc-id', result: { decision: 'decline' } });
  assert.equal(controller.state().approvals.length, 0);
});

test('permission and question responses include only the requested values and use turn-scoped grants', async (t) => {
  const { controller, client } = await setup(t);
  const chat = await begin(controller);
  const permissions = { network: { enabled: true }, fileSystem: { write: [chat.workspace] } };
  client.ask('permission', 'item/permissions/requestApproval', { threadId: chat.threadId, itemId: 'p1', permissions });
  await controller.respondApproval({ requestId: controller.state().approvals[0].requestId, decision: 'accept' });
  assert.deepEqual(client.responses.at(-1), { id: 'permission', result: { permissions, scope: 'turn' } });
  client.ask('denied-permission', 'item/permissions/requestApproval', { threadId: chat.threadId, itemId: 'p2', permissions });
  await controller.respondApproval({ requestId: controller.state().approvals[0].requestId, decision: 'decline' });
  assert.deepEqual(client.responses.at(-1).result, { permissions: {}, scope: 'turn' });
  client.ask('question', 'item/tool/requestUserInput', { threadId: chat.threadId, itemId: 'q1', questions: [{ id: 'choice', question: 'Which format?' }] });
  const requestId = controller.state().approvals[0].requestId;
  await assert.rejects(controller.respondApproval({ requestId, decision: 'accept', answers: {} }), /Answer each question/);
  await controller.respondApproval({ requestId, decision: 'accept', answers: { choice: { answers: ['CSV'] }, unrelated: { answers: ['ignore this'] } } });
  assert.deepEqual(client.responses.at(-1).result, { answers: { choice: { answers: ['CSV'] } } });
});

test('foreign and unsupported server requests are rejected without creating a prompt', async (t) => {
  const { controller, client } = await setup(t);
  const chat = await begin(controller);
  client.ask('foreign', 'item/commandExecution/requestApproval', { threadId: 'not-our-thread', command: 'pwd' });
  client.ask('unsupported', 'some/future/tool', { threadId: chat.threadId });
  assert.deepEqual(client.rejections.map(request => request.id), ['foreign', 'unsupported']);
  assert.ok(client.rejections.every(request => request.code === -32601));
  assert.equal(controller.state().approvals.length, 0);
  client.notice('item/agentMessage/delta', { threadId: 'not-our-thread', itemId: 'foreign-message', delta: 'Must not appear' });
  assert.equal(chat.messages.length, 1);
});

test('Stop declines pending prompts and interrupts only the selected conversation', async (t) => {
  const { controller, client } = await setup(t);
  const first = await begin(controller, 'First');
  const second = await begin(controller, 'Second');
  client.ask('stop-approval', 'item/commandExecution/requestApproval', { threadId: first.threadId, turnId: 'turn-1', itemId: 'cmd', command: 'pwd' });
  const outcome = controller.waitForChat(first.id);
  await controller.stop({ chatId: first.id });
  assert.deepEqual(client.responses.at(-1), { id: 'stop-approval', result: { decision: 'decline' } });
  const interrupt = client.calls.find(call => call.method === 'turn/interrupt');
  assert.deepEqual(interrupt.params, { threadId: first.threadId, turnId: 'turn-1' });
  completed(client, first, 'turn-1', 'interrupted');
  assert.match((await outcome).error, /Stopped/);
  assert.equal(first.status, 'idle');
  assert.equal(second.status, 'running');
});

test('engine crash resolves in-flight work and clears approvals without leaking a key in state', async (t) => {
  const { controller, client } = await setup(t);
  const chat = await begin(controller);
  client.notice('item/agentMessage/delta', { threadId: chat.threadId, itemId: 'answer', delta: 'Partial answer' });
  client.ask('pending', 'item/fileChange/requestApproval', { threadId: chat.threadId, itemId: 'file', reason: 'Save file' });
  const outcome = controller.waitForChat(chat.id);
  client.emit('crash', new Error('Disconnected using sk-private-test-key-12345'));
  assert.match((await outcome).error, /engine stopped/);
  assert.equal(chat.status, 'idle');
  assert.equal(chat.messages.find(message => message.id === 'answer').status, 'failed');
  assert.equal(controller.state().runtime.status, 'error');
  assert.equal(controller.state().approvals.length, 0);
  assert.equal(JSON.stringify(controller.state()).includes('sk-private-test-key-12345'), false);
  await assert.rejects(controller.send({ text: 'Try again' }), /Disconnected/);
});

test('sign-in metadata and stored state exclude API keys, account details, and response tokens', async (t) => {
  const { controller, client, store, filePath } = await setup(t);
  const key = 'sk-a-private-api-key-for-test';
  const events = [];
  controller.on('event', event => events.push(event));
  const result = await controller.login({ type: 'apiKey', apiKey: `  ${key}  ` });
  assert.equal(client.calls.find(call => call.method === 'account/login/start').params.apiKey, key);
  assert.deepEqual(Object.keys(result).sort(), ['authUrl', 'loginId', 'type']);
  store.flush();
  const surfaced = JSON.stringify([result, controller.state(), events, await readFile(filePath, 'utf8')]);
  for (const secret of [key, 'account-private-token', 'login-private-token', 'refresh-private-token', 'private@example.test']) {
    assert.equal(surfaced.includes(secret), false);
  }
});

test('blank, oversized, invalid, and signed-out sends create no conversation or model calls', async (t) => {
  const { controller, client } = await setup(t);
  for (const text of ['', '  \n ', 'x'.repeat(32001), null, 42]) await assert.rejects(controller.send({ text }), /32,000/);
  await assert.rejects(controller.send({ chatId: 'missing', text: 'Hello' }), /no longer exists/);
  controller.account = { status: 'signedOut' };
  await assert.rejects(controller.send({ text: 'Hello' }), /Sign in/);
  assert.equal(controller.state().chats.length, 0);
  assert.equal(client.calls.filter(call => ['thread/start', 'turn/start'].includes(call.method)).length, 0);
});

test('a second send on the same conversation cannot race an in-flight turn-start request', async (t) => {
  const { controller, client } = await setup(t);
  const chat = await begin(controller);
  completed(client, chat);
  let release;
  client.hooks.set('turn/start', () => new Promise(resolve => { release = resolve; }));
  const first = controller.send({ chatId: chat.id, text: 'First follow-up' });
  await assert.rejects(controller.send({ chatId: chat.id, text: 'Double click' }), /Wait for this reply/);
  assert.equal(chat.messages.filter(message => message.role === 'user').length, 2);
  release({ turn: { id: 'turn-2' } });
  await first;
  assert.equal(client.calls.filter(call => call.method === 'turn/start').length, 2);
});

test('serverRequest/resolved removes the obsolete prompt and restores running status', async (t) => {
  const { controller, client } = await setup(t);
  const chat = await begin(controller);
  client.ask('resolved-rpc', 'item/commandExecution/requestApproval', { threadId: chat.threadId, turnId: 'turn-1', itemId: 'cmd', command: 'pwd' });
  assert.equal(chat.status, 'waiting');
  client.notice('serverRequest/resolved', { threadId: chat.threadId, requestId: 'resolved-rpc' });
  assert.equal(controller.state().approvals.length, 0);
  assert.equal(chat.status, 'running');
});

test('an approval transport failure is surfaced to the caller instead of reporting success', async (t) => {
  const { controller, client } = await setup(t);
  const chat = await begin(controller);
  client.ask('failed-rpc', 'item/commandExecution/requestApproval', { threadId: chat.threadId, itemId: 'cmd', command: 'pwd' });
  const failed = Promise.reject(new Error('Input pipe is closed'));
  failed.catch(() => {}); // Keep the test's synthetic rejection handled even on the buggy implementation.
  client.respond = () => failed;
  await assert.rejects(Promise.resolve(controller.respondApproval({ requestId: controller.state().approvals[0].requestId, decision: 'accept' })), /Input pipe is closed/);
});

test('engine crash finalizes in-progress tool messages as failed', async (t) => {
  const { controller, client } = await setup(t);
  const chat = await begin(controller);
  client.notice('item/started', { threadId: chat.threadId, item: { id: 'cmd', type: 'commandExecution', command: 'long-command', status: 'inProgress' } });
  client.emit('crash', new Error('Engine exited'));
  assert.equal(chat.messages.find(message => message.id === 'cmd').status, 'failed');
});

test('stopping a scheduled conversation records an interrupted automation instead of success', async (t) => {
  const { controller, client, store } = await setup(t);
  const automation = validateAutomation({ name: 'Test task', prompt: 'Scheduled request', intervalMinutes: 60 }, null, store.data.settings);
  store.data.automations.push(automation);
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const scheduler = new Scheduler({
    store,
    run: async (record) => {
      const { chatId } = await controller.send({ text: record.prompt }, record);
      started(chatId);
      const outcome = await controller.waitForChat(chatId);
      if (outcome.error) throw new Error(outcome.error);
      return { chatId };
    },
  });
  const running = scheduler.runNow(automation.id);
  const rejected = assert.rejects(running, /Stopped/);
  const chat = controller.chat(await startedPromise);
  assert.equal(automation.lastStatus, 'running');
  await controller.stop({ chatId: chat.id });
  completed(client, chat, 'turn-1', 'interrupted');
  await rejected;
  assert.equal(automation.lastStatus, 'error');
  assert.match(automation.lastError, /Stopped/);
  assert.equal(scheduler.runningId, null);
});

module.exports = { FakeCodexClient };
