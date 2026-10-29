'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CadWorkshop, TEMPLATE } = require('../src/cad-workshop.cjs');
const { AgentTools } = require('../src/agent-tools.cjs');

const TOOL_IMAGES = Symbol.for('little-bot.tool-images');

// A stand-in for the kernel page: builds report the code's length, and a script containing "boom" fails.
function fakeKernel() {
  const calls = [];
  return {
    calls,
    start: async () => ({ ok: true }),
    close() {},
    async call(op, args) {
      calls.push([op, args]);
      if (op === 'run') {
        if (args.code.includes('boom')) return { error: { message: 'boom is not defined', line: 3 }, params: [] };
        const width = args.params.width ?? 40;
        return { params: [{ name: 'width', type: 'number', value: width, min: 0, max: 120, step: 1 }], info: { size: [width, 25, 4], volume: width * 100, solids: 1, faces: 10, edges: 24 },
          checks: [{ kind: 'thinWall', severity: 'warning', message: 'Wall 0.6 mm thick.', faceId: 3, at: [1, 2, 3] }], steps: [{ line: 5, kind: 'makeBaseBox' }],
          mesh: { vertices: new Float32Array(9), normals: new Float32Array(9), triangles: new Uint32Array([0, 1, 2]), faceGroups: [], lines: new Float32Array(0), edgeGroups: [] } };
      }
      if (op === 'face') return { kind: 'face', faceId: args.faceId, type: 'PLANE', plane: '+Z', line: 5, madeBy: 'makeBaseBox', finder: '(f) => f.inPlane("XY", 4)', point: [0, 0, 4] };
      if (op === 'export') return new Uint8Array([1, 2, 3]);
      throw new Error(`unexpected ${op}`);
    },
    async snapshot() { return 'data:image/png;base64,iVBORw0KGgo='; },
  };
}

function setup(t, { enabled = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cad-ws-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'work');
  fs.mkdirSync(workspace);
  const store = { data: { settings: { cadEnabled: enabled, workspace }, cad: {} }, save() {} };
  const guidePath = path.join(root, 'GUIDE.md');
  fs.writeFileSync(guidePath, '# guide');
  const kernel = fakeKernel();
  const meshes = [];
  const cad = new CadWorkshop({ kernel, store, root: path.join(root, 'state'), getWorkspace: () => workspace, guidePath, onMesh: payload => meshes.push(payload) });
  const chat = { id: 'c1', status: 'running' };
  return { cad, kernel, store, workspace, chat, meshes };
}

test('the model writes versions into the working folder, sees checks and a picture, and slider values reset on a new script', async t => {
  const { cad, workspace, chat, meshes } = setup(t);
  const first = await cad.call({ action: 'write', code: TEMPLATE, note: 'first' }, { chat });
  assert.equal(first.version, 1);
  assert.equal(fs.readFileSync(path.join(workspace, 'cad', 'part.cad.js'), 'utf8'), TEMPLATE);
  assert.deepEqual(first.checks, ['warning: Wall 0.6 mm thick. (face 3) at [1, 2, 3]']);
  assert.match(first.picture, /\.png$/);
  assert.equal(first[TOOL_IMAGES].length, 1);
  assert.equal(meshes.length, 1);
  const tried = await cad.setParams({ width: 60 });
  assert.deepEqual(tried.size, { x: 60, y: 25, z: 4 });
  await assert.rejects(cad.setParams({ depth: 2 }), /no setting "depth"/);
  const second = await cad.call({ action: 'write', code: `${TEMPLATE}\n// v2`, note: 'second' }, { chat });
  assert.equal(second.version, 2);
  assert.deepEqual(second.slidersReset, { width: 60 });
  const read = await cad.call({ action: 'read' }, { chat });
  assert.deepEqual(read.versions, ['1: first (model)', '2: second (model)']);
  const reverted = await cad.revert(1);
  assert.equal(reverted.version, 3);
  assert.equal(cad.project.code, TEMPLATE);
  assert.equal(cad.state().project.versions.at(-1).note, 'Back to version 1');
});

test('a failing script reports its line and keeps the version; the guide, inspect and export work', async t => {
  const { cad, chat, workspace } = setup(t);
  const failed = await cad.call({ action: 'write', code: 'const params = {};\nfunction main() {\n  boom();\n}' }, { chat });
  assert.deepEqual(failed.error, { message: 'boom is not defined', line: 3 });
  assert.equal(failed.version, 1);
  assert.equal(failed[TOOL_IMAGES], undefined);
  await assert.rejects(cad.call({ action: 'inspect', faceId: 1 }, { chat }), /does not build: boom/);
  assert.equal((await cad.call({ action: 'guide' }, { chat })).guide, '# guide');
  await cad.call({ action: 'write', code: TEMPLATE }, { chat });
  assert.equal((await cad.call({ action: 'inspect', faceId: 4 }, { chat })).line, 5);
  const exported = await cad.call({ action: 'export', format: 'stl' }, { chat });
  assert.equal(exported.path, path.join(workspace, 'cad', 'part.stl'));
  assert.deepEqual([...fs.readFileSync(exported.path)], [1, 2, 3]);
  await assert.rejects(cad.call({ action: 'export', format: 'stl', path: 'out.step' }, { chat }), /must end in \.stl/);
});

test('the tool is offered only when switched on, and only in the user\'s own running conversation', async t => {
  const off = setup(t, { enabled: false });
  const store = { data: { settings: {}, extensions: {}, memory: {} } };
  const toolsOff = new AgentTools({ store, cad: off.cad });
  assert.ok(!toolsOff.specs().some(tool => tool.name === 'cad'));
  await assert.rejects(off.cad.call({ action: 'guide' }, { chat: off.chat }), /CAD workshop is off/);
  const on = setup(t);
  const toolsOn = new AgentTools({ store, cad: on.cad });
  assert.ok(toolsOn.specs().some(tool => tool.name === 'cad'));
  assert.ok(!toolsOn.specs({ readOnly: true }).some(tool => tool.name === 'cad'), 'Plan mode has no CAD tool');
  await assert.rejects(on.cad.call({ action: 'guide' }, { chat: { id: 'h', internal: true, status: 'running' } }), /not in background work/);
  assert.ok((await on.cad.call({ action: 'guide' }, { chat: { id: 'a', automationId: 'x', status: 'running' } })).guide, 'a scheduled task has full access');
});

test('what the user pointed at becomes numbered text for the model and a picture with the same numbers', async t => {
  const { cad, chat } = setup(t);
  await cad.call({ action: 'write', code: TEMPLATE }, { chat });
  await cad.setParams({ width: 55 });
  const context = await cad.messageContext({ items: [
    { kind: 'face', faceId: 4, type: 'CYLINDRE', diameter: 4.5, area: 56.5, line: 7, madeBy: 'makeCylinder', movedAt: 7, finder: '(f) => f.containsPoint([1, 2, 3])', point: [1, 2, 3], note: 'make this 5 mm' },
    { kind: 'point', point: [0, 0, 4], note: 'too tall here' },
    { kind: 'measure', text: '2.8 mm between face 3 and face 7', point: [1, 1, 1] },
  ] });
  const lines = context.text.split('\n');
  assert.match(lines[1], /^1\. Face 4: cylinder, ⌀4\.5 mm, 56\.5 mm², made by makeCylinder on script line 7 \(moved on line 7\), finder \(f\) => f\.containsPoint\(\[1, 2, 3\]\) — note: "make this 5 mm"$/);
  assert.equal(lines[2], '2. Point [0, 0, 4] — note: "too tall here"');
  assert.equal(lines[3], '3. Measurement: 2.8 mm between face 3 and face 7');
  assert.match(context.text, /Slider values the user set \(not yet in the script\): \{"width":55\}/);
  assert.match(context.image, /\.png$/);
  assert.deepEqual(context.labels, ['1. Face 4', '2. Point', '3. Measure']);
  assert.equal(await cad.messageContext({ items: [] }), null);
});

test('several parts: the summary lists them, exports take one by name, and pointing names the part', async t => {
  const { cad, kernel, workspace, chat } = setup(t);
  const run = kernel.call.bind(kernel);
  kernel.call = async (op, args) => {
    const result = await run(op, args);
    if (op !== 'run' || result.error) return result;
    return { ...result, info: { ...result.info, solids: 2, parts: [{ name: 'box', size: [60, 40, 30], volume: 15344.2, solids: 1 }, { name: 'lid', size: [60, 40, 4], volume: 8724, solids: 1 }] },
      checks: [{ kind: 'fit', severity: 'warning', parts: ['box', 'lid'], value: 0.1, message: '"box" and "lid": gap of 0.1 mm, tight for printed parts.' }, { kind: 'thinWall', severity: 'warning', part: 'lid', faceId: 7, message: 'Wall 0.6 mm thick.' }] };
  };
  const built = await cad.call({ action: 'write', code: 'function main() { return { box, lid }; }', note: 'two parts' }, { chat });
  assert.deepEqual(built.parts, ['box: 60 × 40 × 30 mm, 15344.2 mm³', 'lid: 60 × 40 × 4 mm, 8724 mm³']);
  assert.equal(built.pieces, undefined);
  assert.deepEqual(built.checks, ['warning: "box" and "lid": gap of 0.1 mm, tight for printed parts.', 'warning: [lid] Wall 0.6 mm thick. (face 7)']);
  const one = await cad.call({ action: 'export', format: 'stl', part: 'lid' }, { chat });
  assert.equal(one.path, path.join(workspace, 'cad', 'part-lid.stl'));
  assert.deepEqual(kernel.calls.at(-1), ['export', { format: 'stl', view: 'top', part: 'lid' }]);
  const all = await cad.call({ action: 'export', format: 'step' }, { chat });
  assert.match(all.note, /named assembly/);
  await assert.rejects(cad.call({ action: 'export', format: 'stl', part: 'hinge' }, { chat }), /There is no part "hinge". Parts: box, lid/);
  const context = await cad.messageContext({ items: [{ kind: 'face', faceId: 7, part: 'lid', type: 'PLANE', plane: '+Z', point: [1, 2, 3], note: 'thicker' }] });
  assert.match(context.text, /1\. Face 7: of part "lid", plane/);
  assert.deepEqual(context.labels, ['1. lid · Face 7']);
});
