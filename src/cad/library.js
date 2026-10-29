// The workshop's own helpers on top of replicad: ISO metric threads, fasteners and the holes they need, patterns,
// text from the PC's fonts, imported STEP and STL files, and the joints and materials of an assembly. They are
// given to a part's script beside replicad's functions. Sizes are in millimetres; Z points up.

// ISO 261/262 coarse pitch, and the fastener sizes that go with each thread: clearance holes (ISO 273 close,
// normal, loose), socket cap heads (ISO 4762: head diameter, height) and their counterbore (DIN 974), hex nuts
// (ISO 4032: across flats, height), hex bolt heads (ISO 4017), countersunk heads (ISO 10642), button heads
// (ISO 7380), washers (ISO 7089: inner, outer, thickness) and typical heat-set inserts (hole, depth).
export const METRIC = {
  M2: { pitch: 0.4, clearance: [2.2, 2.4, 2.6], socket: [3.8, 2], counterbore: 4.3, nut: [4, 1.6], hex: [4, 1.4], countersunk: [4.4, 1.2], button: [3.5, 1.3], washer: [2.2, 5, 0.3], insert: [3.2, 4] },
  'M2.5': { pitch: 0.45, clearance: [2.7, 2.9, 3.1], socket: [4.5, 2.5], counterbore: 5, nut: [5, 2], hex: [5, 1.7], countersunk: [5.5, 1.5], button: [4.7, 1.5], washer: [2.7, 6, 0.5], insert: [3.6, 4.5] },
  M3: { pitch: 0.5, clearance: [3.2, 3.4, 3.6], socket: [5.5, 3], counterbore: 6.5, nut: [5.5, 2.4], hex: [5.5, 2], countersunk: [6.72, 1.86], button: [5.7, 1.65], washer: [3.2, 7, 0.5], insert: [4, 5.7] },
  M4: { pitch: 0.7, clearance: [4.3, 4.5, 4.8], socket: [7, 4], counterbore: 8, nut: [7, 3.2], hex: [7, 2.8], countersunk: [8.96, 2.48], button: [7.6, 2.2], washer: [4.3, 9, 0.8], insert: [5.6, 8.1] },
  M5: { pitch: 0.8, clearance: [5.3, 5.5, 5.8], socket: [8.5, 5], counterbore: 10, nut: [8, 4.7], hex: [8, 3.5], countersunk: [11.2, 3.1], button: [9.5, 2.75], washer: [5.3, 10, 1], insert: [6.4, 9.5] },
  M6: { pitch: 1, clearance: [6.4, 6.6, 7], socket: [10, 6], counterbore: 11, nut: [10, 5.2], hex: [10, 4], countersunk: [13.44, 3.72], button: [10.5, 3.3], washer: [6.4, 12, 1.6], insert: [8, 12.7] },
  M8: { pitch: 1.25, clearance: [8.4, 9, 10], socket: [13, 8], counterbore: 15, nut: [13, 6.8], hex: [13, 5.3], countersunk: [17.92, 4.96], button: [14, 4.4], washer: [8.4, 16, 1.6], insert: [9.7, 12.7] },
  M10: { pitch: 1.5, clearance: [10.5, 11, 12], socket: [16, 10], counterbore: 18, nut: [16, 8.4], hex: [16, 6.4], countersunk: [22.4, 6.2], button: [17.5, 5.5], washer: [10.5, 20, 2] },
  M12: { pitch: 1.75, clearance: [13, 13.5, 14.5], socket: [18, 12], counterbore: 20, nut: [18, 10.8], hex: [18, 7.5], countersunk: [26.88, 7.44], button: [21, 6.6], washer: [13, 24, 2.5] },
  M16: { pitch: 2, clearance: [17, 17.5, 18.5], socket: [24, 16], counterbore: 26, nut: [24, 14.8], hex: [24, 10], countersunk: [33.6, 8.8], washer: [17, 30, 3] },
  M20: { pitch: 2.5, clearance: [21, 22, 24], socket: [30, 20], counterbore: 33, nut: [30, 18], hex: [30, 12.5], countersunk: [40.32, 10.16], washer: [21, 37, 3] },
};

// Density in g/cm³, for the weight of each part in the bill of materials.
export const MATERIALS = {
  PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, Nylon: 1.14, PC: 1.2, Resin: 1.15,
  Aluminium: 2.7, Steel: 7.85, Stainless: 8, Brass: 8.5, Copper: 8.96, Wood: 0.6, Plywood: 0.68, MDF: 0.75, Acrylic: 1.18, Rubber: 1.1,
};
export function materialOf(name) {
  if (name === undefined || name === null || name === '') return null;
  const key = Object.keys(MATERIALS).find(item => item.toLowerCase() === String(name).trim().toLowerCase().replace(/^aluminum$/, 'aluminium'));
  if (!key) throw new Error(`Unknown material "${String(name).slice(0, 40)}". Materials: ${Object.keys(MATERIALS).join(', ')}.`);
  return key;
}

const FITS = { close: 0, normal: 1, loose: 2 };
const SEAM = 41;
const TAN30 = Math.tan(Math.PI / 6);
const positive = (value, what) => { if (!(Number(value) > 0)) throw new Error(`${what} must be a positive number of millimetres.`); return Number(value); };

// A size is "M3" (the table) or a diameter with its pitch.
function metric(size, pitch) {
  if (typeof size === 'string') {
    const key = size.trim().toUpperCase();
    const row = METRIC[key];
    if (!row) throw new Error(`Unknown thread size "${size}". Sizes: ${Object.keys(METRIC).join(', ')}, or give a diameter and { pitch }.`);
    return { name: key, d: Number(key.slice(1)), ...row, pitch: Number(pitch) > 0 ? Number(pitch) : row.pitch };
  }
  const d = positive(size, 'The thread diameter');
  if (!(Number(pitch) > 0)) throw new Error('Give the pitch of a thread that is not in the table, e.g. thread(7, 10, { pitch: 1 }).');
  return { name: `M${d}`, d, pitch: Number(pitch) };
}
function row(size, key) {
  const spec = metric(size);
  if (!spec[key]) throw new Error(`No ${key} size is listed for ${spec.name}.`);
  return { ...spec, value: spec[key] };
}

export function createLibrary({ R, traced, fonts, imports }) {
  const cylinder = (radius, height, z = 0) => R.makeCylinder(radius, height, [0, 0, z]);
  // A solid of revolution around Z from a profile of [radius, z] points.
  const revolved = points => {
    let pen = R.draw(points[0]);
    for (const at of points.slice(1)) pen = pen.lineTo(at);
    return pen.close().sketchOnPlane('XZ').revolve();
  };
  const hexagon = (acrossFlats, height, z = 0) => R.drawPolysides(acrossFlats / Math.sqrt(3), 6).sketchOnPlane('XY', [0, 0, z]).extrude(height);

  // The ISO profile swept along a helix and fused to its core, from z = 0 to z = length. grow widens it on every
  // side (a hole's cutting tool), shrink narrows it (a printed bolt).
  // A failed attempt is tried again with the sweep cut into more pieces, a turn more, and the seams elsewhere.
  const ATTEMPTS = [[0, 0], [1, 0], [0, 1], [1, 1]];
  function threadSolid(spec, length, options = {}) {
    for (let attempt = 0; ; attempt++) {
      try { return threadAttempt(spec, length, options, attempt); }
      catch (error) { if (!/could not be built/.test(error.message) || attempt === ATTEMPTS.length - 1) throw error; }
    }
  }
  function threadAttempt(spec, length, { grow = 0, leftHand = false, chamfer = false } = {}, attempt = 0) {
    const P = spec.pitch, H = 0.866025 * P;
    const rMaj = spec.d / 2 + grow, rMin = spec.d / 2 - 5 / 8 * H + grow;
    if (rMin <= 0) throw new Error('This thread is too fine for its diameter.');
    const inner = rMin - Math.min(0.05, P * 0.05);
    const half = r => P / 16 + (rMaj - r) * TAN30;
    // OpenCascade is particular here: the helix starts at z = 0 and makes whole turns (a sweep ending half way round
    // loses the coil in the booleans), a long one is swept in pieces of at most 20 turns stacked end to end (a single
    // long sweep drifts), and the seams of the core and the trim are turned away from the coil's ends.
    const [morePieces, moreTurns] = ATTEMPTS[attempt];
    const turns = Math.ceil((length + 2 * P) / P - 1e-9) + moreTurns;
    const pieces = Math.ceil(turns / 20) + morePieces, perPiece = Math.ceil(turns / pieces);
    const start = -P, height = pieces * perPiece * P, seam = SEAM + attempt * 26;
    const temporary = [];
    const keep = shape => { temporary.push(shape); return shape; };
    try {
      const profile = keep(R.draw([inner, -half(inner)]).lineTo([rMaj, -half(rMaj)]).lineTo([rMaj, half(rMaj)]).lineTo([inner, half(inner)]).close().sketchOnPlane('XZ'));
      const spine = keep(R.assembleWire([R.makeHelix(P, perPiece * P, inner, [0, 0, 0], [0, 0, 1], leftHand)]));
      const piece = keep(R.genericSweep(profile.wire, spine, { frenet: true }));
      let coil = piece.clone().translate([0, 0, start]);
      for (let k = 1; k < pieces; k++) {
        const next = keep(piece.clone().translate([0, 0, start + k * perPiece * P]));
        coil = keep(coil).fuse(next);
      }
      const cylinderCore = keep(cylinder(rMin, height, start).rotate(seam, [0, 0, 0], [0, 0, 1]));
      const core = keep(cylinderCore.fuse(keep(coil)));
      // Trimmed to its length, with a 45° lead-in at both ends when asked.
      const c = chamfer ? Math.min(rMaj - rMin + P / 4, length / 3) : 0;
      const trim = keep((c ? revolved([[0, 0], [rMaj - c, 0], [rMaj + 1, c + 1], [rMaj + 1, length - c - 1], [rMaj - c, length], [0, length]]) : cylinder(rMaj + 1, length)).rotate(seam, [0, 0, 0], [0, 0, 1]));
      const result = core.intersect(trim);
      let volume = 0;
      try { volume = R.measureVolume(result); } catch { volume = 0; }
      if (!(volume > Math.PI * rMin * rMin * length * 1.03)) { result.delete?.(); throw new Error(`The ${spec.name} thread could not be built at this length; try a length a little longer or shorter.`); }
      return result;
    } finally {
      for (const shape of temporary) try { shape.delete?.(); } catch { /* Already freed. */ }
    }
  }

  const thread = traced('thread', (size, length, { pitch, leftHand = false, chamfer = true, clearance = 0 } = {}) => {
    const spec = metric(size, pitch);
    return threadSolid(spec, positive(length, 'The thread length'), { grow: -Math.max(0, Number(clearance) || 0) / 2, leftHand, chamfer });
  });

  // The cutting tool for a threaded hole going down from z = 0; it pokes 0.5 mm above so the cut is clean.
  const threadedHole = traced('threadedHole', (size, depth, { pitch, leftHand = false, clearance = 0 } = {}) => {
    const spec = metric(size, pitch);
    const deep = positive(depth, 'The hole depth');
    // One thread from the bottom of the hole to 0.5 mm above the surface: a separate cap on top would only touch it.
    return threadSolid(spec, deep + 0.5, { grow: Math.max(0, Number(clearance) || 0) / 2, leftHand }).translate([0, 0, -deep]);
  });

  // A tap-drill hole: the size to tap later, or for a screw to cut its own thread into plastic.
  const tapHole = traced('tapHole', (size, depth, { pitch } = {}) => {
    const spec = metric(size, pitch);
    const deep = positive(depth, 'The hole depth');
    return cylinder((spec.d - spec.pitch) / 2, deep + 0.5, -deep);
  });

  // A clearance hole going down from z = 0, with a counterbore or countersink for the head at the top.
  const boltHole = traced('boltHole', (size, depth, { head = 'socket', fit = 'normal', headDepth, clearance = 0 } = {}) => {
    const spec = metric(size);
    const deep = positive(depth, 'The hole depth');
    const extra = Math.max(0, Number(clearance) || 0);
    if (!(fit in FITS)) throw new Error('fit is close, normal or loose.');
    let tool = cylinder(spec.clearance[FITS[fit]] / 2 + extra / 2, deep + 0.5, -deep);
    if (head === 'socket' || head === 'button' || head === 'hex') {
      const width = head === 'hex' ? spec.hex[0] * 1.155 + 1 : head === 'button' ? spec.button[0] + 1 : spec.counterbore;
      const sink = Number(headDepth) >= 0 && headDepth !== undefined ? Number(headDepth) : head === 'hex' ? spec.hex[1] : head === 'button' ? spec.button[1] : spec.socket[1];
      if (sink > 0) tool = tool.fuse(cylinder(width / 2 + extra / 2, sink + 0.5, -sink));
    } else if (head === 'countersunk') {
      const top = spec.countersunk[0] / 2 + 0.2 + extra / 2, bottom = spec.clearance[FITS[fit]] / 2 + extra / 2;
      tool = tool.fuse(revolved([[0, -(top - bottom)], [bottom, -(top - bottom)], [top, 0], [top, 0.5], [0, 0.5]]));
    } else if (head !== 'none') throw new Error('head is socket, button, hex, countersunk or none.');
    return tool;
  });

  // A hexagonal pocket for a nut going down from z = 0; slot opens it sideways along +X to slide the nut in.
  const nutTrap = traced('nutTrap', (size, { depth, slot = 0, clearance = 0 } = {}) => {
    const spec = metric(size);
    const extra = Math.max(0, Number(clearance) || 0);
    const flats = spec.nut[0] + extra, deep = Number(depth) > 0 ? Number(depth) : spec.nut[1] + extra;
    let tool = hexagon(flats, deep + 0.5, -deep).rotate(30, [0, 0, 0], [0, 0, 1]);
    if (Number(slot) > 0) tool = tool.fuse(R.makeBox([0, -flats / 2, -deep], [Number(slot), flats / 2, 0.5]));
    return tool;
  });

  // The hole for a heat-set insert going down from z = 0 (typical sizes; check your inserts).
  const insertHole = traced('insertHole', (size, { depth, clearance = 0 } = {}) => {
    const spec = row(size, 'insert');
    const deep = Number(depth) > 0 ? Number(depth) : spec.value[1] + 1;
    return cylinder(spec.value[0] / 2 + Math.max(0, Number(clearance) || 0) / 2, deep + 0.5, -deep);
  });

  // A fastener that comes out of OpenCascade in two pieces is refused rather than returned broken.
  const oneSolid = (shape, name) => {
    if ((shape.solids?.length ?? 1) > 1) { shape.delete?.(); throw new Error(`The ${name} bolt could not be built in one piece at this length; try a length a little longer or shorter.`); }
    return shape;
  };

  // A bolt with its head on z = 0 and its shank down along -Z (a countersunk head sits below z = 0, flush).
  const bolt = traced('bolt', (size, length, { head = 'socket', threaded = true, pitch } = {}) => {
    const spec = metric(size, pitch);
    const long = positive(length, 'The bolt length');
    // The shank reaches into the head, so the two fuse into one solid rather than touching: 0.5 mm above z = 0 under
    // a raised head, half way up a countersunk one (which ends at z = 0).
    const top = head === 'countersunk' ? -spec.countersunk[1] / 2 : 0.5;
    const shank = threaded ? threadSolid(spec, long + top, { chamfer: true }).translate([0, 0, -long]) : cylinder(spec.d / 2, long + top, -long);
    if (head === 'socket') {
      const [width, tall] = spec.socket;
      const key = hexagon(width * 0.42, tall * 0.6, tall * 0.4 + 0.01);
      return oneSolid(shank.fuse(cylinder(width / 2, tall)).cut(key), spec.name);
    }
    if (head === 'hex') return oneSolid(shank.fuse(hexagon(spec.hex[0], spec.hex[1])), spec.name);
    if (head === 'button') return oneSolid(shank.fuse(revolved([[0, 0], [spec.button[0] / 2, 0], [spec.button[0] / 2, spec.button[1] * 0.35], [spec.button[0] * 0.3, spec.button[1]], [0, spec.button[1]]])), spec.name);
    if (head === 'countersunk') {
      const [width, tall] = spec.countersunk;
      // The cone starts from the thread's core rather than its crest: meeting the crests edge to edge, the fuse fails.
      return oneSolid(shank.fuse(revolved([[0, -tall], [spec.d / 2 - 0.6 * spec.pitch, -tall], [width / 2, 0], [0, 0]])), spec.name);
    }
    throw new Error('head is socket, hex, button or countersunk.');
  });

  // A hex nut from z = 0 up, its hole threaded or plain.
  const nut = traced('nut', (size, { threaded = false, clearance = 0, pitch } = {}) => {
    const spec = metric(size, pitch);
    const [flats, tall] = spec.nut;
    const body = hexagon(flats, tall).rotate(30, [0, 0, 0], [0, 0, 1]);
    const hole = threaded ? threadSolid(spec, tall + 2, { grow: Math.max(0, Number(clearance) || 0) / 2 }).translate([0, 0, -1]) : cylinder((spec.d - spec.pitch) / 2 + Math.max(0, Number(clearance) || 0) / 2, tall + 2, -1);
    return body.cut(hole);
  });

  const washer = traced('washer', size => {
    const [inner, outer, thick] = row(size, 'washer').value;
    return cylinder(outer / 2, thick).cut(cylinder(inner / 2, thick + 2, -1));
  });

  // Copies of a shape, as one shape (a compound) to fuse, cut or return; the first copy stays in place.
  const together = shapes => R.makeCompound(shapes);
  const count = (value, what) => { const n = Math.round(Number(value)); if (!(n >= 1 && n <= 500)) throw new Error(`${what} must be between 1 and 500.`); return n; };
  const linearPattern = traced('linearPattern', (shape, copies, step) => {
    const n = count(copies, 'The count');
    if (!Array.isArray(step) || step.length !== 3) throw new Error('Give the step between copies as [dx, dy, dz].');
    return together(Array.from({ length: n }, (_, k) => shape.clone().translate([step[0] * k, step[1] * k, step[2] * k])));
  });
  const gridPattern = traced('gridPattern', (shape, [nx, ny] = [], [dx, dy] = []) => {
    const columns = count(nx, 'The columns'), rows = count(ny, 'The rows');
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Give the spacing as [dx, dy].');
    const copies = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) copies.push(shape.clone().translate([dx * i, dy * j, 0]));
    return together(copies);
  });
  const polarPattern = traced('polarPattern', (shape, copies, { angle = 360, axis = [0, 0, 1], center = [0, 0, 0] } = {}) => {
    const n = count(copies, 'The count');
    const stepAngle = Math.abs(angle) >= 360 ? angle / n : n > 1 ? angle / (n - 1) : 0;
    return together(Array.from({ length: n }, (_, k) => shape.clone().rotate(stepAngle * k, center, axis)));
  });
  const mirrorCopy = traced('mirrorCopy', (shape, plane = 'YZ', origin = [0, 0, 0]) => together([shape.clone(), shape.clone().mirror(plane, origin)]));
  const fuseAll = traced('fuseAll', shapes => {
    if (!Array.isArray(shapes) || !shapes.length) throw new Error('fuseAll needs a list of shapes.');
    return shapes.slice(1).reduce((sum, shape) => sum.fuse(shape), shapes[0]);
  });
  const cutAll = traced('cutAll', (base, tools) => (Array.isArray(tools) ? tools : [tools]).reduce((result, tool) => result.cut(tool), base));

  // Text from a font on this PC, lying on XY from z = 0 up; emboss with fuse, engrave with cut.
  const text = traced('text', (value, { size = 10, height = 1, font = 'Arial', bold = false, italic = false, align = 'left', valign = 'baseline' } = {}) => {
    const string = String(value ?? '');
    if (!string.trim()) throw new Error('text() needs some text.');
    const family = fonts.family(font, { bold, italic });
    let drawing = R.drawText(string, { fontSize: positive(size, 'The text size'), fontFamily: family });
    const [[x0, y0], [x1, y1]] = drawing.boundingBox.bounds;
    const dx = align === 'center' ? -(x0 + x1) / 2 : align === 'right' ? -x1 : -x0;
    const dy = valign === 'center' ? -(y0 + y1) / 2 : valign === 'top' ? -y1 : valign === 'bottom' ? -y0 : 0;
    drawing = drawing.translate(dx, dy);
    return drawing.sketchOnPlane('XY').extrude(positive(height, 'The text height'));
  });

  // A part from a STEP or STL file in the working folder's cad folder (or the working folder itself).
  const importPart = traced('importPart', name => imports.get(String(name || '')));

  // Joints of an assembly: the part they are given to moves, with every part attached to it.
  const vector = (value, what) => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`${what} must be [x, y, z].`);
    return value.map(Number);
  };
  const hinge = ({ axis = [0, 0, 1], origin = [0, 0, 0], min = 0, max = 90, value = 0, parent = null } = {}) => ({ type: 'hinge', axis: vector(axis, 'The hinge axis'), origin: vector(origin, 'The hinge origin'), min, max, value, parent });
  const slider = ({ axis = [1, 0, 0], min = 0, max = 10, value = 0, parent = null } = {}) => ({ type: 'slider', axis: vector(axis, 'The slider axis'), origin: [0, 0, 0], min, max, value, parent });
  const attach = parent => ({ type: 'fixed', axis: [0, 0, 1], origin: [0, 0, 0], min: 0, max: 0, value: 0, parent });

  return { thread, threadedHole, tapHole, boltHole, nutTrap, insertHole, bolt, nut, washer, linearPattern, gridPattern, polarPattern, mirrorCopy, fuseAll, cutAll, text, importPart, hinge, slider, attach, METRIC, MATERIALS: { ...MATERIALS } };
}

// What a script needs loaded before it runs: fonts named in text() calls and files named in importPart() calls.
// Names must be written as plain text in the script for this to find them.
export function wanted(source) {
  const fonts = new Set(), files = new Set();
  if (/\btext\s*\(/.test(source)) {
    fonts.add('Arial');
    for (const match of source.matchAll(/\bfont\s*:\s*(['"`])([^'"`\n]{1,60})\1/g)) fonts.add(match[2].trim());
  }
  for (const match of source.matchAll(/\bimportPart\s*\(\s*(['"`])([^'"`\n]{1,200})\1/g)) files.add(match[2].trim());
  return { fonts: [...fonts], files: [...files] };
}
