// The 3D view of a part, shared by the CAD panel (interactive) and the kernel page (pictures for the model).
// Z points up, as in CAD. Faces and edges keep the engine's ids so a click names exactly what was clicked.

import * as THREE from '../../node_modules/three/build/three.module.js';
import { partColor } from './colors.js';

export const PALETTES = {
  light: { background: 0xf7f6f1, part: 0xd9dccf, edge: 0x3d4339, highlight: 0xbc623f, ghost: 0x7a8a6c, grid: 0xd8d8cc, gridMajor: 0xc4c6b8, problem: 0xc0392b, warning: 0xd08a2e, info: 0x4f7aa8, pin: 0x2f6f8f, text: '#232822' },
  dark: { background: 0x1d1f1a, part: 0x8f9684, edge: 0x14160f, highlight: 0xe08a5f, ghost: 0xa8b894, grid: 0x30332b, gridMajor: 0x3d4136, problem: 0xe0584a, warning: 0xe0a24e, info: 0x7aa6d4, pin: 0x6fb3d2, text: '#e8e6dc' },
};

const VIEWS = { iso: [1, -1.15, 0.85], front: [0, -1, 0], back: [0, 1, 0], top: [0, 0, 1], bottom: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0] };

// A model of several parts keeps one mesh: every face and edge group says which part it belongs to. Hidden parts
// are left out of the index, and the print layout moves each part's vertices by its offset.
const ZERO = [0, 0, 0];

// Edge groups are polylines; LineSegments wants pairs. Hidden parts are skipped, laid-out ones moved.
function edgeSegments(mesh, view) {
  const positions = [], ids = [], parts = [];
  for (const group of mesh.edgeGroups || []) {
    const part = group.part || 0;
    if (view.hidden.has(part)) continue;
    const [dx, dy, dz] = view.offset(part);
    for (let k = group.start; k < group.start + group.count - 1; k++) {
      positions.push(mesh.lines[k * 3] + dx, mesh.lines[k * 3 + 1] + dy, mesh.lines[k * 3 + 2] + dz, mesh.lines[k * 3 + 3] + dx, mesh.lines[k * 3 + 4] + dy, mesh.lines[k * 3 + 5] + dz);
      ids.push(group.edgeId); parts.push(part);
    }
  }
  return { positions: new Float32Array(positions), ids, parts };
}

function subsetGeometry(mesh, faceIds, position, hidden) {
  const wanted = new Set(faceIds);
  const indices = [];
  for (const group of mesh.faceGroups || []) if (wanted.has(group.faceId) && !hidden.has(group.part || 0)) for (let k = group.start; k < group.start + group.count; k++) indices.push(mesh.triangles[k]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function createViewer(canvas, { interactive = false, theme = 'light', preserve = false, onRender = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: preserve });
  renderer.setPixelRatio(interactive ? Math.min(2, globalThis.devicePixelRatio || 1) : 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
  camera.up.set(0, 0, 1);
  const headlight = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 1.3), camera, headlight);
  camera.add(headlight); headlight.position.set(0.3, 0.5, 1);
  const root = new THREE.Group(), overlay = new THREE.Group();
  scene.add(root, overlay);
  let palette = PALETTES[theme] || PALETTES.light;
  let mesh = null, faceOf = null, trianglePart = null, partMesh = null, edgeLines = null, edgeIds = [], edgeParts = [], ghost = null, grid = null;
  let target = new THREE.Vector3(), radius = 50;
  const spherical = new THREE.Spherical(1, Math.PI / 3, Math.PI / 4);
  // The parts: their names, colors and print-layout offsets; which are hidden; assembled or laid out for printing.
  let parts = [], vertexPart = null, positionAttribute = null;
  const view = { hidden: new Set(), layout: false, offset: part => (view.layout && parts.length > 1 ? parts[part]?.offset || ZERO : ZERO) };

  const materials = () => ({
    part: new THREE.MeshStandardMaterial({ color: parts.length > 1 ? 0xffffff : palette.part, vertexColors: parts.length > 1, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    edge: new THREE.LineBasicMaterial({ color: palette.edge, transparent: true, opacity: 0.85 }),
  });

  function clear(group) { for (const child of [...group.children]) { group.remove(child); child.geometry?.dispose(); child.material?.dispose?.(); } }

  function setMesh(next, { keepView = false } = {}) {
    mesh = next;
    parts = next?.parts?.length ? next.parts : [{ name: 'part', offset: ZERO }];
    // A new model keeps the parts the user hid, by name.
    const hiddenNames = new Set([...view.hidden].map(index => view.names?.[index]).filter(Boolean));
    view.hidden = new Set(parts.map((part, index) => hiddenNames.has(part.name) ? index : -1).filter(index => index >= 0));
    view.names = parts.map(part => part.name);
    if (parts.length < 2) view.layout = false;
    vertexPart = null;
    if (next && parts.length > 1) {
      vertexPart = new Int16Array(next.vertices.length / 3);
      for (const group of next.faceGroups || []) for (let k = group.start; k < group.start + group.count; k++) vertexPart[next.triangles[k]] = group.part || 0;
    }
    build({ keepView });
  }

  // (Re)builds the drawn mesh from the model, the hidden parts and the layout.
  function build({ keepView = true } = {}) {
    clear(root);
    if (!mesh) { faceOf = null; render(); return; }
    const { part, edge } = materials();
    let vertices = mesh.vertices;
    if (view.layout && vertexPart) {
      vertices = new Float32Array(mesh.vertices);
      for (let v = 0; v < vertexPart.length; v++) { const [dx, dy, dz] = view.offset(vertexPart[v]); vertices[v * 3] += dx; vertices[v * 3 + 1] += dy; vertices[v * 3 + 2] += dz; }
    }
    positionAttribute = new THREE.BufferAttribute(vertices, 3);
    const indices = [], faces = [], owners = [];
    for (const group of mesh.faceGroups || []) {
      const owner = group.part || 0;
      if (view.hidden.has(owner)) continue;
      for (let k = group.start; k < group.start + group.count; k++) indices.push(mesh.triangles[k]);
      for (let t = 0; t < group.count / 3; t++) { faces.push(group.faceId); owners.push(owner); }
    }
    faceOf = Int32Array.from(faces); trianglePart = Int16Array.from(owners);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    if (vertexPart) {
      const colors = new Float32Array(mesh.vertices.length);
      const shade = palette === PALETTES.dark ? 0.62 : 1;
      const tones = parts.map((item, index) => new THREE.Color(partColor(item, index)).multiplyScalar(shade));
      for (let v = 0; v < vertexPart.length; v++) { const tone = tones[vertexPart[v]]; colors[v * 3] = tone.r; colors[v * 3 + 1] = tone.g; colors[v * 3 + 2] = tone.b; }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    geometry.setIndex(indices);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    partMesh = new THREE.Mesh(geometry, part);
    const segments = edgeSegments(mesh, view);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.BufferAttribute(segments.positions, 3));
    edgeLines = new THREE.LineSegments(edgeGeometry, edge); edgeIds = segments.ids; edgeParts = segments.parts;
    root.add(partMesh, edgeLines);
    if (indices.length) {
      buildGrid(geometry.boundingBox);
      if (!keepView) frame(geometry.boundingSphere);
    }
    render();
  }

  // Shows or hides parts (by index) and switches between assembled and print layout.
  function setParts({ hidden, layout } = {}) {
    if (hidden) view.hidden = new Set([...hidden].filter(index => index >= 0 && index < parts.length));
    const relayout = layout !== undefined && Boolean(layout) !== view.layout;
    if (layout !== undefined) view.layout = Boolean(layout) && parts.length > 1;
    build({ keepView: !relayout });
  }

  function setGhost(previous) {
    if (ghost) { scene.remove(ghost); ghost.geometry.dispose(); ghost.material.dispose(); ghost = null; }
    if (previous) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(previous.vertices, 3));
      geometry.setIndex(new THREE.BufferAttribute(previous.triangles, 1));
      ghost = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: palette.ghost, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
      ghost.renderOrder = 2;
      scene.add(ghost);
    }
    render();
  }

  function buildGrid(box) {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 10);
    const step = size > 300 ? 50 : size > 80 ? 10 : size > 20 ? 5 : 1;
    const extent = Math.ceil((size * 1.6) / step) * step;
    grid = new THREE.GridHelper(extent, Math.round(extent / step), palette.gridMajor, palette.grid);
    grid.rotation.x = Math.PI / 2;
    grid.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z - 0.001);
    scene.add(grid);
  }

  function frame(sphere) {
    target.copy(sphere.center);
    radius = Math.max(sphere.radius, 1);
    setView('iso', false);
  }

  function place() {
    const distance = radius / Math.sin((camera.fov * Math.PI / 180) / 2) * 1.15 * spherical.radius;
    const offset = new THREE.Vector3().setFromSpherical(new THREE.Spherical(distance, spherical.phi, spherical.theta));
    // Spherical is Y-up; turn it to Z-up.
    camera.position.set(target.x + offset.x, target.y - offset.z, target.z + offset.y);
    camera.near = Math.max(0.01, distance / 1000); camera.far = distance * 100;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }

  function setView(name, draw = true) {
    const [x, y, z] = VIEWS[name] || VIEWS.iso;
    // To the Y-up frame of Spherical; 0 - y, because -0 would turn the top view upside down.
    const vector = new THREE.Vector3(x, z, 0 - y).normalize();
    const s = new THREE.Spherical().setFromVector3(vector);
    spherical.phi = Math.min(Math.PI - 1e-3, Math.max(1e-3, s.phi)); spherical.theta = s.theta; spherical.radius = 1;
    place();
    if (draw) render();
  }

  function resize(width, height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    render();
  }

  function setTheme(name) {
    palette = PALETTES[name] || PALETTES.light;
    // Part colors are shaded for the theme: rebuild them.
    if (vertexPart) { build(); ghost?.material.color.set(palette.ghost); return; }
    partMesh?.material.color.set(palette.part);
    edgeLines?.material.color.set(palette.edge);
    ghost?.material.color.set(palette.ghost);
    if (partMesh) buildGrid(partMesh.geometry.boundingBox);
    render();
  }

  // Highlights: faces and edges in the accent color, problems and pins as dots.
  function setMarks({ faces = [], edges = [], dots = [] } = {}) {
    clear(overlay);
    if (!mesh) { render(); return; }
    if (faces.length) {
      const highlight = new THREE.Mesh(subsetGeometry(mesh, faces, positionAttribute, view.hidden), new THREE.MeshBasicMaterial({ color: palette.highlight, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      overlay.add(highlight);
    }
    if (edges.length) {
      const wanted = new Set(edges);
      const all = edgeSegments(mesh, view), positions = [];
      all.ids.forEach((id, index) => { if (wanted.has(id)) positions.push(...all.positions.slice(index * 6, index * 6 + 6)); });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      overlay.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: palette.highlight, linewidth: 2 })));
    }
    for (const dot of dots) {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.025, 16, 12), new THREE.MeshBasicMaterial({ color: palette[dot.color] ?? palette.pin, depthTest: false }));
      sphere.position.set(...moved(dot.at, dot.part)); sphere.renderOrder = 5;
      overlay.add(sphere);
    }
    render();
  }

  function render() { renderer.setClearColor(palette.background, 1); renderer.render(scene, camera); onRender?.(); }

  // A point of the assembled model where it is drawn now: moved with its part in the print layout.
  function moved(at, part) {
    const index = typeof part === 'string' ? parts.findIndex(item => item.name === part) : Number.isInteger(part) ? part : -1;
    const [dx, dy, dz] = index >= 0 ? view.offset(index) : ZERO;
    return [at[0] + dx, at[1] + dy, at[2] + dz];
  }

  // Where a 3D point (of the assembled model; part names its part) lands on the canvas, in CSS pixels; null behind
  // the camera or on a hidden part.
  function project(at, part) {
    const index = typeof part === 'string' ? parts.findIndex(item => item.name === part) : -1;
    if (index >= 0 && view.hidden.has(index)) return null;
    camera.updateMatrixWorld();
    const vector = new THREE.Vector3(...moved(at, part)).project(camera);
    if (vector.z > 1) return null;
    const rect = { width: canvas.clientWidth || canvas.width, height: canvas.clientHeight || canvas.height };
    return { x: (vector.x + 1) / 2 * rect.width, y: (1 - vector.y) / 2 * rect.height };
  }

  // A clicked point back in the assembled model's coordinates, so pins and the engine agree whatever the layout.
  function assembled(at, part) { const [dx, dy, dz] = view.offset(part); return [at[0] - dx, at[1] - dy, at[2] - dz]; }
  const partOf = index => (parts.length > 1 ? { part: parts[index]?.name } : {});

  const raycaster = new THREE.Raycaster();
  function pick(x, y, { edges = true } = {}) {
    if (!mesh) return null;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1), camera);
    const faceHit = raycaster.intersectObject(partMesh, false)[0] || null;
    if (edges) {
      raycaster.params.Line.threshold = radius * 0.012;
      const edgeHit = raycaster.intersectObject(edgeLines, false)[0];
      if (edgeHit && (!faceHit || edgeHit.distance <= faceHit.distance + radius * 0.02)) {
        const part = edgeParts[Math.floor(edgeHit.index / 2)] || 0;
        return { kind: 'edge', edgeId: edgeIds[Math.floor(edgeHit.index / 2)], point: assembled(edgeHit.point.toArray(), part), ...partOf(part) };
      }
    }
    if (faceHit) {
      const part = trianglePart[faceHit.faceIndex] || 0;
      return { kind: 'face', faceId: faceOf[faceHit.faceIndex], point: assembled(faceHit.point.toArray(), part), normal: faceHit.face?.normal?.toArray(), ...partOf(part) };
    }
    return null;
  }

  // Orbit (left drag), pan (right or middle drag, or Shift), zoom (wheel).
  if (interactive) {
    let drag = null;
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      drag = { x: event.clientX, y: event.clientY, button: event.shiftKey ? 2 : event.button, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      drag.x = event.clientX; drag.y = event.clientY;
      if (drag.button === 0) {
        spherical.theta -= dx * 0.008;
        spherical.phi = Math.min(Math.PI - 0.01, Math.max(0.01, spherical.phi - dy * 0.008));
      } else {
        const distance = camera.position.distanceTo(target);
        const scale = distance * Math.tan(camera.fov * Math.PI / 360) * 2 / (canvas.clientHeight || 1);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
      }
      place(); render();
    });
    canvas.addEventListener('pointerup', event => {
      const moved = drag?.moved;
      drag = null;
      canvas.releasePointerCapture?.(event.pointerId);
      if (!moved) canvas.dispatchEvent(new CustomEvent('cadclick', { detail: { x: event.offsetX, y: event.offsetY, shift: event.shiftKey || event.ctrlKey, button: event.button } }));
    });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      spherical.radius = Math.min(20, Math.max(0.05, spherical.radius * Math.exp(event.deltaY * 0.0012)));
      place(); render();
    }, { passive: false });
  }

  // A picture of the part for the model: one view, or the four standard views in a 2×2 grid, with labels and pins.
  function snapshot({ views = ['iso'], width = 512, height = 384, labels = [] } = {}) {
    const output = document.createElement('canvas');
    const columns = views.length > 1 ? 2 : 1, rows = Math.ceil(views.length / columns);
    output.width = width * columns; output.height = height * rows;
    const context = output.getContext('2d');
    const saved = { phi: spherical.phi, theta: spherical.theta, radius: spherical.radius, target: target.clone() };
    resize(width, height);
    views.forEach((view, index) => {
      if (mesh) { target.copy(partMesh.geometry.boundingSphere.center); radius = Math.max(partMesh.geometry.boundingSphere.radius, 1); }
      setView(view);
      const x = (index % columns) * width, y = Math.floor(index / columns) * height;
      context.drawImage(renderer.domElement, x, y, width, height);
      context.font = '600 15px Segoe UI, sans-serif';
      context.fillStyle = palette.text;
      context.fillText(view.toUpperCase(), x + 10, y + 22);
      for (const label of labels) {
        const at = new THREE.Vector3(...moved(label.at, label.part)).project(camera);
        if (at.z > 1) continue;
        const px = x + (at.x + 1) / 2 * width, py = y + (1 - at.y) / 2 * height;
        context.beginPath(); context.arc(px, py, 11, 0, Math.PI * 2);
        context.fillStyle = label.color || '#2f6f8f'; context.fill();
        context.fillStyle = '#ffffff'; context.font = '700 12px Segoe UI, sans-serif'; context.textAlign = 'center';
        context.fillText(String(label.text), px, py + 4); context.textAlign = 'start';
      }
      if (index % columns) { context.fillStyle = palette.text; context.globalAlpha = 0.15; context.fillRect(x, y, 1, height); context.globalAlpha = 1; }
    });
    // Several parts: a legend of their colors and names, bottom left.
    if (parts.length > 1) {
      context.font = '600 13px Segoe UI, sans-serif';
      const shown = parts.map((part, index) => ({ part, index })).filter(({ index }) => !view.hidden.has(index));
      shown.forEach(({ part, index }, row) => {
        const y = output.height - 14 - (shown.length - 1 - row) * 20;
        context.fillStyle = partColor(part, index); context.fillRect(10, y - 11, 13, 13);
        context.strokeStyle = palette.text; context.globalAlpha = 0.35; context.strokeRect(10.5, y - 10.5, 12, 12); context.globalAlpha = 1;
        context.fillStyle = palette.text; context.fillText(part.name, 30, y);
      });
    }
    spherical.phi = saved.phi; spherical.theta = saved.theta; spherical.radius = saved.radius; target.copy(saved.target);
    place();
    return output.toDataURL('image/png');
  }

  function dispose() { clear(root); clear(overlay); renderer.dispose(); }

  setTheme(theme);
  return { setMesh, setGhost, setMarks, setParts, setView, setTheme, resize, render, pick, project, snapshot, dispose,
    get hasMesh() { return Boolean(mesh); },
    get parts() { return parts.map((part, index) => ({ name: part.name, color: partColor(part, index), hidden: view.hidden.has(index) })); },
    get layout() { return view.layout; } };
}
