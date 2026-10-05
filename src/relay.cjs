'use strict';
// Phone relay: a small local web server that mirrors the one Little Bot conversation to paired phones.
// The PC stays the single source of truth; phones read a trimmed view and send the same actions as the desktop window.
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const qrcode = require('qrcode-generator');
const view = require('./relay-view.cjs');
const webPush = require('./web-push.cjs');
const phoneContext = require('./phone-context.cjs');

const DEFAULT_PORT = 8787;
const MAX_DEVICES = 5;
const PAIR_MS = 10 * 60 * 1000;
const PAIR_ATTEMPTS = 5;
const MAX_BODY = 64 * 1024;
const MAX_UPLOAD_BODY = 28 * 1024 * 1024; // a 20 MB attachment, base64-encoded
const PHONE_ACTIONS = ['alarm', 'timer', 'ring', 'navigate'];
const PING_MS = 25000;
const PUSH_SUBJECT = 'https://github.com/b7216309-jpg/little-bot';
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
};
// The Wink app icon, built by scripts/build-icons.cjs.
const ICONS = { '/icon-192.png': 'little-bot-192.png', '/icon-512.png': 'little-bot.png', '/icon-maskable.png': 'little-bot-maskable.png' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const hash = token => crypto.createHash('sha256').update(String(token)).digest();
const cleanName = value => String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) || 'Phone';
const errorText = error => String(error?.message || error || 'Something went wrong.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').slice(0, 300);

function lanAddresses(interfaces = os.networkInterfaces()) {
  const result = [];
  for (const [name, entries] of Object.entries(interfaces)) for (const entry of entries || []) {
    if (entry.family !== 'IPv4' && entry.family !== 4) continue;
    if (entry.internal || entry.address.startsWith('169.254.')) continue;
    result.push({ name, address: entry.address, tailscale: /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(entry.address) || /tailscale/i.test(name) });
  }
  return result;
}

function tailscaleCli() {
  const candidates = [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')];
  return candidates.find(file => fs.existsSync(file)) || 'tailscale';
}
function runTailscale(args, timeout = 8000) {
  return new Promise(resolve => execFile(tailscaleCli(), args, { timeout, windowsHide: true }, (error, stdout, stderr) =>
    resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || error?.message || '') })));
}

class Relay {
  constructor({ file, protector, handlers, getState, isDesktopFocused = () => false, onError = () => {}, webRoot = path.join(__dirname, 'relay-web'), iconRoot = path.join(__dirname, '..', 'resources', 'icons'), apkFile = path.join(__dirname, '..', 'resources', 'android', 'little-bot.apk'), tailscale = runTailscale, push = webPush.send, host = '0.0.0.0' }) {
    Object.assign(this, { file, protector, handlers, getState, isDesktopFocused, onError, webRoot, iconRoot, apkFile, tailscale, push, host });
    this.phone = new Map(); // deviceId -> latest shared context, memory only
    this.server = null; this.clients = new Map(); this.pairing = null; this.error = ''; this.https = '';
    this.lastSnapshot = null; this.sent = new Map(); this.failures = new Map(); this.seenSaveAt = 0;
    this.config = this.load();
  }

  load() {
    let data = {};
    try { if (fs.existsSync(this.file)) data = JSON.parse(this.protector.decryptString(Buffer.from(fs.readFileSync(this.file, 'utf8'), 'base64'))); }
    catch (error) { this.onError('relay-load', error); }
    const devices = (Array.isArray(data.devices) ? data.devices : []).filter(item => item && typeof item.id === 'string' && typeof item.tokenHash === 'string').slice(0, MAX_DEVICES)
      .map(item => ({ id: item.id, name: cleanName(item.name), tokenHash: item.tokenHash, createdAt: Number(item.createdAt) || Date.now(),
        lastSeenAt: Number(item.lastSeenAt) || 0, ...(item.push?.endpoint ? { push: item.push } : {}) }));
    const port = Number.isInteger(data.port) && data.port >= 1024 && data.port <= 65535 ? data.port : DEFAULT_PORT;
    const home = Number.isFinite(data.home?.lat) && Number.isFinite(data.home?.lon) ? { lat: data.home.lat, lon: data.home.lon, radius: Number(data.home.radius) || phoneContext.HOME_RADIUS_M } : null;
    return { enabled: data.enabled === true, port, allowApprovals: data.allowApprovals === true, devices, home,
      vapid: data.vapid?.privateJwk ? data.vapid : webPush.createVapidKeys() };
  }
  save() {
    const encrypted = Buffer.from(this.protector.encryptString(JSON.stringify(this.config))).toString('base64');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, encrypted); fs.renameSync(temp, this.file);
  }

  publicState() {
    const addresses = lanAddresses();
    const urls = addresses.map(item => ({ url: `http://${item.address}:${this.config.port}`, label: item.tailscale ? 'Tailscale' : 'Wi-Fi' }));
    if (this.https) urls.unshift({ url: this.https, label: 'Tailscale HTTPS', secure: true });
    const pairing = this.pairing && this.pairing.expiresAt > Date.now() ? this.pairing : null;
    return {
      enabled: this.config.enabled, running: Boolean(this.server?.listening), port: this.config.port, error: this.error,
      allowApprovals: this.config.allowApprovals, urls, connected: [...this.clients.values()].filter(client => client.visible).length,
      devices: this.config.devices.map(({ id, name, createdAt, lastSeenAt, push }) => ({ id, name, createdAt, lastSeenAt, push: Boolean(push),
        online: [...this.clients.values()].some(client => client.deviceId === id) })),
      pairing: pairing ? { code: pairing.code, expiresAt: pairing.expiresAt, url: pairing.url, qr: pairing.qr } : null,
      home: Boolean(this.config.home), phone: this.phoneState(), apk: fs.existsSync(this.apkFile),
    };
  }

  async start() {
    if (this.server || !this.config.enabled) return;
    this.error = '';
    const server = http.createServer((request, response) => this.route(request, response).catch(error => {
      this.onError('relay-request', error);
      if (!response.headersSent) this.json(response, 500, { error: 'The relay hit an error.' });
      else response.end();
    }));
    server.headersTimeout = 15000; server.requestTimeout = 0;
    await new Promise(resolve => {
      server.once('error', error => { this.error = error.code === 'EADDRINUSE' ? `Port ${this.config.port} is already in use.` : errorText(error); resolve(); });
      server.listen(this.config.port, this.host, () => { this.server = server; resolve(); });
    });
    if (this.server) {
      this.pingTimer = setInterval(() => { for (const client of this.clients.values()) client.response.write(': ping\n\n'); }, PING_MS);
      this.lastSnapshot = this.snapshot();
      this.sent.clear(); this.remember(this.lastSnapshot.messages);
      this.refreshTailscale().catch(() => {});
    }
  }
  async stop() {
    clearInterval(this.pingTimer); this.pingTimer = null;
    for (const client of this.clients.values()) client.response.end();
    this.clients.clear();
    const server = this.server; this.server = null;
    if (server) await new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections?.(); });
  }
  async setEnabled(enabled) {
    this.config.enabled = enabled === true; this.save();
    if (this.config.enabled) await this.start(); else { this.pairing = null; await this.stop(); }
    return this.publicState();
  }
  setAllowApprovals(allow) { this.config.allowApprovals = allow === true; this.save(); this.broadcastState(); return this.publicState(); }
  removeDevice(id) {
    this.config.devices = this.config.devices.filter(device => device.id !== id); this.phone.delete(id); this.save();
    for (const [key, client] of this.clients) if (client.deviceId === id) { client.response.end(); this.clients.delete(key); }
    return this.publicState();
  }
  startPairing() {
    if (!this.server) throw new Error('Turn on the phone relay first.');
    if (this.config.devices.length >= MAX_DEVICES) throw new Error(`Remove a phone first; up to ${MAX_DEVICES} can be paired.`);
    const code = crypto.randomBytes(9).toString('base64url');
    const base = this.publicState().urls[0]?.url;
    if (!base) throw new Error('This PC has no network address a phone can reach.');
    const url = `${base}/#pair=${code}`;
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    this.pairing = { code, url, expiresAt: Date.now() + PAIR_MS, attempts: 0,
      qr: `data:image/svg+xml;base64,${Buffer.from(qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true })).toString('base64')}` };
    return this.publicState();
  }
  async refreshTailscale() {
    const status = await this.tailscale(['status', '--json']);
    let dns = '';
    try { dns = String(JSON.parse(status.stdout).Self?.DNSName || '').replace(/\.$/, ''); } catch { dns = ''; }
    const serve = dns ? await this.tailscale(['serve', 'status', '--json']) : { stdout: '' };
    this.https = dns && serve.stdout.includes(`:${this.config.port}`) ? `https://${dns}` : '';
    return { installed: status.ok, dns, https: this.https };
  }
  async enableTailscaleHttps() {
    const result = await this.tailscale(['serve', '--bg', `http://127.0.0.1:${this.config.port}`], 20000);
    if (!result.ok) throw new Error(/not found|ENOENT/i.test(result.stderr) ? 'Tailscale is not installed on this PC.' : (result.stderr || result.stdout).trim().slice(0, 400));
    await this.refreshTailscale();
    return this.publicState();
  }

  snapshot() { return view.snapshot(this.getState(), { allowApprovals: this.config.allowApprovals }); }

  // The most recent context any paired phone shared, for the desktop and for prompts.
  latestPhone() {
    let best = null;
    for (const [deviceId, context] of this.phone) {
      const device = this.config.devices.find(item => item.id === deviceId);
      if (device && (!best || context.at > best.context.at)) best = { device, context };
    }
    return best;
  }
  phoneState() {
    const latest = this.latestPhone();
    if (!latest) return null;
    const where = phoneContext.place(latest.context, this.config.home);
    return { name: latest.device.name, at: latest.context.at, location: Boolean(latest.context.location), home: where ? where.home : null,
      distance: where ? where.meters : null, battery: latest.context.battery || null };
  }
  phoneSummary(now = Date.now()) {
    const latest = this.latestPhone();
    return latest ? phoneContext.summary(latest.context, this.config.home, { now, name: latest.device.name }) : '';
  }

  // Controller events, mirrored to every connected phone.
  onEvent(event) {
    if (!this.server) return;
    try {
      if (event?.type === 'state') this.broadcastState(event.state);
      else if (event?.type === 'chatUpdate') this.broadcastMessages(event);
    } catch (error) { this.onError('relay-event', error); }
  }
  broadcastState(state = null) {
    if (!this.server) return;
    const next = state ? view.snapshot(state, { allowApprovals: this.config.allowApprovals }) : this.snapshot();
    const notes = view.notifications(this.lastSnapshot, next);
    this.lastSnapshot = next;
    const upsert = [];
    const ids = next.messages.map(message => message.id), quickIds = next.quickMessages.map(message => message.id);
    for (const message of [...next.messages, ...next.quickMessages]) {
      const json = JSON.stringify(message);
      if (this.sent.get(message.id) !== json) { this.sent.set(message.id, json); upsert.push(message); }
    }
    const keep = new Set([...ids, ...quickIds]);
    for (const id of this.sent.keys()) if (!keep.has(id)) this.sent.delete(id);
    const { messages, quickMessages, ...rest } = next;
    this.broadcast({ type: 'state', ...rest, ids, quickIds, upsert });
    if (notes.length) this.notify(notes).catch(error => this.onError('relay-push', error));
  }
  // Little Bot's phone tool: alarms, timers, ringing and routes run on the phone through its background connection.
  phoneAction(input = {}) {
    if (!PHONE_ACTIONS.includes(input.action)) throw new Error('Choose alarm, timer, ring or navigate.');
    const action = { id: crypto.randomUUID(), kind: input.action, at: Date.now() };
    const label = typeof input.label === 'string' ? input.label.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) : '';
    if (label) action.label = label;
    if (input.action === 'alarm') {
      if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23 || !Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59) throw new Error('An alarm needs hour 0-23 and minute 0-59 (phone local time).');
      Object.assign(action, { hour: input.hour, minute: input.minute });
    } else if (input.action === 'timer') {
      if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440) throw new Error('A timer needs minutes from 1 to 1440.');
      action.minutes = input.minutes;
    } else if (input.action === 'navigate') {
      const destination = typeof input.destination === 'string' ? input.destination.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) : '';
      if (!destination) throw new Error('Say where to go.');
      action.destination = destination;
    }
    const data = `data: ${JSON.stringify({ type: 'action', action })}\n\n`;
    const devices = new Set();
    for (const client of this.clients.values()) {
      if (!client.background) continue;
      client.response.write(data);
      devices.add(this.config.devices.find(device => device.id === client.deviceId)?.name || 'phone');
    }
    if (!devices.size) throw new Error('No phone with the Little Bot app is connected right now.');
    return { sent: true, kind: action.kind, phones: [...devices] };
  }
  remember(messages) { for (const message of messages) this.sent.set(message.id, JSON.stringify(message)); }
  broadcastMessages(event) {
    const quick = event.chatId === this.lastSnapshot?.quick?.id;
    if (!quick && event.chatId !== this.lastSnapshot?.chat?.id) return;
    const upsert = (event.messages || []).map(view.slimMessage);
    this.remember(upsert);
    if (upsert.length) this.broadcast({ type: 'messages', upsert, ...(quick ? { quick: true } : {}) });
  }
  broadcast(payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients.values()) client.response.write(data);
  }
  async notify(notes) {
    if (this.isDesktopFocused() || [...this.clients.values()].some(client => client.visible)) return;
    // The Android app's background connection shows these as native notifications.
    const data = `data: ${JSON.stringify({ type: 'notify', notes: notes.slice(0, 3) })}

`;
    for (const client of this.clients.values()) if (client.background) client.response.write(data);
    const targets = this.config.devices.filter(device => device.push);
    if (!targets.length) return;
    let changed = false;
    for (const device of targets) for (const note of notes.slice(0, 3)) {
      try {
        const result = await this.push(device.push, { ...note, url: '/' }, { keys: this.config.vapid, subject: PUSH_SUBJECT });
        if (result.gone) { delete device.push; changed = true; break; }
      } catch (error) { this.onError('relay-push', error); break; }
    }
    if (changed) this.save();
  }

  // HTTP
  json(response, status, body) {
    response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  }
  async body(request, max = MAX_BODY) {
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > max) throw Object.assign(new Error('Too large.'), { status: 413 }); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch { throw Object.assign(new Error('Send JSON.'), { status: 400 }); }
  }
  limited(request) {
    const key = request.socket.remoteAddress || '';
    const entry = this.failures.get(key);
    if (entry && entry.until > Date.now() && entry.count >= 20) return true;
    return false;
  }
  failed(request) {
    const key = request.socket.remoteAddress || '';
    const entry = this.failures.get(key);
    if (!entry || entry.until < Date.now()) this.failures.set(key, { count: 1, until: Date.now() + 10 * 60 * 1000 });
    else entry.count++;
  }
  device(request) {
    const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(request.headers.authorization || '');
    if (!match) return null;
    const digest = hash(match[1]);
    const device = this.config.devices.find(item => { const stored = Buffer.from(item.tokenHash, 'base64'); return stored.length === digest.length && crypto.timingSafeEqual(stored, digest); });
    if (device && Date.now() - device.lastSeenAt > 60000) {
      device.lastSeenAt = Date.now();
      if (Date.now() - this.seenSaveAt > 5 * 60000) { this.seenSaveAt = Date.now(); try { this.save(); } catch (error) { this.onError('relay-save', error); } }
    }
    return device || null;
  }

  async route(request, response) {
    const url = new URL(request.url, 'http://relay.local');
    if (request.method === 'GET' && STATIC[url.pathname]) return this.serveFile(response, ...STATIC[url.pathname]);
    if (request.method === 'GET' && ICONS[url.pathname]) return this.serveFile(response, ICONS[url.pathname], 'image/png', this.iconRoot);
    if (request.method === 'GET' && url.pathname === '/little-bot.apk') {
      if (!fs.existsSync(this.apkFile)) return this.json(response, 404, { error: 'The Android app is not built yet.' });
      response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="little-bot.apk"', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(this.apkFile).pipe(response);
    }
    if (!url.pathname.startsWith('/api/')) return this.json(response, 404, { error: 'Not found.' });
    if (this.limited(request)) return this.json(response, 429, { error: 'Too many failed attempts. Wait ten minutes.' });
    try {
      if (url.pathname === '/api/pair' && request.method === 'POST') return this.json(response, 200, this.pair(await this.body(request), request));
      const device = this.device(request);
      if (!device) { this.failed(request); return this.json(response, 401, { error: 'This phone is not paired. Pair it again from Little Bot settings.' }); }
      if (url.pathname === '/api/events' && request.method === 'GET') return this.stream(request, response, device, url.searchParams.get('background') === '1');
      if (url.pathname === '/api/state' && request.method === 'GET') return this.json(response, 200, this.snapshot());
      if (url.pathname === '/api/push-key' && request.method === 'GET') return this.json(response, 200, { key: webPush.vapidPublicKey(this.config.vapid) });
      if (request.method !== 'POST') return this.json(response, 404, { error: 'Not found.' });
      const input = await this.body(request, url.pathname === '/api/attach' ? MAX_UPLOAD_BODY : MAX_BODY);
      const result = await this.action(url.pathname.slice(5), input, device);
      return this.json(response, 200, result || { ok: true });
    } catch (error) {
      return this.json(response, error.status || 400, { error: errorText(error) });
    }
  }
  serveFile(response, name, type, root = this.webRoot) {
    const file = path.join(root, name);
    let content;
    try { content = fs.readFileSync(file); } catch { return this.json(response, 404, { error: 'Not found.' }); }
    response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-cache',
      ...(name === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
    response.end(content);
  }
  pair(input, request) {
    const pairing = this.pairing;
    if (!pairing || pairing.expiresAt < Date.now()) { this.failed(request); throw Object.assign(new Error('This pairing code expired. Show a new one in Little Bot settings.'), { status: 403 }); }
    const given = Buffer.from(String(input.code || '')), expected = Buffer.from(pairing.code);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      this.failed(request);
      if (++pairing.attempts >= PAIR_ATTEMPTS) this.pairing = null;
      throw Object.assign(new Error('Wrong pairing code.'), { status: 403 });
    }
    if (this.config.devices.length >= MAX_DEVICES) throw new Error(`Up to ${MAX_DEVICES} phones can be paired.`);
    const token = crypto.randomBytes(32).toString('base64url');
    const device = { id: crypto.randomUUID(), name: cleanName(input.name), tokenHash: hash(token).toString('base64'), createdAt: Date.now(), lastSeenAt: Date.now() };
    this.config.devices.push(device); this.pairing = null; this.save();
    this.onPaired?.(device);
    return { token, deviceId: device.id, name: device.name };
  }
  stream(request, response, device, background = false) {
    response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const id = crypto.randomUUID();
    // A background listener (the Android app's service) never counts as someone looking at the chat.
    const client = { id, deviceId: device.id, response, visible: !background, background };
    this.clients.set(id, client);
    const snap = this.snapshot();
    this.remember([...snap.messages, ...snap.quickMessages]);
    response.write(`data: ${JSON.stringify({ type: 'hello', clientId: id, ...snap, ids: snap.messages.map(item => item.id), quickIds: snap.quickMessages.map(item => item.id), upsert: [...snap.messages, ...snap.quickMessages], messages: undefined, quickMessages: undefined })}\n\n`);
    request.on('close', () => { this.clients.delete(id); this.onClients?.(); });
    this.onClients?.();
  }
  async action(name, input, device) {
    const snap = this.snapshot();
    const chatId = snap.chat?.id;
    switch (name) {
      case 'presence': {
        const client = this.clients.get(String(input.clientId || ''));
        if (client && client.deviceId === device.id) client.visible = input.visible === true;
        this.onClients?.();
        return { ok: true };
      }
      case 'send': {
        const text = String(input.text || '').trim();
        const attachmentIds = Array.isArray(input.attachmentIds) ? input.attachmentIds.filter(id => typeof id === 'string').slice(0, 8) : [];
        if ((!text && !attachmentIds.length) || text.length > 32000) throw new Error('Write a message first.');
        // The Quick session: a side chat with no memory, goals or follow-ups (see Controller.send).
        if (input.quick === true) await this.handlers.send({ quick: true, ...(snap.quick ? { chatId: snap.quick.id } : {}), text, ...(attachmentIds.length ? { attachmentIds } : {}) });
        else await this.handlers.send({ ...(chatId ? { chatId } : {}), text, ...(attachmentIds.length ? { attachmentIds } : {}) });
        return { ok: true };
      }
      case 'attach': {
        // A photo or file from the phone, imported exactly like a desktop attachment (images are resized there).
        const name = String(input.name || '').replace(/[\\/\u0000-\u001f]/g, '').trim().slice(0, 180) || 'Phone file';
        if (typeof input.data !== 'string' || !input.data) throw new Error('Choose a file first.');
        const bytes = Buffer.from(input.data, 'base64');
        if (!bytes.length) throw new Error('This file is empty.');
        const attachment = await this.handlers.importAttachment({ name, bytes });
        return { attachment: { id: attachment.id, name: attachment.name, kind: attachment.kind, size: attachment.size, ...(attachment.thumbnail ? { thumbnail: attachment.thumbnail } : {}) } };
      }
      case 'stop': {
        const target = input.quick === true ? snap.quick?.id : chatId;
        if (target) await this.handlers.stop({ chatId: target });
        return { ok: true };
      }
      case 'endQuick': if (snap.quick) await this.handlers.deleteChat({ chatId: snap.quick.id }); return { ok: true };
      case 'proactive': await this.handlers.answerProactive({ messageId: String(input.messageId || ''), choice: String(input.choice || '') }); return { ok: true };
      case 'answer': {
        const approval = snap.approvals.find(item => item.requestId === input.requestId && item.ask);
        if (!approval) throw new Error('This question is no longer waiting for an answer.');
        if (input.skip === true) await this.handlers.respondApproval({ requestId: approval.requestId, decision: 'decline' });
        else {
          const text = String(input.text || '').trim();
          if (!text || text.length > 2000) throw new Error('Write an answer of up to 2,000 characters.');
          await this.handlers.respondApproval({ requestId: approval.requestId, decision: 'accept', answers: { answer: { answers: [text] } } });
        }
        return { ok: true };
      }
      case 'approval': {
        if (!this.config.allowApprovals) throw Object.assign(new Error('Approvals from the phone are turned off in Little Bot settings.'), { status: 403 });
        const approval = snap.approvals.find(item => item.requestId === input.requestId && !item.ask);
        if (!approval) throw new Error('This request is no longer waiting.');
        const pending = (this.getState().approvals || []).find(item => item.requestId === approval.requestId);
        if (pending?.questions?.length || approval.kind === 'mcp') throw new Error('This request needs a form. Answer it on the PC.');
        if (!['accept', 'decline'].includes(input.decision)) throw new Error('Choose Allow or Decline.');
        await this.handlers.respondApproval({ requestId: approval.requestId, decision: input.decision });
        return { ok: true };
      }
      case 'goal': {
        const goal = snap.goals.find(item => item.id === input.id);
        if (!goal) throw new Error('This goal no longer exists.');
        const handler = { run: 'runGoal', pause: 'pauseGoal', resume: 'resumeGoal' }[input.action];
        if (!handler) throw new Error('Choose Run, Pause or Resume.');
        await this.handlers[handler]({ id: goal.id });
        return { ok: true };
      }
      case 'push': {
        const subscription = input.subscription;
        if (subscription === null) { delete device.push; this.save(); return { ok: true }; }
        if (!webPush.allowedEndpoint(subscription?.endpoint) || typeof subscription?.keys?.p256dh !== 'string' || typeof subscription?.keys?.auth !== 'string') throw new Error('This push subscription is not supported.');
        device.push = { endpoint: subscription.endpoint.slice(0, 2000), keys: { p256dh: subscription.keys.p256dh.slice(0, 200), auth: subscription.keys.auth.slice(0, 100) } };
        this.save();
        return { ok: true };
      }
      case 'push-test': {
        if (!device.push) throw new Error('Notifications are not set up on this phone yet.');
        const result = await this.push(device.push, { title: 'Little Bot', body: 'Notifications work.', tag: 'test', url: '/' }, { keys: this.config.vapid, subject: PUSH_SUBJECT });
        if (result.status >= 400) throw new Error(`The push service answered ${result.status}.`);
        return { ok: true };
      }
      case 'context': {
        const context = phoneContext.normalizeContext(input);
        const before = phoneContext.place(this.phone.get(device.id), this.config.home);
        this.phone.set(device.id, context);
        const after = phoneContext.place(context, this.config.home);
        try { this.onContext?.({ device, context, before, after }); } catch (error) { this.onError('relay-context', error); }
        return { ok: true, home: after ? after.home : null, distance: after ? after.meters : null, homeSet: Boolean(this.config.home) };
      }
      case 'home': {
        if (input.clear === true) { this.config.home = null; this.save(); this.onClients?.(); return { ok: true, homeSet: false }; }
        const location = this.phone.get(device.id)?.location;
        if (!location) throw new Error('Share your location from the app first, then set home.');
        this.config.home = { lat: location.lat, lon: location.lon, radius: phoneContext.HOME_RADIUS_M };
        this.save(); this.onClients?.();
        return { ok: true, homeSet: true };
      }
      case 'unpair': this.removeDevice(device.id); this.onClients?.(); return { ok: true };
      default: throw Object.assign(new Error('Not found.'), { status: 404 });
    }
  }
}

module.exports = { Relay, lanAddresses, DEFAULT_PORT, MAX_DEVICES };
