// The CAD workshop panel. The part is built by the engine in the main process; this draws it, lets the user
// point at faces, edges and places, measure, try settings and edit the script, and keeps what they pointed at
// as numbered chips that go with the next message (app.js asks LittleBotCad.selection() when sending).

import { createViewer } from '../cad/viewer.js';

const $ = id => document.getElementById(id);
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const glyph = name => (typeof globalThis.icon === 'function' ? globalThis.icon(name) : make('span'));
const say = (message, error = false) => globalThis.notify?.(message, error);
const theme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

let cad = null;              // state.cad from the main process
let viewer = null, meshVersion = null, ghostVersion = null;
let mode = 'select', tab = 'settings';
let selection = [];          // what goes with the next message
let measureFrom = null, flash = null;
let codeDirty = false, shownCodeVersion = null, highlightLine = null;
let paramTimer = null;
const pendingParams = {};

// ------------------------------------------------------------------------------------------------ viewer

function ensureViewer() {
  if (viewer) return viewer;
  viewer = createViewer($('cad-canvas'), { interactive: true, theme: theme(), onRender: placeMarks });
  const stage = $('cad-stage');
  new ResizeObserver(() => viewer.resize(stage.clientWidth, stage.clientHeight)).observe(stage);
  viewer.resize(stage.clientWidth, stage.clientHeight);
  $('cad-canvas').addEventListener('cadclick', event => onPick(event.detail).catch(error => say(error.message || String(error), true)));
  new MutationObserver(() => viewer.setTheme(theme())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return viewer;
}

// Typed arrays survive the trip from the engine, but be lenient about plain arrays.
function typed(mesh) {
  return { ...mesh, vertices: Float32Array.from(mesh.vertices), normals: Float32Array.from(mesh.normals), triangles: Uint32Array.from(mesh.triangles), lines: Float32Array.from(mesh.lines || []) };
}

function showMesh({ version, mesh }) {
  if (!mesh) return;
  ensureViewer();
  const first = meshVersion === null;
  viewer.setMesh(typed(mesh), { keepView: !first });
  if (version !== meshVersion) {
    // Face and edge numbers change with each build: drop what pointed at them.
    const before = selection.length;
    selection = selection.filter(item => item.kind === 'point' || item.kind === 'measure');
    if (selection.length !== before) selectionChanged();
    measureFrom = null; flash = null;
  }
  meshVersion = version;
  if (ghostVersion !== null) setGhost(cad?.project?.version > 1 ? cad.project.version - 1 : null);
  refreshMarks();
}

async function setGhost(version) {
  ghostVersion = version;
  $('cad-ghost').setAttribute('aria-pressed', String(version !== null));
  if (version === null) { viewer?.setGhost(null); return; }
  const mesh = await window.bot.cadMesh({ version });
  if (!mesh) { say('Only the last few versions can be compared.'); ghostVersion = null; $('cad-ghost').setAttribute('aria-pressed', 'false'); viewer?.setGhost(null); return; }
  viewer?.setGhost(typed(mesh));
}

function refreshMarks() {
  if (!viewer) return;
  const faces = selection.filter(item => item.kind === 'face').map(item => item.faceId);
  const edges = selection.filter(item => item.kind === 'edge').map(item => item.edgeId);
  if (flash) faces.push(...(flash.faceIds || (flash.faceId !== undefined ? [flash.faceId] : [])));
  viewer.setMarks({ faces, edges });
}

// Numbered markers over the canvas, following the camera.
function placeMarks() {
  const layer = $('cad-marks');
  if (!viewer || !layer) return;
  const marks = [];
  selection.forEach((item, index) => { if (item.point) marks.push({ at: item.point, text: String(index + 1), kind: item.kind === 'measure' ? 'measure' : item.kind === 'problem' ? 'problem' : '' }); });
  if (measureFrom?.point) marks.push({ at: measureFrom.point, text: 'A', kind: 'measure' });
  if (flash?.at) marks.push({ at: flash.at, text: '!', kind: flash.severity === 'error' ? 'problem' : flash.severity || 'warning' });
  layer.replaceChildren(...marks.map(mark => {
    const spot = viewer.project(mark.at);
    const node = make('span', `cad-mark ${mark.kind}`.trim(), mark.text);
    if (!spot) node.hidden = true; else { node.style.left = `${spot.x}px`; node.style.top = `${spot.y}px`; }
    return node;
  }));
}

// ------------------------------------------------------------------------------------------------ pointing

function label(item) {
  if (item.kind === 'face') return `Face ${item.faceId} · ${(item.type || '').toLowerCase().replace('cylindre', 'cylinder')}${item.diameter ? ` ⌀${item.diameter}` : ''}${item.plane ? ` ${item.plane}` : ''}${item.line ? ` · line ${item.line}` : ''}`;
  if (item.kind === 'edge') return `Edge ${item.edgeId} · ${(item.type || '').toLowerCase()}${item.diameter ? ` ⌀${item.diameter}` : ''}${item.length ? ` ${item.length} mm` : ''}`;
  if (item.kind === 'measure') return item.text;
  if (item.kind === 'problem') return item.message;
  return `Point ${item.point.map(value => round(value, 1)).join(', ')}`;
}

function describe(info) {
  const parts = [label({ ...info })];
  if (info.area) parts.push(`${info.area} mm²`);
  if (info.madeBy) parts.push(`made by ${info.madeBy}`);
  return parts.join(' · ');
}

async function onPick({ x, y, shift }) {
  if (!viewer?.hasMesh) return;
  const hit = viewer.pick(x, y);
  if (mode === 'pin') {
    if (!hit) return;
    selection.push({ kind: 'point', point: hit.point, note: '' });
    selectionChanged({ focusLast: true });
    return;
  }
  if (mode === 'measure') {
    if (!hit) { measureFrom = null; showReadout(''); placeMarks(); return; }
    const target = hit.kind === 'face' ? { faceId: hit.faceId } : { edgeId: hit.edgeId };
    if (!measureFrom) { measureFrom = { target, point: hit.point, name: hit.kind === 'face' ? `face ${hit.faceId}` : `edge ${hit.edgeId}` }; showReadout('Now click the second face or edge.'); placeMarks(); return; }
    const result = await window.bot.cadMeasure({ from: measureFrom.target, to: target });
    const name = hit.kind === 'face' ? `face ${hit.faceId}` : `edge ${hit.edgeId}`;
    const text = `${result.distance} mm between ${measureFrom.name} and ${name}${Number.isFinite(result.angle) ? `, ${result.angle}° apart` : ''}`;
    const mid = measureFrom.point.map((value, axis) => (value + hit.point[axis]) / 2);
    selection.push({ kind: 'measure', text, point: mid, note: '' });
    measureFrom = null;
    showReadout(`Measured: ${text}`);
    selectionChanged();
    return;
  }
  if (!hit) { if (!shift) { selection = selection.filter(item => item.kind !== 'face' && item.kind !== 'edge'); selectionChanged(); showReadout(''); } return; }
  const info = await window.bot.cadInspect(hit.kind === 'face' ? { faceId: hit.faceId, near: hit.point } : { edgeId: hit.edgeId });
  const item = { ...info, kind: hit.kind, point: info.point || hit.point, note: '' };
  const same = existing => existing.kind === item.kind && (item.kind === 'face' ? existing.faceId === item.faceId : existing.edgeId === item.edgeId);
  if (shift) {
    const at = selection.findIndex(same);
    if (at >= 0) selection.splice(at, 1); else selection.push(item);
  } else {
    selection = selection.filter(existing => existing.kind !== 'face' && existing.kind !== 'edge');
    selection.push(item);
  }
  highlightLine = item.line || null;
  showReadout(describe(item));
  renderGutter();
  selectionChanged();
}

function showReadout(text) {
  $('cad-readout').textContent = text;
  $('cad-readout').classList.toggle('hidden', !text);
}

function selectionChanged({ focusLast = false } = {}) {
  renderSelection();
  refreshMarks();
  placeMarks();
  document.dispatchEvent(new Event('cad-selection'));
  if (focusLast) $('cad-selection').querySelector('.cad-chip:last-child input')?.focus();
}

function renderSelection() {
  const tray = $('cad-selection');
  const visible = Boolean(cad?.enabled) && selection.length > 0;
  tray.classList.toggle('hidden', !visible);
  if (!visible) { tray.replaceChildren(); return; }
  tray.replaceChildren(...selection.map((item, index) => {
    const chip = make('div', `cad-chip ${item.kind}`);
    const text = label(item);
    const name = make('span', 'cad-chip-label', text);
    name.title = text;
    const note = make('input');
    note.type = 'text'; note.placeholder = 'Add a note…'; note.value = item.note || ''; note.maxLength = 300;
    note.setAttribute('aria-label', `Note for mark ${index + 1}`);
    note.addEventListener('input', () => { item.note = note.value; });
    note.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('message-input').focus(); } });
    const remove = make('button');
    remove.type = 'button'; remove.title = 'Remove'; remove.setAttribute('aria-label', `Remove mark ${index + 1}`);
    remove.append(glyph('x'));
    remove.addEventListener('click', () => { selection.splice(selection.indexOf(item), 1); selectionChanged(); });
    chip.append(make('span', 'cad-chip-n', String(index + 1)), name, note, remove);
    return chip;
  }));
}

// ------------------------------------------------------------------------------------------------ the panel

function setMode(next) {
  mode = next; measureFrom = null; showReadout(next === 'measure' ? 'Click a face or edge, then a second one.' : next === 'pin' ? 'Click the part to drop a numbered pin.' : '');
  $('cad-panel').dataset.mode = next;
  for (const button of document.querySelectorAll('[data-cad-mode]')) button.setAttribute('aria-checked', String(button.dataset.cadMode === next));
  placeMarks();
}

function setTab(next) {
  tab = next;
  for (const button of document.querySelectorAll('[data-cad-tab]')) button.setAttribute('aria-selected', String(button.dataset.cadTab === next));
  for (const section of document.querySelectorAll('[data-cad-panel]')) section.classList.toggle('hidden', section.dataset.cadPanel !== next);
  if (next === 'script') renderGutter();
}

function renderParams(build) {
  const box = $('cad-params');
  const params = build?.params || [];
  const overrides = cad?.project?.overrides || {};
  if (!params.length) { box.replaceChildren(make('p', 'cad-hint', build ? 'This part has no settings. Ask Little Bot to make sizes adjustable.' : 'Settings appear here once there is a part.')); return; }
  if (box.contains(document.activeElement)) return; // Do not rebuild the slider being dragged.
  const rows = [];
  for (const spec of params) {
    const id = `cad-param-${spec.name}`;
    const row = [];
    const name = make('label', '', spec.label || spec.name);
    name.htmlFor = id; name.title = spec.name;
    row.push(name);
    if (spec.type === 'number') {
      const range = make('input'); range.type = 'range'; range.min = spec.min; range.max = spec.max; range.step = spec.step; range.value = spec.value; range.id = id;
      const number = make('input'); number.type = 'number'; number.min = spec.min; number.max = spec.max; number.step = spec.step; number.value = spec.value;
      number.setAttribute('aria-label', `${spec.name} value`);
      const update = value => { range.value = value; number.value = value; queueParam(spec.name, Number(value)); };
      range.addEventListener('input', () => update(range.value));
      number.addEventListener('change', () => { if (Number.isFinite(Number(number.value))) update(number.value); });
      row.push(range, number);
    } else if (spec.type === 'boolean') {
      const toggle = make('label', 'switch cad-param-wide');
      const input = make('input'); input.type = 'checkbox'; input.checked = spec.value; input.id = id;
      input.addEventListener('change', () => queueParam(spec.name, input.checked, 0));
      toggle.append(input, make('span', 'switch-track'));
      row.push(toggle);
    } else {
      const input = make('input', 'cad-param-wide'); input.type = 'text'; input.value = spec.value; input.id = id; input.maxLength = 200;
      input.addEventListener('change', () => queueParam(spec.name, input.value, 0));
      row.push(input);
    }
    if (Object.hasOwn(overrides, spec.name)) row.forEach(node => node.classList.add('cad-param-changed'));
    rows.push(...row);
  }
  const hint = make('p', 'cad-hint', Object.keys(overrides).length
    ? 'Changed settings are tried without touching the script; Little Bot sees them with your next message. Ask it to keep them.'
    : 'Move a setting to try it. The script stays as it is.');
  box.replaceChildren(...rows, hint);
}

function queueParam(name, value, delay = 350) {
  pendingParams[name] = value;
  clearTimeout(paramTimer);
  paramTimer = setTimeout(async () => {
    const params = { ...pendingParams };
    for (const key of Object.keys(pendingParams)) delete pendingParams[key];
    try { const result = await window.bot.cadSetParams({ params }); globalThis.applyState?.(result.state); }
    catch (error) { say(error.message || String(error), true); }
  }, delay);
}

function renderChecks(build) {
  const box = $('cad-checks');
  const checks = build?.checks || [];
  const count = $('cad-check-count');
  const worst = checks.some(check => check.severity === 'error') ? 'error' : checks.some(check => check.severity === 'warning') ? 'warning' : '';
  count.textContent = checks.length ? String(checks.length) : '';
  count.className = `cad-count ${worst}`.trim();
  if (!build || build.error) { box.replaceChildren(make('p', 'cad-hint', build?.error ? 'The part does not build, so it cannot be checked.' : 'Checks run after each build.')); return; }
  if (!checks.length) { const ok = make('p', 'cad-ok'); ok.append(glyph('check'), document.createTextNode('No problems found with the current limits.')); box.replaceChildren(ok); return; }
  box.replaceChildren(...checks.map(check => {
    const row = make('div', `cad-check ${check.severity}`);
    const actions = make('div', 'cad-check-actions');
    if (check.at || check.faceId !== undefined) {
      const show = make('button', '', 'Show'); show.type = 'button';
      show.addEventListener('click', () => { flash = { at: check.at, faceId: check.faceId, faceIds: check.faceIds, severity: check.severity }; refreshMarks(); placeMarks(); });
      actions.append(show);
    }
    const fix = make('button', '', 'Fix'); fix.type = 'button'; fix.title = 'Point Little Bot at this problem';
    fix.addEventListener('click', () => pointAtProblem(check));
    actions.append(fix);
    row.append(make('span', 'cad-check-dot'), make('p', '', check.message), actions);
    return row;
  }));
}

function pointAtProblem(problem) {
  selection.push({ kind: 'problem', message: problem.message, point: problem.at || null, faceId: problem.faceId, note: '' });
  selectionChanged();
  const input = $('message-input');
  if (!input.value.trim()) { input.value = 'Fix this.'; input.dispatchEvent(new Event('input', { bubbles: true })); }
  input.focus();
}

function renderLimits() {
  const limits = cad?.limits || {};
  const set = (id, value) => { if (document.activeElement !== $(id)) $(id).value = value; };
  set('cad-min-wall', limits.minWall ?? 0.8);
  set('cad-min-hole', limits.minHole ?? 1);
  set('cad-overhang-angle', limits.overhangAngle ?? 45);
  $('cad-overhang').checked = limits.overhang !== false;
}

async function saveLimits() {
  try {
    const result = await window.bot.cadLimits({ limits: { minWall: Number($('cad-min-wall').value), minHole: Number($('cad-min-hole').value), overhangAngle: Number($('cad-overhang-angle').value), overhang: $('cad-overhang').checked } });
    globalThis.applyState?.(result);
  } catch (error) { say(error.message || String(error), true); }
}

function renderScript(project, build) {
  const area = $('cad-code');
  if (project && (!codeDirty || shownCodeVersion !== project.version) && document.activeElement !== area) {
    area.value = project.code || '';
    codeDirty = false; shownCodeVersion = project.version;
  }
  const status = $('cad-script-status');
  status.textContent = !project ? '' : codeDirty ? 'Edited — Build to try it.' : build?.error ? `Line ${build.error.line ?? '?'}: ${build.error.message}` : `Version ${project.version}`;
  renderGutter();
}

function renderGutter() {
  const area = $('cad-code');
  const count = Math.max(1, area.value.split('\n').length);
  const bad = cad?.build?.error?.line;
  const gutter = $('cad-gutter');
  const lines = [];
  for (let n = 1; n <= count; n++) {
    const span = make('span', n === bad ? 'bad' : n === highlightLine ? 'hit' : '', String(n));
    lines.push(span, document.createTextNode('\n'));
  }
  gutter.replaceChildren(...lines);
  gutter.scrollTop = area.scrollTop;
}

async function buildScript() {
  try {
    const result = await window.bot.cadWrite({ code: $('cad-code').value });
    codeDirty = false;
    globalThis.applyState?.(result.state);
  } catch (error) { say(error.message || String(error), true); }
}

function renderVersions(project) {
  const list = $('cad-versions');
  if (!project?.versions?.length) { list.replaceChildren(make('li', 'cad-hint', 'No versions yet.')); return; }
  list.replaceChildren(...[...project.versions].reverse().map(version => {
    const item = make('li', version.n === project.version ? 'current' : '');
    const when = new Date(version.at);
    item.append(make('span', 'n', `v${version.n}`), make('span', 'note', version.note || 'No note'), make('span', 'by', `${version.by === 'you' ? 'You' : 'Little Bot'} · ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
    if (version.n !== project.version) {
      const compare = make('button', '', 'Compare'); compare.type = 'button'; compare.title = 'Show this version faintly over the current one';
      compare.addEventListener('click', () => setGhost(ghostVersion === version.n ? null : version.n).catch(error => say(error.message, true)));
      const restore = make('button', '', 'Restore'); restore.type = 'button'; restore.title = 'Make this the current version (a new version is saved)';
      restore.addEventListener('click', async () => {
        try { const result = await window.bot.cadRevert({ version: version.n }); globalThis.applyState?.(result.state); }
        catch (error) { say(error.message || String(error), true); }
      });
      item.append(compare, restore);
    }
    return item;
  }));
}

function renderStage(project, build) {
  const hasPart = Boolean(project?.code);
  $('cad-empty').classList.toggle('hidden', hasPart);
  $('cad-building').classList.toggle('hidden', !cad?.building);
  const error = build?.error;
  const box = $('cad-error');
  box.classList.toggle('hidden', !error);
  if (error) {
    const text = make('span', '', `${error.line ? `Line ${error.line}: ` : ''}${error.message}${meshVersion !== null ? ' The last version that built is shown.' : ''}`);
    const fix = make('button', 'button secondary', 'Fix'); fix.type = 'button';
    fix.addEventListener('click', () => pointAtProblem({ message: `The script fails${error.line ? ` on line ${error.line}` : ''}: ${error.message}` }));
    box.replaceChildren(text, fix);
  }
  const info = build?.info;
  $('cad-size').textContent = info ? `${round(info.size[0], 1)} × ${round(info.size[1], 1)} × ${round(info.size[2], 1)} mm · ${round(info.volume / 1000, 2)} cm³${info.solids > 1 ? ` · ${info.solids} pieces` : ''}` : '';
}

function render(state) {
  if (window.LittleBotWidget?.widget) return;
  cad = state?.cad || null;
  const enabled = Boolean(cad?.enabled);
  const open = enabled && Boolean(cad?.panel) && !state?.browser?.panel;
  const button = $('open-cad');
  button.classList.toggle('hidden', !enabled);
  button.classList.toggle('browser-active', open);
  button.setAttribute('aria-pressed', String(open));
  button.title = open ? 'Hide the CAD workshop' : 'Show the CAD workshop';
  $('cad-panel').classList.toggle('hidden', !open);
  document.querySelector('.app-shell')?.classList.toggle('cad-open', open);
  if (!enabled && selection.length) { selection = []; selectionChanged(); }
  renderSelection();
  if (!open) return;
  ensureViewer();
  const project = cad.project, build = cad.build;
  $('cad-part-name').textContent = project?.name || 'No part yet';
  $('cad-version').textContent = project ? `v${project.version}` : '';
  // After a restart the mesh is not pushed again: ask for it.
  if (build?.version && !build.error && meshVersion !== build.version) {
    window.bot.cadMesh({ version: build.version }).then(mesh => { if (mesh && meshVersion !== build.version) showMesh({ version: build.version, mesh }); }).catch(() => {});
  }
  renderStage(project, build);
  renderParams(build);
  renderChecks(build);
  renderLimits();
  renderScript(project, build);
  renderVersions(project);
}

// ------------------------------------------------------------------------------------------------ wiring

function closeMenus(except) {
  for (const [button, menu] of [['cad-part', 'cad-part-menu'], ['cad-export', 'cad-export-menu']]) {
    if (menu === except) continue;
    $(menu).classList.add('hidden');
    $(button).setAttribute('aria-expanded', 'false');
  }
}
function toggleMenu(button, menu) {
  const opening = $(menu).classList.contains('hidden');
  closeMenus(menu);
  $(menu).classList.toggle('hidden', !opening);
  $(button).setAttribute('aria-expanded', String(opening));
  if (opening && menu === 'cad-part-menu') { $('cad-part-input').value = cad?.project?.name || ''; $('cad-part-input').select(); $('cad-part-input').focus(); }
}

$('open-cad').addEventListener('click', async () => {
  try { globalThis.applyState?.(await window.bot.cadPanel({ visible: !(cad?.panel) })); }
  catch (error) { say(error.message || String(error), true); }
});
$('cad-hide').addEventListener('click', async () => {
  try { globalThis.applyState?.(await window.bot.cadPanel({ visible: false })); } catch (error) { say(error.message || String(error), true); }
});
$('cad-part').addEventListener('click', () => toggleMenu('cad-part', 'cad-part-menu'));
$('cad-export').addEventListener('click', () => toggleMenu('cad-export', 'cad-export-menu'));
$('cad-part-menu').addEventListener('submit', async event => {
  event.preventDefault();
  const error = $('cad-part-error');
  error.classList.add('hidden');
  try { globalThis.applyState?.(await window.bot.cadOpen({ name: $('cad-part-input').value })); closeMenus(); }
  catch (failure) { error.textContent = failure.message || String(failure); error.classList.remove('hidden'); }
});
$('cad-show-folder').addEventListener('click', () => window.bot.cadShowFile({ file: 'folder' }).catch(error => say(error.message, true)));
for (const item of document.querySelectorAll('[data-cad-export]')) {
  item.addEventListener('click', async () => {
    closeMenus();
    try {
      const result = await window.bot.cadExport({ format: item.dataset.cadExport });
      if (result?.path) say(`Exported ${result.path.split(/[\\/]/).pop()}.`);
    } catch (error) { say(error.message || String(error), true); }
  });
}
document.addEventListener('click', event => { if (!event.target.closest?.('.cad-part-wrap')) closeMenus(); });
for (const button of document.querySelectorAll('[data-cad-mode]')) button.addEventListener('click', () => setMode(button.dataset.cadMode));
for (const button of document.querySelectorAll('[data-cad-tab]')) button.addEventListener('click', () => setTab(button.dataset.cadTab));
for (const button of document.querySelectorAll('[data-cad-view]')) button.addEventListener('click', () => viewer?.setView(button.dataset.cadView));
$('cad-ghost').addEventListener('click', () => setGhost(ghostVersion !== null ? null : (cad?.project?.version > 1 ? cad.project.version - 1 : null)).catch(error => say(error.message, true)));
$('cad-code').addEventListener('input', () => { codeDirty = true; $('cad-script-status').textContent = 'Edited — Build to try it.'; renderGutter(); });
$('cad-code').addEventListener('scroll', () => { $('cad-gutter').scrollTop = $('cad-code').scrollTop; });
$('cad-code').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); buildScript(); }
  if (event.key === 'Tab') { event.preventDefault(); const area = event.target; const at = area.selectionStart; area.setRangeText('  ', at, area.selectionEnd, 'end'); area.dispatchEvent(new Event('input')); }
});
$('cad-build').addEventListener('click', buildScript);
for (const id of ['cad-min-wall', 'cad-min-hole', 'cad-overhang-angle', 'cad-overhang']) $(id).addEventListener('change', saveLimits);
$('cad-canvas').addEventListener('keydown', event => { if (event.key === 'Escape') { measureFrom = null; showReadout(''); placeMarks(); } });
$('cad-canvas').tabIndex = 0;

window.bot?.onEvent?.(event => { if (event?.type === 'cadMesh') showMesh(event); });

window.LittleBotCad = {
  render,
  // Plain data for the message: what was pointed at, with the user's notes.
  selection() {
    if (!cad?.enabled) return [];
    const keep = ['kind', 'faceId', 'edgeId', 'point', 'note', 'type', 'diameter', 'plane', 'area', 'line', 'madeBy', 'movedAt', 'finder', 'length', 'direction', 'text', 'message'];
    return selection.map(item => Object.fromEntries(keep.filter(key => item[key] !== undefined && item[key] !== null && item[key] !== '').map(key => [key, item[key]])));
  },
  clearSelection() { selection = []; flash = null; selectionChanged(); },
};
document.dispatchEvent(new Event('cad-ready'));
