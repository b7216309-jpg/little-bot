'use strict';

// Runs the CAD kernel in Electron: a part with a fillet and holes, its faces traced to script lines, the checks,
// every export, a picture, a script error with its line, a stuck script stopped, and the sandbox refusing the network.

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
  const kernel = new CadKernel({ BrowserWindow, session, appRoot: path.join(__dirname, '..') });
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
  assert.deepEqual(built.at(-1).parts.map(part => part.name), ['box', 'lid'], 'the guide shows several parts');
  const [, , box, , knob] = built;
  assert.ok(Math.abs(box.size[0] - 50) < 1e-6 && Math.abs(box.size[2] - 25) < 1e-6, `shell keeps the outer size: ${box.size}`);
  assert.ok(Math.abs(knob.size[0] - 30) < 1e-3 && Math.abs(knob.size[1] - 30) < 1e-3 && Math.abs(knob.size[2] - 12) < 1e-3, `revolve spins around Z: ${knob.size}`);
  step('guide examples built');

  // Several parts: named, each face and edge tagged with its part, checked one by one and for their fit.
  const boxAndLid = await kernel.call('run', { code: examples.at(-1) });
  assert.deepEqual(boxAndLid.mesh.parts.map(part => part.name), ['box', 'lid']);
  assert.ok(boxAndLid.mesh.faceGroups.every(group => group.part === 0 || group.part === 1) && boxAndLid.mesh.faceGroups.some(group => group.part === 1));
  assert.ok(!boxAndLid.checks.some(check => check.kind === 'pieces'), 'two parts are not two loose pieces');
  const fit = boxAndLid.checks.find(check => check.kind === 'fit');
  assert.ok(fit && /touch/.test(fit.message) && fit.parts.join() === 'box,lid', JSON.stringify(boxAndLid.checks));
  assert.equal(fit.value, 0.25, `the lip's clearance is measured where the parts do not touch: ${fit.message}`);
  assert.equal(fit.severity, 'info');
  const tightLid = await kernel.call('run', { code: examples.at(-1), params: { gap: 0.1 } });
  const tightFit = tightLid.checks.find(check => check.kind === 'fit');
  assert.ok(tightFit.severity === 'warning' && tightFit.value === 0.1, `a 0.1 mm lip gap is too tight: ${JSON.stringify(tightFit)}`);
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
  assert.deepEqual(tight.checks.map(check => [check.kind, check.severity, check.value]), [['fit', 'warning', 0.1]]);
  assert.deepEqual(tight.mesh.parts.map(part => [part.name, part.color]), [['part 1', null], ['peg', '#ff8800']]);
  assert.match((await kernel.call('run', { code: 'function main() { return { "a/b": makeBaseBox(1, 1, 1) }; }' })).error.message, /not a usable part name/);
  assert.match((await kernel.call('run', { code: 'function main() { const s = makeBaseBox(5, 5, 5); return { a: s, b: s }; }' })).error.message, /are the same shape/);
  step('parts checked');

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

setTimeout(() => { console.error('The CAD kernel test did not finish in 3 minutes.'); app.exit(1); }, 180000).unref();
app.whenReady().then(main).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
