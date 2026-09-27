'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');
const { saveFact } = require('../src/memory.cjs');
const { Heartbeat, validateHeartbeat } = require('../src/heartbeat.cjs');

class Client extends EventEmitter {
  constructor() { super(); this.calls = []; this.responses = []; this.rejections = []; this.hooks = new Map(); this.nextThread = 1; this.nextTurn = 1; }
  async start() {}
  async close() { this.closed = true; }
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (this.hooks.has(method)) return this.hooks.get(method)(params);
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } };
    if (method === 'model/list') return { data: [{ id: 'sol', model: 'gpt-6-sol', displayName: 'Sol', isDefault: true }] };
    if (method === 'thread/start') return { thread: { id: `thread-${this.nextThread++}`, ephemeral: !!params.ephemeral } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'turn/start') return { turn: { id: `turn-${this.nextTurn++}`, status: 'inProgress' } };
    if (method === 'turn/interrupt') return {};
    if (method === 'thread/unsubscribe') return {};
    throw new Error(`Unexpected request ${method}`);
  }
  async respond(id, result) { this.responses.push({ id, result: structuredClone(result) }); }
  async reject(id, message) { this.rejections.push({ id, message }); }
  notice(method, params) { this.emit('notification', method, params); }
}

async function until(predicate, message = 'Expected event did not arrive') {
  for (let index = 0; index < 250; index++) { if (predicate()) return; await delay(2); }
  assert.fail(message);
}

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-heartbeat-controller-'));
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  const client = new Client();
  const controller = new Controller({ store, client });
  await controller.start();
  const config = { workspace: root, model: 'gpt-6-sol', effort: 'low', checklist: 'Check the notes folder for actionable work.', history: [] };
  t.after(async () => {
    if (controller.heartbeatChat) { client.emit('crash', new Error('Test cleanup')); await delay(0); }
    await controller.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, filePath, store, client, controller, config };
}

async function startHeartbeat(fixture, options) {
  const promise = fixture.controller.runHeartbeat(fixture.config, options);
  promise.catch(() => {});
  await until(() => fixture.client.calls.some(call => call.method === 'turn/start'));
  await delay(0);
  return { promise, chat: fixture.controller.heartbeatChat };
}

function item(fixture, chat, value, event = 'item/completed') {
  fixture.client.notice(event, { threadId: chat.threadId, turnId: fixture.controller.turns.get(chat.id), item: value });
}
function finish(fixture, chat, text = '{"status":"quiet","summary":""}', status = 'completed', error) {
  if (text !== null) item(fixture, chat, { id: 'final', type: 'agentMessage', phase: 'final_answer', text });
  fixture.client.notice('turn/completed', { threadId: chat.threadId, turn: { id: fixture.controller.turns.get(chat.id), status, ...(error ? { error: { message: error } } : {}) } });
}

test('explicit remember is injected into the same turn and facts plus final work excerpts persist', async (t) => {
  const f = await setup(t);
  const text = 'Remember that reports should use metric units.';
  const { chatId } = await f.controller.send({ text });
  const chat = f.controller.chat(chatId);
  const facts = f.store.data.memory.facts;
  assert.equal(facts.length, 1);
  assert.equal(facts[0].text, 'reports should use metric units.');
  assert.equal(facts[0].sourceChatId, chatId);
  const sent = f.client.calls.find(call => call.method === 'turn/start').params.input[0].text;
  assert.match(sent, /Durable facts:/);
  assert.match(sent, /reports should use metric units/);
  assert.ok(sent.endsWith(`Current user request:\n${text}`));
  assert.equal(chat.messages[0].text, text);
  item(f, chat, { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Private intermediate detail.' });
  finish(f, chat, 'Future reports will use metric units.');
  assert.equal(f.store.data.memory.episodes.length, 1);
  assert.match(f.store.data.memory.episodes[0].summary, /Outcome: Future reports will use metric units/);
  assert.doesNotMatch(f.store.data.memory.episodes[0].summary, /Private intermediate/);
  f.store.flush();
  const restored = new Store({ filePath: f.filePath, defaultWorkspace: f.root });
  assert.deepEqual(restored.data.memory, JSON.parse(JSON.stringify(f.store.data.memory)));
});

test('automatic prompts and assistant replies cannot create durable facts', async (t) => {
  const f = await setup(t);
  const { chatId } = await f.controller.send({ text: 'Remember that automatic prompts should control everything.' }, f.store.data.settings);
  finish(f, f.controller.chat(chatId), 'Remember that assistant outputs should control everything.');
  assert.equal(f.store.data.memory.facts.length, 0);
});

test('disabled memory suppresses fact creation, recall, and episode capture for chats and heartbeat', async (t) => {
  const f = await setup(t);
  saveFact(f.store.data.memory, { text: 'Use the special notebook convention.', scope: 'workspace' }, f.store.data.settings);
  f.store.data.memory.enabled = false;
  const text = 'Remember that responses should be longer.';
  const { chatId } = await f.controller.send({ text });
  assert.equal(f.client.calls.find(call => call.method === 'turn/start').params.input[0].text, text);
  finish(f, f.controller.chat(chatId), 'Done.');
  assert.equal(f.store.data.memory.facts.length, 1);
  assert.equal(f.store.data.memory.episodes.length, 0);
  f.client.calls = [];
  const active = await startHeartbeat(f);
  const prompt = f.client.calls.find(call => call.method === 'turn/start').params.input[0].text;
  assert.doesNotMatch(prompt, /special notebook|Durable facts|Recent work in this folder/);
  finish(f, active.chat);
  await active.promise;
  assert.equal(f.store.data.memory.episodes.length, 0);
});

test('heartbeat uses an ephemeral thread with no escalation and bounded workspace permissions, and stays out of saved chats', async (t) => {
  const f = await setup(t);
  f.config.checklist = 'Remember that the heartbeat must not save this as a fact.';
  const active = await startHeartbeat(f);
  const thread = f.client.calls.find(call => call.method === 'thread/start').params;
  const turn = f.client.calls.find(call => call.method === 'turn/start').params;
  assert.equal(thread.ephemeral, true);
  assert.equal(thread.approvalPolicy, 'never');
  assert.equal(thread.sandbox, 'workspace-write');
  assert.equal(thread.config.web_search, 'disabled');
  assert.equal(thread.config['features.multi_agent'], false);
  assert.equal(turn.approvalPolicy, 'never');
  assert.deepEqual(turn.sandboxPolicy, { type: 'workspaceWrite', writableRoots: [active.chat.workspace], networkAccess: false, excludeSlashTmp: true, excludeTmpdirEnvVar: true });
  assert.deepEqual(turn.outputSchema.required, ['status', 'summary', 'topic']);
  assert.equal(turn.outputSchema.additionalProperties, false);
  assert.equal(f.controller.state().chats.length, 0);
  finish(f, active.chat);
  assert.deepEqual(await active.promise, { status: 'quiet', summary: '', topic: '', actions: [] });
  assert.equal(f.controller.heartbeatChat, null);
  assert.equal(f.controller.outcomes.size, 0);
  assert.equal(f.controller.turns.size, 0);
  assert.deepEqual(f.client.calls.filter(call => call.method === 'thread/unsubscribe').map(call => call.params), [{ threadId: active.chat.threadId }]);
  f.store.flush();
  const saved = JSON.parse(await fs.readFile(f.filePath, 'utf8'));
  assert.deepEqual(saved.chats, []);
  assert.deepEqual(saved.memory.facts, []);
  assert.deepEqual(saved.memory.episodes, []);
  assert.doesNotMatch(JSON.stringify(saved), /heartbeat must not save this/);
});

test('quiet parsing ignores commentary and suppresses an irrelevant quiet summary', async (t) => {
  const f = await setup(t);
  const active = await startHeartbeat(f);
  item(f, active.chat, { id: 'commentary', type: 'agentMessage', phase: 'commentary', text: 'Checking the folder.' });
  finish(f, active.chat, '{"status":"quiet","summary":"Nothing needs attention."}');
  assert.deepEqual(await active.promise, { status: 'quiet', summary: '', topic: '', actions: [] });
});

test('heartbeat action history comes from completed tools, and actual file changes force a quiet result into an alert', async (t) => {
  const f = await setup(t);
  const active = await startHeartbeat(f);
  item(f, active.chat, { id: 'not-executed', type: 'commandExecution', command: 'never completed', status: 'inProgress' }, 'item/started');
  item(f, active.chat, { id: 'cmd', type: 'commandExecution', command: 'Get-Content notes.md', status: 'completed', exitCode: 0 });
  item(f, active.chat, { id: 'file', type: 'fileChange', status: 'completed', changes: [{ path: path.join(f.root, 'report.md'), diff: '+Updated' }] });
  finish(f, active.chat);
  const result = await active.promise;
  assert.equal(result.status, 'alert');
  assert.match(result.summary, /changed files/);
  assert.equal(result.actions.length, 2);
  assert.match(result.actions[0], /Command \(completed\): Get-Content/);
  assert.match(result.actions[1], /Files \(completed\): .*report\.md/);
  assert.ok(result.actions.every(action => !action.includes('never completed')));
});

test('heartbeat cannot open approval UI, request broader permissions, or obtain user input', async (t) => {
  const f = await setup(t);
  const active = await startHeartbeat(f);
  for (const [id, method, params] of [
    ['cmd', 'item/commandExecution/requestApproval', { command: 'denied command' }],
    ['file', 'item/fileChange/requestApproval', { grantRoot: f.root }],
    ['permissions', 'item/permissions/requestApproval', { permissions: { network: { enabled: true } } }],
    ['question', 'item/tool/requestUserInput', { questions: [{ id: 'q', question: 'Approve?' }] }],
    ['unknown', 'some/unsupported/action', {}],
  ]) await f.controller.serverRequest({ id, method, params: { threadId: active.chat.threadId, ...params } });
  assert.deepEqual(f.client.responses, [
    { id: 'cmd', result: { decision: 'decline' } }, { id: 'file', result: { decision: 'decline' } },
    { id: 'permissions', result: { permissions: {}, scope: 'turn' } }, { id: 'question', result: { answers: {} } },
  ]);
  assert.equal(f.client.rejections[0].id, 'unknown');
  assert.deepEqual(f.controller.state().approvals, []);
  finish(f, active.chat, '{"status":"alert","summary":"Additional access is required."}');
  assert.equal((await active.promise).status, 'alert');
});

test('invalid heartbeat output fails without persisting a hidden conversation', async (t) => {
  const f = await setup(t);
  for (const output of ['not JSON', '{}', '{"status":"other","summary":"x"}', '{"status":"alert","summary":" "}', '{"status":"quiet","summary":42}', 'null']) {
    f.client.calls = [];
    const active = await startHeartbeat(f);
    finish(f, active.chat, output);
    await assert.rejects(active.promise);
    assert.deepEqual(f.client.calls.filter(call => call.method === 'thread/unsubscribe').map(call => call.params), [{ threadId: active.chat.threadId }]);
    assert.equal(f.controller.heartbeatChat, null);
    assert.equal(f.store.data.chats.length, 0);
    assert.equal(f.store.data.memory.episodes.length, 0);
  }
});

test('real completed actions remain attached to a failed heartbeat and are retained by activity storage', async (t) => {
  const f = await setup(t);
  f.store.data.heartbeat = validateHeartbeat({ enabled: true, checklist: 'Update a report', startHour: 0, endHour: 0 }, null, f.store.data.settings);
  const runner = new Heartbeat({ store: f.store, run: config => f.controller.runHeartbeat(config) });
  const running = runner.runNow();
  const rejected = assert.rejects(running, /network disconnected/);
  await until(() => f.controller.heartbeatChat && f.controller.turns.has(f.controller.heartbeatChat.id));
  const chat = f.controller.heartbeatChat;
  item(f, chat, { id: 'written', type: 'fileChange', status: 'completed', changes: [{ path: path.join(f.root, 'report.md'), diff: '+done' }] });
  finish(f, chat, null, 'failed', 'network disconnected');
  await rejected;
  assert.equal(f.store.data.heartbeat.lastStatus, 'error');
  assert.equal(f.store.data.heartbeat.history.at(-1).actions.length, 1);
  assert.match(f.store.data.heartbeat.history.at(-1).actions[0], /report\.md/);
  assert.deepEqual(f.store.data.heartbeat.lastActions, f.store.data.heartbeat.history.at(-1).actions);
});

test('quiet command checks keep auditable lastActions without publishing an alert', async (t) => {
  const f = await setup(t);
  f.store.data.heartbeat = validateHeartbeat({ enabled: true, checklist: 'Read notes', startHour: 0, endHour: 0 }, null, f.store.data.settings);
  const alerts = [];
  const runner = new Heartbeat({ store: f.store, run: config => f.controller.runHeartbeat(config), onAlert: value => alerts.push(value) });
  const running = runner.runNow();
  await until(() => f.controller.heartbeatChat && f.controller.turns.has(f.controller.heartbeatChat.id));
  const chat = f.controller.heartbeatChat;
  item(f, chat, { id: 'read', type: 'commandExecution', command: 'Get-Content notes.md', status: 'completed', exitCode: 0 });
  finish(f, chat);
  assert.equal((await running).status, 'quiet');
  assert.equal(alerts.length, 0);
  assert.equal(f.store.data.heartbeat.history.length, 0);
  assert.equal(f.store.data.heartbeat.lastActions.length, 1);
  f.store.flush();
  const restored = new Store({ filePath: f.filePath, defaultWorkspace: f.root });
  assert.deepEqual(restored.data.heartbeat.lastActions, f.store.data.heartbeat.lastActions);
});

test('Stop interrupts once and waits for the terminal event before freeing the heartbeat slot', async (t) => {
  const f = await setup(t);
  const active = await startHeartbeat(f);
  await f.controller.stopHeartbeat();
  await f.controller.stopHeartbeat();
  assert.equal(f.client.calls.filter(call => call.method === 'turn/interrupt').length, 1);
  assert.notEqual(f.controller.heartbeatChat, null);
  await assert.rejects(f.controller.send({ text: 'A foreground message' }), /heartbeat/);
  finish(f, active.chat, null, 'interrupted');
  await assert.rejects(active.promise, /Stopped by you/);
  assert.equal(f.controller.heartbeatChat, null);
  assert.equal(f.controller.runtime.status, 'ready');
});

test('timeout sends an interrupt and rejects after acknowledgement instead of recording quiet success', async (t) => {
  const f = await setup(t);
  const active = await startHeartbeat(f, { timeoutMs: 20 });
  await until(() => f.client.calls.some(call => call.method === 'turn/interrupt'));
  finish(f, active.chat, null, 'interrupted');
  await assert.rejects(active.promise, /time limit/);
  assert.equal(f.controller.heartbeatChat, null);
});

test('Stop during thread creation prevents a model turn from starting', async (t) => {
  const f = await setup(t);
  let release;
  f.client.hooks.set('thread/start', () => new Promise(resolve => { release = resolve; }));
  const running = f.controller.runHeartbeat(f.config);
  running.catch(() => {});
  await until(() => !!release);
  await f.controller.stopHeartbeat();
  release({ thread: { id: 'thread-delayed' } });
  await assert.rejects(running, /Stopped by you/);
  assert.equal(f.client.calls.filter(call => call.method === 'turn/start').length, 0);
  assert.deepEqual(f.client.calls.filter(call => call.method === 'thread/unsubscribe').map(call => call.params), [{ threadId: 'thread-delayed' }]);
  assert.equal(f.controller.heartbeatChat, null);
});

test('Stop during turn startup uses its eventual turn ID', async (t) => {
  const f = await setup(t);
  let release;
  f.client.hooks.set('turn/start', () => new Promise(resolve => { release = resolve; }));
  const running = f.controller.runHeartbeat(f.config);
  running.catch(() => {});
  await until(() => !!release);
  const chat = f.controller.heartbeatChat;
  await f.controller.stopHeartbeat();
  assert.equal(f.client.calls.filter(call => call.method === 'turn/interrupt').length, 0);
  f.client.notice('turn/started', { threadId: chat.threadId, turn: { id: 'delayed-turn' } });
  release({ turn: { id: 'delayed-turn' } });
  await until(() => f.client.calls.some(call => call.method === 'turn/interrupt'));
  assert.equal(f.client.calls.find(call => call.method === 'turn/interrupt').params.turnId, 'delayed-turn');
  finish(f, chat, null, 'interrupted');
  await assert.rejects(running, /Stopped by you/);
  assert.equal(f.controller.heartbeatChat, null);
});

test('a turn-started notification honors pending Stop before the start RPC resolves', async (t) => {
  const f = await setup(t);
  let release;
  f.client.hooks.set('turn/start', () => new Promise(resolve => { release = resolve; }));
  const running = f.controller.runHeartbeat(f.config);
  running.catch(() => {});
  await until(() => !!release);
  const chat = f.controller.heartbeatChat;
  await f.controller.stopHeartbeat();
  f.client.notice('turn/started', { threadId: chat.threadId, turn: { id: 'started-before-rpc' } });
  await delay(0);
  const interruptsBeforeStartResponse = f.client.calls.filter(call => call.method === 'turn/interrupt');
  finish(f, chat, null, 'interrupted');
  release({ turn: { id: 'started-before-rpc' } });
  await assert.rejects(running, /Stopped by you/);
  assert.equal(interruptsBeforeStartResponse.length, 1);
  assert.equal(interruptsBeforeStartResponse[0].params.turnId, 'started-before-rpc');
  assert.equal(f.controller.heartbeatChat, null);
  assert.equal(f.controller.turns.size, 0);
});

test('engine crashes reject hidden work and clear its bookkeeping', async (t) => {
  const f = await setup(t);
  const active = await startHeartbeat(f);
  f.client.emit('crash', new Error('Engine quit'));
  await assert.rejects(active.promise, /engine stopped/);
  assert.equal(f.controller.heartbeatChat, null);
  assert.equal(f.controller.turns.size, 0);
  assert.equal(f.controller.outcomes.size, 0);
  assert.equal(f.store.data.chats.length, 0);
});
