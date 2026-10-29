'use strict';

// Runs the CAD kernel in Electron: a part with a fillet and holes, its faces traced to script lines, the checks,
// every export, a picture, a script error with its line, a stuck script stopped, and the sandbox refusing the network.
// Then the workshop's own helpers: threads and fasteners, patterns, text, an imported STEP file, and an assembly with
// joints, materials and bought parts.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, session, protocol } = require('electron');
const { CadKernel } = require('../src/cad-kernel.cjs');

protocol.registerSchemesAsPrivileged([CadKernel.scheme()]);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cad-test-'));
app.setPath('userData', profile);
const step = message => { if (process.env.CAD_TEST_VERBOSE) console.log(`${new Date().toISOString().slice(11, 19)} ${message}`); };

const BRACKET = `// A wall bracket for a pipe.
const params = { width: 40, depth: 25, thickness: 4, hole: 4.5, pipe: { value: 25, min: 10, max: 60 } };

function main(p) {
  let base = makeBaseBox(p.width, p.depth, p.thickness);
  base = base.fillet(2, (e) => e.inDirection("Z"));
  const left = makeCylinder(p.hole / 2, p.thickness * 3).translate([-p.width / 2 + 6, 0, -p.thickness]);
  const right = makeCylinder(p.hole / 2, p.thickness * 3).translate([p.width / 2 - 6, 0, -p.thickness]);
  return base.cut(left).cut(right);
}
`;

async function main() {
  const out = process.env.CAD_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cad-out-'));
  const kernel = new CadKernel({ BrowserWindow, session, appRoot: path.join(__dirname, '..'), getWorkspace: () => out });
  const started = Date.now();
  const ready = await kernel.start();
  const loadMs = Date.now() - started;

  step('engine ready');
  const run = await kernel.call('run', { code: BRACKET, params: { width: 50 } });
  step('bracket built');
  assert.equal(run.error, undefined, JSON.stringify(run.error));
  assert.deepEqual(run.params.map(p => [p.name, p.value]), [['width', 50], ['depth', 25], ['thickness', 4], ['hole', 4.5], ['pipe', 25]]);
  assert.deepEqual(run.params.find(p => p.name === 'pipe'), { name: 'pipe', type: 'number', value: 25, min: 10, max: 60, step: 1, label: undefined });
  assert.equal(run.info.solids, 1);
  assert.ok(Math.abs(run.info.size[0] - 50) < 1e-6 && Math.abs(run.info.size[2] - 4) < 1e-6, JSON.stringify(run.info.size));
  const expected = 50 * 25 * 4 - 4 * (4 - Math.PI) * 4 /* fillets */ - 2 * Math.PI * 2.25 ** 2 * 4;
  assert.ok(Math.abs(run.info.volume - expected) < 1, `volume ${run.info.volume} vs ${expected}`);
  assert.ok(run.mesh.faceGroups.length === run.info.faces, 'one mesh group per face');

  // Face ids from the mesh match the engine's faces, and each traces to the script line that made it.
  const facesByType = {};
  for (let faceId = 0; faceId < run.info.faces; faceId++) {
    const face = await kernel.call('face', { faceId });
    facesByType[face.type] = (facesByType[face.type] || 0) + 1;
    if (face.type === 'CYLINDRE' && face.diameter === 4.5) assert.ok([7, 8].includes(face.line) && face.madeBy === 'makeCylinder', JSON.stringify(face));
    if (face.type === 'CYLINDRE' && face.diameter === 4) assert.equal(face.line, 6, `fillet face line ${JSON.stringify(face)}`);
    if (face.type === 'PLANE' && face.plane === '+Z') assert.equal(face.line, 5, JSON.stringify(face));
  }
  assert.equal(facesByType.CYLINDRE, 6, JSON.stringify(facesByType));

  const edge = await kernel.call('edge', { edgeId: 0 });
  assert.ok(edge.finder.startsWith('(e) => e.containsPoint('));

  const top = (await Promise.all(Array.from({ length: run.info.faces }, (_, faceId) => kernel.call('face', { faceId })))).find(face => face.plane === '+Z');
  const bottom = (await Promise.all(Array.from({ length: run.info.faces }, (_, faceId) => kernel.call('face', { faceId })))).find(face => face.plane === '-Z');
  const measured = await kernel.call('measure', { a: { kind: 'face', faceId: top.faceId }, b: { kind: 'face', faceId: bottom.faceId } });
  assert.deepEqual(measured, { distance: 4, angle: 0 });

  step('faces traced');
  // Checks: a 0.6 mm wall, a 0.8 mm hole and a floating piece.
  const flawed = await kernel.call('run', { code: `const params = {};
function main() {
  const box = makeBaseBox(20, 20, 10).shell(0.6, (f) => f.inPlane("XY", 10));
  const pin = makeCylinder(0.4, 30).translate([5, 5, -10]);
  const loose = makeBox([40, 0, 0], [45, 5, 5]);
  return box.cut(pin).fuse(loose);
}`, limits: { minWall: 1.2, minHole: 1 } });
  assert.equal(flawed.error, undefined, JSON.stringify(flawed.error));
  const kinds = flawed.checks.map(check => check.kind);
  assert.ok(kinds.includes('pieces') && kinds.includes('thinWall') && kinds.includes('smallHole'), JSON.stringify(flawed.checks, null, 1));

  // A T: the underside of its bar is an overhang, reported once for all its faces.
  const tee = await kernel.call('run', { code: 'const params = {};\nfunction main() {\n  return makeBox([-2, -2, 0], [2, 2, 10]).fuse(makeBox([-10, -2, 10], [10, 2, 12]));\n}\n' });
  const overhangs = tee.checks.filter(check => check.kind === 'overhang');
  assert.equal(overhangs.length, 1, JSON.stringify(tee.checks));
  assert.ok(overhangs[0].faceIds.length >= 1 && /on \d+ faces? \([\d.]+ mm²\)/.test(overhangs[0].message), overhangs[0].message);
  step('checks done');
  // Exports.
  await kernel.call('run', { code: BRACKET });
  const sizes = {};
  for (const format of ['step', 'stl', '3mf', 'svg', 'dxf']) {
    const bytes = await kernel.call('export', { format });
    assert.ok(bytes instanceof Uint8Array && bytes.length > 200, `${format} export`);
    fs.writeFileSync(path.join(out, `bracket.${format}`), bytes);
    sizes[format] = bytes.length;
  }
  const text = format => fs.readFileSync(path.join(out, `bracket.${format}`), 'utf8');
  assert.match(text('step'), /ISO-10303-21/);
  assert.match(text('svg'), /width="[\d.]+mm"/);
  assert.match(text('dxf'), /POLYLINE/);
  assert.equal(fs.readFileSync(path.join(out, 'bracket.3mf')).subarray(0, 2).toString(), 'PK');

  step('exports done');
  // A picture with a pin.
  const image = await kernel.snapshot({ labels: [{ text: 1, at: top.point }], faces: [top.faceId] });
  assert.match(image, /^data:image\/png;base64,/);
  fs.writeFileSync(path.join(out, 'bracket.png'), Buffer.from(image.split(',')[1], 'base64'));

  step('picture taken');
  // Errors name their line.
  const broken = await kernel.call('run', { code: 'const params = {};\nfunction main() {\n  return makeBaseBox(10, 10, 10).fillet(20);\n}\n' });
  assert.ok(broken.error && broken.error.line === 3, JSON.stringify(broken.error));
  const syntax = await kernel.call('run', { code: 'const params = {};\nfunction main() {\n  return makeBaseBox(10, 10 10);\n}\n' });
  assert.equal(syntax.error.line, 3, JSON.stringify(syntax.error));

  // The sandbox: no network, no Node.
  const network = await kernel.call('run', { code: 'const params = {};\nasync function main() {\n  await fetch("https://example.com/");\n  return makeBaseBox(1, 1, 1);\n}\n' });
  assert.ok(network.error, 'the network is refused');
  const node = await kernel.call('run', { code: 'const params = {};\nfunction main() {\n  require("fs");\n  return makeBaseBox(1, 1, 1);\n}\n' });
  assert.match(node.error.message, /require is not defined/);

  step('sandbox checked');
  // Every example in the guide the model reads builds one solid, and what the guide says about them holds.
  const guide = fs.readFileSync(path.join(__dirname, '..', 'resources', 'cad', 'GUIDE.md'), 'utf8');
  const examples = [...guide.matchAll(/```js\r?\n([\s\S]*?)```/g)].map(match => match[1]);
  assert.ok(examples.length >= 6, 'the guide has its examples');
  const built = [];
  for (const code of examples) {
    const result = await kernel.call('run', { code });
    assert.equal(result.error, undefined, `${code.split('\n')[0]} → ${JSON.stringify(result.error)}`);
    // Each part is one solid, and nothing in an example is an error.
    for (const part of result.info.parts) assert.equal(part.solids, 1, `${code.split('\n')[0]}: ${part.name}`);
    assert.ok(!result.checks.some(check => check.severity === 'error'), `${code.split('\n')[0]}: ${JSON.stringify(result.checks)}`);
    built.push(result.info);
  }
  assert.deepEqual(built.at(-2).parts.map(part => part.name), ['box', 'lid'], 'the guide shows several parts');
  assert.deepEqual(built.at(-1).parts.map(part => [part.name, part.material, part.bought || false]), [['box', 'PETG', false], ['lid', 'PETG', false], ['screw', 'Steel', true]], 'and an assembly');
  const [, , box, , knob] = built;
  assert.ok(Math.abs(box.size[0] - 50) < 1e-6 && Math.abs(box.size[2] - 25) < 1e-6, `shell keeps the outer size: ${box.size}`);
  assert.ok(Math.abs(knob.size[0] - 30) < 1e-3 && Math.abs(knob.size[1] - 30) < 1e-3 && Math.abs(knob.size[2] - 12) < 1e-3, `revolve spins around Z: ${knob.size}`);
  step('guide examples built');

  // Several parts: named, each face and edge tagged with its part, checked one by one and for overlaps. Gaps are the
  // script's business: a tight lid is not judged, a lid that cuts into the box is.
  const boxAndLid = await kernel.call('run', { code: examples.at(-2) });
  assert.deepEqual(boxAndLid.mesh.parts.map(part => part.name), ['box', 'lid']);
  assert.ok(boxAndLid.mesh.faceGroups.every(group => group.part === 0 || group.part === 1) && boxAndLid.mesh.faceGroups.some(group => group.part === 1));
  assert.ok(!boxAndLid.checks.some(check => check.kind === 'pieces'), 'two parts are not two loose pieces');
  assert.ok(!boxAndLid.checks.some(check => check.kind === 'fit'), JSON.stringify(boxAndLid.checks));
  const tightLid = await kernel.call('run', { code: examples.at(-2), params: { gap: 0.05 } });
  assert.ok(!tightLid.checks.some(check => check.kind === 'fit'), `a tight gap is not judged: ${JSON.stringify(tightLid.checks)}`);
  const clashingLid = await kernel.call('run', { code: examples.at(-2), params: { gap: -0.5 } });
  assert.ok(clashingLid.checks.some(check => check.kind === 'fit' && check.severity === 'error'), `a lip inside the wall overlaps it: ${JSON.stringify(clashingLid.checks)}`);
  assert.ok(!boxAndLid.checks.some(check => check.kind === 'thinWall'), 'the gap between parts is not a thin wall');
  const [layoutBox, layoutLid] = boxAndLid.mesh.parts.map(part => part.offset);
  assert.equal(layoutLid[2], -28, 'the lid goes down onto the bed in the print layout (its lip reaches down to z = 28)');
  assert.ok(layoutBox[0] < 0 && layoutLid[0] > 0, 'side by side');
  const lidFace = (await Promise.all(Array.from({ length: boxAndLid.info.faces }, (_, faceId) => kernel.call('face', { faceId })))).find(face => face.part === 'lid' && face.plane === '+Z');
  assert.ok(lidFace && lidFace.line, 'a lid face names its part and its line');
  const assembly = Buffer.from(await kernel.call('export', { format: 'step' })).toString();
  assert.ok(/PRODUCT\('box'/.test(assembly) && /PRODUCT\('lid'/.test(assembly), 'STEP is a named assembly');
  const objects = Buffer.from(await kernel.call('export', { format: '3mf' })).toString('latin1').match(/<object [^>]*name="(box|lid)"/g) || [];
  assert.equal(objects.length, 2, '3MF has one object per part');
  const lidOnly = await kernel.call('export', { format: 'stl', part: 'lid' });
  const both = await kernel.call('export', { format: 'stl' });
  assert.ok(lidOnly.length > 200 && lidOnly.length < both.length);
  await assert.rejects(kernel.call('export', { format: 'stl', part: 'nope' }), /There is no part "nope"/);
  const overlap = await kernel.call('run', { code: 'function main() { return { a: makeBox([0, 0, 0], [10, 10, 10]), b: makeBox([8, 0, 0], [20, 10, 10]) }; }' });
  const clash = overlap.checks.find(check => check.kind === 'fit');
  assert.ok(clash.severity === 'error' && clash.value === 200, JSON.stringify(overlap.checks));
  const tight = await kernel.call('run', { code: 'function main() { return [makeBox([0, 0, 0], [10, 10, 10]), { name: "peg", shape: makeBox([10.1, 0, 0], [20, 10, 10]), color: "#ff8800" }]; }' });
  assert.deepEqual(tight.checks, [], 'a 0.1 mm gap is not judged');
  assert.deepEqual(tight.mesh.parts.map(part => [part.name, part.color]), [['part 1', null], ['peg', '#ff8800']]);
  assert.match((await kernel.call('run', { code: 'function main() { return { "a/b": makeBaseBox(1, 1, 1) }; }' })).error.message, /not a usable part name/);
  assert.match((await kernel.call('run', { code: 'function main() { const s = makeBaseBox(5, 5, 5); return { a: s, b: s }; }' })).error.message, /are the same shape/);
  step('parts checked');

  // Threads and fasteners: a block with a threaded hole, a counterbored bolt hole, a nut trap and an insert hole,
  // the bolt in its hole and a nut, all at their ISO sizes.
  const fasteners = await kernel.call('run', { code: `function main() {
  let block = makeBaseBox(40, 30, 12);
  block = block.cut(threadedHole("M5", 12).translate([-10, 0, 12]));
  block = block.cut(boltHole("M4", 12, { head: "socket" }).translate([8, 6, 12]));
  block = block.cut(nutTrap("M3", { slot: 20 }).translate([12, -8, 6]));
  block = block.cut(insertHole("M3").translate([-10, 10, 12]));
  return {
    block: { shape: block, material: "PETG" },
    screw: { shape: bolt("M5", 12, { head: "hex" }).translate([-10, 0, 12]), bought: true, material: "Steel", count: 4 },
    nut: { shape: nut("M5", { threaded: true }).translate([40, 0, 0]), bought: true },
  };
}` }, 120000);
  assert.equal(fasteners.error, undefined, JSON.stringify(fasteners.error));
  const [block, screw] = fasteners.info.parts;
  assert.ok(Math.abs(Math.min(screw.size[0], screw.size[1]) - 8) < 0.01 && Math.abs(Math.max(screw.size[0], screw.size[1]) - 8 / Math.cos(Math.PI / 6)) < 0.05 && Math.abs(screw.size[2] - (12 + 3.5)) < 1e-3, `an M5 hex bolt is 8 mm across flats and 12 + 3.5 mm tall: ${screw.size}`);
  assert.equal(screw.count, 4);
  assert.ok(block.weight > 0 && Math.abs(block.weight - block.volume / 1000 * 1.27) < 0.01, 'the weight follows the material');
  assert.ok(!fasteners.checks.some(check => check.severity === 'error'), `the bolt fills its thread without overlapping: ${JSON.stringify(fasteners.checks)}`);
  assert.ok(!fasteners.checks.some(check => check.kind === 'thinWall' && check.part !== 'block'), `thread crests are not thin walls: ${JSON.stringify(fasteners.checks)}`);
  // The bought parts are left off the print bed.
  assert.deepEqual(fasteners.mesh.parts.map(part => part.offset === null), [false, true, true]);
  const printed = Buffer.from(await kernel.call('export', { format: '3mf' })).toString('latin1').match(/<object [^>]*name="[^"]+"/g) || [];
  assert.deepEqual(printed.map(item => item.match(/name="([^"]+)"/)[1]), ['block'], 'bought parts are not printed');
  step('fasteners built');

  // Every thread size in the table builds, at lengths that end on a whole turn and those that do not.
  const threads = await kernel.call('run', { code: `function main() {
  const out = {};
  let x = 0;
  for (const [size, length] of [["M2", 5], ["M3", 6], ["M4", 10], ["M5", 10], ["M6", 10], ["M8", 13], ["M10", 15], ["M12", 18]]) {
    out[size] = thread(size, length).translate([x, 0, 0]);
    x += Number(size.slice(1)) + 4;
  }
  return out;
}` }, 120000);
  assert.equal(threads.error, undefined, JSON.stringify(threads.error));
  for (const part of threads.info.parts) {
    const d = Number(part.name.slice(1));
    assert.ok(Math.abs(part.size[0] - d) < 0.02 && part.solids === 1, `${part.name} is one solid of its diameter: ${part.size}`);
  }
  step('threads built');

  // Patterns and text.
  const patterned = await kernel.call('run', { code: `function main() {
  let plate = makeBaseBox(60, 40, 4);
  plate = plate.cut(polarPattern(makeCylinder(2, 10, [12, 0, -2]), 6));
  plate = plate.cut(gridPattern(makeCylinder(1, 10, [-25, -15, -2]), [3, 2], [5, 30]));
  plate = plate.fuse(text("LB", { size: 8, height: 1, align: "center", valign: "center" }).translate([20, 0, 4]));
  return plate;
}` });
  assert.equal(patterned.error, undefined, JSON.stringify(patterned.error));
  assert.ok(Math.abs(patterned.info.size[2] - 5) < 1e-3, 'the text stands 1 mm on the plate');
  assert.ok(Math.abs(patterned.info.volume - (60 * 40 * 4 - 6 * Math.PI * 4 * 4 - 6 * Math.PI * 4)) > 1, 'the text adds volume');
  const holes = [];
  for (let faceId = 0; faceId < patterned.info.faces; faceId++) { const face = await kernel.call('face', { faceId }); if (face.type === 'CYLINDRE') holes.push(face.diameter); }
  assert.deepEqual([holes.filter(d => d === 4).length, holes.filter(d => d === 2).length], [6, 6], `six of each hole: ${holes}`);
  const noFont = await kernel.call('run', { code: 'function main() { return text("x", { font: "No Such Font 123" }); }' });
  assert.match(noFont.error.message, /not installed on this PC/);
  step('patterns and text');

  // A STEP file in the working folder's cad folder is imported and built on; a missing one is named.
  fs.mkdirSync(path.join(out, 'cad'), { recursive: true });
  fs.copyFileSync(path.join(out, 'bracket.step'), path.join(out, 'cad', 'bracket.step'));
  const imported = await kernel.call('run', { code: 'function main() { return importPart("bracket.step").cut(makeCylinder(3, 10, [0, 0, -1])); }' });
  assert.equal(imported.error, undefined, JSON.stringify(imported.error));
  assert.ok(Math.abs(imported.info.size[0] - 40) < 1e-3 && imported.info.volume < run.info.volume, JSON.stringify(imported.info.size));
  assert.match((await kernel.call('run', { code: 'function main() { return importPart("missing.step"); }' })).error.message, /There is no STEP or STL file "missing.step"/);
  assert.match((await kernel.call('run', { code: 'function main() { return importPart("../outside.step"); }' })).error.message, /There is no STEP or STL file/);
  step('import');

  // An assembly: a hinged arm and a slider on a base, a post attached to it. Each joint is swept through its range;
  // the carriage runs into the post near the end of its travel, and a pose shows where.
  const machine = await kernel.call('run', { code: `function main() {
  return {
    base: { shape: makeBaseBox(60, 40, 10), material: "PLA" },
    post: { shape: makeBox([20, -5, 10], [26, 5, 40]), joint: attach("base") },
    arm: { shape: makeBox([-2, -3, 42], [40, 3, 46]), joint: hinge({ axis: [0, 0, 1], origin: [0, 0, 44], min: -90, max: 90 }) },
    carriage: { shape: makeBox([-28, -6, 10], [-18, 6, 16]), joint: slider({ axis: [1, 0, 0], min: 0, max: 45 }), material: "Aluminium", count: 2 },
  };
}` });
  assert.equal(machine.error, undefined, JSON.stringify(machine.error));
  const motion = machine.checks.filter(check => check.kind === 'motion');
  assert.equal(motion.length, 1, JSON.stringify(machine.checks));
  assert.ok(motion[0].parts.join() === 'carriage,post' && /from [\d.]+ to 45 mm/.test(motion[0].message) && motion[0].pose.carriage === 45, motion[0].message);
  assert.deepEqual(machine.info.parts.map(part => part.joint?.type || null), [null, 'fixed', 'hinge', 'slider']);
  assert.equal(machine.mesh.parts[1].joint.parent, 0, 'the post is attached to the base by index');
  assert.deepEqual(await kernel.call('collide', { pose: { carriage: 10 } }), []);
  const crash = await kernel.call('collide', { pose: { carriage: 45 } });
  assert.ok(crash.length === 1 && [...crash[0].parts].sort().join() === 'carriage,post' && crash[0].volume > 0, JSON.stringify(crash));
  const posedPicture = await kernel.snapshot({ views: ['top'], pose: { arm: 90, carriage: 30 }, explode: 0.5 });
  assert.match(posedPicture, /^data:image\/png;base64,/);
  fs.writeFileSync(path.join(out, 'machine.png'), Buffer.from(posedPicture.split(',')[1], 'base64'));
  assert.match((await kernel.call('run', { code: 'function main() { return { a: { shape: makeBaseBox(1, 1, 1), joint: attach("b") }, b: { shape: makeBaseBox(1, 1, 1).translate([3, 0, 0]), joint: attach("a") } }; }' })).error.message, /in a loop/);
  assert.match((await kernel.call('run', { code: 'function main() { return { a: { shape: makeBaseBox(1, 1, 1), material: "Cheese" } }; }' })).error.message, /Unknown material "Cheese"/);
  step('assembly');

  // A stuck script is stopped and the engine comes back.
  const stuckStarted = Date.now();
  await assert.rejects(kernel.call('run', { code: 'const params = {};\nfunction main() { while (true) {} }\n' }, 3000), /took too long/);
  assert.ok(Date.now() - stuckStarted < 8000);
  const after = await kernel.call('run', { code: BRACKET }, 120000);
  assert.equal(after.info.solids, 1);

  kernel.close();
  if (!process.env.CAD_TEST_OUT) fs.rmSync(out, { recursive: true, force: true });
  console.log(`CAD kernel: engine ready in ${(loadMs / 1000).toFixed(1)} s (pictures: ${ready.pictures}); bracket ${run.info.faces} faces traced to their lines; checks found ${kinds.join(', ')}; exports ${Object.entries(sizes).map(([k, v]) => `${k} ${Math.round(v / 1024)} KB`).join(', ')}; errors located; network and Node refused; a stuck script stopped. Output: ${out}`);
}

setTimeout(() => { console.error('The CAD kernel test did not finish in 6 minutes.'); app.exit(1); }, 360000).unref();
app.whenReady().then(main).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
