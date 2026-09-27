'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const LIMITS = Object.freeze({ servers: 30, skills: 100, plugins: 20, pluginSkills: 20, importBytes: 1024 * 1024 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const slug = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const envName = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const timestamp = (value, fallback) => Number.isFinite(value) && value >= 0 ? value : fallback;

function boundedText(value, label, max, required = false) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    throw new Error(`${label} must be text.`);
  }
  const result = value.trim();
  if ((required && !result) || result.length > max || result.includes('\0')) {
    throw new Error(`${label} must contain ${required ? '1–' : 'at most '}${max} characters without null bytes.`);
  }
  return result;
}

function nameOf(value, label = 'Name') {
  const name = boundedText(value, label, 64, true);
  if (!slug.test(name)) throw new Error(`${label} must be a lowercase slug using letters, numbers, hyphens, or underscores.`);
  return name;
}

function idOf(input, existing) {
  if (existing && input.id !== undefined && input.id !== existing.id) throw new Error('The extension ID cannot be changed.');
  if (existing) return existing.id;
  return input.id == null ? randomUUID() : boundedText(input.id, 'ID', 100, true);
}

function textArray(value, label, { max = 50, itemMax = 2000, pattern } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must be a list with at most ${max} entries.`);
  return [...new Set(value.map(entry => {
    const text = boundedText(entry, label, itemMax, true);
    if (pattern && !pattern.test(text)) throw new Error(`${label} contains an invalid name.`);
    return text;
  }))];
}

function validateServer(input, existing = null) {
  if (!object(input)) throw new Error('An MCP server configuration is required.');
  if (input.env != null || input.headers != null || input.http_headers != null || input.bearerToken != null || input.bearer_token != null) {
    throw new Error('Store credentials in environment variables; raw environment values, tokens, and headers are not supported.');
  }
  const requestedTransport = input.transport ?? input.type ?? (input.url ? 'http' : 'stdio');
  const transport = ['streamable-http', 'streamable_http'].includes(requestedTransport) ? 'http' : requestedTransport;
  if (!['stdio', 'http'].includes(transport)) throw new Error('MCP transport must be stdio or http.');
  const now = Date.now();
  const record = {
    id: idOf(input, existing), name: nameOf(input.name, 'Server name'), transport,
    command: '', args: [], envVars: [], url: '', bearerTokenEnvVar: '',
    enabled: input.enabled === true, disabledTools: textArray(input.disabledTools, 'Disabled tools', { max: 200, itemMax: 200 }),
    createdAt: timestamp(existing?.createdAt ?? input.createdAt, now), updatedAt: now,
  };
  if (transport === 'stdio') {
    record.command = boundedText(input.command, 'Command', 1000, true);
    if (input.args != null && (!Array.isArray(input.args) || input.args.length > 50)) throw new Error('Arguments must be a list with at most 50 entries.');
    record.args = (input.args || []).map(value => {
      if (typeof value !== 'string' || value.length > 2000 || value.includes('\0')) throw new Error('Each command argument must be text with at most 2000 characters and no null bytes.');
      return value;
    });
    // These strings are arguments, not a shell script. Plugin imports resolve root paths before validation.
    if ([record.command, ...record.args].some(value => /\$\{/.test(value))) {
      throw new Error('Command placeholders must be resolved by a plugin import; use an installed MCP command or an absolute path.');
    }
    record.envVars = textArray(input.envVars ?? input.env_vars, 'Environment variables', { max: 50, itemMax: 128, pattern: envName });
  } else {
    record.url = boundedText(input.url, 'Server URL', 2000, true);
    let url;
    try { url = new URL(record.url); } catch { throw new Error('Server URL must be a valid HTTPS URL or loopback HTTP URL.'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Use HTTPS, or HTTP on localhost only.');
    if (url.username || url.password || url.search || url.hash) throw new Error('MCP URLs cannot contain credentials, query strings, or fragments. Use a token environment variable.');
    record.url = url.href;
    record.bearerTokenEnvVar = boundedText(input.bearerTokenEnvVar ?? input.bearer_token_env_var, 'Token environment variable', 128);
    if (record.bearerTokenEnvVar && !envName.test(record.bearerTokenEnvVar)) throw new Error('Token environment variable has an invalid name.');
  }
  if (input.pluginId != null) record.pluginId = boundedText(input.pluginId, 'Plugin ID', 100, true);
  return record;
}

function validateSkill(input, existing = null) {
  if (!object(input)) throw new Error('A skill is required.');
  const now = Date.now();
  const skill = {
    id: idOf(input, existing), name: nameOf(input.name, 'Skill name'),
    description: boundedText(input.description, 'Skill description', 1000, true),
    content: boundedText(input.content, 'Skill instructions', 20000, true),
    enabled: input.enabled !== false,
    createdAt: timestamp(existing?.createdAt ?? input.createdAt, now), updatedAt: now,
  };
  if (input.pluginId != null) skill.pluginId = boundedText(input.pluginId, 'Plugin ID', 100, true);
  if (input.bundled === true || existing?.bundled === true) skill.bundled = true;
  return skill;
}

function defaultExtensions() { return { servers: [], skills: [], plugins: [] }; }

function pluginRecord(input) {
  if (!object(input)) throw new Error('Plugin metadata is required.');
  return {
    id: boundedText(input.id, 'Plugin ID', 100, true), name: nameOf(input.name, 'Plugin name'),
    version: boundedText(input.version, 'Plugin version', 80, true),
    description: boundedText(input.description, 'Plugin description', 1000),
    enabled: input.enabled === true,
    sourcePath: boundedText(input.sourcePath, 'Plugin source folder', 4000, true),
    installedAt: timestamp(input.installedAt, Date.now()), skillIds: [], serverIds: [],
  };
}

function normalizeExtensions(value) {
  const result = defaultExtensions();
  if (!object(value)) return result;
  if (Number.isInteger(value.starterSkillsVersion) && value.starterSkillsVersion > 0) result.starterSkillsVersion = value.starterSkillsVersion;
  for (const input of (Array.isArray(value.plugins) ? value.plugins : []).slice(0, LIMITS.plugins)) {
    try {
      const record = pluginRecord(input);
      if (!result.plugins.some(item => item.id === record.id || item.name === record.name)) result.plugins.push(record);
    } catch { /* Invalid persisted entries are omitted rather than activated. */ }
  }
  for (const [key, validate] of [['servers', validateServer], ['skills', validateSkill]]) {
    for (const input of (Array.isArray(value[key]) ? value[key] : []).slice(0, LIMITS[key])) {
      try {
        const record = validate(input);
        record.updatedAt = timestamp(input.updatedAt, record.createdAt);
        if (record.pluginId && !result.plugins.some(plugin => plugin.id === record.pluginId)) continue;
        if (result[key].some(item => item.id === record.id || item.name === record.name)) continue;
        result[key].push(record);
      } catch { /* Invalid persisted entries are omitted. */ }
    }
  }
  for (const plugin of result.plugins) {
    plugin.skillIds = result.skills.filter(skill => skill.pluginId === plugin.id).map(skill => skill.id);
    plugin.serverIds = result.servers.filter(server => server.pluginId === plugin.id).map(server => server.id);
  }
  return result;
}

// A deliberately small frontmatter reader: name and description support strings and block scalars.
// Other metadata stays inert. YAML aliases, tags, nested maps, and executable config are not interpreted.
function parseSkill(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > LIMITS.importBytes) throw new Error('SKILL.md is too large.');
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') throw new Error('SKILL.md requires YAML frontmatter with name and description.');
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) throw new Error('SKILL.md has unclosed YAML frontmatter.');
  const fields = {};
  for (let index = 1; index < end; index++) {
    const match = /^(name|description):\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    if (Object.hasOwn(fields, match[1])) throw new Error(`SKILL.md repeats ${match[1]}.`);
    let value = match[2].trim();
    if (/^[|>][-+]?$/.test(value)) {
      const chunks = [];
      while (index + 1 < end && (/^\s+/.test(lines[index + 1]) || !lines[index + 1].trim())) chunks.push(lines[++index]);
      const indent = Math.min(...chunks.filter(line => line.trim()).map(line => /^\s*/.exec(line)[0].length));
      value = chunks.map(line => line.slice(Number.isFinite(indent) ? indent : 0)).join(value[0] === '>' ? ' ' : '\n').trim();
    } else if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { throw new Error(`SKILL.md ${match[1]} has an invalid quoted string.`); }
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw new Error(`SKILL.md ${match[1]} has an invalid quoted string.`);
      value = value.slice(1, -1).replace(/''/g, "'");
    } else {
      if (/^[&*!{\[]/.test(value)) throw new Error(`SKILL.md ${match[1]} must be plain text.`);
      value = value.replace(/\s+#.*$/, '').trim();
    }
    fields[match[1]] = value;
  }
  return validateSkill({ ...fields, content: lines.slice(end + 1).join('\n') });
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function localPath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative)
      || /^[A-Za-z]:/.test(relative) || relative.split(/[\\/]/).includes('..') || /^[\\/]/.test(relative)) {
    throw new Error('Plugin paths must be relative and stay inside the selected folder.');
  }
  const result = path.resolve(root, relative.replace(/[\\/]/g, path.sep));
  if (!within(root, result)) throw new Error('Plugin path escapes the selected folder.');
  return result;
}

class ExtensionFiles {
  constructor({ root, store }) {
    this.root = root;
    this.store = store;
    if (!object(store?.data)) throw new Error('An extension store is required.');
    if (!store.data.extensions) store.data.extensions = defaultExtensions();
  }

  get data() { return this.store.data.extensions; }

  unique(key, record, exceptId) {
    if (this.data[key].some(item => item.id !== exceptId && item.name === record.name)) throw new Error(`A ${key === 'skills' ? 'skill' : key === 'servers' ? 'server' : 'plugin'} named “${record.name}” already exists.`);
  }

  saveSkill(input) {
    const existing = input?.id ? this.data.skills.find(skill => skill.id === input.id) : null;
    if (input?.id && !existing) throw new Error('Skill not found.');
    if (existing?.pluginId || input?.pluginId) throw new Error('Plugin skills are managed by their plugin.');
    if (!existing && this.data.skills.length >= LIMITS.skills) throw new Error('The skill limit has been reached.');
    const record = validateSkill(input, existing);
    this.unique('skills', record, existing?.id);
    if (existing) Object.assign(existing, record);
    else this.data.skills.push(record);
    return existing || record;
  }

  removeSkill(id) {
    const existing = this.data.skills.find(skill => skill.id === id);
    if (!existing) throw new Error('Skill not found.');
    if (existing.pluginId) throw new Error('Remove the owning plugin to remove this skill.');
    this.data.skills = this.data.skills.filter(skill => skill.id !== id);
    return true;
  }

  async importSkill(filePath) {
    if (path.basename(filePath).toLowerCase() !== 'skill.md') throw new Error('Choose a SKILL.md file.');
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > LIMITS.importBytes) throw new Error('Choose a SKILL.md file no larger than 1 MiB.');
    const skill = parseSkill(await fs.readFile(filePath, 'utf8'));
    delete skill.id;
    return this.saveSkill(skill);
  }

  async importPlugin(directory) {
    if (this.data.plugins.length >= LIMITS.plugins) throw new Error('The plugin limit has been reached.');
    const root = await fs.realpath(directory);
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Choose a plugin folder.');
    let bytes = 0;
    const checked = async target => {
      const resolved = await fs.realpath(target);
      if (!within(root, resolved)) throw new Error('A plugin file or linked folder escapes the selected plugin folder.');
      return resolved;
    };
    const resolveArgument = async value => {
      if (typeof value !== 'string' || !value.includes('${')) return value;
      const match = /^\$\{(?:PLUGIN_ROOT|CODEX_PLUGIN_ROOT)\}(?:[\\/](.*))?$/.exec(value);
      if (!match || /\$\{/.test(match[1] || '')) throw new Error('Only ${PLUGIN_ROOT} or ${CODEX_PLUGIN_ROOT} at the beginning of an existing plugin path is supported.');
      return checked(match[1] ? localPath(root, match[1]) : root);
    };
    const exists = async target => {
      try { await fs.lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    };
    const read = async target => {
      const resolved = await checked(target);
      const stat = await fs.stat(resolved);
      if (!stat.isFile() || stat.size > LIMITS.importBytes - bytes) throw new Error('Plugin import exceeds the 1 MiB metadata limit.');
      const buffer = await fs.readFile(resolved);
      bytes += buffer.length;
      if (bytes > LIMITS.importBytes) throw new Error('Plugin import exceeds the 1 MiB metadata limit.');
      return buffer.toString('utf8');
    };
    const json = async target => {
      try { return JSON.parse(await read(target)); } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${path.basename(target)}.`);
        throw error;
      }
    };
    const manifests = ['plugin.json', '.codex-plugin/plugin.json'].map(relative => localPath(root, relative));
    let manifestPath;
    for (const candidate of manifests) if (await exists(candidate)) { manifestPath = candidate; break; }
    if (!manifestPath) throw new Error('The selected folder needs plugin.json or .codex-plugin/plugin.json.');
    const manifest = await json(manifestPath);
    if (!object(manifest)) throw new Error('Plugin manifest must be an object.');
    const allowed = new Set(['name', 'version', 'description', 'skills', 'mcpServers', '$schema', 'interface', 'author', 'license', 'homepage', 'repository', 'keywords']);
    for (const field of Object.keys(manifest)) if (!allowed.has(field)) throw new Error(`Plugin field “${field}” is not supported. Only instruction skills and declarative MCP servers can be imported.`);
    const plugin = pluginRecord({ ...manifest, id: randomUUID(), enabled: false, sourcePath: root, installedAt: Date.now() });
    this.unique('plugins', plugin);
    const skills = [], servers = [], seenFiles = new Set();
    const addSkill = async file => {
      const canonical = await checked(file);
      if (seenFiles.has(canonical)) return;
      seenFiles.add(canonical);
      if (skills.length >= LIMITS.pluginSkills) throw new Error('A plugin can contain at most 20 instruction skills.');
      const skill = parseSkill(await read(canonical));
      skill.pluginId = plugin.id;
      if (skills.some(item => item.name === skill.name)) throw new Error('Plugin contains duplicate skill names.');
      this.unique('skills', skill);
      skills.push(skill);
    };
    let skillPaths = manifest.skills === undefined ? ['skills'] : manifest.skills;
    if (typeof skillPaths === 'string') skillPaths = [skillPaths];
    if (!Array.isArray(skillPaths) || skillPaths.length > LIMITS.pluginSkills) throw new Error('Plugin skills must be a relative path or a list of at most 20 paths.');
    for (const relative of skillPaths) {
      const candidate = localPath(root, relative);
      if (!(await exists(candidate))) {
        if (manifest.skills === undefined) continue;
        throw new Error('A declared plugin skills path does not exist.');
      }
      const canonical = await checked(candidate);
      if ((await fs.stat(canonical)).isFile()) {
        if (path.basename(canonical).toLowerCase() !== 'skill.md') throw new Error('A skill file must be named SKILL.md.');
        await addSkill(canonical);
        continue;
      }
      const direct = path.join(canonical, 'SKILL.md');
      if (await exists(direct)) { await addSkill(direct); continue; }
      const children = await fs.readdir(canonical, { withFileTypes: true });
      if (children.length > 200) throw new Error('Plugin skills folder contains too many entries.');
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!child.isDirectory() && !child.isSymbolicLink()) continue;
        const folder = await checked(path.join(canonical, child.name));
        if (!(await fs.stat(folder)).isDirectory()) continue;
        const file = path.join(folder, 'SKILL.md');
        if (await exists(file)) await addSkill(file);
      }
    }
    let mcpPath;
    if (manifest.mcpServers !== undefined) {
      mcpPath = localPath(root, manifest.mcpServers);
      if (!(await exists(mcpPath))) throw new Error('The declared plugin MCP configuration file does not exist.');
    } else {
      const mcpPaths = ['mcp.json', '.mcp.json'].map(relative => localPath(root, relative));
      for (const candidate of mcpPaths) if (await exists(candidate)) { if (mcpPath) throw new Error('Keep one MCP configuration file: mcp.json or .mcp.json.'); mcpPath = candidate; }
    }
    if (mcpPath) {
      const config = await json(mcpPath);
      if (!object(config) || Object.keys(config).some(key => key !== 'mcpServers') || !object(config.mcpServers)) throw new Error('MCP configuration must contain an mcpServers object.');
      if (Object.keys(config.mcpServers).length > LIMITS.servers) throw new Error('A plugin can contain at most 30 MCP servers.');
      const fields = new Set(['type', 'transport', 'command', 'args', 'env_vars', 'envVars', 'url', 'bearer_token_env_var', 'bearerTokenEnvVar', 'disabledTools']);
      for (const [name, value] of Object.entries(config.mcpServers)) {
        if (!object(value) || Object.keys(value).some(field => !fields.has(field))) throw new Error(`MCP server “${name}” contains unsupported fields. Use environment variable names, not raw credential values.`);
        if (value.args != null && (!Array.isArray(value.args) || value.args.length > 50)) throw new Error('Arguments must be a list with at most 50 entries.');
        const resolved = { ...value, command: await resolveArgument(value.command) };
        if (Array.isArray(value.args)) resolved.args = await Promise.all(value.args.map(resolveArgument));
        const server = validateServer({ ...resolved, name, enabled: true, pluginId: plugin.id });
        this.unique('servers', server);
        servers.push(server);
      }
    }
    if (!skills.length && !servers.length) throw new Error('Plugin contains no supported skills or MCP servers.');
    if (this.data.skills.length + skills.length > LIMITS.skills || this.data.servers.length + servers.length > LIMITS.servers) throw new Error('This plugin exceeds the installed skill or MCP server limit.');
    if (this.data.plugins.length >= LIMITS.plugins) throw new Error('The plugin limit has been reached.');
    this.unique('plugins', plugin);
    for (const skill of skills) this.unique('skills', skill);
    for (const server of servers) this.unique('servers', server);
    // Commit once, after every file and record has been checked. Imports are passive snapshots.
    plugin.skillIds = skills.map(skill => skill.id);
    plugin.serverIds = servers.map(server => server.id);
    this.data.skills.push(...skills);
    this.data.servers.push(...servers);
    this.data.plugins.push(plugin);
    return plugin;
  }

  removePlugin(id) {
    if (!this.data.plugins.some(plugin => plugin.id === id)) throw new Error('Plugin not found.');
    this.data.skills = this.data.skills.filter(skill => skill.pluginId !== id);
    this.data.servers = this.data.servers.filter(server => server.pluginId !== id);
    this.data.plugins = this.data.plugins.filter(plugin => plugin.id !== id);
    return true;
  }

  setPluginEnabled({ id, enabled }) {
    const plugin = this.data.plugins.find(item => item.id === id);
    if (!plugin) throw new Error('Plugin not found.');
    if (typeof enabled !== 'boolean') throw new Error('Plugin enabled must be true or false.');
    plugin.enabled = enabled;
    return plugin;
  }
}

module.exports = { defaultExtensions, normalizeExtensions, validateServer, validateSkill, parseSkill, ExtensionFiles, LIMITS };
