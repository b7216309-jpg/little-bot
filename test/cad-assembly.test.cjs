'use strict';

// The CAD workshop's assemblies and helpers outside the engine: joint checks and pose math (shared by the engine and
// the 3D view), the bill of materials and poses through the tool, the PC's fonts by name, and the kernel serving
// only STEP and STL files from inside the working folder.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CadWorkshop } = require('../src/cad-workshop.cjs');
const { CadKernel } = require('../src/cad-kernel.cjs');
const { readRegistry, cleanName } = require('../src/cad-fonts.cjs');

const TOOL_IMAGES = Symbol.for('little-bot.tool-images');
const assembly = import('../src/cad/assembly.js');
const library = import('../src/cad/library.js');
const close = (a, b, message) => a.forEach((value, index) => assert.ok(Math.abs(value - b[index]) < 1e-9, `${message}: ${a} vs ${b}`));

test('joints are checked: known parents, no loops, sensible ranges', async () => {
  const { normalizeJoints } = await assembly;
  const { hinge, slider, attach } = (await library).createLibrary({ R: {}, traced: (_, fn) => fn, fonts: {}, imports: {} });
  const joints = normalizeJoints([
    { name: 'base', joint: null },
    { name: 'lid', joint: hinge({ axis: [2, 0, 0], origin: [0, 10, 5], min: 0, max: 110, value: 200, parent: 'base' }) },
    { name: 'handle', joint: attach('lid') },
    { name: 'drawer', joint: slider({ axis: [0, 1, 0], min: 0, max: 40 }) },
  ]);
  assert.equal(joints[0], null);
  assert.deepEqual(joints[1], { type: 'hinge', axis: [1, 0, 0], origin: [0, 10, 5], min: 0, max: 110, value: 110, parent: 0 }, 'the axis is made unit length and the rest value kept in range');
  assert.equal(joints[2].type, 'fixed');
  assert.equal(joints[2].parent, 1);
  assert.throws(() => normalizeJoints([{ name: 'a', joint: attach('nope') }]), /there is no part "nope"/);
  assert.throws(() => normalizeJoints([{ name: 'a', joint: attach('b') }, { name: 'b', joint: attach('a') }]), /in a loop/);
  assert.throws(() => normalizeJoints([{ name: 'a', joint: hinge({ min: 10, max: 0 }) }]), /min ≤ max/);
  assert.throws(() => normalizeJoints([{ name: 'a', joint: { type: 'weld' } }]), /hinge\(\), slider\(\) or attach\(\)/);
});

test('a pose moves a part by its own joint, then by its parents', async () => {
  const { normalizeJoints, movesOf, matrixOf, applyMatrix, unapplyMatrix, explodeOffsets } = await assembly;
  const parts = [{ name: 'base' }, { name: 'lid' }, { name: 'handle' }, { name: 'drawer' }];
  // Around -X, so a positive angle lifts what is in front of the hinge (right-hand rule).
  parts[1].joint = { type: 'hinge', axis: [-1, 0, 0], origin: [0, 10, 5], min: 0, max: 180, value: 0, parent: 'base' };
  parts[2].joint = { type: 'fixed', axis: [0, 0, 1], origin: [0, 0, 0], min: 0, max: 0, value: 0, parent: 'lid' };
  parts[3].joint = { type: 'slider', axis: [0, 1, 0], origin: [0, 0, 0], min: 0, max: 40, value: 5, parent: null };
  const joints = normalizeJoints(parts);
  const at = (index, pose, point) => applyMatrix(matrixOf(movesOf(parts, joints, index, pose)), point);
  // At rest the drawer sits at its own rest value; the lid at 0.
  close(at(3, {}, [0, 0, 0]), [0, 5, 0], 'the drawer rests 5 mm out');
  close(at(1, {}, [0, 0, 5]), [0, 0, 5], 'the lid rests closed');
  // A quarter turn around X through (0, 10, 5): a point 10 mm in front of the hinge rises to 10 mm above it.
  close(at(1, { lid: 90 }, [0, 0, 5]), [0, 10, 15], 'the lid opens');
  close(at(2, { lid: 90 }, [0, 0, 5]), [0, 10, 15], 'the handle moves with the lid');
  close(at(3, { drawer: 100 }, [0, 0, 0]), [0, 40, 0], 'a value past the range stops at its end');
  const m = matrixOf(movesOf(parts, joints, 1, { lid: 37 }));
  close(unapplyMatrix(m, applyMatrix(m, [3, -4, 7])), [3, -4, 7], 'a move undoes');
  // Exploding pushes parts away from the middle; nothing moves at 0.
  const boxes = [[[-10, -10, 0], [10, 10, 2]], [[20, -5, 0], [30, 5, 10]]];
  assert.deepEqual(explodeOffsets(boxes, 0), [[0, 0, 0], [0, 0, 0]]);
  const [left, right] = explodeOffsets(boxes, 1);
  assert.ok(left[0] < 0 && right[0] > 0, `${left} / ${right}`);
});

test('materials and thread sizes are named as the user would', async () => {
  const { materialOf, METRIC } = await library;
  assert.equal(materialOf('petg'), 'PETG');
  assert.equal(materialOf('aluminum'), 'Aluminium');
  assert.equal(materialOf(undefined), null);
  assert.throws(() => materialOf('Cheese'), /Unknown material "Cheese"/);
  assert.equal(METRIC.M3.pitch, 0.5);
  assert.deepEqual(METRIC.M8.nut, [13, 6.8]);
  const { wanted } = await library;
  assert.deepEqual(wanted('const a = text("Hi", { font: "Segoe UI", bold: true }); importPart("cad/arm.step"); importPart(`lid.stl`)'), { fonts: ['Arial', 'Segoe UI'], files: ['cad/arm.step', 'lid.stl'] });
  assert.deepEqual(wanted('function main() { return makeBaseBox(1, 1, 1); }'), { fonts: [], files: [] });
});

// The engine stand-in for an assembly: a box, a hinged lid and a bought screw.
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cad-asm-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'work');
  fs.mkdirSync(workspace);
  const calls = [];
  const kernel = {
    calls, start: async () => ({ ok: true }), close() {},
    async call(op, args) {
      calls.push([op, args]);
      if (op === 'run') return { params: [], checks: [], steps: [], mesh: { vertices: new Float32Array(9), normals: new Float32Array(9), triangles: new Uint32Array([0, 1, 2]), faceGroups: [], lines: new Float32Array(0), edgeGroups: [] },
        info: { size: [60, 40, 34], volume: 30000, solids: 3, faces: 30, edges: 60, parts: [
          { name: 'box', size: [60, 40, 30], volume: 15000, solids: 1, count: 1, material: 'PETG', weight: 19.05 },
          { name: 'lid', size: [60, 40, 4], volume: 9600, solids: 1, count: 1, material: 'PETG', weight: 12.19, joint: { type: 'hinge', min: 0, max: 120, value: 0, parent: 'box' } },
          { name: 'screw', size: [5.5, 5.5, 11], volume: 70, solids: 1, count: 4, bought: true, material: 'Steel', weight: 0.55 },
        ] } };
      if (op === 'collide') return args.pose.lid > 100 ? [{ parts: ['lid', 'box'], volume: 12.5, at: [0, 0, 30] }] : [];
      if (op === 'export') return new Uint8Array([1, 2, 3]);
      throw new Error(`unexpected ${op}`);
    },
    async snapshot(options) { calls.push(['snapshot', options]); return 'data:image/png;base64,iVBORw0KGgo='; },
  };
  const store = { data: { settings: { cadEnabled: true, workspace }, cad: {} }, save() {} };
  const guidePath = path.join(root, 'GUIDE.md');
  fs.writeFileSync(guidePath, '# guide');
  const cad = new CadWorkshop({ kernel, store, root: path.join(root, 'state'), getWorkspace: () => workspace, guidePath });
  return { cad, kernel, chat: { id: 'c1', status: 'running' } };
}

test('the tool lists the bill of materials and shows poses, checking the joint names and values', async t => {
  const { cad, kernel, chat } = setup(t);
  const built = await cad.call({ action: 'write', code: 'function main() {}', note: 'assembly' }, { chat });
  assert.deepEqual(built.parts, [
    'box: 60 × 40 × 30 mm, 15000 mm³ (PETG, 19.05 g)',
    'lid: 60 × 40 × 4 mm, 9600 mm³ (PETG, 12.19 g, hinge 0–120° on box)',
    'screw: 5.5 × 5.5 × 11 mm, 70 mm³ (× 4, Steel, 0.55 g, bought)',
  ]);
  const bom = await cad.call({ action: 'bom' }, { chat });
  assert.deepEqual(bom.rows.map(row => [row.part, row.count, row.material, row.weight, row.bought || false]), [['box', 1, 'PETG', '19.05 g', false], ['lid', 1, 'PETG', '12.19 g', false], ['screw', 4, 'Steel', '0.55 g', true]]);
  assert.equal(bom.totalWeight, '33.4 g', 'counts multiply');
  const open = await cad.call({ action: 'pose', pose: { lid: '90' } }, { chat });
  assert.deepEqual(open.pose, { lid: 90 }, 'numbers sent as text are read');
  assert.deepEqual(open.collisions, ['Nothing runs into anything in this pose.']);
  assert.equal(open[TOOL_IMAGES].length, 1);
  assert.deepEqual(kernel.calls.filter(([op]) => op === 'snapshot').at(-1)[1].pose, { lid: 90 });
  const tooFar = await cad.call({ action: 'pose', pose: { lid: 500 } }, { chat });
  assert.deepEqual(tooFar.pose, { lid: 120 }, 'a value past the range stops at its end');
  assert.deepEqual(tooFar.collisions, ['"lid" runs into "box" (12.5 mm³)']);
  await assert.rejects(cad.call({ action: 'pose', pose: { box: 10 } }, { chat }), /"box" has no joint that moves. Parts that move: lid/);
  await cad.call({ action: 'view', explode: 2, pose: { lid: 45 } }, { chat });
  const view = kernel.calls.filter(([op]) => op === 'snapshot').at(-1)[1];
  assert.deepEqual([view.explode, view.pose], [1, { lid: 45 }]);
  const printed = await cad.call({ action: 'export', format: 'stl' }, { chat });
  assert.match(printed.note, /Bought parts left out: screw/);
  assert.equal(cad.limits.minClearance, undefined, 'there is no clearance limit any more');
});

test('the PC fonts are found by family and style from the registry', () => {
  const folder = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  const fonts = readRegistry((command, args) => {
    assert.equal(command, 'reg');
    if (args[1].startsWith('HKCU')) return '\r\nHKEY_CURRENT_USER\\...\\Fonts\r\n    My Hand (TrueType)    REG_SZ    C:\\Users\\me\\Fonts\\hand.ttf\r\n';
    return [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
      '    Arial (TrueType)    REG_SZ    arial.ttf',
      '    Arial Bold (TrueType)    REG_SZ    arialbd.ttf',
      '    Cambria & Cambria Math (TrueType)    REG_SZ    cambria.ttc',
      '    Segoe UI Variable (TrueType)    REG_SZ    SegUIVar.ttf',
      '    Old Font    REG_SZ    old.fon',
    ].join('\r\n');
  });
  assert.equal(fonts.get('arial'), path.join(folder, 'arial.ttf'));
  assert.equal(fonts.get('arial bold'), path.join(folder, 'arialbd.ttf'));
  assert.equal(fonts.get('my hand'), 'C:\\Users\\me\\Fonts\\hand.ttf');
  assert.ok(!fonts.has('cambria & cambria math') && !fonts.has('old font'), 'collections and bitmap fonts are left out');
  assert.equal(cleanName('Segoe UI  Bold (OpenType)'), 'segoe ui bold');
});

test('the engine page reads only STEP and STL files inside the working folder', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cad-import-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'work');
  fs.mkdirSync(path.join(workspace, 'cad'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'cad', 'arm.step'), 'ISO-10303-21;');
  fs.writeFileSync(path.join(workspace, 'plate.stl'), 'solid plate');
  fs.writeFileSync(path.join(workspace, 'notes.txt'), 'secret');
  fs.writeFileSync(path.join(root, 'outside.step'), 'ISO-10303-21;');
  const kernel = new CadKernel({ BrowserWindow: null, session: null, appRoot: root, getWorkspace: () => workspace });
  const read = async name => { const answer = kernel._import(name); return [answer.status, answer.status === 200 ? await answer.text() : '']; };
  assert.deepEqual(await read('arm.step'), [200, 'ISO-10303-21;'], 'the cad folder first');
  assert.deepEqual(await read('plate.stl'), [200, 'solid plate'], 'then the working folder');
  assert.equal(kernel._import('arm.step').headers.get('x-file-tag').split('-').length, 2);
  assert.equal((await read('notes.txt'))[0], 404, 'other file types are refused');
  assert.equal((await read('../outside.step'))[0], 404, 'nothing outside the working folder');
  assert.equal((await read('../../outside.step'))[0], 404);
  assert.equal((await read(path.join(root, 'outside.step')))[0], 404, 'nor by full path');
  assert.equal(new CadKernel({ appRoot: root, getWorkspace: () => '' })._import('arm.step').status, 404, 'no working folder, no files');
});
