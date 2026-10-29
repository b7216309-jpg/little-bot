// The hidden CAD kernel page. It owns the engine worker (restarted when a script runs too long) and draws
// pictures of the current part for the model. The main process calls window.cadKernel through executeJavaScript.

import { createViewer } from './viewer.js';

let worker = null, nextId = 1, starting = null, memory = 0;
// The engine does not free what a script drops; past this a fresh worker takes the next build.
const MEMORY_LIMIT = 1.2e9;
const pending = new Map();

function startWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const entry = pending.get(data?.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.error) entry.reject(Object.assign(new Error(data.error.message), { line: data.error.line }));
    else entry.resolve(data.result);
  };
  worker.onerror = event => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(event.message || 'The CAD engine failed.')); }
    pending.clear();
  };
  starting = send('init', {}, 120000);
  return starting;
}

function send(op, args, timeoutMs) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // A script stuck in a loop cannot be interrupted: replace the worker.
      worker.terminate();
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('The CAD engine was restarted.')); }
      pending.clear();
      startWorker().catch(() => {});
      reject(Object.assign(new Error(`Stopped after ${Math.round(timeoutMs / 1000)} s: the script took too long (an endless loop, or far too many operations).`), { timeout: true }));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, op, args });
  });
}

let viewer = null, viewerError = null, lastMesh = null;
try { viewer = createViewer(document.getElementById('snapshot'), { preserve: true }); }
catch (error) { viewerError = error.message; }

window.cadKernel = {
  async ready() { await (starting || startWorker()); return { ok: true, pictures: Boolean(viewer), viewerError }; },
  async call(op, args = {}, timeoutMs = 30000) {
    await (starting || startWorker());
    if (op === 'run' && memory > MEMORY_LIMIT) { memory = 0; worker.terminate(); await startWorker(); }
    try {
      const result = await send(op, args, timeoutMs);
      if (op === 'run' && Number.isFinite(result?.memory)) { memory = result.memory; delete result.memory; }
      if (op === 'run' && result?.mesh) { lastMesh = result.mesh; viewer?.setMesh(lastMesh); }
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: { message: error.message, line: error.line ?? null, timeout: Boolean(error.timeout) } };
    }
  },
  // A pose ({ part name: joint value }) or an exploded view applies to this picture only.
  snapshot({ views = ['iso', 'front', 'top', 'right'], faces = [], edges = [], dots = [], labels = [], theme = 'light', width = 512, height = 384, pose = null, explode = 0 } = {}) {
    if (!viewer) return { ok: false, error: { message: `Pictures are unavailable: ${viewerError || 'no WebGL'}.` } };
    if (!lastMesh) return { ok: false, error: { message: 'There is no part to look at yet.' } };
    viewer.setTheme(theme);
    viewer.setPose(pose || {}, { replace: true });
    viewer.setExplode(explode);
    viewer.setMarks({ faces, edges, dots });
    const image = viewer.snapshot({ views, width, height, labels });
    viewer.setMarks({});
    return { ok: true, image };
  },
};
