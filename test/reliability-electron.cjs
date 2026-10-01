'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { app, BrowserWindow, ipcMain } = require('electron');
const { Store } = require('../src/store.cjs');
const { Controller } = require('../src/controller.cjs');
const { Attachments } = require('../src/attachments.cjs');
const { MemoryConsolidator } = require('../src/memory-consolidator.cjs');
const { saveFact, deleteFact, clearEpisodes } = require('../src/memory.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-reliability-ui-'));
app.setPath('userData', path.join(root, 'electron'));
process.env.LITTLE_BOT_DATA_DIR = path.join(root, 'data');
let store, controller, window;
const errors = [], channels = [];
class FakeTransport extends EventEmitter {
  async start() {}
  async close() {}
  async request(method) {
    if (method === 'account/read') return { account: { type: 'apiKey' } };
    if (method === 'account/rateLimits/read') return { rateLimits: {} };
    if (method === 'model/list') return { data: [{ id: 'fixture', model: 'fixture', supportedReasoningEfforts: [] }] };
    throw new Error('Unexpected request: ' + method);
  }
}
function register(name, handler) {
  const channel = 'bot:' + name; channels.push(channel);
  ipcMain.handle(channel, (_event, value) => handler(value));
}
const evaluate = code => window.webContents.executeJavaScript(code);
async function wait(predicate, description) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out: ' + description);
}
async function run() {
  await app.whenReady();
  try {
    store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
    Object.assign(store.data.settings, { connection: 'codex', model: 'fixture', codexModel: 'fixture', independentCheckMode: 'off' });
    store.data.chats = [{ id: 'continuous-fixture', title: 'Conversation', workspace: root, connection: 'codex', model: 'fixture', status: 'idle', messages: [] }];
    controller = new Controller({ store, client: new FakeTransport(), onError: (_source, error) => errors.push(error.message) });
    controller.memoryConsolidator = new MemoryConsolidator(controller, { autoStart: false });
    controller.attachments = new Attachments({ root: path.join(root, 'attachments'), references: () =>
      store.data.chats.flatMap(chat => chat.messages.flatMap(message => (message.attachments || []).map(item => item.id))) });
    controller.attachmentStorage = await controller.attachments.storage();
    await controller.start();
    controller.on('event', event => { if (window && !window.isDestroyed()) window.webContents.send('bot:event', event); });
    register('getState', () => controller.state());
    register('getContextUsed', ({ chatId }) => controller.contextUsedFor(chatId));
    register('reportError', input => errors.push(input.message));
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
    const attachStart = source.indexOf("  register('chooseAttachments',"), attachEnd = source.indexOf("  register('openAttachment',", attachStart);
    const memoryStart = source.indexOf("  register('saveMemory',"), memoryEnd = source.indexOf("  register('saveHeartbeat',", memoryStart);
    assert(attachStart > 0 && attachEnd > attachStart && memoryStart > 0 && memoryEnd > memoryStart);
    const sourceFile = path.join(root, 'original.txt'); fs.writeFileSync(sourceFile, 'The original source stays intact.');
    // Run actual IPC registrations, with only the native file picker simulated.
    const idleStart = source.indexOf('  function ensureExtensionsIdle()'), idleEnd = source.indexOf('  async function updateExtensions(', idleStart);
    const scope = { register, store, controller, window: null, goals: { activeId: null }, heartbeat: { running: false }, scheduler: { runningId: null },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [sourceFile] }) }, saveFact, deleteFact, clearEpisodes };
    vm.runInNewContext(source.slice(idleStart, idleEnd) + source.slice(attachStart, attachEnd) + source.slice(memoryStart, memoryEnd), scope);
    window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    await window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await wait(() => evaluate('Boolean(state?.settings)'), 'initial state');
    await evaluate("document.getElementById('attach-button').click()");
    await wait(() => evaluate('queuedAttachments().length === 1 && !attachmentImportPending'), 'draft import');
    const draftId = await evaluate('queuedAttachments()[0].id');
    assert(fs.existsSync(controller.attachments._directory(draftId)));
    await evaluate("document.querySelector('#attachment-queue .attachment-remove').click()");
    await wait(() => evaluate('queuedAttachments().length === 0 && !attachmentImportPending'), 'draft removed');
    assert(!fs.existsSync(controller.attachments._directory(draftId)), 'Draft removal must free disk space.');
    const saved = (await controller.attachments.importPaths([sourceFile]))[0];
    const chat = store.data.chats[0];
    chat.messages.push({ id: 'saved-message', role: 'user', text: 'Keep this message text.', status: 'completed', attachments: [saved] });
    store.save(); await controller.attachments.release(saved.id);
    controller.attachmentStorage = await controller.attachments.storage(); controller.changed();
    await wait(() => evaluate("Boolean(document.querySelector('.attachment-actions'))"), 'saved attachment');
    await evaluate("[...document.querySelectorAll('.attachment-actions button')].find(b => b.textContent.includes('Remove')).click()");
    await wait(() => evaluate("document.getElementById('confirm-dialog').open"), 'remove confirmation');
    await evaluate("document.getElementById('confirm-accept').click()");
    await wait(() => !fs.existsSync(controller.attachments._directory(saved.id)), 'saved file removed');
    assert.equal(chat.messages.at(-1).text, 'Keep this message text.');
    assert.equal(chat.messages.at(-1).attachments.length, 0);
    assert.equal(fs.readFileSync(sourceFile, 'utf8'), 'The original source stays intact.');
    await evaluate("document.getElementById('nav-settings').click()");
    await wait(() => evaluate("document.getElementById('settings-attachment-usage').textContent.includes('0 saved or pending files')"), 'settings storage usage');
    await evaluate("document.querySelector('[data-close=\"settings-dialog\"]').click()");
    const pending = (await controller.attachments.importPaths([sourceFile]))[0];
    const orphan = (await controller.attachments.importPaths([sourceFile]))[0]; controller.attachments.pending.delete(orphan.id);
    const result = await evaluate('window.bot.cleanupAttachments()');
    assert.equal(result.removed, 1); assert(fs.existsSync(controller.attachments._directory(pending.id)));
    assert(!fs.existsSync(controller.attachments._directory(orphan.id)));
    const failed = () => {
      const job = store.memoryService.enqueueExtraction({ id: chat.id, status: 'idle', messages: [
        { id: 'u'+Math.random(), role: 'user', text: 'Remember brief replies.' }, { id: 'a'+Math.random(), role: 'assistant', text: 'Understood.' }] });
      for (let i = 0; i < 3; i++) store.memoryService.failExtraction(job.id, new Error('Fixture invalid JSON'));
      return job;
    };
    const first = failed(); controller.changed();
    await evaluate("document.getElementById('nav-memory').click()");
    await wait(() => evaluate("document.querySelectorAll('#memory-learning-failures article').length === 1"), 'failed learning UI');
    await evaluate("[...document.querySelectorAll('#memory-learning-failures button')].find(b => b.textContent === 'Retry').click()");
    await wait(() => store.memoryService.pendingExtractions().some(job => job.id === first.id && job.attempts === 0), 'retry IPC');
    store.memoryService.completeExtraction(first.id, []);
    const second = failed(); controller.changed();
    await wait(() => evaluate("document.querySelectorAll('#memory-learning-failures article').length === 1"), 'second failure');
    await evaluate("[...document.querySelectorAll('#memory-learning-failures button')].find(b => b.textContent === 'Discard').click()");
    await wait(() => store.memoryService.db.prepare('SELECT status FROM extraction_jobs WHERE id=?').get(second.id).status === 'discarded', 'discard IPC');
    await wait(() => evaluate("document.querySelectorAll('#memory-learning-failures article').length === 0"), 'discard result rendered');
    await evaluate('refreshMemoryResults()');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ verified: ['production attachment IPC', 'draft disk cleanup', 'saved removal and source retention', 'storage UI', 'orphan cleanup preserves drafts', 'production memory retry/discard IPC'] }));
  } catch (error) {
    console.error('Primary fixture failure:', error.stack || error); throw error;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    await controller?.close(); for (const channel of channels) ipcMain.removeHandler(channel);
    app.quit();
  }
}
run().catch(error => { console.error(error.stack || error); app.exit(1); });
