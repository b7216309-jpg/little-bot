'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const partsDir = path.join(__dirname, 'vector-memory-payload');
const encoded = fs.readdirSync(partsDir).sort().map(name => fs.readFileSync(path.join(partsDir, name), 'utf8')).join('');
const target = path.join(__dirname, 'vector-memory-bootstrap.cjs');
fs.writeFileSync(target, Buffer.from(encoded, 'base64'));
require(target);
