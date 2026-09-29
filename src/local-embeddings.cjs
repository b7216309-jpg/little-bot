'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const manifest = require('../resources/embeddings/manifest.json');
const BUNDLED_EMBEDDING = Object.freeze({ provider: 'bundled', model: manifest.id });

// Native inference and tokenization stay off Electron's main/UI thread.
class LocalEmbeddings {
  constructor() { this.worker = null; this.pending = new Map(); this.sequence = 0; }
  embed(texts, timeout = 30000, { query = false } = {}) {
    if (!this.worker) {
      const worker = this.worker = new Worker(path.join(__dirname, 'local-embeddings-worker.cjs'));
      worker.on('message', ({ id, vectors, error }) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(id);
        if (!this.pending.size) worker.unref();
        if (error) pending.reject(new Error(error)); else pending.resolve(vectors);
      });
      worker.on('error', error => { if (this.worker === worker) this.reset(error); });
      worker.on('exit', code => { if (this.worker === worker) this.reset(new Error(`Embedding worker exited (${code}).`)); });
    }
    const id = ++this.sequence;
    this.worker.ref();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.reset(new Error('Local embedding inference timed out.')), timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, texts, query });
    });
  }
  reset(error = new Error('Local embeddings closed.')) {
    const worker = this.worker; this.worker = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (worker) void worker.terminate();
  }
  close() { this.reset(); }
}
module.exports = { LocalEmbeddings, BUNDLED_EMBEDDING };
