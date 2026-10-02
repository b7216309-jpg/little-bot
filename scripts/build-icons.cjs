'use strict';

// Rasterize the hand-drawn SVG with Chromium; no image service or extra dependency.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function encodeIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(image => image.png)]);
}

async function buildIcons() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  try {
    const mark = fs.readFileSync(path.join(root, 'src', 'renderer', 'assets', 'wink.svg'), 'utf8');
    const drawing = mark.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)?.[1];
    if (!drawing) throw new Error('Wink SVG is missing its drawing.');
    const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512" color="#fcfbf8">
  <rect width="100" height="100" rx="26" fill="#58705c"/>
  <g transform="translate(10 10) scale(.8)">${drawing}</g>
</svg>\n`;
    await window.loadURL('about:blank');
    const frames = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(tile)});
      await image.decode();
      return ${JSON.stringify([...sizes, 512])}.map(size => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return {size, data: canvas.toDataURL('image/png').split(',')[1]};
      });
    })()`);
    const images = frames.map(({ size, data }) => ({ size, png: Buffer.from(data, 'base64') }));
    const output = path.join(root, 'resources', 'icons');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'little-bot.svg'), tile);
    fs.writeFileSync(path.join(output, 'little-bot.png'), images.find(image => image.size === 512).png);
    fs.writeFileSync(path.join(output, 'little-bot.ico'), encodeIco(images.filter(image => image.size <= 256)));
    console.log('Built Wink SVG, 512 px PNG, and Windows ICO (16–256 px).');
  } finally {
    window.destroy();
    app.quit();
  }
}

buildIcons().catch(error => { console.error(error); app.exit(1); });
