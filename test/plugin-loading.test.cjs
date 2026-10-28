'use strict';

// Optional plugins that are on cost one plugin_load line until a conversation loads them, and leave again at a
// compaction once unused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentTools } = require('../src/agent-tools.cjs');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Store } = require('../src/store.cjs');

function plugin(name, { enabled = true, panel = false } = {}) {
  return {
    enabled, panel, calls: 0,
    specs() { return this.enabled ? [{ type: 'function', name, description: name, inputSchema: { type: 'object', properties: {}, additionalProperties: true } }] : []; },
    owns(tool) { return tool === name; },
    async call() { this.calls++; return { ok: name }; },
  };
}
function setup(options = {}) {
  const store = { data: { settings: {}, extensions: {}, memory: {} }, saves: 0, save() { this.saves++; } };
  const plugins = { cad: plugin('cad', options.cad), draughts: plugin('draughts', options.draughts), torrents: plugin('torrents', options.torrents) };
  const tools = new AgentTools({ store, ...plugins });
  const chat = { id: 'main', status: 'running', messages: [] };
  return { store, plugins, tools, chat };
}
const names = specs => specs.map(tool => tool.name).filter(name => ['cad', 'draughts', 'torrents', 'plugin_load'].includes(name));

test('plugins that are on wait behind one plugin_load tool that names them', () => {
  const { tools, plugins } = setup({ torrents: { enabled: false } });
  const specs = tools.specs();
  assert.deepEqual(names(specs), ['plugin_load']);
  const loader = specs.find(tool => tool.name === 'plugin_load');
  assert.deepEqual(loader.inputSchema.properties.name.enum, ['cad', 'draughts']);
  assert.match(loader.description, /cad: design 3D-printable parts/);
  assert.doesNotMatch(loader.description, /torrent/, 'a plugin that is off is not mentioned');
  assert.ok(loader.description.length < 400, 'the waiting plugins stay short');
  // Loaded ones are offered in full, the loader keeps only the rest, and goes once nothing is left.
  assert.deepEqual(names(tools.specs({ loaded: ['cad'] })), ['cad', 'plugin_load']);
  assert.deepEqual(tools.specs({ loaded: ['cad'] }).find(tool => tool.name === 'plugin_load').inputSchema.properties.name.enum, ['draughts']);
  assert.deepEqual(names(tools.specs({ loaded: ['cad', 'draughts'] })), ['cad', 'draughts']);
  plugins.cad.enabled = plugins.draughts.enabled = false;
  assert.deepEqual(names(tools.specs({ loaded: ['cad'] })), [], 'nothing on, nothing offered');
  assert.deepEqual(names(tools.specs({ readOnly: true })), [], 'nothing in Plan mode');
});

test('plugin_load loads a plugin into the running conversation, and only there', async () => {
  const { tools, store, chat, plugins } = setup();
  await assert.rejects(tools.call('cad', {}, { chat }), /Unknown tool "cad"/, 'not loaded yet');
  const result = await tools.call('plugin_load', { name: 'cad' }, { chat });
  assert.equal(result.loaded, 'cad');
  assert.deepEqual(chat.plugins.map(item => item.name), ['cad']);
  assert.ok(store.saves > 0);
  assert.deepEqual(tools.loadedPlugins(chat), ['cad']);
  assert.deepEqual(await tools.call('cad', {}, { chat }), { ok: 'cad' });
  assert.equal(plugins.cad.calls, 1);
  await assert.rejects(tools.call('plugin_load', { name: 'chess' }, { chat }), /draughts|torrents/);
  // A scheduled task has full access; background work and finished conversations do not.
  const scheduled = { id: 'a', automationId: 'x', status: 'running' };
  assert.equal((await tools.call('plugin_load', { name: 'draughts' }, { chat: scheduled })).loaded, 'draughts');
  for (const other of [{ id: 'h', internal: true, status: 'running' }, { id: 's', status: 'idle' }]) {
    await assert.rejects(tools.call('plugin_load', { name: 'draughts' }, { chat: other }), /own running conversation/);
    assert.equal(other.plugins, undefined);
  }
  // A plugin switched off leaves the conversation's tools even while it stays on the list.
  plugins.cad.enabled = false;
  assert.deepEqual(tools.loadedPlugins(chat), []);
});

test('an unused plugin leaves at a compaction unless its panel is open', () => {
  const { tools, chat, plugins } = setup();
  const old = Date.now() - 60_000;
  chat.plugins = [{ name: 'cad', usedAt: old }, { name: 'draughts', usedAt: old }, { name: 'torrents', usedAt: old }];
  // Fewer than five turns: everything counts as recent.
  chat.messages = [{ role: 'user', createdAt: old - 1000 }];
  assert.equal(tools.dropIdlePlugins(chat), false);
  chat.messages = Array.from({ length: 6 }, (_, index) => ({ role: 'user', createdAt: old + 1000 * (index + 1) }));
  plugins.draughts.panel = true;
  tools.usePlugins(chat, ['torrents']);
  assert.equal(tools.dropIdlePlugins(chat), true);
  assert.deepEqual(chat.plugins.map(item => item.name), ['draughts', 'torrents']);
  assert.equal(tools.dropIdlePlugins(chat), false);
  assert.equal(tools.usePlugins(chat, ['cad']), true, 'using the panel loads it again');
  assert.equal(tools.usePlugins({ id: 'h', internal: true }, ['cad']), false, 'not for background work');
});

test('the loaded plugins are saved with the conversation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-plugins-store-'));
  try {
    const store = new Store({ filePath: path.join(dir, 'state.json'), defaultWorkspace: dir });
    store.data.chats.push({ id: 'c1', title: 'x', messages: [], plugins: [{ name: 'cad', usedAt: 5 }, { name: 'cad', usedAt: 6 }, { name: 'shell' }, 'draughts', { name: 'torrents' }] });
    store.save();
    const again = new Store({ filePath: path.join(dir, 'state.json'), defaultWorkspace: dir });
    assert.deepEqual(again.data.chats.find(chat => chat.id === 'c1').plugins, [{ name: 'cad', usedAt: 5 }, { name: 'torrents', usedAt: 0 }]);
    again.data.chats.find(chat => chat.id === 'c1').plugins = [];
    again.save();
    const third = new Store({ filePath: path.join(dir, 'state.json'), defaultWorkspace: dir });
    assert.equal(third.data.chats.find(chat => chat.id === 'c1').plugins, undefined);
    store.close(); again.close(); third.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
