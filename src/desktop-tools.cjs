'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Pixels for the model travel beside the JSON result under this key, so they never count toward its size limit.
const TOOL_IMAGES = Symbol.for('little-bot.tool-images');
const MAX_EDGE = 1600;
const CLIPBOARD_LIMIT = 20000;
const KEEP_CAPTURES = 20;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const functionSpec = (name, description, properties = {}, required = []) => ({
  type: 'function', name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
});
const SPECS = [
  functionSpec('screen_capture', 'Look at the user\'s screen. Captures one display (default: the main one) or one window (handle from windows_ui list_windows) and returns it as an image you can see, plus the saved file path. Use it when the user asks you to look, or when their request is about something on their screen. Send the file with attachment_send only if the user wants to see it.', {
    display: { type: 'integer', minimum: 1, maximum: 16, description: 'Display number, 1 = main display.' },
    window: { type: 'integer', minimum: 1, description: 'Window handle from windows_ui list_windows.' },
  }),
  functionSpec('clipboard', 'Read or write the user\'s clipboard. read returns its text, and any copied image as an image you can see. write replaces the clipboard with your text. Use it when the user mentions what they copied or asks for a result on the clipboard.', {
    action: { type: 'string', enum: ['read', 'write'] },
    text: { type: 'string', maxLength: CLIPBOARD_LIMIT, description: 'Text to put on the clipboard (write only).' },
  }, ['action']),
  functionSpec('document_render', 'Turn an HTML file into a PDF or a PNG image with Little Bot\'s built-in Chromium. Write the HTML file first (inline CSS and SVG; scripts and network are off; use @page CSS for paper size and margins), render it, then deliver the result with attachment_send.', {
    path: { type: 'string', maxLength: 2000, description: 'HTML file, absolute or relative to the working folder.' },
    format: { type: 'string', enum: ['pdf', 'png'] },
    output: { type: 'string', maxLength: 2000, description: 'Result path; defaults to the HTML path with the new extension.' },
    landscape: { type: 'boolean', description: 'PDF only, when the HTML sets no @page size.' },
    width: { type: 'integer', minimum: 200, maximum: 4000, description: 'PNG width in pixels (default 1200).' },
    height: { type: 'integer', minimum: 200, maximum: 4000, description: 'PNG height in pixels (default 800).' },
  }, ['path']),
];

class DesktopTools {
  constructor({ desktopCapturer, screen, clipboard, nativeImage, BrowserWindow, session, root }) {
    this.desktopCapturer = desktopCapturer;
    this.BrowserWindow = BrowserWindow;
    this.session = session;
    this.screen = screen;
    this.clipboard = clipboard;
    this.nativeImage = nativeImage;
    this.root = root;
  }
  specs() { return SPECS.map(spec => structuredClone(spec)); }
  owns(name) { return ['screen_capture', 'clipboard', 'document_render'].includes(name); }
  // Rendering looks at nothing and acts on nothing outside the working folder; the screen and clipboard do.
  observes(name) { return name !== 'document_render'; }
  async call(name, args, { chat } = {}) {
    if (!object(args)) throw new Error('Tool arguments must be an object.');
    if (name === 'document_render') return this.render(args, chat?.workspace || process.cwd());
    return name === 'screen_capture' ? this.capture(args) : this.clipboardTool(args);
  }
  async render({ path: input, format, output, landscape, width = 1200, height = 800 }, workspace) {
    const file = path.resolve(workspace, String(input || ''));
    if (!/\.html?$/i.test(file) || !fs.existsSync(file)) throw new Error('Give an existing .html file to render.');
    const kind = format || (/\.png$/i.test(output || '') ? 'png' : 'pdf');
    const target = path.resolve(workspace, output || file.replace(/\.html?$/i, `.${kind}`));
    if (path.extname(target).toLowerCase() !== `.${kind}`) throw new Error(`The output path must end in .${kind}.`);
    const partition = 'little-bot-render';
    if (!this.renderSession) {
      this.renderSession = this.session.fromPartition(partition);
      // Only the local file and the files beside it load; nothing reaches the network.
      this.renderSession.webRequest.onBeforeRequest((details, done) => done({ cancel: !/^(file|data|blob):/i.test(details.url) }));
    }
    // A hidden window never paints, so an image is rendered offscreen instead.
    const view = new this.BrowserWindow({ show: false, width, height, webPreferences: { partition, offscreen: kind === 'png', javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await view.loadFile(file);
      if (kind === 'png') await new Promise(resolve => setTimeout(resolve, 150));
      const data = kind === 'pdf'
        ? await view.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, landscape: landscape === true })
        : (await view.webContents.capturePage()).toPNG();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
      return { path: target, format: kind, bytes: data.length };
    } finally { view.destroy(); }
  }
  async capture({ display, window }) {
    if (display !== undefined && window !== undefined) throw new Error('Choose a display or a window, not both.');
    let image, label;
    if (window !== undefined) {
      const sources = await this.desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: MAX_EDGE, height: MAX_EDGE }, fetchWindowIcons: false });
      const source = sources.find(item => item.id.split(':')[1] === String(window));
      if (!source) throw new Error('That window is not available to capture. Use windows_ui list_windows for a current handle.');
      image = source.thumbnail; label = `window "${source.name}"`;
    } else {
      const displays = this.screen.getAllDisplays();
      const primary = this.screen.getPrimaryDisplay();
      const ordered = [primary, ...displays.filter(item => item.id !== primary.id)];
      const target = ordered[(display || 1) - 1];
      if (!target) throw new Error(`There ${ordered.length === 1 ? 'is 1 display' : `are ${ordered.length} displays`}; choose display 1${ordered.length > 1 ? `–${ordered.length}` : ''}.`);
      const size = { width: Math.round(target.size.width * target.scaleFactor), height: Math.round(target.size.height * target.scaleFactor) };
      const sources = await this.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const source = sources.find(item => String(item.display_id) === String(target.id)) || (sources.length === 1 ? sources[0] : null);
      if (!source) throw new Error('That display could not be captured.');
      image = source.thumbnail; label = `display ${display || 1} of ${ordered.length}`;
    }
    if (!image || image.isEmpty()) throw new Error('The capture came back empty; the window may be minimized.');
    return this.withImage({ captured: label }, image, 'screen');
  }
  // Electron 44's clipboard is the asynchronous, browser-style API.
  async clipboardTool({ action, text, ...rest }) {
    if (Object.keys(rest).length) throw new Error(`Unsupported argument: ${Object.keys(rest).join(', ')}.`);
    if (action === 'write') {
      if (typeof text !== 'string' || !text) throw new Error('Give the text to put on the clipboard.');
      await this.clipboard.writeText(text);
      return { written: true, characters: text.length };
    }
    if (action !== 'read') throw new Error('Choose read or write.');
    if (text !== undefined) throw new Error('read takes no text.');
    const value = await this.clipboard.readText().catch(() => '');
    const items = await this.clipboard.read().catch(() => []);
    const result = { text: value.slice(0, CLIPBOARD_LIMIT), ...(value.length > CLIPBOARD_LIMIT ? { truncated: true, characters: value.length } : {}) };
    const item = items.find(entry => entry.types.includes('image/png'));
    const image = item ? this.nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer())) : null;
    if (image && !image.isEmpty()) return this.withImage({ ...result, image: true }, image, 'clipboard');
    return value ? result : { ...result, empty: true, types: [...new Set(items.flatMap(entry => entry.types))] };
  }
  withImage(result, image, prefix) {
    const { width, height } = image.getSize();
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const sized = scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : image;
    const jpeg = sized.toJPEG(82);
    fs.mkdirSync(this.root, { recursive: true });
    const file = path.join(this.root, `${prefix}-${Date.now()}.jpg`);
    fs.writeFileSync(file, jpeg);
    this.prune();
    const value = { ...result, width, height, path: file };
    value[TOOL_IMAGES] = [`data:image/jpeg;base64,${jpeg.toString('base64')}`];
    return value;
  }
  prune() {
    try {
      const files = fs.readdirSync(this.root).filter(name => name.endsWith('.jpg')).sort();
      for (const name of files.slice(0, Math.max(0, files.length - KEEP_CAPTURES))) fs.rmSync(path.join(this.root, name), { force: true });
    } catch { /* Old captures are only housekeeping. */ }
  }
}

module.exports = { DesktopTools, TOOL_IMAGES };
