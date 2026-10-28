'use strict';

// The CAD workshop: one part at a time, kept as a script in the working folder (cad/<name>.cad.js) with every
// version saved beside the app's state. The model edits it through the cad tool; the user through the panel.
// Both share one build, so what the user points at is what the model sees.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TOOL_IMAGES = Symbol.for('little-bot.tool-images');
const MAX_VERSIONS = 200;
const MAX_SCRIPT = 200000;
const FORMATS = ['step', 'stl', '3mf', 'svg', 'dxf'];
const VIEWS = ['iso', 'front', 'back', 'top', 'bottom', 'right', 'left'];
const NAME = /^[\w][\w .-]{0,59}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const TEMPLATE = `// A new part. Sizes are in millimetres; Z points up.
const params = { width: 40, depth: 25, thickness: 4 };

function main(p) {
  return makeBaseBox(p.width, p.depth, p.thickness).fillet(2, (e) => e.inDirection("Z"));
}
`;

const SPEC = {
  type: 'function',
  name: 'cad',
  description: 'Design small parts in Little Bot\'s CAD workshop (OpenCascade through replicad; millimetres, Z up). '
    + 'A part is a script: `const params = { width: 40, ... }` (numbers become sliders) and `function main(p) { ...; return solid; }` with every replicad function in scope. '
    + 'Actions: guide (the API with examples; read it before your first script in a conversation), read (current script, settings, size, checks, versions), '
    + 'write (save a new version of the whole script and build it; returns size, checks and a picture), set (change setting values without rewriting), '
    + 'view (a picture; views iso/front/top/right/..., optional faceIds/edgeIds to highlight), inspect (one face or edge: type, size, the script line that made it, a ready finder for fillet/chamfer/shell), '
    + 'measure (distance and angle between two faces, edges or points), export (step, stl, 3mf, svg or dxf into the working folder), open (open or start a part by name), revert (go back to a version). '
    + 'Several parts (a box and its lid, a hinge and its pin): return them named, as `return { box, lid }` (or [{ name, shape, color }]); each part is checked on its own, '
    + 'the fit between parts is checked (overlaps, gaps under the clearance), and export can take one part by name. '
    + 'After each write, look at the picture and the checks and fix problems before answering.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['guide', 'read', 'write', 'set', 'view', 'inspect', 'measure', 'export', 'open', 'revert'] },
      code: { type: 'string', maxLength: MAX_SCRIPT, description: 'write: the whole script.' },
      note: { type: 'string', maxLength: 200, description: 'write: what changed, in a few words.' },
      params: { type: 'object', description: 'set: setting values by name, e.g. {"width": 50}.' },
      views: { type: 'array', items: { type: 'string', enum: VIEWS }, maxItems: 4, description: 'view: which views (default the four standard ones).' },
      faceIds: { type: 'array', items: { type: 'integer', minimum: 0 }, maxItems: 20 },
      edgeIds: { type: 'array', items: { type: 'integer', minimum: 0 }, maxItems: 20 },
      faceId: { type: 'integer', minimum: 0, description: 'inspect: one face.' },
      edgeId: { type: 'integer', minimum: 0, description: 'inspect: one edge.' },
      from: { type: 'object', description: 'measure: {"faceId": n}, {"edgeId": n} or {"point": [x, y, z]}.' },
      to: { type: 'object', description: 'measure: the second face, edge or point.' },
      format: { type: 'string', enum: FORMATS },
      path: { type: 'string', maxLength: 1000, description: 'export: file path, default cad/<name>.<format> in the working folder.' },
      part: { type: 'string', maxLength: 40, description: 'export: one part by name; all parts when left out (side by side for printing, a named assembly for STEP).' },
      name: { type: 'string', maxLength: 60, description: 'open: the part name.' },
      version: { type: 'integer', minimum: 1, description: 'revert: the version number.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
};

class CadWorkshop {
  constructor({ kernel, store, root, getWorkspace, onChange, onMesh, guidePath, beforeShow }) {
    this.kernel = kernel;
    this.store = store;
    this.root = root;
    this.getWorkspace = getWorkspace;
    this.onChange = onChange || (() => {});
    this.onMesh = onMesh || (() => {});
    this.guidePath = guidePath;
    this.beforeShow = beforeShow || (() => {}); // puts away another side panel
    this.panel = false;
    this.project = null;     // { id, name, file, versions: [{ n, at, note, by }], version, code, overrides }
    this.last = null;        // the last build: { params, info, checks, steps, error, mesh, version }
    this.meshes = new Map(); // version -> mesh, a few kept for the ghost view
    this.busy = null;
  }

  get enabled() { return this.store.data.settings.cadEnabled === true; }
  get limits() {
    const saved = this.store.data.cad?.limits || {};
    return { minWall: saved.minWall ?? 0.8, minHole: saved.minHole ?? 1, overhang: saved.overhang !== false, overhangAngle: saved.overhangAngle ?? 45, minClearance: saved.minClearance ?? 0.2 };
  }

  specs() { return this.enabled ? [structuredClone(SPEC)] : []; }
  owns(name) { return name === 'cad'; }

  // ---------------------------------------------------------------------------------------------- projects

  _requireEnabled() { if (!this.enabled) throw new Error('The CAD workshop is off. Turn it on in Extensions › Tools.'); }

  _projectDir(id) { return path.join(this.root, 'projects', id); }

  _fileFor(name) {
    const workspace = this.getWorkspace();
    if (!workspace) throw new Error('Choose a working folder first; parts are saved in its cad folder.');
    return path.join(workspace, 'cad', `${name}.cad.js`);
  }

  _load(file) {
    const id = crypto.createHash('sha256').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 16);
    const dir = this._projectDir(id);
    let index = { versions: [], overrides: {} };
    try { index = { ...index, ...JSON.parse(fs.readFileSync(path.join(dir, 'versions.json'), 'utf8')) }; } catch { /* A new project. */ }
    const versions = Array.isArray(index.versions) ? index.versions.filter(v => Number.isInteger(v?.n)).slice(-MAX_VERSIONS) : [];
    const name = path.basename(file).replace(/\.cad\.js$/i, '');
    return { id, name, file, versions, version: versions.at(-1)?.n || 0, overrides: object(index.overrides) ? index.overrides : {}, code: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
  }

  _saveIndex() {
    const project = this.project;
    const dir = this._projectDir(project.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'versions.json'), JSON.stringify({ file: project.file, versions: project.versions, overrides: project.overrides }, null, 1));
    this.store.data.cad = { ...(this.store.data.cad || {}), current: project.file };
    this.store.save();
  }

  _ensureProject() {
    if (this.project) return this.project;
    const remembered = this.store.data.cad?.current;
    if (remembered && fs.existsSync(remembered)) this.project = this._load(remembered);
    return this.project;
  }

  async open(name) {
    this._requireEnabled();
    const clean = String(name || '').trim();
    if (!NAME.test(clean)) throw new Error('Name the part with letters, digits, spaces, dots or dashes (up to 60).');
    const file = this._fileFor(clean);
    this.project = this._load(file);
    this.meshes.clear();
    this.last = null;
    if (this.project.code === null) return this.write({ code: TEMPLATE, note: 'New part', by: 'model' });
    if (!this.project.versions.length) this._addVersion(this.project.code, 'Opened', 'you');
    return this.build();
  }

  _addVersion(code, note, by) {
    const project = this.project;
    const n = (project.versions.at(-1)?.n || 0) + 1;
    const dir = this._projectDir(project.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `v${n}.js`), code);
    project.versions.push({ n, at: Date.now(), note: String(note || '').slice(0, 200), by });
    if (project.versions.length > MAX_VERSIONS) {
      for (const old of project.versions.splice(0, project.versions.length - MAX_VERSIONS)) fs.rmSync(path.join(dir, `v${old.n}.js`), { force: true });
    }
    project.version = n;
    project.code = code;
    fs.mkdirSync(path.dirname(project.file), { recursive: true });
    fs.writeFileSync(project.file, code);
    this._saveIndex();
  }

  async write({ code, note, by = 'model' }) {
    this._requireEnabled();
    if (typeof code !== 'string' || !code.trim()) throw new Error('Give the whole script as code.');
    if (code.length > MAX_SCRIPT) throw new Error('The script is too long.');
    if (!this._ensureProject()) {
      this.project = this._load(this._fileFor('part'));
      this.meshes.clear();
    }
    // A new script starts from its own defaults; the result says which slider values were dropped.
    const dropped = { ...this.project.overrides };
    this.project.overrides = {};
    this._addVersion(code, note, by);
    const result = await this.build();
    return Object.keys(dropped).length ? { ...result, slidersReset: dropped } : result;
  }

  async setParams(values) {
    this._requireEnabled();
    if (!this._ensureProject()?.code) throw new Error('There is no part yet. Write a script first.');
    if (!object(values)) throw new Error('Give params as {"name": value}.');
    const known = new Map((this.last?.params || []).map(spec => [spec.name, spec]));
    for (let [key, value] of Object.entries(values)) {
      const spec = known.get(key);
      if (!spec) throw new Error(`There is no setting "${key}". Settings: ${[...known.keys()].join(', ') || 'none'}.`);
      // Local models often send numbers and switches as text.
      if (spec.type === 'number' && typeof value === 'string' && /^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) value = Number(value);
      if (spec.type === 'boolean' && typeof value === 'string' && /^(?:true|false)$/i.test(value.trim())) value = value.trim().toLowerCase() === 'true';
      if (spec.type === 'number' && !Number.isFinite(value)) throw new Error(`${key} must be a number.`);
      if (spec.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${key} must be true or false.`);
      if (spec.type === 'text' && typeof value !== 'string') throw new Error(`${key} must be text.`);
      this.project.overrides[key] = value;
    }
    this._saveIndex();
    return this.build();
  }

  async revert(version) {
    this._requireEnabled();
    const project = this._ensureProject();
    if (!project) throw new Error('There is no part yet.');
    const entry = project.versions.find(v => v.n === Number(version));
    if (!entry) throw new Error(`There is no version ${version}. Versions: ${project.versions.map(v => v.n).join(', ')}.`);
    const code = fs.readFileSync(path.join(this._projectDir(project.id), `v${entry.n}.js`), 'utf8');
    return this.write({ code, note: `Back to version ${entry.n}`, by: 'you' });
  }

  versionCode(version) {
    const project = this._ensureProject();
    if (!project) throw new Error('There is no part yet.');
    return fs.readFileSync(path.join(this._projectDir(project.id), `v${Number(version)}.js`), 'utf8');
  }

  // ---------------------------------------------------------------------------------------------- building

  async build() {
    const project = this.project;
    const run = this.busy = this.kernel.call('run', { code: project.code, params: project.overrides, limits: this.limits }, 60000)
      .catch(error => ({ error: { message: error.message, line: error.line ?? null } }));
    this.changed();
    const result = await run;
    if (this.busy === run) this.busy = null;
    this.last = { ...result, version: project.version };
    if (result.mesh) {
      this.meshes.set(project.version, result.mesh);
      while (this.meshes.size > 4) this.meshes.delete(this.meshes.keys().next().value);
      this.onMesh({ version: project.version, mesh: result.mesh });
    }
    this.changed();
    return this.summary();
  }

  summary() {
    const last = this.last, project = this.project;
    if (!project) return { part: null };
    const base = { part: project.name, file: project.file, version: project.version };
    if (!last) return base;
    if (last.error) return { ...base, error: last.error, settings: settingsOf(last.params), hint: 'Fix the script and write it again. Read the guide action if an API call is unclear.' };
    const { info } = last;
    const parts = info.parts?.length > 1 ? info.parts.map(part => `${part.name}: ${round(part.size[0])} × ${round(part.size[1])} × ${round(part.size[2])} mm, ${round(part.volume, 1)} mm³${part.solids > 1 ? `, ${part.solids} pieces` : ''}`) : null;
    return {
      ...base,
      size: { x: round(info.size[0]), y: round(info.size[1]), z: round(info.size[2]) },
      volume: round(info.volume, 1), ...(parts ? { parts } : { pieces: info.solids }), faces: info.faces, edges: info.edges,
      settings: settingsOf(last.params),
      checks: last.checks.length ? last.checks.map(check => `${check.severity}: ${check.part ? `[${check.part}] ` : ''}${check.message}${check.faceIds?.length > 1 ? ` (faces ${check.faceIds.join(', ')})` : check.faceId !== undefined ? ` (face ${check.faceId})` : ''}${check.at ? ` at [${check.at.join(', ')}]` : ''}`) : ['No problems found.'],
    };
  }

  state() {
    const project = this.project || this._ensureProject();
    const last = this.last;
    return {
      enabled: this.enabled, panel: this.panel && this.enabled, building: Boolean(this.busy), limits: this.limits,
      project: project ? {
        name: project.name, file: project.file, version: project.version, code: project.code,
        versions: project.versions.slice(-50).map(v => ({ ...v })), overrides: { ...project.overrides },
      } : null,
      build: last ? { version: last.version, params: last.params || [], info: last.info || null, checks: last.checks || [], steps: last.steps || [], error: last.error || null } : null,
    };
  }

  changed() { this.onChange(); }

  mesh(version) { return this.meshes.get(Number(version)) || null; }

  async showPanel(visible) {
    this._requireEnabled();
    this.panel = visible === true;
    if (this.panel) {
      this.beforeShow();
      this.kernel.start().catch(() => {});
      if (this._ensureProject()?.code && !this.last) await this.build();
      else if (this.last?.version && this.meshes.has(this.last.version)) this.onMesh({ version: this.last.version, mesh: this.meshes.get(this.last.version) });
    }
    this.changed();
    return this.state();
  }

  // ---------------------------------------------------------------------------------------------- questions

  _requireBuild() {
    if (!this.last || this.last.error || !this.last.info) throw new Error(this.last?.error ? `The part does not build: ${this.last.error.message}` : 'There is no part yet. Write a script first.');
  }

  inspect({ faceId, edgeId, near }) {
    this._requireBuild();
    if (Number.isInteger(faceId)) return this.kernel.call('face', { faceId, near });
    if (Number.isInteger(edgeId)) return this.kernel.call('edge', { edgeId });
    throw new Error('Give a faceId or an edgeId.');
  }

  measure(from, to) {
    this._requireBuild();
    const target = item => {
      if (!object(item)) throw new Error('Measure between {"faceId": n}, {"edgeId": n} or {"point": [x, y, z]}.');
      if (Number.isInteger(item.faceId)) return { kind: 'face', faceId: item.faceId };
      if (Number.isInteger(item.edgeId)) return { kind: 'edge', edgeId: item.edgeId };
      if (Array.isArray(item.point) && item.point.length === 3 && item.point.every(Number.isFinite)) return { kind: 'point', point: item.point };
      throw new Error('Measure between {"faceId": n}, {"edgeId": n} or {"point": [x, y, z]}.');
    };
    return this.kernel.call('measure', { a: target(from), b: target(to) });
  }

  async picture({ views, faces = [], edges = [], labels = [], dots = [], theme = 'light' } = {}) {
    this._requireBuild();
    const chosen = Array.isArray(views) && views.length ? views.filter(view => VIEWS.includes(view)).slice(0, 4) : ['iso', 'front', 'top', 'right'];
    const image = await this.kernel.snapshot({ views: chosen, faces, edges, labels, dots, theme, width: chosen.length > 1 ? 480 : 768, height: chosen.length > 1 ? 360 : 576 });
    const dir = path.join(this.root, 'pictures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`);
    fs.writeFileSync(file, Buffer.from(image.split(',')[1], 'base64'));
    const kept = fs.readdirSync(dir).filter(name => name.endsWith('.png')).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - 40))) fs.rmSync(path.join(dir, old), { force: true });
    return { file, image };
  }

  // One part by name, or all: side by side as laid out for printing, or as a named assembly for STEP.
  async exportFile({ format, path: target, part = null }) {
    this._requireBuild();
    if (!FORMATS.includes(format)) throw new Error(`Export as ${FORMATS.join(', ')}.`);
    const names = (this.last.info.parts || []).map(item => item.name);
    if (part && !names.includes(part)) throw new Error(`There is no part "${part}". Parts: ${names.join(', ')}.`);
    const workspace = this.getWorkspace();
    const stem = part && names.length > 1 ? `${this.project.name}-${part.replace(/\s+/g, '-')}` : this.project.name;
    const file = target ? path.resolve(workspace, String(target)) : path.join(path.dirname(this.project.file), `${stem}.${format}`);
    if (path.extname(file).toLowerCase() !== `.${format}`) throw new Error(`The file must end in .${format}.`);
    const bytes = await this.kernel.call('export', { format, view: 'top', ...(part ? { part } : {}) }, 120000);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(bytes));
    const several = !part && names.length > 1;
    const notes = [format === 'svg' || format === 'dxf' ? 'Seen from the top, as for a laser cutter.' : '', several ? (format === 'step' ? 'All parts, as a named assembly in place.' : 'All parts, side by side as laid out for printing.') : ''].filter(Boolean);
    return { path: file, format, bytes: bytes.length, ...(part ? { part } : {}), ...(notes.length ? { note: notes.join(' ') } : {}) };
  }

  // ---------------------------------------------------------------------------------------------- the model's tool

  async call(args, { chat } = {}) {
    if (!object(args)) throw new Error('Tool arguments must be an object.');
    this._requireEnabled();
    if (!chat || chat.internal || chat.status !== 'running') throw new Error('The CAD workshop works in your own conversation, not in background work.');
    const { action } = args;
    if (action === 'guide') return { guide: fs.readFileSync(this.guidePath, 'utf8') };
    if (action === 'open') { const summary = await this.open(args.name); this._showForModel(); return this._withPicture(summary); }
    if (action === 'read') {
      const project = this._ensureProject();
      if (!project) return { part: null, message: 'There is no part yet. Use write with a script, or open with a name.' };
      if (!this.last && project.code) await this.build();
      return { ...this.summary(), code: project.code, versions: project.versions.slice(-10).map(v => `${v.n}: ${v.note || 'no note'} (${v.by})`), steps: (this.last?.steps || []).map(step => `line ${step.line}: ${step.kind}`) };
    }
    if (action === 'write') { const summary = await this.write({ code: args.code, note: args.note, by: 'model' }); this._showForModel(); return this._withPicture(summary); }
    if (action === 'set') return this._withPicture(await this.setParams(args.params));
    if (action === 'revert') return this._withPicture(await this.revert(args.version));
    if (action === 'view') {
      const { file, image } = await this.picture({ views: args.views, faces: args.faceIds || [], edges: args.edgeIds || [] });
      return { picture: file, [TOOL_IMAGES]: [image] };
    }
    if (action === 'inspect') return this.inspect({ faceId: args.faceId, edgeId: args.edgeId });
    if (action === 'measure') return this.measure(args.from, args.to);
    if (action === 'export') return this.exportFile({ format: args.format, path: args.path, part: typeof args.part === 'string' && args.part.trim() ? args.part.trim() : null });
    throw new Error('Use one of the listed actions.');
  }

  _showForModel() { if (!this.panel) { this.beforeShow(); this.panel = true; this.changed(); } }

  async _withPicture(summary) {
    if (summary.error || !this.last?.info) return summary;
    try {
      const { file, image } = await this.picture({});
      return { ...summary, picture: file, [TOOL_IMAGES]: [image] };
    } catch (error) { return { ...summary, pictureError: error.message }; }
  }

  // ---------------------------------------------------------------------------------------------- messages

  // What the user pointed at, as text for the model plus a picture with the numbered marks.
  async messageContext(input) {
    if (!this.enabled || !object(input) || !Array.isArray(input.items) || !input.items.length) return null;
    const items = input.items.slice(0, 12).filter(object);
    const project = this._ensureProject();
    const lines = [`The user is pointing at parts of the CAD model "${project?.name || 'part'}" (version ${project?.version || 0}); numbers match the marks in the attached picture.`];
    const labels = [], faces = [], edges = [];
    items.forEach((item, index) => {
      const n = index + 1;
      const note = typeof item.note === 'string' && item.note.trim() ? ` — note: "${item.note.trim().slice(0, 300)}"` : '';
      const at = Array.isArray(item.point) && item.point.length === 3 && item.point.every(Number.isFinite) ? item.point.map(v => Math.round(v * 1000) / 1000) : null;
      if (at) labels.push({ text: n, at, ...(typeof item.part === 'string' ? { part: item.part } : {}) });
      if (item.kind === 'face' && Number.isInteger(item.faceId)) {
        faces.push(item.faceId);
        lines.push(`${n}. Face ${item.faceId}: ${describeFace(item)}${note}`);
      } else if (item.kind === 'edge' && Number.isInteger(item.edgeId)) {
        edges.push(item.edgeId);
        lines.push(`${n}. Edge ${item.edgeId}: ${describeEdge(item)}${note}`);
      } else if (item.kind === 'measure') {
        lines.push(`${n}. Measurement: ${String(item.text || '').slice(0, 300)}${note}`);
      } else if (item.kind === 'problem') {
        lines.push(`${n}. Problem the checks found: ${String(item.message || '').slice(0, 300)}${note}`);
      } else if (at) lines.push(`${n}. Point [${at.join(', ')}]${note}`);
    });
    if (project && Object.keys(project.overrides).length) lines.push(`Slider values the user set (not yet in the script): ${JSON.stringify(project.overrides)}.`);
    lines.push('Use the cad tool (inspect, write) to act on these.');
    let image = null;
    try { if (this.last?.info) image = (await this.picture({ faces, edges, labels })).file; } catch { /* Text alone still helps. */ }
    const owner = item => (typeof item.part === 'string' ? `${item.part} · ` : '');
    return { text: lines.join('\n'), image, labels: items.map((item, index) => `${index + 1}. ${item.kind === 'face' ? `${owner(item)}Face ${item.faceId}` : item.kind === 'edge' ? `${owner(item)}Edge ${item.edgeId}` : item.kind === 'measure' ? 'Measure' : item.kind === 'problem' ? 'Problem' : 'Point'}`) };
  }

  close() { this.kernel.close(); }
}

function round(value, digits = 2) { return Math.round(Number(value) * 10 ** digits) / 10 ** digits; }

function settingsOf(params = []) {
  return Object.fromEntries((params || []).map(spec => [spec.name, spec.value]));
}

function describeFace(item) {
  const parts = [`${typeof item.part === 'string' ? `of part "${item.part}", ` : ''}${String(item.type || 'face').toLowerCase().replace('cylindre', 'cylinder')}`];
  if (item.diameter) parts.push(`⌀${item.diameter} mm`);
  if (item.plane) parts.push(`facing ${item.plane}`);
  if (Number.isFinite(item.area)) parts.push(`${item.area} mm²`);
  if (item.line) parts.push(`made by ${item.madeBy || 'a step'} on script line ${item.line}${item.movedAt ? ` (moved on line ${item.movedAt})` : ''}`);
  if (item.finder) parts.push(`finder ${item.finder}`);
  return parts.join(', ');
}

function describeEdge(item) {
  const parts = [`${typeof item.part === 'string' ? `of part "${item.part}", ` : ''}${String(item.type || 'edge').toLowerCase()}`];
  if (item.diameter) parts.push(`⌀${item.diameter} mm`);
  if (item.direction) parts.push(`along ${item.direction}`);
  if (Number.isFinite(item.length)) parts.push(`${item.length} mm long`);
  if (item.line) parts.push(`from script line ${item.line} (${item.madeBy || 'a step'})`);
  if (item.finder) parts.push(`finder ${item.finder}`);
  return parts.join(', ');
}

module.exports = { CadWorkshop, CAD_TOOL: SPEC, TEMPLATE };
