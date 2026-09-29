'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const manifest = require('../resources/embeddings/manifest.json');
async function prepareEmbeddings() {
  const root = path.join(__dirname, '../resources/embeddings', manifest.directory);
  await fs.mkdir(root, { recursive: true });
  for (const file of manifest.files) {
    const target = path.join(root, file.name);
    const valid = data => data.length === file.bytes && createHash('sha256').update(data).digest('hex') === file.sha256;
    try { if (valid(await fs.readFile(target))) continue; } catch {}
    const response = await fetch(file.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Embedding asset download failed: ${file.name} (${response.status})`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!valid(data)) throw new Error(`Embedding asset checksum mismatch: ${file.name}`);
    await fs.writeFile(target, data);
  }
  console.log('Bundled CPU embedding assets verified.');
}
if (require.main === module) prepareEmbeddings().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { prepareEmbeddings };
