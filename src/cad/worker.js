// The CAD engine: OpenCascade through replicad, in a worker of the sandboxed kernel page. It runs a part's script,
// returns the mesh for the 3D view, answers questions about faces and edges, checks the part and exports it.
// The page's session serves only the app's own files, so a script reaches neither the disk nor the network.

import * as R from '../../node_modules/replicad/dist/replicad.js';
import opencascade from '../../node_modules/replicad-opencascadejs/dist/replicad_single.js';
import { parse } from '../../node_modules/acorn/dist/acorn.mjs';
import { storedZip } from './zip.js';

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
function note(kind) { lastCall = { line: callerLine(), kind }; return lastCall.line; }

function record(kind, output, source, line) {
  if (!recording || !R.isShape3D?.(output)) return output;
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
  const names = Object.keys(values);
  return [names, names.map(name => values[name])];
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

function settle(result) {
  if (Array.isArray(result)) {
    const shapes = result.map(item => item?.shape ?? item).filter(item => R.isShape3D(item));
    if (!shapes.length) throw new Error('main() returned a list without 3D shapes.');
    return shapes.length === 1 ? shapes[0] : R.makeCompound(shapes);
  }
  const shape = result?.shape ?? result;
  if (R.isShape3D(shape)) return shape;
  if (shape instanceof R.Drawing || shape?.sketchOnPlane) throw new Error('main() returned a 2D drawing. Turn it into a solid first, for example drawing.sketchOnPlane().extrude(3).');
  if (shape?.extrude) throw new Error('main() returned a sketch. Extrude or revolve it into a solid first.');
  throw new Error('main() must return a 3D shape (or a list of them).');
}

function release() {
  if (!current) return;
  for (const step of current.records || []) try { step.shape.delete?.(); step.faces?.delete?.(); } catch { /* Already freed. */ }
  try { current.shape?.delete?.(); } catch { /* Already freed. */ }
  current = null;
}

async function run({ code, params: overrides = {}, limits = {} }) {
  await init();
  const source = String(code || '');
  const syntax = syntaxError(source);
  if (syntax) return { error: syntax };
  release();
  recording = [];
  lastCall = null;
  let values = {}, specs = [], shape;
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
    shape = settle(await defined.main(values));
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
  const byIndex = (groups, key, index) => groups.map(group => ({ ...group, [key]: index.get(group[key]) ?? -1 }));
  const mesh = {
    vertices: Float32Array.from(raw.vertices), normals: Float32Array.from(raw.normals), triangles: Uint32Array.from(raw.triangles),
    faceGroups: byIndex(raw.faceGroups, 'faceId', faceIndex), lines: Float32Array.from(edgesRaw.lines), edgeGroups: byIndex(edgesRaw.edgeGroups, 'edgeId', edgeIndex),
  };
  current = { shape, faces, edges, mesh, records, values };
  let volume = 0, area = 0;
  try { volume = R.measureVolume(shape); } catch { /* Not a closed solid. */ }
  try { area = R.measureArea(shape); } catch { /* No faces. */ }
  const solids = shape.solids?.length ?? 0;
  const info = { min, max, size, volume, area, solids, faces: faces.length, edges: edges.length };
  let checks;
  try {
    const coarse = shape.mesh({ tolerance: Math.max(diagonal / 400, 0.01), angularTolerance: 0.4 });
    checks = checkPart(info, limits, { vertices: coarse.vertices, triangles: coarse.triangles, faceGroups: byIndex(coarse.faceGroups, 'faceId', faceIndex) });
  } catch (error) { checks = [{ kind: 'checkFailed', severity: 'info', message: `The checks could not run: ${describe(error).message}` }]; }
  const steps = records.map(step => ({ line: step.line, kind: step.kind, movedAt: step.movedAt })).filter((step, index, list) => step.line && list.findIndex(other => other.line === step.line && other.kind === step.kind) === index);
  return { params: specs, mesh, info, checks, steps };
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

function checkPart(info, limits = {}, mesh) {
  const problems = [];
  const minWall = Number(limits.minWall) > 0 ? Number(limits.minWall) : 0.8;
  const minHole = Number(limits.minHole) > 0 ? Number(limits.minHole) : 1;
  const overhang = limits.overhang === false ? null : Number(limits.overhangAngle) > 0 ? Number(limits.overhangAngle) : 45;
  if (!info.volume || info.volume <= 0) problems.push({ kind: 'notSolid', severity: 'error', message: 'The part has no volume: it is not a closed solid.' });
  if (info.solids > 1) {
    const pieces = current.shape.solids.map(solid => ({ solid, volume: (() => { try { return R.measureVolume(solid); } catch { return 0; } })() })).sort((a, b) => b.volume - a.volume);
    for (const piece of pieces.slice(1, 6)) {
      const [lo, hi] = piece.solid.boundingBox.bounds;
      problems.push({ kind: 'pieces', severity: 'error', message: `The part is ${info.solids} separate pieces. This piece (${round(piece.volume, 1)} mm³) does not touch the main one.`, at: point([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]) });
    }
  }
  // Holes: cylindrical faces whose material is outside the cylinder.
  current.faces.forEach((face, faceId) => {
    if (face.geomType !== 'CYLINDRE') return;
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
      if (isHole && radius * 2 < minHole) problems.push({ kind: 'smallHole', severity: 'warning', faceId, message: `Hole of ${round(radius * 2)} mm diameter, under the ${minHole} mm minimum.`, at: point(on), value: round(radius * 2) });
    } catch { /* Not a plain cylinder. */ }
  });
  // Thin walls: from points on the surface, look straight into the material for the opposite surface.
  const thin = new Map();
  const triangleCount = mesh.triangles.length / 3;
  const stride = Math.max(1, Math.floor(triangleCount / 1500));
  // Per triangle: corner a, edges e1 and e2, unit normal, centroid (15 numbers).
  const T = new Float64Array(triangleCount * 15);
  for (let t = 0; t < triangleCount; t++) {
    const [a, b, c] = [0, 1, 2].map(k => vertexOf(mesh, mesh.triangles[t * 3 + k]));
    const e1 = sub(b, a), e2 = sub(c, a), n = cross(e1, e2), length = Math.hypot(...n) || 1;
    T.set([...a, ...e1, ...e2, n[0] / length, n[1] / length, n[2] / length, (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], t * 15);
  }
  for (let t = 0; t < triangleCount; t += stride) {
    const o = t * 15;
    const dx = -T[o + 9], dy = -T[o + 10], dz = -T[o + 11];
    const ox = T[o + 12] + dx * 1e-4, oy = T[o + 13] + dy * 1e-4, oz = T[o + 14] + dz * 1e-4;
    let nearest = Infinity;
    for (let other = 0; other < triangleCount && nearest >= 1e-3; other++) {
      if (other === t) continue;
      const distance = rayTriangle(T, other * 15, ox, oy, oz, dx, dy, dz);
      if (distance < nearest) nearest = distance;
    }
    if (nearest === Infinity || nearest >= minWall || nearest < 1e-3) continue;
    const faceId = faceOfTriangle(mesh, t);
    const known = thin.get(faceId);
    if (!known || nearest < known.value) thin.set(faceId, { value: nearest, at: [T[o + 12], T[o + 13], T[o + 14]] });
  }
  for (const [faceId, wall] of [...thin].sort((x, y) => x[1].value - y[1].value).slice(0, 4)) {
    problems.push({ kind: 'thinWall', severity: 'warning', faceId, message: `Wall ${round(wall.value)} mm thick, under the ${minWall} mm minimum.`, at: point(wall.at), value: round(wall.value) });
  }
  // Overhangs for 3D printing: faces pointing down more steeply than the angle, reported together. The first
  // 0.6 mm above the bed is left out: a small roundover or chamfer there prints fine.
  if (overhang) {
    const limit = -Math.sin((90 - overhang) * Math.PI / 180);
    const floor = info.min[2] + 0.6;
    const overhangs = new Map();
    for (let t = 0; t < triangleCount; t++) {
      const o = t * 15;
      if (T[o + 11] >= limit) continue;
      const top = Math.max(T[o + 2], T[o + 2] + T[o + 5], T[o + 2] + T[o + 8]);
      if (top <= floor) continue;
      const faceId = faceOfTriangle(mesh, t);
      const area = Math.hypot(...cross([T[o + 3], T[o + 4], T[o + 5]], [T[o + 6], T[o + 7], T[o + 8]])) / 2;
      const entry = overhangs.get(faceId) || { area: 0, at: [T[o + 12], T[o + 13], T[o + 14]] };
      entry.area += area;
      overhangs.set(faceId, entry);
    }
    const faces = [...overhangs].filter(([, entry]) => entry.area > 1).sort((x, y) => y[1].area - x[1].area);
    if (faces.length) {
      const area = faces.reduce((sum, [, entry]) => sum + entry.area, 0);
      problems.push({ kind: 'overhang', severity: 'info', faceId: faces[0][0], faceIds: faces.slice(0, 20).map(([faceId]) => faceId),
        message: `Overhangs steeper than ${overhang}° on ${faces.length} face${faces.length > 1 ? 's' : ''} (${round(area, 1)} mm²): they need supports when printed this way up.`, at: point(faces[0][1].at) });
    }
  }
  return problems;
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
  const info = { kind: 'face', faceId, type: face.geomType, point: point(on), normal, area: round(R.measureArea(face)) };
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
  const info = { kind: 'edge', edgeId, type: edge.geomType, length: round(edge.length, 3), start: vec(edge.startPoint), end: vec(edge.endPoint), point: vec(mid) };
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

async function exportPart({ format, view = 'top' }) {
  requireCurrent();
  const shape = current.shape;
  if (format === 'step') return new Uint8Array(await shape.blobSTEP().arrayBuffer());
  if (format === 'stl') return new Uint8Array(await shape.blobSTL({ binary: true, tolerance: 0.01, angularTolerance: 0.1 }).arrayBuffer());
  if (format === '3mf') return threeMf(shape);
  if (format === 'svg' || format === 'dxf') {
    const projection = R.drawProjection(shape, view);
    const drawing = projection.visible;
    if (format === 'svg') return encoder.encode(svgInMillimetres(drawing.toSVG(1)));
    return encoder.encode(dxf(drawing));
  }
  throw new Error('Export as step, stl, 3mf, svg or dxf.');
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

function threeMf(shape) {
  const { vertices, triangles } = weld(shape.mesh({ tolerance: 0.01, angularTolerance: 0.1 }));
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<resources><object id="1" type="model"><mesh><vertices>'];
  for (let i = 0; i < vertices.length; i += 3) parts.push(`<vertex x="${+vertices[i].toFixed(5)}" y="${+vertices[i + 1].toFixed(5)}" z="${+vertices[i + 2].toFixed(5)}"/>`);
  parts.push('</vertices><triangles>');
  for (let i = 0; i < triangles.length; i += 3) parts.push(`<triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}"/>`);
  parts.push('</triangles></mesh></object></resources>\n<build><item objectid="1"/></build>\n</model>\n');
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

const operations = { init: () => init(), run, face: faceInfo, edge: edgeInfo, measure, export: exportPart };

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
