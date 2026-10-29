// The CAD engine: OpenCascade through replicad, in a worker of the sandboxed kernel page. It runs a part's script,
// returns the mesh for the 3D view, answers questions about faces and edges, checks the part and exports it.
// The page's session serves only the app's own files, so a script reaches neither the disk nor the network.

import * as R from '../../node_modules/replicad/dist/replicad.js';
import opencascade from '../../node_modules/replicad-opencascadejs/dist/replicad_single.js';
import { parse } from '../../node_modules/acorn/dist/acorn.mjs';
import { storedZip } from './zip.js';
import { partColor } from './colors.js';
import { createLibrary, wanted, materialOf, MATERIALS } from './library.js';
import { normalizeJoints, movesOf, matrixOf, applyMatrix, unapplyMatrix } from './assembly.js';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
let oc = null, ready = null, lineOffset = 2;
let scope = null;            // [names, values] the script sees as globals
let recording = null;        // steps recorded while a script runs: { line, kind, shape }
const origins = new WeakMap(); // shape -> the step that made it, kept through moves
let current = null;          // { shape, faces, edges, mesh, records }

function init() {
  ready ||= opencascade({ locateFile: file => new URL(`../../node_modules/replicad-opencascadejs/dist/${file}`, import.meta.url).href })
    .then(instance => {
      oc = instance;
      R.setOC(oc);
      // Where a function body's first line lands in a stack trace.
      try { new Function('"use strict";\nthrow new Error("probe")')(); }
      catch (error) { lineOffset = stackLine(error, 0) - 1; }
      scope = buildScope();
      return true;
    });
  return ready;
}

function stackLine(error, offset = lineOffset) {
  const match = /<anonymous>:(\d+):(\d+)/.exec(String(error?.stack || ''));
  return match ? Number(match[1]) - offset : null;
}
function callerLine() { return stackLine(new Error()); }

// Every step that makes or changes a solid is recorded with its script line, so a face can be traced to its line.
// OpenCascade failures arrive as C++ exceptions without a JavaScript stack, so the last traced call names the line.
let lastCall = null;
// Inside one of the workshop's helpers, its own steps are not traced: the helper is one step of the script.
let helperDepth = 0;
function note(kind) { if (helperDepth) return lastCall?.line ?? null; lastCall = { line: callerLine(), kind }; return lastCall.line; }

function record(kind, output, source, line) {
  if (!recording || helperDepth || !R.isShape3D?.(output)) return output;
  const origin = source ? origins.get(source) : null;
  const step = origin && ['translate', 'translateX', 'translateY', 'translateZ', 'rotate', 'mirror', 'scale'].includes(kind)
    ? { line: origin.line, kind: origin.kind, movedAt: line }
    : { line, kind };
  origins.set(output, step);
  try { recording.push({ ...step, shape: output.clone() }); } catch { /* A shape that cannot be copied is not traced. */ }
  return output;
}

function buildScope() {
  const values = {};
  for (const [name, value] of Object.entries(R)) if (IDENTIFIER.test(name)) values[name] = value;
  for (const name of ['makeBox', 'makeBaseBox', 'makeCylinder', 'makeSphere', 'makeEllipsoid', 'makeSolid', 'loft', 'revolution', 'twistExtrude', 'supportExtrude', 'complexExtrude', 'genericSweep']) {
    const original = R[name];
    if (typeof original === 'function') values[name] = (...args) => { const line = note(name); return record(name, original(...args), null, line); };
  }
  const wrapMethods = (Class, methods) => {
    if (!Class?.prototype) return;
    for (const method of methods) {
      const original = Class.prototype[method];
      if (typeof original !== 'function' || original.__lbWrapped) continue;
      const wrapped = function (...args) { const line = note(method); return record(method, original.apply(this, args), this, line); };
      wrapped.__lbWrapped = true;
      Class.prototype[method] = wrapped;
    }
  };
  for (const Class of [R.Sketch, R.Sketches, R.CompoundSketch]) wrapMethods(Class, ['extrude', 'revolve', 'loftWith', 'sweepSketch', 'twistExtrude']);
  wrapMethods(R._3DShape, ['fillet', 'chamfer', 'shell', 'cut', 'fuse', 'intersect', 'draft']);
  wrapMethods(R.Shape, ['translate', 'translateX', 'translateY', 'translateZ', 'rotate', 'mirror', 'scale']);
  // The workshop's own helpers; what one makes is traced to the script line that called it.
  const traced = (kind, helper) => (...args) => {
    const line = note(kind);
    helperDepth++;
    let output;
    try { output = helper(...args); } finally { helperDepth--; }
    return record(kind, output, null, line);
  };
  Object.assign(values, createLibrary({ R, traced, fonts, imports }));
  const names = Object.keys(values);
  return [names, names.map(name => values[name])];
}

// ------------------------------------------------------------------------------------------------ fonts and files

// The kernel page serves the PC's fonts by family name, and STEP and STL files from the working folder. A script's
// functions are synchronous, so what it names is loaded before it runs and kept for the next builds.
const STYLES = ['regular', 'bold', 'italic', 'bolditalic'];
const loadedFonts = new Set();
const missingFonts = new Set();
const fonts = {
  family(font, { bold = false, italic = false } = {}) {
    const name = String(font || 'Arial').trim().toLowerCase();
    const style = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
    for (const key of [`${name}|${style}`, `${name}|regular`]) if (loadedFonts.has(key)) return key;
    throw new Error(`The font "${String(font).slice(0, 60)}" is not installed on this PC, or its name is not written as plain text in the script (font: "Arial").`);
  },
};
async function loadFonts(names) {
  for (const name of names) for (const style of STYLES) {
    const key = `${name.toLowerCase()}|${style}`;
    if (loadedFonts.has(key) || missingFonts.has(key)) continue;
    try {
      const answer = await fetch(new URL(`../../fonts/${encodeURIComponent(name)}?style=${style}`, import.meta.url));
      if (!answer.ok) { missingFonts.add(key); continue; }
      await R.loadFont(await answer.arrayBuffer(), key);
      loadedFonts.add(key);
    } catch { missingFonts.add(key); }
  }
}

const importCache = new Map(); // name -> { tag, shape }
const imports = {
  get(name) {
    const entry = importCache.get(name);
    if (!entry) throw new Error(`"${name.slice(0, 100)}" was not loaded: write its file name as plain text in importPart("…"), and keep the file in the working folder's cad folder.`);
    if (entry.error) throw new Error(entry.error);
    return entry.shape.clone();
  },
};
async function loadImports(files) {
  for (const name of files) {
    let answer;
    try { answer = await fetch(new URL(`../../import/${encodeURIComponent(name)}`, import.meta.url)); }
    catch { answer = null; }
    if (!answer?.ok) { importCache.set(name, { error: answer?.status === 413 ? `"${name}" is too large to import (64 MB at most).` : `There is no STEP or STL file "${name}" in the working folder's cad folder or the working folder.` }); continue; }
    const tag = answer.headers.get('x-file-tag') || '';
    if (importCache.get(name)?.tag === tag && tag) continue;
    try { importCache.get(name)?.shape?.delete?.(); } catch { /* Freed. */ }
    try {
      const blob = await answer.blob();
      const shape = /\.stl$/i.test(name) ? await R.importSTL(blob) : await R.importSTEP(blob);
      importCache.set(name, { tag, shape });
    } catch (error) { importCache.set(name, { error: `"${name}" could not be read: ${String(error?.message || error).slice(0, 200)}` }); }
  }
}

// ------------------------------------------------------------------------------------------------ running

function syntaxError(code) {
  try { parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); return null; }
  catch (error) { return { message: error.message.replace(/\s*\(\d+:\d+\)$/, ''), line: error.loc?.line ?? null }; }
}

function describe(error) {
  let message = String(error?.message || error || 'The script failed.');
  let fromEngine = false;
  if (typeof WebAssembly.Exception === 'function' && error instanceof WebAssembly.Exception) {
    fromEngine = true;
    try { const [type, text] = oc.getExceptionMessage(error); message = `OpenCascade ${type}${text ? `: ${text}` : ''}`; }
    catch { message = 'OpenCascade could not build this step'; }
    if (lastCall?.kind) message = `${lastCall.kind}() failed. ${message}`;
  }
  message = message.split('\n')[0].slice(0, 500);
  return { message: friendly(message, lastCall?.kind), line: (fromEngine ? null : stackLine(error)) ?? lastCall?.line ?? null };
}

// OpenCascade's messages name its internals; say what usually went wrong instead.
function friendly(message, kind) {
  if (/fillet|chamfer|BRepFilletAPI|ChFi/i.test(message) || ['fillet', 'chamfer'].includes(kind)) return `${message} — the fillet or chamfer could not be built. It is usually larger than the faces next to the edge allow; try a smaller radius or fewer edges.`;
  if (/StdFail_NotDone|command not done|Not done/i.test(message)) return `${message} — OpenCascade could not build this step. Check that the shapes touch or overlap and that sizes are positive.`;
  if (/is not a function/.test(message)) return `${message} — check the method name in the API list.`;
  if (/is not defined/.test(message)) return `${message} — this name is not part of the CAD API or the script.`;
  return message;
}

function paramSpecs(raw = {}) {
  const specs = [];
  for (const [name, spec] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!IDENTIFIER.test(name)) continue;
    const value = spec && typeof spec === 'object' && 'value' in spec ? spec.value : spec;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const integer = Number.isInteger(value);
      const min = Number.isFinite(spec?.min) ? spec.min : value > 0 ? 0 : value * 3;
      const max = Number.isFinite(spec?.max) ? spec.max : Math.max(Math.abs(value) * 3, integer ? 10 : 1);
      specs.push({ name, type: 'number', value, min, max, step: Number.isFinite(spec?.step) ? spec.step : integer ? 1 : 0.1, label: typeof spec?.label === 'string' ? spec.label : undefined });
    } else if (typeof value === 'boolean') specs.push({ name, type: 'boolean', value, label: spec?.label });
    else if (typeof value === 'string') specs.push({ name, type: 'text', value: value.slice(0, 200), label: spec?.label });
  }
  return specs.slice(0, 40);
}

// What main() returns, as named parts: one shape is one part called "part"; { box, lid } names each part by its
// key; a list names them "part 1", "part 2"… unless an entry gives { name, shape }. An entry may add a color.
const PART_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$/u;
const MAX_PARTS = 200;
function partsOf(result) {
  const entries = [];
  const add = (name, value, many) => {
    const shape = value?.shape ?? value;
    const where = many ? ` (part "${name}")` : '';
    if (!R.isShape3D(shape)) {
      if (shape instanceof R.Drawing || shape?.sketchOnPlane) throw new Error(`main() returned a 2D drawing${where}. Turn it into a solid first, for example drawing.sketchOnPlane().extrude(3).`);
      if (shape?.extrude) throw new Error(`main() returned a sketch${where}. Extrude or revolve it into a solid first.`);
      throw new Error(many ? `Part "${name}" is not a 3D shape.` : 'main() must return a 3D shape, or several as { name: shape, … }.');
    }
    try { shape.boundingBox.bounds; }
    catch { throw new Error(`${many ? `Part "${name}"` : 'The part'} is empty: a cut or intersect left nothing of it.`); }
    const color = typeof value?.color === 'string' && /^#[\da-f]{6}$/i.test(value.color) ? value.color.toLowerCase() : null;
    // What an entry may say besides its shape: what it is made of, how many are needed, whether it is bought
    // rather than made (a screw), and the joint it moves on.
    const extra = value?.shape ? value : {};
    const quantity = extra.count === undefined ? 1 : Math.round(Number(extra.count));
    if (!(quantity >= 1 && quantity <= 10000)) throw new Error(`Part "${name}": count must be a whole number from 1.`);
    entries.push({ name: String(name).trim(), shape, color, material: materialOf(extra.material), count: quantity, bought: extra.bought === true, joint: extra.joint || null });
  };
  const plainObject = result && typeof result === 'object' && Object.getPrototypeOf(result) === Object.prototype && !('shape' in result);
  if (Array.isArray(result)) result.forEach((item, index) => add(typeof item?.name === 'string' ? item.name : `part ${index + 1}`, item, true));
  else if (plainObject) for (const [name, value] of Object.entries(result)) add(name, value, true);
  else add('part', result, false);
  if (!entries.length) throw new Error('main() returned no parts.');
  if (entries.length > MAX_PARTS) throw new Error(`main() returned ${entries.length} parts; up to ${MAX_PARTS} are shown.`);
  const names = new Set();
  for (const entry of entries) {
    if (!PART_NAME.test(entry.name)) throw new Error(`"${entry.name.slice(0, 50)}" is not a usable part name: use letters, digits, spaces, dots, dashes or underscores (up to 40).`);
    if (names.has(entry.name.toLowerCase())) throw new Error(`Two parts are called "${entry.name}". Give each part its own name.`);
    names.add(entry.name.toLowerCase());
  }
  // The same shape under two names would be one object in two places at once.
  const seen = new Map();
  for (const entry of entries) {
    if (seen.has(entry.shape)) throw new Error(`"${seen.get(entry.shape)}" and "${entry.name}" are the same shape. Give each part its own, for example shape.clone().translate([40, 0, 0]).`);
    seen.set(entry.shape, entry.name);
  }
  return entries;
}

// Where each part goes in the print layout: on the bed (lowest point at z = 0), side by side along X with a gap,
// the row centred on the origin. One part stays where it is. Bought parts are not printed: they get no place (null)
// unless every part is bought.
function printLayout(parts) {
  if (parts.length < 2) return parts.map(() => [0, 0, 0]);
  const printed = parts.some(part => !part.bought) ? parts.map(part => !part.bought) : parts.map(() => true);
  const boxes = parts.map(part => part.shape.boundingBox.bounds);
  const largest = Math.max(...boxes.filter((_, index) => printed[index]).map(([lo, hi]) => Math.max(hi[0] - lo[0], hi[1] - lo[1])));
  const gap = Math.max(5, Math.min(20, largest * 0.15));
  let cursor = 0;
  const offsets = boxes.map(([lo, hi], index) => {
    if (!printed[index]) return null;
    const offset = [cursor - lo[0], -(lo[1] + hi[1]) / 2, -lo[2]]; cursor += hi[0] - lo[0] + gap; return offset;
  });
  const shift = (cursor - gap) / 2;
  return offsets.map(offset => offset && [round(offset[0] - shift, 4), round(offset[1], 4), round(offset[2], 4)]);
}

function release() {
  if (!current) return;
  for (const step of current.records || []) try { step.shape.delete?.(); step.faces?.delete?.(); } catch { /* Already freed. */ }
  try { current.shape?.delete?.(); } catch { /* Already freed. */ }
  if ((current.parts || []).length > 1) for (const part of current.parts) try { part.shape.delete?.(); } catch { /* Already freed. */ }
  current = null;
}

async function run({ code, params: overrides = {}, limits = {} }) {
  await init();
  const source = String(code || '');
  const syntax = syntaxError(source);
  if (syntax) return { error: syntax };
  release();
  const needs = wanted(source);
  await loadFonts(needs.fonts);
  await loadImports(needs.files);
  recording = [];
  lastCall = null;
  let values = {}, specs = [], shape, parts, joints;
  try {
    const factory = new Function(...scope[0], `"use strict";\n${source}\n;return { params: typeof params === 'undefined' ? {} : params, main: typeof main === 'function' ? main : null };`);
    const defined = factory(...scope[1]);
    if (!defined.main) throw new Error('The script needs a function main(p) that returns the part.');
    specs = paramSpecs(defined.params);
    for (const spec of specs) {
      const override = overrides?.[spec.name];
      spec.value = typeof override === typeof spec.value && (typeof override !== 'number' || Number.isFinite(override)) ? override : spec.value;
      values[spec.name] = spec.value;
    }
    parts = partsOf(await defined.main(values));
    joints = normalizeJoints(parts);
    // makeCompound frees what it is given; clones share the parts' faces, so face ids still map to parts.
    shape = parts.length === 1 ? parts[0].shape : R.makeCompound(parts.map(part => part.shape.clone()));
  } catch (error) {
    const records = recording; recording = null;
    for (const step of records) try { step.shape.delete?.(); } catch { /* Freed. */ }
    return { error: describe(error), params: specs };
  }
  const records = recording; recording = null;
  const box = shape.boundingBox;
  const [min, max] = box.bounds;
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const diagonal = Math.hypot(...size) || 1;
  const tolerance = Math.max(diagonal / 3000, 0.002);
  const raw = shape.mesh({ tolerance, angularTolerance: 0.15 });
  const edgesRaw = shape.meshEdges({ tolerance, angularTolerance: 0.15 });
  const faces = shape.faces, edges = shape.edges;
  // The mesher names faces and edges by hash code; the rest of the app uses their index.
  const faceIndex = new Map(faces.map((face, index) => [face.hashCode, index]));
  const edgeIndex = new Map(edges.map((edge, index) => [edge.hashCode, index]));
  // Which part each face and edge belongs to: a part's own faces are the same shapes inside the compound.
  const facePart = new Int16Array(faces.length), edgePart = new Int16Array(edges.length);
  if (parts.length > 1) {
    const owner = (list, of) => { const map = new Map(); parts.forEach((part, index) => { for (const item of part.shape[of]) map.set(item.hashCode, index); }); return list.map(item => map.get(item.hashCode) ?? 0); };
    facePart.set(owner(faces, 'faces')); edgePart.set(owner(edges, 'edges'));
  }
  const byIndex = (groups, key, index, partOf) => groups.map(group => { const id = index.get(group[key]) ?? -1; return { ...group, [key]: id, part: id >= 0 ? partOf[id] : 0 }; });
  const layout = printLayout(parts);
  const mesh = {
    vertices: Float32Array.from(raw.vertices), normals: Float32Array.from(raw.normals), triangles: Uint32Array.from(raw.triangles),
    faceGroups: byIndex(raw.faceGroups, 'faceId', faceIndex, facePart), lines: Float32Array.from(edgesRaw.lines), edgeGroups: byIndex(edgesRaw.edgeGroups, 'edgeId', edgeIndex, edgePart),
    parts: parts.map((part, index) => ({ name: part.name, color: part.color, offset: layout[index], box: part.shape.boundingBox.bounds, ...(part.bought ? { bought: true } : {}), ...(joints[index] ? { joint: joints[index] } : {}) })),
  };
  current = { shape, faces, edges, mesh, records, values, parts, joints, facePart, edgePart, layout, meshTolerance: tolerance };
  let volume = 0, area = 0;
  try { volume = R.measureVolume(shape); } catch { /* Not a closed solid. */ }
  try { area = R.measureArea(shape); } catch { /* No faces. */ }
  const solids = shape.solids?.length ?? 0;
  const partInfo = parts.map((part, index) => {
    const [lo, hi] = part.shape.boundingBox.bounds;
    let partVolume = 0;
    try { partVolume = R.measureVolume(part.shape); } catch { /* Not a closed solid. */ }
    const joint = joints[index];
    return { name: part.name, min: lo, max: hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], volume: partVolume, solids: part.shape.solids?.length ?? 0, color: part.color,
      count: part.count, ...(part.bought ? { bought: true } : {}),
      ...(part.material ? { material: part.material, weight: round(partVolume / 1000 * MATERIALS[part.material], 2) } : {}),
      ...(joint ? { joint: { type: joint.type, min: joint.min, max: joint.max, value: joint.value, ...(joint.parent !== null ? { parent: parts[joint.parent].name } : {}) } } : {}) };
  });
  const info = { min, max, size, volume, area, solids, faces: faces.length, edges: edges.length, parts: partInfo };
  let checks;
  try {
    const coarse = shape.mesh({ tolerance: Math.max(diagonal / 400, 0.01), angularTolerance: 0.4 });
    checks = checkPart(info, limits, { vertices: coarse.vertices, triangles: coarse.triangles, faceGroups: byIndex(coarse.faceGroups, 'faceId', faceIndex, facePart) });
    const fit = parts.length > 1 ? checkFit() : [];
    checks.push(...fit);
    // Parts that already overlap at rest are reported once, by the fit check.
    if (joints.some(joint => joint && joint.type !== 'fixed')) checks.push(...checkMotion(new Set(fit.flatMap(item => [item.parts.join('|'), [...item.parts].reverse().join('|')]))));
  } catch (error) { checks = [{ kind: 'checkFailed', severity: 'info', message: `The checks could not run: ${describe(error).message}` }]; }
  const steps = records.map(step => ({ line: step.line, kind: step.kind, movedAt: step.movedAt })).filter((step, index, list) => step.line && list.findIndex(other => other.line === step.line && other.kind === step.kind) === index);
  // Shapes a script drops along the way are not freed by the engine; the page restarts the worker when this grows.
  return { params: specs, mesh, info, checks, steps, memory: oc.HEAPU8?.length || 0 };
}

// ------------------------------------------------------------------------------------------------ checks

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const point = list => list.map(value => round(value, 3));

function vertexOf(mesh, index) { const i = index * 3; return [mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2]]; }
function faceOfTriangle(mesh, triangle) {
  const index = triangle * 3;
  if (!mesh.faceOf) {
    mesh.faceOf = new Int32Array(mesh.triangles.length / 3).fill(-1);
    for (const group of mesh.faceGroups) for (let k = group.start / 3; k < (group.start + group.count) / 3; k++) mesh.faceOf[k] = group.faceId;
  }
  return mesh.faceOf[index / 3];
}
// The point of a shape nearest to the given one.
function closestPoint(shape, near) {
  const vertex = R.makeVertex(near);
  const tool = new oc.BRepExtrema_DistShapeShape();
  try {
    tool.LoadS1(vertex.wrapped); tool.LoadS2(shape.wrapped); tool.Perform();
    if (!tool.IsDone() || tool.NbSolution() < 1) return near;
    // The point belongs to the tool; it is freed with it.
    const p = tool.PointOnShape2(1);
    return [p.X(), p.Y(), p.Z()];
  } finally { tool.delete(); vertex.delete?.(); }
}

// A point on a face: near the clicked point, else the middle of its first triangle, snapped onto the exact surface
// (a face's center of mass can lie outside it, and a triangle's middle sits inside a curved face).
function pointOnFace(faceId, near = null) {
  const face = current.faces[faceId];
  let start = near;
  if (!start) {
    const mesh = current.mesh;
    const group = mesh.faceGroups.find(item => item.faceId === faceId);
    if (!group) return null;
    const [a, b, c] = [0, 1, 2].map(k => vertexOf(mesh, mesh.triangles[group.start + k]));
    start = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  }
  try { return face ? closestPoint(face, start) : start; } catch { return start; }
}

const THREADED = new Set(['thread', 'threadedHole', 'bolt', 'nut']);
function checkPart(info, limits = {}, mesh) {
  const problems = [];
  const minWall = Number(limits.minWall) > 0 ? Number(limits.minWall) : 0.8;
  const minHole = Number(limits.minHole) > 0 ? Number(limits.minHole) : 1;
  const overhang = limits.overhang === false ? null : Number(limits.overhangAngle) > 0 ? Number(limits.overhangAngle) : 45;
  // Volume and separate pieces are checked part by part: a box and its lid are two parts, not two loose pieces.
  const many = current.parts.length > 1;
  current.parts.forEach((part, index) => {
    const own = info.parts[index];
    const label = many ? `Part "${part.name}"` : 'The part';
    if (!own.volume || own.volume <= 0) problems.push({ kind: 'notSolid', severity: 'error', part: many ? part.name : undefined, message: `${label} has no volume: it is not a closed solid.` });
    if (own.solids > 1) {
      const pieces = part.shape.solids.map(solid => ({ solid, volume: (() => { try { return R.measureVolume(solid); } catch { return 0; } })() })).sort((a, b) => b.volume - a.volume);
      for (const piece of pieces.slice(1, 6)) {
        const [lo, hi] = piece.solid.boundingBox.bounds;
        problems.push({ kind: 'pieces', severity: 'error', part: many ? part.name : undefined, message: `${label} is ${own.solids} separate pieces. This piece (${round(piece.volume, 1)} mm³) does not touch the main one.${many ? '' : ' If they are meant to be separate, return them as named parts: { name: shape, … }.'}`, at: point([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]) });
      }
    }
  });
  const partName = faceId => many && faceId >= 0 ? current.parts[current.facePart[faceId]]?.name : undefined;
  // Bought parts (screws, bearings) are not printed: walls, holes and overhangs are checked on the printed ones only.
  const printed = index => !current.parts[index]?.bought;
  // Holes: cylindrical faces whose material is outside the cylinder.
  current.faces.forEach((face, faceId) => {
    if (face.geomType !== 'CYLINDRE' || !printed(current.facePart[faceId])) return;
    try {
      const cylinder = face._geomAdaptor().Cylinder();
      const radius = cylinder.Radius();
      const on = pointOnFace(faceId);
      if (!on) return;
      const axis = cylinder.Axis(), location = axis.Location(), direction = axis.Direction();
      const origin = [location.X(), location.Y(), location.Z()], dir = [direction.X(), direction.Y(), direction.Z()];
      const along = dot(sub(on, origin), dir);
      const radial = sub(on, [origin[0] + dir[0] * along, origin[1] + dir[1] * along, origin[2] + dir[2] * along]);
      const normal = face.normalAt(on);
      const isHole = dot([normal.x, normal.y, normal.z], radial) < 0;
      if (isHole && radius * 2 < minHole) problems.push({ kind: 'smallHole', severity: 'warning', faceId, part: partName(faceId), message: `Hole of ${round(radius * 2)} mm diameter, under the ${minHole} mm minimum.`, at: point(on), value: round(radius * 2) });
    } catch { /* Not a plain cylinder. */ }
  });
  // Thin walls: from points on the surface, look straight into the material for the opposite surface of the same
  // part (the gap to another part is a fit, checked apart). A thread's crests are thin by design: the swept faces
  // of a part with threads are left out.
  const threaded = current.records.some(step => THREADED.has(step.kind));
  const threadFace = faceId => threaded && !['PLANE', 'CYLINDRE', 'CONE', 'SPHERE', 'TORUS'].includes(current.faces[faceId]?.geomType);
  const thin = new Map();
  const triangleCount = mesh.triangles.length / 3;
  const partOfTriangle = new Int16Array(triangleCount);
  if (many) for (let t = 0; t < triangleCount; t++) { const faceId = faceOfTriangle(mesh, t); partOfTriangle[t] = faceId >= 0 ? current.facePart[faceId] : 0; }
  const stride = Math.max(1, Math.floor(triangleCount / 1500));
  // Per triangle: corner a, edges e1 and e2, unit normal, centroid (15 numbers).
  const T = new Float64Array(triangleCount * 15);
  for (let t = 0; t < triangleCount; t++) {
    const [a, b, c] = [0, 1, 2].map(k => vertexOf(mesh, mesh.triangles[t * 3 + k]));
    const e1 = sub(b, a), e2 = sub(c, a), n = cross(e1, e2), length = Math.hypot(...n) || 1;
    T.set([...a, ...e1, ...e2, n[0] / length, n[1] / length, n[2] / length, (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], t * 15);
  }
  for (let t = 0; t < triangleCount; t += stride) {
    if (!printed(partOfTriangle[t])) continue;
    const o = t * 15;
    const dx = -T[o + 9], dy = -T[o + 10], dz = -T[o + 11];
    const ox = T[o + 12] + dx * 1e-4, oy = T[o + 13] + dy * 1e-4, oz = T[o + 14] + dz * 1e-4;
    let nearest = Infinity, hit = -1;
    for (let other = 0; other < triangleCount && nearest >= 1e-3; other++) {
      if (other === t || partOfTriangle[other] !== partOfTriangle[t]) continue;
      const distance = rayTriangle(T, other * 15, ox, oy, oz, dx, dy, dz);
      if (distance < nearest) { nearest = distance; hit = other; }
    }
    if (nearest === Infinity || nearest >= minWall || nearest < 1e-3) continue;
    const faceId = faceOfTriangle(mesh, t);
    if (threadFace(faceId) || threadFace(faceOfTriangle(mesh, hit))) continue;
    const known = thin.get(faceId);
    if (!known || nearest < known.value) thin.set(faceId, { value: nearest, at: [T[o + 12], T[o + 13], T[o + 14]] });
  }
  for (const [faceId, wall] of [...thin].sort((x, y) => x[1].value - y[1].value).slice(0, 4)) {
    problems.push({ kind: 'thinWall', severity: 'warning', faceId, part: partName(faceId), message: `Wall ${round(wall.value)} mm thick, under the ${minWall} mm minimum.`, at: point(wall.at), value: round(wall.value) });
  }
  // Overhangs for 3D printing: faces pointing down more steeply than the angle, reported together. The first
  // 0.6 mm above the bed is left out: a small roundover or chamfer there prints fine. Each part is printed on its
  // own, so its own lowest point is its bed.
  if (overhang) {
    const limit = -Math.sin((90 - overhang) * Math.PI / 180);
    const floors = info.parts.map(part => part.min[2] + 0.6);
    const overhangs = new Map();
    for (let t = 0; t < triangleCount; t++) {
      const o = t * 15;
      if (T[o + 11] >= limit || !printed(partOfTriangle[t])) continue;
      const top = Math.max(T[o + 2], T[o + 2] + T[o + 5], T[o + 2] + T[o + 8]);
      if (top <= floors[partOfTriangle[t]]) continue;
      const faceId = faceOfTriangle(mesh, t);
      const area = Math.hypot(...cross([T[o + 3], T[o + 4], T[o + 5]], [T[o + 6], T[o + 7], T[o + 8]])) / 2;
      const entry = overhangs.get(faceId) || { area: 0, at: [T[o + 12], T[o + 13], T[o + 14]] };
      entry.area += area;
      overhangs.set(faceId, entry);
    }
    const faces = [...overhangs].filter(([, entry]) => entry.area > 1).sort((x, y) => y[1].area - x[1].area);
    if (faces.length) {
      const area = faces.reduce((sum, [, entry]) => sum + entry.area, 0);
      problems.push({ kind: 'overhang', severity: 'info', faceId: faces[0][0], part: partName(faces[0][0]), faceIds: faces.slice(0, 20).map(([faceId]) => faceId),
        message: `Overhangs steeper than ${overhang}° on ${faces.length} face${faces.length > 1 ? 's' : ''} (${round(area, 1)} mm²): they need supports when printed this way up.`, at: point(faces[0][1].at) });
    }
  }
  return problems;
}

// How the parts fit together: two parts that overlap cannot both be there. Gaps are the script's business, so they
// are not judged.
function overlapOf(a, b) {
  try {
    const common = a.intersect(b);
    let volume = 0;
    try { volume = R.measureVolume(common); } catch { volume = 0; }
    const [lo, hi] = volume > 1e-3 ? common.boundingBox.bounds : [[0, 0, 0], [0, 0, 0]];
    common.delete?.();
    return volume > 1e-3 ? { volume, at: point([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]) } : null;
  } catch { return null; }
}
const boxesMeet = (a, b) => [0, 1, 2].every(axis => a[0][axis] <= b[1][axis] && b[0][axis] <= a[1][axis]);

// The exact overlap is slow where two parts share a curved surface (a bolt in its threaded hole: half a minute), so
// the view mesh decides first: points just inside one part's surface are tested for being inside the other, with
// rays along X and Y counting crossings. Only parts that reach into each other are intersected exactly.
const CELLS = 48;
function meshSolids() {
  if (current.solidsIndex) return current.solidsIndex;
  const { mesh } = current;
  const starts = current.parts.map(() => []);
  for (const group of mesh.faceGroups || []) for (let k = group.start; k < group.start + group.count; k += 3) starts[group.part || 0].push(k);
  current.solidsIndex = starts.map(list => {
    const count = list.length, T = new Float64Array(count * 15);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    list.forEach((k, t) => {
      const [a, b, c] = [0, 1, 2].map(n => vertexOf(mesh, mesh.triangles[k + n]));
      const e1 = sub(b, a), e2 = sub(c, a), n = cross(e1, e2), length = Math.hypot(...n) || 1;
      T.set([...a, ...e1, ...e2, n[0] / length, n[1] / length, n[2] / length, (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], t * 15);
      for (const p of [a, b, c]) for (let axis = 0; axis < 3; axis++) { lo[axis] = Math.min(lo[axis], p[axis]); hi[axis] = Math.max(hi[axis], p[axis]); }
    });
    // A ray along X crosses the triangles of its (y, z) cell; one along Y those of its (x, z) cell.
    const grid = (u, v) => {
      const cells = Array.from({ length: CELLS * CELLS }, () => []);
      const su = (hi[u] - lo[u]) / CELLS || 1, sv = (hi[v] - lo[v]) / CELLS || 1;
      const cell = (value, axis, size) => Math.min(CELLS - 1, Math.max(0, Math.floor((value - lo[axis]) / size)));
      for (let t = 0; t < count; t++) {
        const o = t * 15;
        const us = [T[o + u], T[o + u] + T[o + 3 + u], T[o + u] + T[o + 6 + u]], vs = [T[o + v], T[o + v] + T[o + 3 + v], T[o + v] + T[o + 6 + v]];
        for (let i = cell(Math.min(...us), u, su); i <= cell(Math.max(...us), u, su); i++) for (let j = cell(Math.min(...vs), v, sv); j <= cell(Math.max(...vs), v, sv); j++) cells[i * CELLS + j].push(t);
      }
      return { cells, u, v, su, sv, find: p => cells[cell(p[u], u, su) * CELLS + cell(p[v], v, sv)] };
    };
    return { T, count, box: [lo, hi], rays: [[grid(1, 2), [1, 0, 0]], [grid(0, 2), [0, 1, 0]]] };
  });
  return current.solidsIndex;
}
function insideMesh(solid, p) {
  if ([0, 1, 2].some(axis => p[axis] < solid.box[0][axis] || p[axis] > solid.box[1][axis])) return false;
  for (const [grid, [dx, dy, dz]] of solid.rays) {
    let crossings = 0;
    for (const t of grid.find(p)) if (rayTriangle(solid.T, t * 15, p[0], p[1], p[2], dx, dy, dz) < Infinity) crossings++;
    if (crossings % 2 === 0) return false;
  }
  return true;
}
// Whether part a, moved by its matrix, reaches into part b moved by its own (null: at rest). Points are spread over
// a's surface by area (about 12 000), pushed just inside it, and count when they stay inside b however they are
// nudged by the mesh's precision. A few stray points where two parts share a surface are the mesh, not an overlap.
const NUDGES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const MIN_HITS = 8;
function reachesInto(a, ma, b, mb) {
  const solids = meshSolids(), A = solids[a], B = solids[b];
  const inset = current.meshTolerance * 3 + 0.005;
  const area = o => Math.hypot(...cross([A.T[o + 3], A.T[o + 4], A.T[o + 5]], [A.T[o + 6], A.T[o + 7], A.T[o + 8]])) / 2;
  let total = 0;
  for (let t = 0; t < A.count; t++) total += area(t * 15);
  const each = total / 12000 || 1, skip = Math.ceil(A.count / 12000);
  let hits = 0;
  for (let t = 0; t < A.count; t++) {
    const o = t * 15, n = Math.min(256, Math.max(1, Math.round(area(o) / each)));
    if (n === 1 && skip > 1 && t % skip) continue;
    for (let k = 0; k < n; k++) {
      let r1 = n === 1 ? 1 / 3 : (k * 0.618034 + 0.31) % 1, r2 = n === 1 ? 1 / 3 : (k * 0.754878 + 0.17) % 1;
      if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
      const p = [0, 1, 2].map(axis => A.T[o + axis] + r1 * A.T[o + 3 + axis] + r2 * A.T[o + 6 + axis] - A.T[o + 9 + axis] * inset);
      const q = unapplyMatrix(mb, applyMatrix(ma, p));
      if (insideMesh(B, q) && NUDGES.every(([x, y, z]) => insideMesh(B, [q[0] + x * inset, q[1] + y * inset, q[2] + z * inset])) && ++hits >= MIN_HITS) return true;
    }
  }
  return false;
}
const meet = (a, ma, b, mb) => reachesInto(a, ma, b, mb) || reachesInto(b, mb, a, ma);
const poseMatrix = (index, pose) => { const moves = movesOf(current.parts, current.joints, index, pose); return moves.length ? matrixOf(moves) : null; };

function checkFit() {
  const results = [];
  const parts = current.parts;
  const boxes = parts.map(part => part.shape.boundingBox.bounds);
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (!boxesMeet(boxes[i], boxes[j]) || !meet(i, null, j, null)) continue;
    const overlap = overlapOf(parts[i].shape, parts[j].shape);
    if (overlap) results.push({ kind: 'fit', severity: 'error', parts: [parts[i].name, parts[j].name], value: round(overlap.volume, 3), message: `"${parts[i].name}" and "${parts[j].name}" overlap by ${round(overlap.volume, 2)} mm³: they cannot both be there.`, at: overlap.at });
  }
  return results;
}

// A part placed for a pose: a copy moved by its own joint and its parents' (see assembly.js).
function posed(index, pose) {
  let shape = current.parts[index].shape.clone();
  for (const move of movesOf(current.parts, current.joints, index, pose)) {
    shape = move.type === 'slider' ? shape.translate(move.axis.map(value => value * move.value)) : shape.rotate(move.value, move.origin, move.axis);
  }
  return shape;
}

// Each moving joint is swept through its range, the others where they rest: the parts it moves must not run into
// the rest. Up to 9 positions per joint and a budget of intersections, so a large assembly still builds quickly.
const MOTION_SAMPLES = 9, MOTION_BUDGET = 200;
function checkMotion(atRest = new Set()) {
  const { parts, joints } = current;
  const results = [];
  let budget = MOTION_BUDGET, skipped = false;
  const movedBy = index => parts.map((_, other) => { for (let at = other; at !== null && at !== undefined; at = joints[at]?.parent) if (at === index) return true; return false; });
  const unit = joint => joint.type === 'hinge' ? '°' : ' mm';
  joints.forEach((joint, index) => {
    if (!joint || joint.type === 'fixed' || joint.max <= joint.min) return;
    const moving = movedBy(index);
    const still = parts.map((_, other) => other).filter(other => !moving[other]);
    if (!still.length) return;
    const rest = new Map(still.map(other => [other, posed(other, {})]));
    const hits = new Map(); // "moving|still" -> { from, to, deepest, at }
    try {
      for (let k = 0; k < MOTION_SAMPLES; k++) {
        const value = joint.min + (joint.max - joint.min) * k / (MOTION_SAMPLES - 1);
        const pose = { [parts[index].name]: value };
        for (let m = 0; m < parts.length; m++) {
          if (!moving[m]) continue;
          const shape = posed(m, pose), matrix = poseMatrix(m, pose);
          const box = shape.boundingBox.bounds;
          try {
            for (const [other, fixed] of rest) {
              if (atRest.has(`${parts[m].name}|${parts[other].name}`) || !boxesMeet(box, fixed.boundingBox.bounds)) continue;
              if (!meet(m, matrix, other, poseMatrix(other, {}))) continue;
              if (budget-- <= 0) { skipped = true; break; }
              const overlap = overlapOf(shape, fixed);
              if (!overlap) continue;
              const key = `${m}|${other}`;
              const hit = hits.get(key) || { from: value, to: value, deepest: 0, at: overlap.at, value };
              hit.to = value;
              if (overlap.volume > hit.deepest) Object.assign(hit, { deepest: overlap.volume, at: overlap.at, value });
              hits.set(key, hit);
            }
          } finally { shape.delete?.(); }
        }
      }
    } finally { for (const shape of rest.values()) shape.delete?.(); }
    for (const [key, hit] of hits) {
      const [m, other] = key.split('|').map(Number);
      const range = hit.from === hit.to ? `at ${round(hit.from, 1)}${unit(joint)}` : `from ${round(hit.from, 1)} to ${round(hit.to, 1)}${unit(joint)}`;
      results.push({ kind: 'motion', severity: 'error', parts: [parts[m].name, parts[other].name], value: round(hit.deepest, 3), pose: { [parts[index].name]: hit.value },
        message: `When "${parts[index].name}" moves on its ${joint.type} (${range}), "${parts[m].name}" runs into "${parts[other].name}" (up to ${round(hit.deepest, 2)} mm³ at ${round(hit.value, 1)}${unit(joint)}).`, at: hit.at });
    }
  });
  if (skipped) results.push({ kind: 'motion', severity: 'info', message: `Only part of the movement was checked: the assembly is large. Check one joint at a time with the pose action.` });
  return results;
}

// Möller–Trumbore on the packed triangle at T[o]: distance along the ray, or Infinity.
function rayTriangle(T, o, ox, oy, oz, dx, dy, dz) {
  const e1x = T[o + 3], e1y = T[o + 4], e1z = T[o + 5], e2x = T[o + 6], e2y = T[o + 7], e2z = T[o + 8];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-12 && det < 1e-12) return Infinity;
  const inv = 1 / det;
  const sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 ? t : Infinity;
}

// ------------------------------------------------------------------------------------------------ faces and edges

function requireCurrent() { if (!current) throw new Error('There is no part yet. Run a script first.'); }

// The part a face or edge belongs to, named only when there are several.
function partField(index) { return current.parts.length > 1 ? { part: current.parts[index]?.name } : {}; }

// The earliest recorded step whose own faces contain this point made the face.
function originOf(onFace) {
  const vertex = R.makeVertex(onFace);
  try {
    for (const step of current.records) {
      const [lo, hi] = step.shape.boundingBox.bounds;
      if (onFace.some((value, axis) => value < lo[axis] - 1e-3 || value > hi[axis] + 1e-3)) continue;
      step.faces ||= R.makeCompound(step.shape.faces);
      if (R.measureDistanceBetween(vertex, step.faces) < 1e-4) return { line: step.line, kind: step.kind, movedAt: step.movedAt };
    }
  } catch { /* Tracing is best effort. */ }
  finally { vertex.delete?.(); }
  return null;
}

const vec = v => point([v.x, v.y, v.z]);
const unit = v => { const length = Math.hypot(v.x, v.y, v.z) || 1; return point([v.x / length, v.y / length, v.z / length]); };
const axisName = normal => {
  const names = [['X', [1, 0, 0]], ['Y', [0, 1, 0]], ['Z', [0, 0, 1]]];
  for (const [name, axis] of names) if (Math.abs(Math.abs(dot(normal, axis)) - 1) < 1e-6) return { name, sign: Math.sign(dot(normal, axis)) };
  return null;
};

function faceInfo({ faceId, near }) {
  requireCurrent();
  const face = current.faces[faceId];
  if (!face) throw new Error(`There is no face ${faceId}.`);
  const on = pointOnFace(faceId, Array.isArray(near) ? near : null) || [0, 0, 0];
  const normal = unit(face.normalAt(on));
  const info = { kind: 'face', faceId, type: face.geomType, point: point(on), normal, area: round(R.measureArea(face)), ...partField(current.facePart[faceId]) };
  try {
    const surface = face._geomAdaptor();
    if (face.geomType === 'CYLINDRE') {
      const cylinder = surface.Cylinder();
      info.diameter = round(cylinder.Radius() * 2, 3);
      const d = cylinder.Axis().Direction(), l = cylinder.Axis().Location();
      info.axis = point([d.X(), d.Y(), d.Z()]); info.axisPoint = point([l.X(), l.Y(), l.Z()]);
    } else if (face.geomType === 'SPHERE') info.diameter = round(surface.Sphere().Radius() * 2, 3);
    else if (face.geomType === 'CONE') info.halfAngle = round(surface.Cone().SemiAngle() * 180 / Math.PI, 2);
  } catch { /* Plain data only. */ }
  const aligned = info.type === 'PLANE' ? axisName(normal) : null;
  if (aligned) info.plane = `${aligned.sign > 0 ? '+' : '-'}${aligned.name}`;
  info.finder = aligned
    ? `(f) => f.inPlane("${aligned.name === 'Z' ? 'XY' : aligned.name === 'Y' ? 'XZ' : 'YZ'}", ${round(on[{ X: 0, Y: 1, Z: 2 }[aligned.name]], 3)})`
    : `(f) => f.containsPoint([${point(on).join(', ')}])`;
  const origin = originOf(on);
  if (origin) Object.assign(info, { line: origin.line, madeBy: origin.kind, movedAt: origin.movedAt });
  return info;
}

function edgeInfo({ edgeId }) {
  requireCurrent();
  const edge = current.edges[edgeId];
  if (!edge) throw new Error(`There is no edge ${edgeId}.`);
  const mid = edge.pointAt(0.5);
  const info = { kind: 'edge', edgeId, type: edge.geomType, length: round(edge.length, 3), start: vec(edge.startPoint), end: vec(edge.endPoint), point: vec(mid), ...partField(current.edgePart[edgeId]) };
  try {
    if (edge.geomType === 'CIRCLE') {
      const circle = edge._geomAdaptor().Circle();
      info.diameter = round(circle.Radius() * 2, 3);
      const c = circle.Location(); info.center = point([c.X(), c.Y(), c.Z()]);
    }
    if (edge.geomType === 'LINE') {
      const direction = sub(info.end, info.start), length = Math.hypot(...direction) || 1;
      const aligned = axisName(direction.map(value => value / length));
      if (aligned) info.direction = aligned.name;
    }
  } catch { /* Plain data only. */ }
  info.finder = `(e) => e.containsPoint([${info.point.join(', ')}])`;
  const origin = originOf(info.point);
  if (origin) Object.assign(info, { line: origin.line, madeBy: origin.kind, movedAt: origin.movedAt });
  return info;
}

function shapeOf(target) {
  if (target.kind === 'face') return { shape: current.faces[target.faceId], owned: false };
  if (target.kind === 'edge') return { shape: current.edges[target.edgeId], owned: false };
  if (Array.isArray(target.point)) return { shape: R.makeVertex(target.point), owned: true };
  throw new Error('Pick a face, an edge or a point to measure.');
}

function measure({ a, b }) {
  requireCurrent();
  const first = shapeOf(a), second = shapeOf(b);
  try {
    if (!first.shape || !second.shape) throw new Error('That face or edge no longer exists.');
    const result = { distance: round(R.measureDistanceBetween(first.shape, second.shape), 3) };
    if (a.kind === 'face' && b.kind === 'face' && first.shape.geomType === 'PLANE' && second.shape.geomType === 'PLANE') {
      const n1 = unit(first.shape.normalAt(pointOnFace(a.faceId))), n2 = unit(second.shape.normalAt(pointOnFace(b.faceId)));
      result.angle = round(Math.acos(Math.min(1, Math.abs(dot(n1, n2)))) * 180 / Math.PI, 2);
    }
    if (Array.isArray(a.point) && Array.isArray(b.point)) result.between = { dx: round(b.point[0] - a.point[0], 3), dy: round(b.point[1] - a.point[1], 3), dz: round(b.point[2] - a.point[2], 3) };
    return result;
  } finally {
    if (first.owned) first.shape.delete?.();
    if (second.owned) second.shape.delete?.();
  }
}

// ------------------------------------------------------------------------------------------------ export

const encoder = new TextEncoder();

const colorOf = partColor;

// One part by name, or all of them. STEP keeps the parts where they are, as a named assembly; STL, 3MF, SVG and
// DXF of several parts use the print layout, so they arrive side by side on the bed rather than inside each other.
async function exportPart({ format, view = 'top', part = null }) {
  requireCurrent();
  const all = part === null || part === undefined || part === '';
  let indexes = all ? current.parts.map((_, index) => index) : current.parts.map((item, index) => item.name === part ? index : -1).filter(index => index >= 0);
  if (!indexes.length) throw new Error(`There is no part "${part}". Parts: ${current.parts.map(item => item.name).join(', ')}.`);
  // Bought parts (screws, nuts, bearings) are in the STEP assembly but not on the print bed.
  if (all && format !== 'step' && indexes.some(index => !current.parts[index].bought)) indexes = indexes.filter(index => !current.parts[index].bought);
  const chosen = indexes.map(index => ({ ...current.parts[index], index }));
  if (!['step', 'stl', '3mf', 'svg', 'dxf'].includes(format)) throw new Error('Export as step, stl, 3mf, svg or dxf.');
  if (format === 'step') {
    if (chosen.length === 1 && current.parts.length === 1) return new Uint8Array(await chosen[0].shape.blobSTEP().arrayBuffer());
    return new Uint8Array(await R.exportSTEP(chosen.map(item => ({ shape: item.shape, name: item.name, color: colorOf(item, item.index) }))).arrayBuffer());
  }
  // Laid out for printing when there are several; copies, since moving a shape frees the original.
  const placed = chosen.map(item => ({ ...item, shape: chosen.length > 1 ? item.shape.clone().translate(current.layout[item.index]) : item.shape, owned: chosen.length > 1 }));
  const together = placed.length > 1 ? R.makeCompound(placed.map(item => item.shape.clone())) : placed[0].shape;
  try {
    if (format === 'stl') return new Uint8Array(await together.blobSTL({ binary: true, tolerance: 0.01, angularTolerance: 0.1 }).arrayBuffer());
    if (format === '3mf') return threeMf(placed.map(item => ({ shape: item.shape, name: item.name, color: colorOf(item, item.index) })));
    const projection = R.drawProjection(together, view);
    const drawing = projection.visible;
    if (format === 'svg') return encoder.encode(svgInMillimetres(drawing.toSVG(1)));
    return encoder.encode(dxf(drawing));
  } finally {
    if (placed.length > 1) together.delete?.();
    for (const item of placed) if (item.owned) item.shape.delete?.();
  }
}

function weld(mesh) {
  const index = new Map(), vertices = [], triangles = [];
  for (let i = 0; i < mesh.triangles.length; i++) {
    const v = mesh.triangles[i] * 3;
    const key = `${Math.round(mesh.vertices[v] * 1e5)},${Math.round(mesh.vertices[v + 1] * 1e5)},${Math.round(mesh.vertices[v + 2] * 1e5)}`;
    let at = index.get(key);
    if (at === undefined) { at = vertices.length / 3; index.set(key, at); vertices.push(mesh.vertices[v], mesh.vertices[v + 1], mesh.vertices[v + 2]); }
    triangles.push(at);
  }
  const kept = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]];
    if (a !== b && b !== c && a !== c) kept.push(a, b, c);
  }
  return { vertices, triangles: kept };
}

// A 3MF with each part as its own named, colored object, so a slicer can arrange or color them one by one.
const xmlText = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function threeMf(items) {
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<resources><basematerials id="1">'];
  for (const item of items) parts.push(`<base name="${xmlText(item.name)}" displaycolor="${item.color.toUpperCase()}FF"/>`);
  parts.push('</basematerials>');
  items.forEach((item, index) => {
    const { vertices, triangles } = weld(item.shape.mesh({ tolerance: 0.01, angularTolerance: 0.1 }));
    parts.push(`<object id="${index + 2}" type="model" name="${xmlText(item.name)}" pid="1" pindex="${index}"><mesh><vertices>`);
    for (let i = 0; i < vertices.length; i += 3) parts.push(`<vertex x="${+vertices[i].toFixed(5)}" y="${+vertices[i + 1].toFixed(5)}" z="${+vertices[i + 2].toFixed(5)}"/>`);
    parts.push('</vertices><triangles>');
    for (let i = 0; i < triangles.length; i += 3) parts.push(`<triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}"/>`);
    parts.push('</triangles></mesh></object>');
  });
  parts.push(`</resources>\n<build>${items.map((_, index) => `<item objectid="${index + 2}"/>`).join('')}</build>\n</model>\n`);
  return storedZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n'],
    ['3D/3dmodel.model', parts.join('')],
  ].map(([name, text]) => [name, encoder.encode(text)]));
}

// replicad writes SVG in drawing units; give it real millimetre sizes so cutters keep the scale.
function svgInMillimetres(svg) {
  const box = /viewBox="([-\d.e]+) ([-\d.e]+) ([\d.e]+) ([\d.e]+)"/.exec(svg);
  if (!box) return svg;
  return svg.replace(/<svg\b([^>]*)>/, (tag, attributes) => `<svg${attributes.replace(/\s(width|height)="[^"]*"/g, '')} width="${box[3]}mm" height="${box[4]}mm">`);
}

// R12 DXF of polylines, from the drawing's SVG paths flattened into points.
function dxf(drawing) {
  const paths = drawing.toSVGPaths().flat(Infinity);
  const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  for (const d of paths) for (const { points, closed } of flattenPath(String(d))) {
    if (points.length < 2) continue;
    lines.push('0', 'POLYLINE', '8', '0', '66', '1', '70', closed ? '1' : '0');
    for (const [x, y] of points) lines.push('0', 'VERTEX', '8', '0', '10', String(+x.toFixed(5)), '20', String(+(-y).toFixed(5)));
    lines.push('0', 'SEQEND');
  }
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n') + '\n';
}

function flattenPath(d) {
  const tokens = d.match(/[MLHVCQAZmlhvcqaz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const shapes = [];
  let i = 0, command = '', x = 0, y = 0, startX = 0, startY = 0, points = null;
  const take = () => Number(tokens[i++]);
  const push = (px, py) => { points.push([px, py]); x = px; y = py; };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0, oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case 'M': points = []; shapes.push({ points, closed: false }); startX = take() + ox; startY = take() + oy; push(startX, startY); command = relative ? 'l' : 'L'; break;
      case 'L': push(take() + ox, take() + oy); break;
      case 'H': push(take() + ox, y); break;
      case 'V': push(x, take() + oy); break;
      case 'C': { const p = [x, y], c1 = [take() + ox, take() + oy], c2 = [take() + ox, take() + oy], e = [take() + ox, take() + oy]; for (let k = 1; k <= 16; k++) { const t = k / 16, u = 1 - t; push(u ** 3 * p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * e[0], u ** 3 * p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * e[1]); } break; }
      case 'Q': { const p = [x, y], c = [take() + ox, take() + oy], e = [take() + ox, take() + oy]; for (let k = 1; k <= 12; k++) { const t = k / 12, u = 1 - t; push(u * u * p[0] + 2 * u * t * c[0] + t * t * e[0], u * u * p[1] + 2 * u * t * c[1] + t * t * e[1]); } break; }
      case 'A': { const rx = take(), ry = take(), rotation = take(), large = take(), sweep = take(), ex = take() + ox, ey = take() + oy; for (const [px, py] of arcPoints(x, y, rx, ry, rotation, large, sweep, ex, ey)) push(px, py); break; }
      case 'Z': if (points) { points.push([startX, startY]); shapes.at(-1).closed = true; x = startX; y = startY; } break;
      default: i++;
    }
  }
  return shapes;
}

// SVG arc from endpoint form to points (SVG 1.1 implementation notes, F.6.5).
function arcPoints(x1, y1, rx, ry, rotationDeg, large, sweep, x2, y2) {
  if (!rx || !ry) return [[x2, y2]];
  const phi = rotationDeg * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = x1p ** 2 / rx ** 2 + y1p ** 2 / ry ** 2;
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const sign = Number(large) === Number(sweep) ? -1 : 1;
  const num = rx ** 2 * ry ** 2 - rx ** 2 * y1p ** 2 - ry ** 2 * x1p ** 2;
  const coef = sign * Math.sqrt(Math.max(0, num / (rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2)));
  const cxp = coef * rx * y1p / ry, cyp = -coef * ry * x1p / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!Number(sweep) && delta > 0) delta -= 2 * Math.PI;
  if (Number(sweep) && delta < 0) delta += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 24)));
  const points = [];
  for (let k = 1; k <= steps; k++) {
    const t = start + delta * k / steps;
    points.push([cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx, sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy]);
  }
  return points;
}

// ------------------------------------------------------------------------------------------------ messages

// What runs into what with the joints at these values (the others where they rest).
function collide({ pose = {} } = {}) {
  requireCurrent();
  const { parts } = current;
  const placed = parts.map((_, index) => posed(index, pose));
  try {
    const boxes = placed.map(shape => shape.boundingBox.bounds);
    const found = [];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      if (!boxesMeet(boxes[i], boxes[j]) || !meet(i, poseMatrix(i, pose), j, poseMatrix(j, pose))) continue;
      const overlap = overlapOf(placed[i], placed[j]);
      if (overlap) found.push({ parts: [parts[i].name, parts[j].name], volume: round(overlap.volume, 3), at: overlap.at });
    }
    return found;
  } finally { for (const shape of placed) shape.delete?.(); }
}

const operations = { init: () => init(), run, face: faceInfo, edge: edgeInfo, measure, export: exportPart, collide };

self.onmessage = async ({ data }) => {
  const { id, op, args } = data || {};
  try {
    const handler = operations[op];
    if (!handler) throw new Error(`Unknown CAD operation ${op}.`);
    const result = await handler(args || {});
    // The mesh is copied, not moved: the worker keeps it to answer questions about faces.
    self.postMessage({ id, result }, result instanceof Uint8Array ? [result.buffer] : []);
  } catch (error) {
    self.postMessage({ id, error: describe(error) });
  }
};
