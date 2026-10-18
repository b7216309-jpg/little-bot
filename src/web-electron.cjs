'use strict';

// Electron transport for the built-in web tools. Requests go through Chromium's network stack (its TLS, HTTP/2,
// decompression and cookie jar), in a partition of their own: never the user's signed-in browser profile.
const PARTITION = 'persist:little-bot-web';

function webSession(electron, partition = PARTITION) {
  const session = electron.session.fromPartition(partition);
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.on('will-download', event => event.preventDefault());
  session.setUserAgent(session.getUserAgent().replace(/ (?:Electron|[\w-]*little[\w-]*bot[\w-]*)\/\S+/gi, ''), 'en-US,en,fr');
  return session;
}

// fetch-like GET/POST that validates every redirect hop before following it and stops reading at maxBytes.
function requester(electron, session) {
  return ({ url, method = 'GET', headers = {}, body, signal, timeout = 15000, maxBytes = 4 * 1024 * 1024, validate = () => {} }) => new Promise((resolve, reject) => {
    let settled = false, finalUrl = url, hops = 0, timer;
    const request = electron.net.request({ method, url, session, redirect: 'manual', useSessionCookies: true });
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { try { request.abort(); } catch { /* Already closed. */ } reject(error); } else resolve(value);
    };
    const abort = () => finish(Object.assign(new Error('The web request was cancelled.'), { code: 'aborted' }));
    timer = setTimeout(() => finish(Object.assign(new Error('The web request timed out.'), { code: 'timeout' })), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    request.on('redirect', (_status, _method, location) => {
      try {
        if (++hops > 6) throw Object.assign(new Error('Too many redirects.'), { code: 'redirects' });
        validate(location);
        finalUrl = location;
        request.followRedirect();
      } catch (error) { finish(error); }
    });
    request.on('response', response => {
      const chunks = []; let size = 0;
      const header = name => { const value = response.headers[name.toLowerCase()]; return Array.isArray(value) ? value.join(', ') : value ?? null; };
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) return finish(Object.assign(new Error(`The response exceeded ${Math.round(maxBytes / 1048576)} MiB.`), { code: 'size' }));
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, { status: response.statusCode, url: finalUrl, headers: { get: header }, body: Buffer.concat(chunks) }));
      response.on('error', error => finish(error));
    });
    request.on('error', error => finish(Object.assign(new Error(String(error?.message || error).replace(/^net::/, '')), { code: 'network' })));
    for (const [name, value] of Object.entries(headers)) request.setHeader(name, value);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

// Loads a page in a hidden, sandboxed window so client-rendered sites produce their text, then returns its DOM.
function renderer(electron, session) {
  return async (url, { signal, timeout = 25000, validate = () => {} } = {}) => {
    if (signal?.aborted) throw new Error('The web request was cancelled.');
    const window = new electron.BrowserWindow({ show: false, skipTaskbar: true, width: 1280, height: 900, webPreferences: {
      session, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, images: false, webgl: false, spellcheck: false, autoplayPolicy: 'user-gesture-required',
    } });
    const contents = window.webContents;
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event, target) => { try { validate(target); } catch { event.preventDefault(); } };
    contents.on('will-redirect', guard);
    contents.on('will-navigate', guard);
    let timer, abort;
    try {
      const stop = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('The page took too long to render.'), { code: 'timeout' })), timeout);
        abort = () => reject(new Error('The web request was cancelled.'));
        signal?.addEventListener('abort', abort, { once: true });
      });
      const settle = async () => {
        // Text is read from the first DOM on, not after every ad, font and tracker has loaded.
        let loaded = false;
        contents.on('did-finish-load', () => { loaded = true; });
        const ready = new Promise((resolve, reject) => {
          contents.once('dom-ready', resolve);
          contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => { if (mainFrame && code !== -3) reject(new Error(description || 'The page failed to load.')); });
        });
        contents.loadURL(url).catch(() => { /* Reported by did-fail-load. */ });
        await ready;
        // Client-rendered pages keep filling in: wait until the text stops growing. Text that moves by under 1%
        // (tickers, carousels) counts as settled, and text that has not moved for 1.5 s (a short page, a bot
        // check that will not pass) is read as it is. A check page that navigates on by itself keeps the loop going.
        let previous = -1, stable = 0;
        for (let step = 0; step < 28; step++) {
          await new Promise(resolve => setTimeout(resolve, 250));
          const length = await contents.executeJavaScript('document.body ? document.body.innerText.length : 0', true).catch(() => 0);
          stable = previous >= 0 && Math.abs(length - previous) <= Math.max(2, previous * 0.01) ? stable + 1 : 0;
          previous = length;
          if ((length > 500 && stable >= 2) || (loaded && length > 200 && stable >= 1) || stable >= 6) break;
        }
        return { html: await contents.executeJavaScript('document.documentElement.outerHTML', true), url: contents.getURL() };
      };
      return await Promise.race([settle(), stop]);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (!window.isDestroyed()) window.destroy();
    }
  };
}

// `partition` exists for benchmarks that must not share a cache; the app uses the default.
function electronWeb(electron, { partition } = {}) {
  const session = webSession(electron, partition);
  // Chromium's own resolver: cached, and the connection that follows reuses its answer.
  const resolve = async host => (await session.resolveHost(host)).endpoints.map(endpoint => ({ address: endpoint.address }));
  return { request: requester(electron, session), render: renderer(electron, session), resolve };
}

module.exports = { electronWeb, PARTITION };
