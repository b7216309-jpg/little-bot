'use strict';

// Hosts the CAD engine in a hidden, sandboxed page of its own session. The session serves only the app's CAD
// files and libraries through the little-bot-cad protocol and cancels every other request, so a part's script
// can reach neither the disk nor the network. The page draws offscreen so it can take pictures while hidden.

const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'little-bot-cad';
const PARTITION = 'little-bot-cad';
// Published path prefix -> folder under the app root.
const SERVED = ['/src/cad/', '/node_modules/replicad/dist/', '/node_modules/replicad-opencascadejs/dist/', '/node_modules/three/build/', '/node_modules/acorn/dist/'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };

class CadKernel {
  constructor({ BrowserWindow, session, appRoot, onCrash }) {
    this.BrowserWindow = BrowserWindow;
    this.session = session;
    this.appRoot = appRoot;
    this.onCrash = onCrash || (() => {});
    this.window = null;
    this.starting = null;
  }

  static scheme() { return { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }; }

  _session() {
    if (this.cadSession) return this.cadSession;
    const cad = this.session.fromPartition(PARTITION);
    cad.protocol.handle(SCHEME, request => {
      try {
        const url = new URL(request.url);
        const relative = decodeURIComponent(url.pathname);
        if (url.host !== 'app' || !SERVED.some(prefix => relative.startsWith(prefix)) || relative.includes('..')) return new Response('Not found', { status: 404 });
        const file = path.join(this.appRoot, ...relative.split('/').filter(Boolean));
        const body = fs.readFileSync(file);
        return new Response(body, { headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    cad.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith(`${SCHEME}://app/`) && !/^(data|blob):/i.test(details.url) }));
    cad.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    cad.on('will-download', event => event.preventDefault());
    this.cadSession = cad;
    return cad;
  }

  start() {
    if (this.window && !this.window.isDestroyed()) return this.starting;
    this.window = new this.BrowserWindow({
      show: false, width: 512, height: 384,
      webPreferences: { partition: PARTITION, offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, webSecurity: true, backgroundThrottling: false, spellcheck: false },
    });
    this._session();
    const contents = this.window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('render-process-gone', () => { this.window?.destroy(); this.window = null; this.starting = null; this.onCrash(); });
    this.starting = contents.loadURL(`${SCHEME}://app/src/cad/kernel.html`)
      .then(() => contents.executeJavaScript('window.cadKernel.ready()'))
      .catch(error => { this.close(); throw error; });
    return this.starting;
  }

  async call(op, args = {}, timeoutMs = 30000) {
    await this.start();
    const answer = await this.window.webContents.executeJavaScript(`window.cadKernel.call(${JSON.stringify(op)}, ${JSON.stringify(args)}, ${Number(timeoutMs) || 30000})`);
    if (!answer?.ok) throw Object.assign(new Error(answer?.error?.message || 'The CAD engine failed.'), { line: answer?.error?.line ?? null, timeout: Boolean(answer?.error?.timeout) });
    return answer.result;
  }

  async snapshot(options = {}) {
    await this.start();
    const answer = await this.window.webContents.executeJavaScript(`window.cadKernel.snapshot(${JSON.stringify(options)})`);
    if (!answer?.ok) throw new Error(answer?.error?.message || 'The picture could not be taken.');
    return answer.image;
  }

  get running() { return Boolean(this.window && !this.window.isDestroyed()); }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.starting = null;
  }
}

module.exports = { CadKernel, CAD_SCHEME: SCHEME };
