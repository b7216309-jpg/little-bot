'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { defaultExtensions, normalizeExtensions, validateServer, validateSkill, parseSkill, ExtensionFiles } = require('../src/extensions.cjs');

function fixture(t) {
  const testRoot = path.resolve(__dirname, '../../../work/extension-tests');
  fs.mkdirSync(testRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(testRoot, 'fixture-'));
  t.after(() => {
    if (path.dirname(directory) !== testRoot || !path.basename(directory).startsWith('fixture-')) throw new Error('Unexpected test cleanup target.');
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const store = { data: { extensions: defaultExtensions() } };
  return { directory, store, files: new ExtensionFiles({ root: directory, store }) };
}
function write(root, file, value) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  return target;
}
function skill(name = 'brief', body = 'Write a concise answer.') { return `---\nname: ${name}\ndescription: A useful instruction.\n---\n${body}\n`; }
function plugin(root, manifest = {}) {
  write(root, 'plugin.json', { name: 'sample', version: '1.0.0', description: 'Example package.', ...manifest });
  write(root, 'skills/brief/SKILL.md', skill());
}

test('stdio configuration preserves repeated, empty, and whitespace arguments without shell parsing', () => {
  const server = validateServer({ name: 'sample', command: 'node', args: ['-e', '  value ', '', 'x', 'x'], envVars: ['MCP_TOKEN', 'MCP_TOKEN'] });
  assert.deepEqual(server.args, ['-e', '  value ', '', 'x', 'x']);
  assert.deepEqual(server.envVars, ['MCP_TOKEN']);
  assert.equal(server.enabled, false);
  assert.equal(server.transport, 'stdio');
  assert.throws(() => validateServer({ name: 'sample', command: 'node', args: ['x'.repeat(2001)] }), /argument/i);
  assert.throws(() => validateServer({ name: 'sample', command: 'node', envVars: ['TOKEN=raw'] }), /invalid name/);
  assert.throws(() => validateServer({ name: 'sample', command: 'node', env: { TOKEN: 'secret' } }), /credentials/);
});

test('HTTP MCP requires TLS or canonical loopback and rejects credential-bearing URL components', () => {
  for (const url of ['https://example.test/mcp', 'http://localhost:3000/mcp', 'http://127.0.0.1:3000/mcp', 'http://[::1]:3000/mcp']) {
    const server = validateServer({ name: 'remote', transport: 'http', url, bearerTokenEnvVar: 'MCP_TOKEN' });
    assert.equal(server.bearerTokenEnvVar, 'MCP_TOKEN');
  }
  for (const url of ['http://example.test/mcp', 'file:///tmp/socket', 'https://name:secret@example.test/mcp', 'https://example.test/mcp?token=secret', 'https://example.test/mcp#secret', 'http://localhost.example.test/mcp']) {
    assert.throws(() => validateServer({ name: 'remote', transport: 'http', url }));
  }
  assert.throws(() => validateServer({ name: 'remote', url: 'https://example.test/mcp', bearerTokenEnvVar: 'TOKEN=secret' }), /invalid name/);
});

test('record validation whitelists persisted fields and cannot change existing IDs', () => {
  const input = { name: 'sample', command: 'node', args: [], arbitrary: { payload: true } };
  const first = validateServer(input);
  assert.equal('arbitrary' in first, false);
  assert.throws(() => validateServer({ ...input, id: 'different' }, first), /ID cannot/);
  const modified = validateServer({ ...input, id: first.id, enabled: true }, first);
  assert.equal(modified.id, first.id);
  assert.equal(modified.createdAt, first.createdAt);
  assert.throws(() => validateServer({ ...input, name: '../bad' }), /slug/);
  assert.throws(() => validateSkill({ name: 'fine', description: 'ok', content: 'x'.repeat(20001) }), /20000/);
});

test('SKILL.md frontmatter supports plain, quoted, folded, and literal strings', () => {
  const a = parseSkill(`\uFEFF---\r\nname: 'my-skill'\r\ndescription: >\r\n  First line\r\n  second line.\r\n---\r\nDo the task.\r\n`);
  assert.equal(a.name, 'my-skill');
  assert.equal(a.description, 'First line second line.');
  assert.equal(a.content, 'Do the task.');
  const b = parseSkill('---\nname: "another"\ndescription: |\n  First\n  second\n---\nInstructions');
  assert.equal(b.description, 'First\nsecond');
  assert.equal(parseSkill("---\nname: plain\ndescription: 'It''s useful'\n---\nGo").description, "It's useful");
  assert.throws(() => parseSkill('---\nname: foo\n---\nGo'), /description/);
  assert.throws(() => parseSkill('---\nname: foo\nname: bar\ndescription: hello\n---\nGo'), /repeats/);
  assert.throws(() => parseSkill('---\nname: foo\ndescription: *alias\n---\nGo'), /plain text/);
});

test('standalone skill import and edits are passive, bounded, and collision-safe', async t => {
  const f = fixture(t);
  const target = write(f.directory, 'SKILL.md', skill());
  const imported = await f.files.importSkill(target);
  assert.equal(f.store.data.extensions.skills.length, 1);
  assert.equal(imported.enabled, true);
  assert.equal(fs.readFileSync(target, 'utf8'), skill());
  const edited = f.files.saveSkill({ ...imported, content: 'New instruction', enabled: false });
  assert.equal(edited, imported);
  assert.equal(imported.content, 'New instruction');
  await assert.rejects(f.files.importSkill(target), /already exists/);
  f.files.removeSkill(imported.id);
  assert.equal(f.store.data.extensions.skills.length, 0);
  assert.throws(() => f.files.saveSkill({ id: 'unknown', name: 'x', description: 'x', content: 'x' }), /not found/);
});

test('plugin import collects instruction skills and servers but remains disabled', async t => {
  const f = fixture(t);
  plugin(f.directory);
  write(f.directory, '.mcp.json', { mcpServers: { 'word-count': { command: 'node', args: ['--version'], env_vars: ['MCP_TOKEN'] } } });
  const imported = await f.files.importPlugin(f.directory);
  const state = f.store.data.extensions;
  assert.equal(imported.enabled, false);
  assert.equal(state.skills[0].pluginId, imported.id);
  assert.equal(state.servers[0].pluginId, imported.id);
  assert.equal(state.skills[0].enabled, true);
  assert.equal(state.servers[0].enabled, true);
  assert.deepEqual(imported.skillIds, [state.skills[0].id]);
  assert.deepEqual(imported.serverIds, [state.servers[0].id]);
  f.files.setPluginEnabled({ id: imported.id, enabled: true });
  assert.equal(imported.enabled, true);
  assert.throws(() => f.files.saveSkill({ ...state.skills[0], content: 'hijack' }), /managed/);
  assert.throws(() => f.files.removeSkill(state.skills[0].id), /owning plugin/);
  await assert.rejects(f.files.importPlugin(f.directory), /already exists/);
});

test('plugin removal removes only its owned records and leaves source files', async t => {
  const f = fixture(t);
  plugin(f.directory);
  const standalone = f.files.saveSkill({ name: 'standalone', description: 'Own skill', content: 'Do useful work.' });
  const imported = await f.files.importPlugin(f.directory);
  f.files.removePlugin(imported.id);
  assert.deepEqual(f.store.data.extensions.skills.map(item => item.id), [standalone.id]);
  assert.equal(fs.existsSync(path.join(f.directory, 'skills/brief/SKILL.md')), true);
  assert.throws(() => f.files.setPluginEnabled({ id: imported.id, enabled: true }), /not found/);
});

test('failed plugin validation commits no skills or servers', async t => {
  const f = fixture(t);
  plugin(f.directory);
  write(f.directory, 'mcp.json', { mcpServers: { first: { command: 'node' }, broken: { command: 'node', env: { API_KEY: 'raw-secret' } } } });
  const before = structuredClone(f.store.data.extensions);
  await assert.rejects(f.files.importPlugin(f.directory), /unsupported fields/);
  assert.deepEqual(f.store.data.extensions, before);
  write(f.directory, 'mcp.json', { mcpServers: { first: { command: 'node' } } });
  write(f.directory, 'skills/second/SKILL.md', skill());
  await assert.rejects(f.files.importPlugin(f.directory), /duplicate skill/);
  assert.deepEqual(f.store.data.extensions, before);
});

test('plugin paths cannot traverse or target external linked folders', async t => {
  const f = fixture(t);
  const source = path.join(f.directory, 'source');
  plugin(source, { skills: '../outside' });
  await assert.rejects(f.files.importPlugin(source), /relative/);
  const outside = path.join(f.directory, 'outside');
  write(outside, 'SKILL.md', skill('outside'));
  write(source, 'plugin.json', { name: 'sample', version: '1', skills: 'linked' });
  fs.symlinkSync(outside, path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.files.importPlugin(source), /escapes/);
  assert.deepEqual(f.store.data.extensions, defaultExtensions());
});

test('plugin root placeholders resolve only existing paths contained in the source package', async t => {
  const f = fixture(t);
  const source = path.join(f.directory, 'source');
  plugin(source);
  const script = write(source, 'server.cjs', 'throw new Error("must not execute at import");');
  write(source, 'mcp.json', { mcpServers: { demo: { command: 'node', args: ['${PLUGIN_ROOT}/server.cjs'] } } });
  await f.files.importPlugin(source);
  assert.equal(f.store.data.extensions.servers[0].args[0], fs.realpathSync(script));
  const second = fixture(t);
  plugin(second.directory);
  write(second.directory, 'mcp.json', { mcpServers: { demo: { command: 'node', args: ['${PLUGIN_ROOT}/../secret'] } } });
  await assert.rejects(second.files.importPlugin(second.directory), /relative/);
  write(second.directory, 'mcp.json', { mcpServers: { demo: { command: 'node', args: ['${HOME}/secret'] } } });
  await assert.rejects(second.files.importPlugin(second.directory), /Only/);
  write(second.directory, 'mcp.json', { mcpServers: { demo: { command: 'node', args: ['${CODEX_PLUGIN_ROOT}/missing.cjs'] } } });
  await assert.rejects(second.files.importPlugin(second.directory), /ENOENT/);
});

test('plugin root script placeholders reject an escaping junction', async t => {
  const f = fixture(t);
  const source = path.join(f.directory, 'source');
  plugin(source);
  const outside = path.join(f.directory, 'outside');
  write(outside, 'script.cjs', 'console.log("outside")');
  fs.symlinkSync(outside, path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  write(source, 'mcp.json', { mcpServers: { demo: { command: 'node', args: ['${PLUGIN_ROOT}/linked/script.cjs'] } } });
  await assert.rejects(f.files.importPlugin(source), /escapes/);
  assert.deepEqual(f.store.data.extensions, defaultExtensions());
});

test('unsupported executable plugin features and oversized imports are rejected atomically', async t => {
  const f = fixture(t);
  plugin(f.directory, { hooks: './hooks.json' });
  await assert.rejects(f.files.importPlugin(f.directory), /not supported/);
  plugin(f.directory);
  write(f.directory, 'skills/brief/SKILL.md', 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(f.files.importPlugin(f.directory), /1 MiB/);
  assert.deepEqual(f.store.data.extensions, defaultExtensions());
});

test('normalization preserves disabled owners, rebuilds ownership, and removes corrupt or orphan records', () => {
  const now = Date.now();
  const result = normalizeExtensions({
    plugins: [{ id: 'owner', name: 'owner', version: '1', sourcePath: 'C:\\plugins\\owner', installedAt: now, enabled: false, skillIds: ['forged'] }],
    skills: [
      { id: 'owned', name: 'owned', description: 'Useful', content: 'Instruction', enabled: true, pluginId: 'owner', createdAt: now - 10, updatedAt: now - 5 },
      { id: 'orphan', name: 'orphan', description: 'Useful', content: 'Instruction', pluginId: 'missing' },
      { id: 'invalid', name: '../bad', description: 'x', content: 'x' },
    ],
    servers: [{ name: 'remote', url: 'https://example.test/mcp?secret=x' }, { name: 'fine', command: 'node', pluginId: 'owner', enabled: true }],
  });
  assert.equal(result.plugins[0].enabled, false);
  assert.deepEqual(result.plugins[0].skillIds, ['owned']);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].updatedAt, now - 5);
  assert.equal(result.servers.length, 1);
  assert.equal(result.servers[0].name, 'fine');
  assert.equal(result.servers[0].enabled, true);
});

test('concurrent imports cannot overwrite a package with the same name', async t => {
  const f = fixture(t);
  plugin(f.directory);
  const results = await Promise.allSettled([f.files.importPlugin(f.directory), f.files.importPlugin(f.directory)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.store.data.extensions.plugins.length, 1);
  assert.equal(f.store.data.extensions.skills.length, 1);
});

test('Codex manifests support declared MCP files and inert schema or interface metadata', async t => {
  const f = fixture(t);
  write(f.directory, '.codex-plugin/plugin.json', {
    name: 'codex-sample', version: '1.0.0', skills: [], mcpServers: './config/remote.json',
    $schema: 'https://never-fetch.invalid/schema.json',
    interface: { displayName: 'Codex sample', icon: 'https://never-fetch.invalid/icon.svg' },
  });
  write(f.directory, 'config/remote.json', { mcpServers: { remote: { type: 'streamable-http', url: 'https://example.test/mcp' } } });
  // An explicit path selects exactly that file; implicit alternatives are not read.
  write(f.directory, '.mcp.json', 'invalid ignored JSON');
  const imported = await f.files.importPlugin(f.directory);
  assert.equal(imported.enabled, false);
  assert.equal(f.store.data.extensions.servers[0].transport, 'http');
  assert.equal(f.store.data.extensions.servers[0].url, 'https://example.test/mcp');
  assert.equal(Object.hasOwn(imported, '$schema'), false);
  assert.equal(Object.hasOwn(imported, 'interface'), false);
  assert.equal(validateServer({ name: 'alias', transport: 'streamable_http', url: 'http://localhost:3456/mcp' }).transport, 'http');
});

test('declared MCP files retain path boundaries and credential rejection', async t => {
  const f = fixture(t);
  const source = path.join(f.directory, 'source');
  plugin(source, { mcpServers: '../outside/mcp.json' });
  const outside = path.join(f.directory, 'outside');
  write(outside, 'mcp.json', { mcpServers: { outside: { command: 'node' } } });
  await assert.rejects(f.files.importPlugin(source), /relative/);
  fs.symlinkSync(outside, path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  plugin(source, { mcpServers: './linked/mcp.json' });
  await assert.rejects(f.files.importPlugin(source), /escapes/);
  plugin(source, { mcpServers: './missing.json' });
  await assert.rejects(f.files.importPlugin(source), /does not exist/);
  plugin(source, { mcpServers: { inline: { command: 'node' } } });
  await assert.rejects(f.files.importPlugin(source), /relative/);
  plugin(source, { mcpServers: './config/mcp.json' });
  write(source, 'config/mcp.json', { mcpServers: { unsafe: { type: 'streamable_http', url: 'https://example.test/mcp', headers: { Authorization: 'raw' } } } });
  await assert.rejects(f.files.importPlugin(source), /unsupported fields/);
  assert.deepEqual(f.store.data.extensions, defaultExtensions());
});
