'use strict';
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ort = require('onnxruntime-node');
const manifest = require('../resources/embeddings/manifest.json');
const root = path.join(__dirname, '../resources/embeddings', manifest.directory);
let loading;
async function load() {
  if (!loading) loading = (async () => {
    const { Tokenizer } = await import('@huggingface/tokenizers');
    const tokenizer = new Tokenizer(JSON.parse(fs.readFileSync(path.join(root, 'tokenizer.json'))), JSON.parse(fs.readFileSync(path.join(root, 'tokenizer_config.json'))));
    const session = await ort.InferenceSession.create(path.join(root, 'model.onnx'), {
      executionProviders: ['cpu'], intraOpNumThreads: Math.min(2, os.availableParallelism()),
      interOpNumThreads: 1, executionMode: 'sequential', graphOptimizationLevel: 'all',
    });
    return { tokenizer, session };
  })();
  return loading;
}
async function embed(texts, query) {
  const { tokenizer, session } = await load();
  const result = [];
  for (const text of texts) {
    // Preserve long records by encoding every token window, rather than silently
    // truncating them at the model's sentence limit. Retrieval instructions
    // belong on queries only, never on indexed passages.
    const tokens = tokenizer.encode((query ? manifest.queryPrefix : '') + text, { add_special_tokens: false }).ids;
    const sum = new Float64Array(manifest.dimensions);
    for (let start = 0; start < Math.max(1, tokens.length); start += manifest.maxTokens - 2) {
      const chunk = tokens.slice(start, start + manifest.maxTokens - 2);
      const ids = [101, ...chunk, 102];
      const tensor = values => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), [1, ids.length]);
      const feeds = { input_ids: tensor(ids), attention_mask: tensor(ids.map(() => 1)), token_type_ids: tensor(ids.map(() => 0)) };
      const outputs = await session.run(Object.fromEntries(session.inputNames.map(name => [name, feeds[name]])));
      const output = outputs.last_hidden_state || outputs[session.outputNames[0]];
      const vector = new Float64Array(manifest.dimensions);
      // BGE is trained with CLS pooling (not MiniLM's mean pooling).
      for (let d = 0; d < vector.length; d++) vector[d] = output.data[d];
      const norm = Math.hypot(...vector) || 1;
      for (let d = 0; d < vector.length; d++) sum[d] += vector[d] / norm * Math.max(1, chunk.length);
    }
    const norm = Math.hypot(...sum) || 1;
    result.push(Array.from(sum, value => value / norm));
  }
  return result;
}
let queue = Promise.resolve();
parentPort.on('message', ({ id, texts, query }) => {
  queue = queue.then(async () => {
    try { parentPort.postMessage({ id, vectors: await embed(texts, query) }); }
    catch (error) { parentPort.postMessage({ id, error: error.message }); }
  });
});
