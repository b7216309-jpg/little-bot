'use strict';

// Integration fixture: production Store, Controller, AgentTools, consolidator,
// preload, renderer, and memory IPC registrations; only model transport is fake.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { app, BrowserWindow, ipcMain } = require('electron');
const { Store } = require('../src/store.cjs');
const { Controller } = require('../src/controller.cjs');
const { AgentTools } = require('../src/agent-tools.cjs');
const { MemoryConsolidator } = require('../src/memory-consolidator.cjs');
const { saveFact, deleteFact, clearEpisodes } = require('../src/memory.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-runtime-test-'));
app.setPath('userData', path.join(root, 'electron'));
process.env.LITTLE_BOT_DATA_DIR = path.join(root, 'data');
const workspaceA = path.join(root, 'project-a');
const workspaceB = path.join(root, 'project-b');
fs.mkdirSync(workspaceA, { recursive: true });
fs.mkdirSync(workspaceB, { recursive: true });
const filePath = path.join(process.env.LITTLE_BOT_DATA_DIR, 'state.json');
let store, controller, transport, window;
const channels = new Set();
const runtimeErrors = [];
class ModelTransport extends EventEmitter {
  constructor() { super(); this.calls = []; this.threads = 0; this.turns = 0; }
  async start() {}
  async close() {}
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'account/read') return { account: { type: 'apiKey' } };
    if (method === 'account/rateLimits/read') return { rateLimits: {} };
    if (method === 'model/list') return { data: ['model-one', 'model-two'].map(id => ({ id, model: id, displayName: id, supportedReasoningEfforts: [{ reasoningEffort: 'low' }] })) };
    if (method === 'thread/start') return { thread: { id: `runtime-thread-${++this.threads}` } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'turn/start') return { turn: { id: `runtime-turn-${++this.turns}`, status: 'inProgress' } };
    if (['thread/unsubscribe', 'turn/interrupt'].includes(method)) return {};
    throw new Error(`Unexpected model transport request: ${method}`);
  }
  async respond() {}
  async reject() {}
  complete(threadId, turnId, text) {
    this.emit('notification', 'item/completed', { threadId, item: { type: 'agentMessage', id: `answer-${turnId}`, text } });
    this.emit('notification', 'turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
  }
}
function register(name, handler) {
  const channel = `bot:${name}`;
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (_event, input) => handler(input));
  channels.add(channel);
}
function mountProductionMemoryHandlers() {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const start = mainSource.indexOf("  register('saveMemory',");
  const end = mainSource.indexOf("  register('saveHeartbeat',", start);
  assert(start > 0 && end > start, 'Production memory IPC registrations must be found.');
  // Execute the production registration block itself, avoiding copied handlers
  // that could silently diverge from main.cjs.
  vm.runInNewContext(mainSource.slice(start, end), { register, store, controller, saveFact, deleteFact, clearEpisodes }, { filename: 'main-memory-ipc.cjs' });
}
async function startRuntime() {
  store = new Store({ filePath, defaultWorkspace: workspaceA });
  if (!store.data.settings.model || !store.data.settings.model.startsWith('model-')) {
    Object.assign(store.data.settings, { connection: 'codex', model: 'model-one', codexModel: 'model-one', workspace: workspaceA, independentCheckMode: 'off' });
  }
  transport = new ModelTransport();
  controller = new Controller({ store, client: transport, onError: (source, error) => runtimeErrors.push(`${source}: ${error.message}`) });
  controller.agentTools = new AgentTools({ store });
  controller.memoryConsolidator = new MemoryConsolidator(controller, { autoStart: false });
  controller.on('event', event => { if (window && !window.isDestroyed()) window.webContents.send('bot:event', event); });
  await controller.start();
  register('getState', () => controller.state());
  register('getContextUsed', ({ chatId }) => controller.contextUsedFor(chatId));
  register('saveSettings', input => controller.saveSettings(input));
  register('send', input => controller.send(input));
  register('reportError', input => { runtimeErrors.push(input.message); });
  mountProductionMemoryHandlers();
}
const evaluate = source => window.webContents.executeJavaScript(source);
async function waitUntil(predicate, description) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error(`Timed out: ${description}`);
}
async function completeForeground(text) {
  const chat = store.data.chats[0];
  const call = transport.calls.filter(item => item.method === 'turn/start').at(-1);
  const outcome = controller.waitForChat(chat.id);
  transport.complete(chat.threadId, `runtime-turn-${transport.turns}`, text);
  await outcome;
  assert.equal(chat.status, 'idle');
  return call;
}
async function run() {
  await app.whenReady();
  try {
    await startRuntime();
    window = new BrowserWindow({ show: false, width: 1280, height: 980, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) runtimeErrors.push(message); });
    await window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await waitUntil(() => evaluate('Boolean(state?.settings)'), 'renderer receives initial state through preload IPC');
    assert.equal(await evaluate('typeof window.bot.searchMemory'), 'function');
    const sent = await evaluate(`window.bot.send({text:'We chose pnpm for this project. Please remember the package manager.'})`);
    const singletonId = sent.chatId;
    await completeForeground('The project package manager is pnpm.');
    const firstThread = store.data.chats[0].threadId;
    assert.equal(store.data.chats.length, 1);
    assert(store.memoryService.pendingExtractions().length > 0);
    controller.memoryConsolidator.notBefore = 0;
    assert.equal(await controller.memoryConsolidator.tick(), true);
    const extraction = controller.memoryConsolidator.active;
    const extractionCall = transport.calls.filter(item => item.method === 'turn/start').at(-1);
    assert(extractionCall.params.outputSchema, 'Consolidation must use the structured output contract.');
    const userMessage = store.data.chats[0].messages.find(item => item.role === 'user');
    transport.complete(extraction.threadId, extraction.turnId, JSON.stringify({ memories: [{ text: 'This project uses pnpm.', type: 'decision', scope: 'workspace', key: 'project.package-manager', supersedesId: null, sourceIds: [userMessage.id] }] }));
    assert.equal(controller.memoryConsolidator.active, null);
    const saved = await evaluate(`window.bot.searchMemory({query:'pnpm',type:'decision'})`);
    assert.equal(saved.records.length, 1);
    const memoryId = saved.records[0].id;
    assert.match((await evaluate(`window.bot.getMemorySource({id:${JSON.stringify(memoryId)}})`)).sources[0].text, /We chose pnpm/);
    await evaluate(`window.bot.saveFact({id:${JSON.stringify(memoryId)},text:'This project uses pnpm.',type:'decision',scope:'workspace',pinned:true})`);
    assert.equal(store.memoryService.get(memoryId).pinned, true);
    const sourceAfterPin = store.memoryService.sources(memoryId);
    assert.match(sourceAfterPin[0].text, /We chose pnpm/);
    await evaluate(`window.bot.saveFact({text:'Keep answers concise.',type:'preference',scope:'global'})`);
    const toolMemory = await controller.agentTools.call('memory_save', { text: 'Use short answers for this project.', type: 'preference', scope: 'workspace', key: 'project.answer-style' }, { chat: store.data.chats[0] });
    assert.equal((await controller.agentTools.call('memory_search', { query: 'short answers', source: 'facts' }, { chat: store.data.chats[0] })).results.some(item => item.id === toolMemory.record.id), true);
    await evaluate(`window.bot.deleteFact({id:${JSON.stringify(toolMemory.record.id)}})`);
    // A small model's call with stray fields still saves (seen live: an action copied from other tools and an empty id).
    const strayMemory = await controller.agentTools.call('memory_save', { action: 'save', id: '', key: 'user.promise', pinned: true, scope: 'global', text: 'The user promised to always be there.', type: 'decision' }, { chat: store.data.chats[0] });
    assert.deepEqual(strayMemory.ignoredFields, ['action']);
    assert.equal(store.memoryService.get(strayMemory.record.id).text, 'The user promised to always be there.');
    await evaluate(`window.bot.deleteFact({id:${JSON.stringify(strayMemory.record.id)}})`);
    assert.equal(store.memoryService.get(toolMemory.record.id).status, 'forgotten');

    await evaluate(`window.bot.configureMemory({embedding:{baseUrl:'http://127.0.0.1:12345/v1',model:'test-embedding',apiKey:'test-only-key'}})`);
    assert.equal(store.memoryService.embedding.model, 'test-embedding');
    await evaluate(`window.bot.configureMemory({embedding:{baseUrl:'',model:'',apiKey:''}})`);
    await evaluate(`window.bot.saveMemory({enabled:false})`);
    assert.equal((await evaluate(`window.bot.searchMemory({query:'pnpm',type:'decision'})`)).records.length, 1, 'Paused memory remains manageable.');
    await evaluate(`window.bot.saveMemory({enabled:true})`);
    const projectId = store.memoryService.get(memoryId).projectId;
    await evaluate(`window.bot.linkMemoryProject({projectId:${JSON.stringify(projectId)},workspace:${JSON.stringify(workspaceB)}})`);
    await evaluate(`window.bot.saveSettings({model:'model-two'})`);
    controller.setWorkspace(workspaceB);
    await evaluate(`window.bot.send({chatId:'obsolete-id',text:'Which package manager did we choose?'})`);
    const secondCall = await completeForeground('We chose pnpm.');
    assert.equal(store.data.chats.length, 1);
    assert.equal(store.data.chats[0].id, singletonId);
    assert.notEqual(store.data.chats[0].private, true);
    assert.notEqual(store.data.chats[0].threadId, firstThread);
    assert.equal(store.data.chats[0].workspace, workspaceB);
    assert.equal(store.data.chats[0].model, 'model-two');
    assert.match(secondCall.params.input[0].text, /pnpm/);
    assert.match(secondCall.params.input[0].text, /Conversation continuity|Recent conversation/);
    const historyCount = store.data.chats[0].messages.length;
    controller.changed();
    await waitUntil(() => evaluate(`state.chats[0].model === 'model-two'`), 'renderer receives changed continuous conversation');
    await evaluate(`document.getElementById('nav-memory').click(); document.getElementById('memory-search').value='pnpm'; document.getElementById('memory-type').value='decision'; refreshMemoryResults();`);
    await waitUntil(() => evaluate(`document.querySelectorAll('.memory-item').length === 1`), 'actual SQLite result rendered');
    assert.match(await evaluate(`document.getElementById('facts-list').textContent`), /Pinned/);
    await evaluate(`document.querySelector('.memory-item-actions').querySelectorAll('button')[2].click()`);
    await waitUntil(() => evaluate(`Boolean(document.querySelector('.memory-source'))`), 'actual IPC source rendered');
    assert.match(await evaluate(`document.querySelector('.memory-source').textContent`), /We chose pnpm/);
    if (process.env.LITTLE_BOT_SCREENSHOT) {
      await evaluate(`document.getElementById('sidebar-tools').open=true; document.getElementById('toast').classList.add('hidden'); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      fs.mkdirSync(path.dirname(process.env.LITTLE_BOT_SCREENSHOT), { recursive: true });
      fs.writeFileSync(process.env.LITTLE_BOT_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await controller.close();
    await startRuntime();
    await window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await waitUntil(() => evaluate('Boolean(state?.settings)'), 'renderer restart loaded persisted state');
    assert.equal(store.data.chats.length, 1);
    assert.equal(store.data.chats[0].id, singletonId);
    assert.equal(store.data.chats[0].messages.length, historyCount);
    assert.equal(store.memoryService.get(memoryId).pinned, true);
    assert.match(store.memoryService.sources(memoryId)[0].text, /We chose pnpm/);
    assert.equal((await evaluate(`window.bot.searchMemory({query:'pnpm',type:'decision'})`)).records[0].id, memoryId);
    await evaluate(`window.bot.send({text:'Continue with the same project.'})`);
    await completeForeground('Continuing in the same project.');
    assert.equal(store.data.chats[0].id, singletonId);
    assert.equal(store.data.chats.length, 1);
    assert(transport.calls.some(call => call.method === 'thread/resume'), 'Restart resumes the persisted engine thread.');
    assert.deepEqual(runtimeErrors, []);
    console.log(JSON.stringify({ electron: process.versions.electron, sqlite: process.versions.sqlite, singletonId, persistedMessages: historyCount, learnedMemory: memoryId, verified: ['production IPC', 'SQLite Electron runtime', 'automatic extraction', 'source provenance', 'pin', 'agent memory tools', 'IPC forget', 'embedding config', 'paused management', 'project alias', 'model/workspace rotation', 'renderer', 'restart persistence'] }));
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    await controller?.close();
    for (const channel of channels) ipcMain.removeHandler(channel);
    app.quit();
  }
}
run().catch(error => { console.error(error.stack || error); app.exit(1); });

