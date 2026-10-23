'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const webPush = require('../src/web-push.cjs');
const view = require('../src/relay-view.cjs');
const { Relay } = require('../src/relay.cjs');
const { LocalModelRelay } = require('../src/local-model-relay.cjs');
const { responsesToChat, StrataStreamAdapter, stableJson } = require('../src/strata-responses-adapter.cjs');
const { LOCAL_STREAM_IDLE_TIMEOUT_MS, providerConfig } = require('../src/connections.cjs');

const protector = { encryptString: value => Buffer.from(`enc:${value}`), decryptString: value => value.toString().replace(/^enc:/, '') };
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-relay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function freePort() {
  return new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
}
function appState(overrides = {}) {
  return {
    appVersion: '9.9.9', runtime: { status: 'ready' }, account: { status: 'connected' },
    settings: { systemPrompt: 'SECRET PROMPT', connection: { apiKey: 'sk-secret' } }, profile: { soul: 'SECRET SOUL' },
    webServices: { keys: 'SECRET KEY' }, memory: { facts: ['SECRET FACT'] },
    chats: [{ id: 'chat-1', status: 'idle', messages: [
      { id: 'm1', role: 'user', text: 'hello' },
      { id: 'm2', role: 'assistant', text: 'hi there', workspace: 'C:\\private' },
    ] }],
    approvals: [], autonomy: { paused: false, goals: [{ id: 'g1', name: 'Evening enjoyment', status: 'queued', nextRunAt: 123, objective: 'SECRET OBJECTIVE', nextStep: '' }] },
    ...overrides,
  };
}

// Decrypts an aes128gcm Web Push body the way a browser does (RFC 8291), to prove the sender is correct.
function browserDecrypt(body, ua, authSecret) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const shared = ua.computeSecret(asPublic);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last record delimiter');
  return plain.subarray(0, plain.length - 1).toString();
}

test('local tool results keep their edges and cap the middle sent back to the model', () => {
  const output = `HEAD${'x'.repeat(30000)}TAIL`;
  const { body } = responsesToChat({ input: [{ type: 'function_call_output', call_id: 'c1', output }] }, false);
  const content = body.messages[0].content;
  assert.ok(content.length <= 12000);
  assert.ok(content.startsWith('HEAD'));
  assert.ok(content.endsWith('TAIL'));
  assert.match(content, /Tool output truncated: \d+ middle characters omitted/);
});

test('web push payloads decrypt in a browser and carry a valid VAPID signature', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const body = webPush.encrypt('{"title":"Little Bot"}', subscription);
  assert.equal(browserDecrypt(body, ua, auth), '{"title":"Little Bot"}');
  assert.equal(body.readUInt32BE(16), 4096);

  const keys = webPush.createVapidKeys();
  const header = webPush.vapidHeader(keys, subscription.endpoint, 'https://example.com', Date.UTC(2026, 9, 2));
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  const [h, c, s] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://example.com');
  const raw = Buffer.from(k, 'base64url');
  assert.equal(raw.length, 65);
  const publicKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));

  assert.ok(webPush.allowedEndpoint('https://fcm.googleapis.com/fcm/send/x'));
  assert.ok(webPush.allowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  for (const bad of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://evil.com/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.com/x', 'https://u:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x']) assert.equal(webPush.allowedEndpoint(bad), false, bad);
});

test('the phone view carries the conversation and goal status but no settings, profile, keys or memory', () => {
  const snap = view.snapshot(appState());
  const json = JSON.stringify(snap);
  for (const secret of ['SECRET', 'sk-secret', 'C:\\\\private']) assert.equal(json.includes(secret), false, secret);
  assert.deepEqual(snap.messages.map(item => [item.id, item.label]), [['m1', 'You'], ['m2', 'Little Bot']]);
  assert.deepEqual(snap.goals, [{ id: 'g1', name: 'Evening enjoyment', status: 'queued', nextRunAt: 123, nextStep: '' }]);
  assert.equal(snap.ready, true);
  const many = appState({ chats: [{ id: 'c', status: 'idle', messages: Array.from({ length: 250 }, (_, i) => ({ id: `x${i}`, role: 'user', text: String(i) })) }] });
  const limited = view.snapshot(many);
  assert.equal(limited.messages.length, view.MAX_MESSAGES);
  assert.equal(limited.messages.at(-1).id, 'x249');
  assert.equal(limited.chat.more, true);
});

test('notifications fire for proactive messages, questions, approvals and finished replies only', () => {
  const before = view.snapshot(appState());
  assert.deepEqual(view.notifications(null, before), []);
  assert.deepEqual(view.notifications(before, before), []);
  const proactive = appState();
  proactive.chats[0].messages.push({ id: 'p1', role: 'assistant', kind: 'heartbeat', heartbeatTopic: 'games', text: 'Want to play Hades tonight?', modelSeen: false });
  assert.deepEqual(view.notifications(before, view.snapshot(proactive)), [{ title: 'Little Bot · on its own · games', body: 'Want to play Hades tonight?', tag: 'message-p1', kind: 'heartbeat', url: '/', messageId: 'p1' }]);

  const asking = appState({ approvals: [{ requestId: 'r1', chatId: 'chat-1', kind: 'question', dynamicTool: 'ask_user', title: 'Little Bot has a question', questions: [{ question: 'Which day?', options: [{ label: 'Monday' }] }] }] });
  const asked = view.snapshot(asking);
  assert.equal(asked.approvals[0].ask, true);
  assert.deepEqual(asked.approvals[0].options, ['Monday']);
  assert.equal(view.notifications(before, asked)[0].title, 'Little Bot has a question');

  const running = appState(); running.chats[0].status = 'running';
  running.chats[0].messages.push({ id: 'u2', role: 'user', text: 'plan my evening' }, { id: 'a2', role: 'assistant', text: 'Working…', status: 'running' });
  const done = structuredClone(running); done.chats[0].status = 'idle'; done.chats[0].messages[3] = { id: 'a2', role: 'assistant', text: 'Here is your evening.' };
  assert.deepEqual(view.notifications(view.snapshot(running), view.snapshot(done)), [{ title: 'Little Bot replied', body: 'Here is your evening.', tag: 'reply', url: '/' }]);
  const stopped = structuredClone(running); stopped.chats[0].status = 'idle'; stopped.chats[0].messages.pop();
  assert.deepEqual(view.notifications(view.snapshot(running), view.snapshot(stopped)), [], 'no reply after the last message');
});

async function startRelay(t, { state = appState(), handlers = {}, pushes = [], options = {} } = {}) {
  const dir = tempDir(t);
  const calls = [];
  const current = { state };
  const relay = new Relay({ file: path.join(dir, 'relay.json'), protector, getState: () => current.state,
    handlers: new Proxy({}, { get: (_t, name) => async payload => { calls.push([name, payload]); return handlers[name]?.(payload); } }),
    tailscale: async () => ({ ok: false, stdout: '', stderr: 'not found' }),
    push: async (subscription, payload) => { pushes.push(payload); return { status: 201, gone: false }; }, ...options });
  relay.config.port = await freePort();
  await relay.setEnabled(true);
  t.after(() => relay.stop());
  const base = `http://127.0.0.1:${relay.config.port}`;
  return { relay, calls, base, current, dir };
}
async function pair(relay, base) {
  const { pairing } = relay.startPairing();
  assert.match(pairing.url, /#pair=/);
  assert.match(pairing.qr, /^data:image\/svg\+xml;base64,/);
  const response = await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code: pairing.code, name: 'Pixel' }) });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}
function events(base, token) {
  const controller = new AbortController();
  const queue = [], waiters = [];
  (async () => {
    const response = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const line = block.split('\n').find(item => item.startsWith('data: '));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        const waiter = waiters.shift(); if (waiter) waiter(event); else queue.push(event);
      }
    }
  })().catch(() => {});
  return { next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve)), close: () => controller.abort() };
}

test('pairing gives a phone its own token; wrong codes and missing tokens are refused', async t => {
  const { relay, base, dir } = await startRelay(t);
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  relay.startPairing();
  for (let i = 0; i < 5; i++) assert.equal((await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code: 'wrong-code-123' }) })).status, 403);
  assert.notEqual(relay.pairing, null, 'someone else guessing cannot cancel the owner’s code');
  for (let i = 0; i < 30; i++) assert.equal((await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${'x'.repeat(43)}` } })).status, 401);
  for (let i = 0; i < 15; i++) await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code: 'wrong-code-123' }) });
  assert.equal((await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code: 'wrong-code-123' }) })).status, 429, 'twenty wrong codes from one address wait ten minutes');
  relay.failures.clear();
  const token = await pair(relay, base);
  const state = await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(state.status, 200);
  assert.equal((await state.json()).messages.length, 2);
  assert.equal(relay.pairing, null, 'a pairing code works once');
  const saved = fs.readFileSync(path.join(dir, 'relay.json'), 'utf8');
  assert.equal(saved.includes(token), false, 'only a hash of the token is stored');
  assert.equal(relay.publicState().devices[0].name, 'Pixel');
  relay.removeDevice(relay.publicState().devices[0].id);
  assert.equal((await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});

test('the phone sees live updates and its actions go through the same handlers as the desktop', async t => {
  const pushes = [];
  const { relay, base, calls, current } = await startRelay(t, { pushes });
  const token = await pair(relay, base);
  const stream = events(base, token);
  t.after(() => stream.close());
  const hello = await stream.next();
  assert.equal(hello.type, 'hello');
  assert.deepEqual(hello.ids, ['m1', 'm2']);
  assert.equal(hello.upsert[1].text, 'hi there');

  const post = (name, body) => fetch(`${base}/api/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  assert.equal((await post('send', { text: '  from my phone ' })).status, 200);
  assert.deepEqual(calls.at(-1), ['send', { chatId: 'chat-1', text: 'from my phone' }]);

  // A full state change sends only changed messages plus the order.
  const next = structuredClone(current.state);
  next.chats[0].messages.push({ id: 'm3', role: 'user', text: 'from my phone' });
  current.state = next;
  relay.onEvent({ type: 'state', state: next });
  const update = await stream.next();
  assert.deepEqual(update.ids, ['m1', 'm2', 'm3']);
  assert.deepEqual(update.upsert.map(item => item.id), ['m3']);
  // Streaming patches pass straight through.
  relay.onEvent({ type: 'chatUpdate', chatId: 'chat-1', messages: [{ id: 'm4', role: 'assistant', text: 'Typing', status: 'running' }] });
  const patch = await stream.next();
  assert.equal(patch.type, 'messages');
  assert.equal(patch.upsert[0].text, 'Typing');

  await post('stop', {});
  await post('proactive', { messageId: 'p1', choice: 'later' });
  await post('goal', { id: 'g1', action: 'pause' });
  assert.deepEqual(calls.slice(-3), [['stop', { chatId: 'chat-1' }], ['answerProactive', { messageId: 'p1', choice: 'later' }], ['pauseGoal', { id: 'g1' }]]);
  assert.equal((await post('goal', { id: 'missing', action: 'pause' })).status, 400);
  assert.equal((await post('nope', {})).status, 404);
});

test('questions can be answered from the phone; other approvals need the opt-in', async t => {
  const state = appState({ approvals: [
    { requestId: 'q1', chatId: 'chat-1', kind: 'question', dynamicTool: 'ask_user', title: 'Little Bot has a question', questions: [{ question: 'Which day?', options: [] }] },
    { requestId: 'c1', chatId: 'chat-1', kind: 'command', title: 'Run a command', detail: 'git push' },
  ] });
  const { relay, base, calls } = await startRelay(t, { state });
  const token = await pair(relay, base);
  const post = (name, body) => fetch(`${base}/api/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  assert.equal((await post('answer', { requestId: 'q1', text: 'Friday' })).status, 200);
  assert.deepEqual(calls.at(-1), ['respondApproval', { requestId: 'q1', decision: 'accept', answers: { answer: { answers: ['Friday'] } } }]);
  assert.equal((await post('answer', { requestId: 'c1', text: 'yes' })).status, 400, 'only ask_user questions are answered this way');
  assert.equal((await post('approval', { requestId: 'c1', decision: 'accept' })).status, 403);
  relay.setAllowApprovals(true);
  assert.equal((await post('approval', { requestId: 'c1', decision: 'accept' })).status, 200);
  assert.deepEqual(calls.at(-1), ['respondApproval', { requestId: 'c1', decision: 'accept' }]);
});

test('push goes out only while nobody is looking, and only to allowed push services', async t => {
  const pushes = [];
  const { relay, base, current } = await startRelay(t, { pushes });
  const token = await pair(relay, base);
  const post = (name, body) => fetch(`${base}/api/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  assert.equal((await post('push', { subscription: { endpoint: 'https://attacker.example/x', keys: { p256dh: 'a', auth: 'b' } } })).status, 400);
  assert.equal((await post('push', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'a', auth: 'b' } } })).status, 200);
  const proactiveState = () => { const next = structuredClone(current.state); next.chats[0].messages.push({ id: `p${next.chats[0].messages.length}`, role: 'assistant', kind: 'offer', text: 'Tea break?' }); current.state = next; return next; };

  const stream = events(base, token); t.after(() => stream.close());
  const hello = await stream.next();
  relay.onEvent({ type: 'state', state: proactiveState() });
  await stream.next();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pushes.length, 0, 'the phone app is open, so no push');

  await post('presence', { clientId: hello.clientId, visible: false });
  relay.onEvent({ type: 'state', state: proactiveState() });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(pushes.map(item => item.body), ['Tea break?']);

  relay.isDesktopFocused = () => true;
  relay.onEvent({ type: 'state', state: proactiveState() });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(pushes.length, 1, 'you are at the PC, so no push');
});

test('the web app is served with a strict content policy and the relay survives a restart', async t => {
  const { relay, base, dir } = await startRelay(t);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await page.text(), /Little Bot/);
  for (const file of ['/app.js', '/app.css', '/sw.js', '/manifest.webmanifest']) assert.equal((await fetch(`${base}${file}`)).status, 200, file);
  for (const [file, size] of [['/icon-192.png', 192], ['/icon-512.png', 512], ['/icon-maskable.png', 512]]) {
    const icon = Buffer.from(await (await fetch(`${base}${file}`)).arrayBuffer());
    assert.deepEqual([...icon.subarray(1, 4)], [80, 78, 71], file);
    assert.equal(icon.readUInt32BE(16), size, file);
  }
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/pair`, { method: 'POST', body: 'x'.repeat(70 * 1024) })).status, 413);
  const token = await pair(relay, base);
  await relay.stop();
  const again = new Relay({ file: path.join(dir, 'relay.json'), protector, getState: () => appState(), handlers: {}, tailscale: async () => ({ ok: false, stdout: '' }) });
  assert.equal(again.config.enabled, true);
  assert.equal(again.config.devices.length, 1);
  assert.deepEqual(again.config.vapid, relay.config.vapid, 'push keys are kept so phones stay subscribed');
  again.config.port = await freePort();
  await again.start(); t.after(() => again.stop());
  assert.equal((await fetch(`http://127.0.0.1:${again.config.port}/api/state`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
});

test('phone context: validated, summarized for prompts, and home/away is detected', () => {
  const phone = require('../src/phone-context.cjs');
  const now = Date.UTC(2026, 9, 2, 18);
  assert.deepEqual(phone.normalizeContext({ location: { lat: 'x', lon: 2 }, battery: { level: 140 } }, now), { at: now });
  const context = phone.normalizeContext({ location: { lat: 48.8566, lon: 2.3522, accuracy: 25.4, at: now - 120000 }, battery: { level: 54.2, charging: true }, extra: 'ignored' }, now);
  assert.deepEqual(context, { at: now, location: { lat: 48.8566, lon: 2.3522, accuracy: 25, at: now - 120000 }, battery: { level: 54, charging: true } });
  const home = { lat: 48.8566, lon: 2.3522, radius: 200 };
  assert.deepEqual(phone.place(context, home), { meters: 0, home: true });
  const away = phone.normalizeContext({ location: { lat: 48.8738, lon: 2.295, accuracy: 10 } }, now);
  const where = phone.place(away, home);
  assert.equal(where.home, false);
  assert.ok(where.meters > 4000 && where.meters < 5000, String(where.meters));
  assert.match(phone.summary(away, home, { now, name: 'Pixel' }), /Pixel.*away from home, about 4\.\d km.*48\.874, 2\.295/);
  assert.match(phone.summary(context, home, { now }), /at home.*battery 54% charging/);
  assert.match(phone.summary(context, null, { now }), /home is not set yet/);
  assert.equal(phone.summary(context, home, { now: now + phone.STALE_MS + 1 }), '', 'stale context is not shown');
});

test('the Android app shares location, sets home, listens in the background and downloads from the PC', async t => {
  const { relay, base, dir } = await startRelay(t);
  const token = await pair(relay, base);
  const post = (name, body) => fetch(`${base}/api/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  assert.equal((await post('home', {})).status, 400, 'no location yet');
  const contexts = [];
  relay.onContext = event => contexts.push(event);
  assert.deepEqual(await (await post('context', { location: { lat: 48.8566, lon: 2.3522, accuracy: 15 } })).json(), { ok: true, home: null, distance: null, homeSet: false });
  assert.deepEqual(await (await post('home', {})).json(), { ok: true, homeSet: true });
  assert.equal(relay.publicState().phone.home, true);
  assert.match(relay.phoneSummary(), /Pixel.*at home/);
  const left = await (await post('context', { location: { lat: 48.8738, lon: 2.295, accuracy: 15 } })).json();
  assert.equal(left.home, false);
  assert.deepEqual([contexts.at(-1).before.home, contexts.at(-1).after.home], [true, false]);

  // A background listener never counts as someone looking, and gets notify events.
  const events = [];
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/events?background=1`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  const reader = response.body.getReader();
  const read = async () => { const { value } = await reader.read(); events.push(...new TextDecoder().decode(value).split('\n\n').filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, '')))); };
  await read();
  assert.equal(events[0].type, 'hello');
  await relay.notify([{ title: 'Little Bot · offer', body: 'Tea?', tag: 'message-x' }]);
  await read();
  assert.deepEqual(events.at(-1), { type: 'notify', notes: [{ title: 'Little Bot · offer', body: 'Tea?', tag: 'message-x' }] });

  relay.apkFile = path.join(dir, 'missing.apk');
  assert.equal((await fetch(`${base}/little-bot.apk`)).status, 404);
  relay.apkFile = path.join(dir, 'app.apk'); fs.writeFileSync(relay.apkFile, 'PK-apk');
  const apk = await fetch(`${base}/little-bot.apk`);
  assert.equal(apk.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.equal(await apk.text(), 'PK-apk');
  assert.deepEqual(await (await post('home', { clear: true })).json(), { ok: true, homeSet: false });
});

test('the model\'s reasoning is folded away on the phone and never notified as a reply', () => {
  const running = appState(); running.chats[0].status = 'running';
  running.chats[0].messages.push({ id: 'u2', role: 'user', text: 'coffee then shower' });
  const done = structuredClone(running); done.chats[0].status = 'idle';
  done.chats[0].messages.push({ id: 'r1', role: 'assistant', kind: 'reasoning', text: 'He is doing coffee. Keep it tiny.' });
  const thinking = view.snapshot(done).messages.find(item => item.id === 'r1');
  assert.equal(thinking.thinking, true);
  assert.equal(thinking.label, 'Thinking');
  assert.deepEqual(view.notifications(view.snapshot(running), view.snapshot(done)), [], 'only reasoning so far: no "replied" notification');
  done.chats[0].messages.push({ id: 'a3', role: 'assistant', phase: 'final_answer', text: 'Go. Coffee first.' });
  assert.deepEqual(view.notifications(view.snapshot(running), view.snapshot(done)).map(item => item.body), ['Go. Coffee first.']);
  assert.equal(view.snapshot(appState({ chats: [{ id: 'c', status: 'idle', messages: [{ id: 'x', role: 'assistant', phase: 'commentary', text: 'Checking the calendar first.' }] }] })).messages[0].thinking, true);
});

test('a scheduled task\'s prompt is labeled as scheduled, not as something the user typed', () => {
  const snap = view.snapshot(appState({ chats: [{ id: 'c', status: 'idle', messages: [
    { id: 's1', role: 'user', text: 'Remind Savinien to do the bathroom', automationId: 'a1', automationName: 'Bathroom Friday' },
    { id: 's2', role: 'assistant', text: 'Bathroom, Savi.', automationId: 'a1', automationName: 'Bathroom Friday' },
    { id: 'u1', role: 'user', text: 'thanks' },
  ] }] }));
  assert.deepEqual(snap.messages.map(item => [item.label, Boolean(item.scheduled)]), [['Scheduled · Bathroom Friday', true], ['Little Bot · Bathroom Friday', false], ['You', false]]);
});

test('the phone can upload attachments and send them, and Little Bot can act on the phone', async t => {
  const imported = [];
  const { relay, base, calls } = await startRelay(t, { handlers: { importAttachment: async ({ name, bytes }) => { imported.push([name, bytes.toString()]); return { id: 'att-1', name, kind: 'file', size: bytes.length, mime: 'text/plain' }; } } });
  const token = await pair(relay, base);
  const post = (name, body) => fetch(`${base}/api/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const upload = await (await post('attach', { name: '../notes/list.txt', data: Buffer.from('milk, eggs').toString('base64') })).json();
  assert.deepEqual(upload, { attachment: { id: 'att-1', name: '..noteslist.txt', kind: 'file', size: 10 } });
  assert.deepEqual(imported, [['..noteslist.txt', 'milk, eggs']]);
  assert.equal((await post('attach', { name: 'x', data: '' })).status, 400);
  assert.equal((await post('send', { text: '', attachmentIds: ['att-1'] })).status, 200);
  assert.deepEqual(calls.at(-1), ['send', { chatId: 'chat-1', text: '', attachmentIds: ['att-1'] }]);

  assert.throws(() => relay.phoneAction({ action: 'ring' }), /No phone with the Little Bot app/);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/events?background=1`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  const reader = response.body.getReader();
  const next = async () => { const { value } = await reader.read(); return new TextDecoder().decode(value).split('\n\n').filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, ''))); };
  await next();
  assert.deepEqual(relay.phoneAction({ action: 'alarm', hour: 7, minute: 30, label: 'Gym' }), { sent: true, kind: 'alarm', phones: ['Pixel'] });
  const [event] = await next();
  assert.equal(event.type, 'action');
  assert.deepEqual({ kind: event.action.kind, hour: event.action.hour, minute: event.action.minute, label: event.action.label }, { kind: 'alarm', hour: 7, minute: 30, label: 'Gym' });
  assert.throws(() => relay.phoneAction({ action: 'alarm', hour: 25, minute: 0 }), /hour 0-23/);
  assert.throws(() => relay.phoneAction({ action: 'timer', minutes: 0 }), /minutes from 1/);
  assert.throws(() => relay.phoneAction({ action: 'navigate' }), /where to go/);
  assert.throws(() => relay.phoneAction({ action: 'sms' }), /Choose alarm/);
});

test('phone_action is a direct-conversation tool only', async () => {
  const { AgentTools } = require('../src/agent-tools.cjs');
  const sent = [];
  const tools = new AgentTools({ store: { data: { settings: {}, extensions: {} } }, phoneAction: async args => { sent.push(args); return { sent: true }; } });
  assert.ok(tools.specs().some(spec => spec.name === 'phone_action'));
  assert.deepEqual(await tools.call('phone_action', { action: 'timer', minutes: 20, label: 'Laundry' }, { chat: { id: 'c' } }), { sent: true });
  await assert.rejects(tools.call('phone_action', { action: 'ring' }, { chat: { id: 'h', internal: true, wild: true } }), /direct user conversation/);
  await assert.rejects(tools.call('phone_action', { action: 'ring', number: '123' }, { chat: { id: 'c' } }), /Unsupported/);
  assert.deepEqual(sent, [{ action: 'timer', minutes: 20, label: 'Laundry' }]);
});

test('screen and clipboard images reach a local model as a user message after the tool outputs', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { AgentTools } = require('../src/agent-tools.cjs');
  const { DesktopTools, TOOL_IMAGES } = require('../src/desktop-tools.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-desktop-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const picture = { isEmpty: () => false, getSize: () => ({ width: 3200, height: 1800 }), resize: ({ width, height }) => ({ ...picture, getSize: () => ({ width, height }), resized: true }), toJPEG: () => Buffer.from('jpeg') };
  let copied = 'Bonjour à tous';
  const desktop = new DesktopTools({ root,
    desktopCapturer: { getSources: async ({ types }) => types[0] === 'screen' ? [{ id: 'screen:1:0', display_id: '1', name: 'Screen 1', thumbnail: picture }] : [{ id: 'window:4242:0', name: 'Notepad', thumbnail: picture }] },
    screen: { getAllDisplays: () => [{ id: 1, size: { width: 1600, height: 900 }, scaleFactor: 2 }], getPrimaryDisplay: () => ({ id: 1, size: { width: 1600, height: 900 }, scaleFactor: 2 }) },
    clipboard: { readText: async () => copied, writeText: async value => { copied = value; }, read: async () => [{ types: ['text/plain'] }] }, nativeImage: {} });
  const tools = new AgentTools({ store: { data: { settings: {}, extensions: {} } }, desktop });
  const chat = { id: 'c', status: 'running' };
  const shot = await tools.call('screen_capture', { window: 4242 }, { chat });
  assert.equal(shot.captured, 'window "Notepad"');
  assert.match(shot[TOOL_IMAGES][0], /^data:image\/jpeg;base64,/);
  assert.ok(fs.existsSync(shot.path) && !JSON.stringify(shot).includes('base64'), 'the file is saved and the JSON stays small');
  assert.deepEqual(await tools.call('clipboard', { action: 'read' }, { chat }), { text: 'Bonjour à tous' });
  await tools.call('clipboard', { action: 'write', text: 'Hello everyone' }, { chat });
  assert.equal(copied, 'Hello everyone');
  await assert.rejects(tools.call('screen_capture', {}, { chat: { id: 'h', internal: true, status: 'running' } }), /active user conversation/);
  await assert.rejects(tools.call('screen_capture', { display: 2 }, { chat }), /1 display/);
  const image = 'data:image/jpeg;base64,AAAA';
  const { body } = responsesToChat({ input: [
    { type: 'function_call', call_id: 'a', name: 'screen_capture', arguments: '{}' },
    { type: 'function_call', call_id: 'b', name: 'clipboard', arguments: '{"action":"read"}' },
    { type: 'function_call_output', call_id: 'a', output: [{ type: 'input_text', text: '{"captured":"display 1 of 1"}' }, { type: 'input_image', image_url: image }] },
    { type: 'function_call_output', call_id: 'b', output: '{"text":"hi"}' },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I see it.' }] },
  ] }, false);
  assert.deepEqual(body.messages.map(message => message.role), ['assistant', 'tool', 'tool', 'user', 'assistant']);
  assert.deepEqual(body.messages[3].content[1], { type: 'image_url', image_url: { url: image } });
  assert.equal(body.messages[1].content, '{"captured":"display 1 of 1"}');
});

function chatChunk(delta = {}, finishReason = null) {
  return `data: ${JSON.stringify({ model: 'mock-qwen', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
}

async function collectAdapter(chunks, options = {}) {
  const adapter = new StrataStreamAdapter({ model: 'mock-qwen', ...options });
  let raw = '';
  adapter.on('data', chunk => { raw += chunk.toString(); });
  const ended = once(adapter, 'end');
  adapter.end(Buffer.from(chunks.join('')));
  await ended;
  const events = raw.split(/\r?\n\r?\n/).filter(block => block.startsWith('data: '))
    .map(block => JSON.parse(block.slice(6)));
  return { adapter, events };
}

async function startStrataMock(t, handler) {
  const server = http.createServer(async (request, response) => {
    if (request.url === '/health') { response.end(JSON.stringify({ images: false })); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    await handler({ request, response, raw, body: JSON.parse(raw) });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const errors = [];
  const relay = new LocalModelRelay({ onError: (source, error, metadata) => errors.push({ source, message: error.message, metadata }) });
  await relay.start();
  t.after(async () => {
    await relay.close();
    await new Promise(resolve => server.close(resolve));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  return { relay, endpoint: relay.endpoint(baseUrl, 'strata'), errors, server, baseUrl };
}

const responseInput = text => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
const localRequest = input => ({ model: 'mock-qwen', input, tools: [{ type: 'function', name: 'lookup', description: 'Look up a value.', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }] });
const responseDone = (text = 'ok') => chatChunk({ content: text }, 'stop') + 'data: [DONE]\n\n';

test('a tool-less follow-up keeps the conversation tool block so Strata reuses its cache', async t => {
  const bodies = [];
  const mock = await startStrataMock(t, async ({ response, body }) => {
    bodies.push(body);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(responseDone('summary'));
  });
  const post = async request => (await fetch(`${mock.endpoint}/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })).text();
  const input = [responseInput('first request')];
  await post(localRequest(input));
  const { tools, ...toolless } = localRequest([...input, responseInput('Summarize for a handoff.')]);
  await post(toolless);
  assert.deepEqual(bodies[1].tools, bodies[0].tools);
  assert.equal(bodies[1].tool_choice, undefined, 'Strata 0.1.40+ drops the tools for "none"');
  const { tools: unused, ...unrelated } = localRequest([responseInput('another conversation')]);
  await post(unrelated);
  assert.equal(bodies[2].tools, undefined, 'only the same conversation gets the block back');
});

test('the Strata adapter turns Qwen text calls into JSON tool events and repairs arguments', async () => {
  const tools = new Map([['lookup', { type: 'function' }]]);
  const forms = [
    '<tool_call>{"name":"lookup","arguments":{"q":"hi"}}</tool_call>',
    '<function=lookup><parameter=q>hi</parameter></function>',
    '```json\n{"name":"lookup","arguments":{"q":"hi",}}\n```',
  ];
  for (const text of forms) {
    const { events } = await collectAdapter([chatChunk({ content: `Done. ${text}` }, 'stop')], { toolKinds: tools });
    const result = events.find(event => event.type === 'response.completed');
    assert.equal(result?.response.output.find(item => item.type === 'message')?.content[0].text, 'Done. ');
    const call = result?.response.output.find(item => item.type === 'function_call');
    assert.equal(call?.name, 'lookup');
    assert.deepEqual(JSON.parse(call.arguments), { q: 'hi' });
  }

  const spaced = await collectAdapter([chatChunk({ content: '<tool_call>{ "name":"lookup", "arguments": { "q" : "hi" } }</tool_call>' }, 'stop')], { toolKinds: tools });
  const spacedCall = spaced.events.find(event => event.type === 'response.completed')?.response.output.find(item => item.type === 'function_call');
  assert.equal(spacedCall.arguments, '{ "q" : "hi" }');
  const replay = responsesToChat({ input: [{ type: 'function_call', call_id: spacedCall.call_id, name: spacedCall.name, arguments: spacedCall.arguments }] });
  assert.equal(replay.body.messages[0].tool_calls[0].function.arguments, spacedCall.arguments);

  const { events } = await collectAdapter([chatChunk({ tool_calls: [{ index: 0, id: 'call-1', function: { name: 'lookup', arguments: "{q: 'hi',}" } }] }, 'stop')], { toolKinds: tools });
  const call = events.find(event => event.type === 'response.completed')?.response.output.find(item => item.type === 'function_call');
  assert.deepEqual(JSON.parse(call.arguments), { q: 'hi' });
  const partial = await collectAdapter([chatChunk({ tool_calls: [{ index: 0, id: 'call-2', function: { name: 'lookup', arguments: '{"q":"partial"' } }] }, 'stop')], { toolKinds: tools });
  const partialCall = partial.events.find(event => event.type === 'response.completed')?.response.output.find(item => item.type === 'function_call');
  assert.deepEqual(JSON.parse(partialCall.arguments), { q: 'partial' });
  const bareword = await collectAdapter([chatChunk({ tool_calls: [{ index: 0, id: 'call-3', function: { name: 'lookup', arguments: '{q: hi,}' } }] }, 'stop')], { toolKinds: tools });
  const barewordCall = bareword.events.find(event => event.type === 'response.completed')?.response.output.find(item => item.type === 'function_call');
  assert.deepEqual(JSON.parse(barewordCall.arguments), { q: 'hi' });
});

test('tagged text tool calls replay their generated assistant text before tool output', async () => {
  const history = new Map();
  const tools = new Map([['lookup', { type: 'function' }]]);
  const raw = 'Let me check. <tool_call>{ "name":"lookup", "arguments": { "q" : "hi" } }</tool_call>';
  const first = await collectAdapter([chatChunk({ content: raw }, 'stop')], { toolKinds: tools, textCallHistory: history });
  const output = first.events.find(event => event.type === 'response.completed').response.output;
  const call = output.find(item => item.type === 'function_call');
  assert.ok(call);
  const replay = responsesToChat({ input: [...output, { type: 'function_call_output', call_id: call.call_id, output: 'Found it.' }] }, false, history);
  assert.equal(replay.body.messages[0].content, raw);
  assert.equal(replay.body.messages[0].tool_calls, undefined);
  assert.deepEqual(replay.body.messages[1], { role: 'assistant', content: 'Tool output for lookup (reference data):\nFound it.' });
  assert.equal(history.size, 2);
});

test('the Strata adapter repairs patch aliases and unknown calls while replaying the original tagged text', async () => {
  const tools = new Map([['exec_command', { type: 'function' }], ['write_stdin', { type: 'function' }]]);
  const patch = '*** Begin Patch\n*** Update File: math.js\n@@\n-const value = 1;\n+const value = 2;\n*** End Patch';
  const shapes = [
    ['apply_patch', { input: patch }],
    ['applypatch', { patch }],
    ['apply-patch', patch],
    ['apply_patch', { cmd: `apply_patch <<'EOF'\n${patch}\nEOF` }],
    ['apply_patch', { command: `apply_patch <<'EOF'\n${patch}\nEOF` }],
    ['apply_patch', { command: ['apply_patch', patch] }],
    ['apply_patch', { cmd: ['apply_patch', patch] }],
    ['exec_command', { cmd: ['apply_patch', patch] }],
  ];
  const repairs = [];
  for (const [name, args] of shapes) {
    const { events } = await collectAdapter([chatChunk({ tool_calls: [{ index: 0, id: 'call-patch', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls')], { toolKinds: tools, onToolRepair: repair => repairs.push(repair) });
    const call = events.find(event => event.type === 'response.completed')?.response.output.find(item => item.type === 'function_call');
    assert.equal(call?.name, 'exec_command', name);
    assert.match(JSON.parse(call.arguments).cmd, /apply_patch <<'LITTLE_BOT_PATCH'/, name);
    assert.ok(JSON.parse(call.arguments).cmd.includes(patch), name);
  }
  assert.equal(repairs.length, shapes.length);
  assert.ok(repairs.every(repair => repair.modelId === 'mock-qwen' && repair.key === 'patch-through-exec-command'));

  const unknownRepairs = [];
  const unknown = await collectAdapter([chatChunk({ tool_calls: [{ index: 0, id: 'call-unknown', function: { name: 'missing_tool', arguments: '{"value":1}' } }] }, 'tool_calls')], { toolKinds: tools, onToolRepair: repair => unknownRepairs.push(repair) });
  const feedback = unknown.events.find(event => event.type === 'response.completed')?.response.output.find(item => item.type === 'function_call');
  assert.equal(feedback?.name, 'exec_command');
  assert.match(JSON.parse(feedback.arguments).cmd, /Unknown tool "missing_tool"/);
  assert.match(JSON.parse(feedback.arguments).cmd, /Valid tools: exec_command, write_stdin/);
  assert.equal(unknownRepairs[0]?.key, 'unknown-tool-name');
  assert.match(JSON.parse(feedback.arguments).cmd, /Lesson: use only listed tool names/);

  const rawArguments = '{ "cmd": "Write-Output ok", "yield_time_ms": 1000 }';
  const valid = await collectAdapter([chatChunk({ tool_calls: [{ index: 0, id: 'call-valid', function: { name: 'exec_command', arguments: rawArguments } }] }, 'tool_calls')], { toolKinds: tools });
  const unchanged = valid.events.find(event => event.type === 'response.completed')?.response.output.find(item => item.type === 'function_call');
  assert.equal(unchanged.arguments, rawArguments);

  const noExec = await collectAdapter([chatChunk({ tool_calls: [{ index: 0, id: 'call-no-exec', function: { name: 'apply_patch', arguments: JSON.stringify({ input: patch }) } }] }, 'tool_calls')], { toolKinds: new Map([['lookup', { type: 'function' }]]) });
  assert.equal(noExec.events.some(event => event.item?.type === 'function_call' && event.item.name === 'exec_command'), false);

  const raw = `Editing. <tool_call>{ "name":"apply-patch", "arguments": {"patch": ${JSON.stringify(patch)} } }</tool_call>`;
  const history = new Map();
  const tagged = await collectAdapter([chatChunk({ content: raw }, 'stop')], { toolKinds: tools, textCallHistory: history });
  const output = tagged.events.find(event => event.type === 'response.completed').response.output;
  const taggedCall = output.find(item => item.type === 'function_call');
  assert.equal(taggedCall?.name, 'exec_command');
  assert.match(JSON.parse(taggedCall.arguments).cmd, /apply_patch <<'LITTLE_BOT_PATCH'/);
  const replay = responsesToChat({ input: [...output, { type: 'function_call_output', call_id: taggedCall.call_id, output: 'Applied.' }] }, false, history);
  assert.equal(replay.body.messages[0].content, raw);
  assert.equal(Buffer.from(replay.body.messages[0].content).compare(Buffer.from(raw)), 0);
  assert.equal(replay.body.messages[0].tool_calls, undefined);
  assert.deepEqual(replay.body.messages[1], { role: 'assistant', content: 'Tool output for apply-patch (reference data):\nApplied.' });
});

test('the Strata adapter preserves hidden thought for replay, fails empty and truncated calls, and trims loops', async () => {
  const tools = new Map([['lookup', { type: 'function' }]]);
  const history = new Map();
  const raw = '<think>private thought</think   ><reasoning>hidden reasoning</reasoning>Answer.';
  const thought = await collectAdapter([
    chatChunk({ content: '<think>private thought</think   ' }),
    chatChunk({ content: '><reasoning>hidden reasoning</reasoning>Answer.' }, 'stop'),
  ], { toolKinds: tools, textCallHistory: history });
  const completed = thought.events.find(event => event.type === 'response.completed');
  assert.equal(completed.response.output.find(item => item.type === 'message').content[0].text, 'Answer.');
  const reasoning = completed.response.output.find(item => item.type === 'reasoning');
  assert.match(reasoning.content[0].text, /private thought/);
  assert.match(reasoning.content[0].text, /hidden reasoning/);
  const replayed = responsesToChat({ input: completed.response.output });
  assert.match(replayed.body.messages[0].reasoning_content, /private thought/);
  assert.match(replayed.body.messages[0].reasoning_content, /hidden reasoning/);
  const stableReplay = responsesToChat({ input: completed.response.output }, false, history);
  assert.equal(stableReplay.body.messages[0].content, raw);
  assert.equal(stableReplay.body.messages[0].reasoning_content, undefined);

  const empty = await collectAdapter([chatChunk({}, 'stop')]);
  assert.equal(empty.events.at(-1).type, 'response.failed');
  assert.equal(empty.events.at(-1).response.error.code, 'empty_completion');
  const whitespace = await collectAdapter([chatChunk({ content: '  \n' }, 'stop')]);
  assert.equal(whitespace.events.at(-1).response.error.code, 'empty_completion');

  const limited = await collectAdapter([chatChunk({ tool_calls: [{ index: 0, function: { name: 'lookup', arguments: '{"q":' } }] }, 'length')], { toolKinds: tools });
  assert.equal(limited.events.at(-1).type, 'response.failed');
  assert.equal(limited.events.some(event => event.item?.type === 'function_call'), false);

  let stopped = false;
  const loop = 'The same loop continues. '.repeat(5);
  const repeated = await collectAdapter([chatChunk({ content: loop }, 'stop')], { onDegenerate: () => { stopped = true; } });
  const output = repeated.events.find(event => event.type === 'response.completed').response.output.find(item => item.type === 'message').content[0].text;
  assert.equal(output, 'The same loop continues. '.repeat(2));
  await new Promise(setImmediate);
  assert.equal(repeated.adapter.degenerate, true);
  assert.equal(stopped, true);

  const streaming = new StrataStreamAdapter();
  const streamingEnd = once(streaming, 'end');
  streaming.resume();
  await new Promise(resolve => streaming.write(Buffer.from(chatChunk({ content: 'x'.repeat(140) })), resolve));
  assert.ok(streaming.text.length > 0, 'ordinary text starts streaming before completion');
  streaming.end(Buffer.from(chatChunk({ content: 'tail' }, 'stop')));
  await streamingEnd;
});

test('the Strata relay starts its Responses stream before model headers and cancels generation on caller close', async t => {
  let headersAt = null;
  const delayed = await startStrataMock(t, async ({ response }) => {
    await new Promise(resolve => setTimeout(resolve, 600));
    headersAt = Date.now();
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(responseDone());
  });
  const startedAt = Date.now();
  const response = await fetch(`${delayed.endpoint}/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(localRequest([responseInput('slow prefill')])) });
  const responseReader = response.body.getReader();
  const first = await responseReader.read();
  const firstByteMs = Date.now() - startedAt;
  assert.equal(headersAt, null, 'the mock model has not sent headers yet');
  assert.ok(firstByteMs < 500, `first Responses bytes arrived in ${firstByteMs}ms`);
  assert.match(new TextDecoder().decode(first.value), /response\.created/);
  let rest = '';
  for (;;) { const part = await responseReader.read(); if (part.done) break; rest += new TextDecoder().decode(part.value); }
  assert.match(rest, /response\.completed/);

  let closeUpstream;
  const closed = new Promise(resolve => { closeUpstream = resolve; });
  const pending = await startStrataMock(t, async ({ response }) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.once('close', closeUpstream);
  });
  const controller = new AbortController();
  const call = fetch(`${pending.endpoint}/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(localRequest([responseInput('stop now')])), signal: controller.signal });
  const stream = await call;
  const reader = stream.body.getReader();
  await reader.read();
  controller.abort();
  await reader.cancel().catch(() => {});
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream stream was not cancelled')), 1500))]);
  assert.deepEqual(pending.errors, [], 'caller cancellation is expected and is not logged');
});

test('the Strata relay retries startup refusal and keeps identical requests byte-stable', async t => {
  const captured = [];
  let accepted = 0;
  const server = http.createServer();
  const port = await freePort();
  const errors = [];
  const relay = new LocalModelRelay({ onError: (source, error) => errors.push(`${source}: ${error.message}`) });
  await relay.start();
  t.after(async () => {
    await relay.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });
  const endpoint = relay.endpoint(`http://127.0.0.1:${port}/v1`, 'strata');
  setTimeout(() => server.listen(port, '127.0.0.1'), 150).unref();

  server.removeAllListeners('request');
  server.on('request', async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    captured.push(Buffer.concat(chunks).toString());
    accepted++;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(responseDone());
  });
  const send = async body => {
    const response = await fetch(`${endpoint}/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    await response.text();
  };
  const first = localRequest([responseInput('first'), { type: 'function_call', name: 'lookup', arguments: '{q: "old",}' }]);
  await send(first);
  await send(first);
  const second = structuredClone(first);
  second.input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'first answer' }] }, responseInput('second'));
  await send(second);
  assert.equal(captured[0], captured[1]);
  assert.equal(captured[0], stableJson(JSON.parse(captured[0])));
  const historicalCall = JSON.parse(captured[0]).messages.flatMap(message => message.tool_calls || [])[0];
  assert.deepEqual(JSON.parse(historicalCall.function.arguments), { q: 'old' });
  assert.equal(accepted, 3, 'the refused connection was retried without a duplicate accepted request');
  assert.deepEqual(errors, [], 'temporary startup refusal was recovered quietly');
  assert.deepEqual(Object.keys(JSON.parse(captured[0])).filter(key => stableJson(JSON.parse(captured[0])[key]) !== stableJson(JSON.parse(captured[2])[key])), ['messages']);
  assert.notEqual(captured[0], captured[2], 'a new turn changes the translated conversation history');
  const settings = providerConfig({ connection: 'local', localBaseUrl: 'http://127.0.0.1:8080/v1' }, { contextWindow: 65536 });
  assert.equal(settings['model_providers.little_bot_local'].request_max_retries, 0);
  assert.equal(settings['model_providers.little_bot_local'].stream_max_retries, 0);
  assert.equal(LOCAL_STREAM_IDLE_TIMEOUT_MS, 30 * 60 * 1000);
});

test('the early Strata stream still restores namespaced Responses tool calls', async t => {
  const { endpoint } = await startStrataMock(t, async ({ response, body }) => {
    const alias = body.tools[0].function.name;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(chatChunk({ tool_calls: [{ index: 0, id: 'call-1', function: { name: alias, arguments: '{"q":"x"}' } }] }, 'tool_calls'));
  });
  const body = { model: 'mock-qwen', input: [responseInput('look up x')], tools: [{ type: 'namespace', name: 'local_space', tools: [
    { type: 'function', name: 'lookup', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
  ] }] };
  const response = await fetch(`${endpoint}/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const raw = await response.text();
  const events = raw.split(/\r?\n\r?\n/).filter(block => block.startsWith('data: ')).map(block => JSON.parse(block.slice(6)));
  const call = events.find(event => event.type === 'response.completed')?.response.output.find(item => item.type === 'function_call');
  assert.equal(call.name, 'lookup');
  assert.equal(call.namespace, 'local_space');
});

test('a stray closing think tag before the answer moves the draft into reasoning, never into the reply', async () => {
  const output = async chunks => (await collectAdapter(chunks)).events.find(event => event.type === 'response.completed').response.output;
  const stray = await output([chatChunk({ reasoning_content: 'They ask for the codename.' }),
    chatChunk({ content: 'You gave me SAFFRON-7.\n</think>\n\nYou gave me the test codename SAFFRON-7.' }), chatChunk({}, 'stop')]);
  assert.equal(stray.find(item => item.type === 'message').content[0].text, 'You gave me the test codename SAFFRON-7.');
  assert.match(stray.find(item => item.type === 'reasoning').content[0].text, /codename\.You gave me SAFFRON-7/);
  const plain = await output([chatChunk({ content: 'No tags here.' }), chatChunk({}, 'stop')]);
  assert.equal(plain.find(item => item.type === 'message').content[0].text, 'No tags here.');
});

test('a JSON example in an answer stays in the answer, and an emoji is never split between deltas', async () => {
  const tools = new Map([['exec_command', { type: 'function' }], ['lookup', { type: 'function' }]]);
  const example = 'Here is a package.json:\n```json\n{\n  "name": "my-app",\n  "version": "1.0.0"\n}\n```\nHope that helps.';
  const repairs = [];
  const { events } = await collectAdapter([chatChunk({ content: example }, 'stop')], { toolKinds: tools, onToolRepair: repair => repairs.push(repair) });
  const output = events.find(event => event.type === 'response.completed').response.output;
  assert.equal(output.some(item => item.type === 'function_call'), false);
  assert.equal(output.find(item => item.type === 'message').content[0].text, example);
  assert.deepEqual(repairs, [], 'no bogus lesson either');

  const emoji = await collectAdapter([chatChunk({ content: 'x'.repeat(10) + '😀' }), chatChunk({ content: 'y'.repeat(127) }), chatChunk({ content: 'tail' }, 'stop')]);
  const deltas = emoji.events.filter(event => event.type === 'response.output_text.delta').map(event => event.delta);
  assert.equal(deltas.some(delta => /[\ud800-\udbff]$/.test(delta) || /^[\udc00-\udfff]/.test(delta)), false);
  assert.equal(deltas.join(''), 'x'.repeat(10) + '😀' + 'y'.repeat(127) + 'tail');
});

test('an HTTP 400 from the model server reaches the engine with its message, and an overflow is named as one', async t => {
  const mock = await startStrataMock(t, async ({ response }) => {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 400, message: 'the request exceeds the available context size, try increasing it', type: 'exceed_context_size_error' } }));
  });
  const raw = await (await fetch(`${mock.endpoint}/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(localRequest([responseInput('hi')])) })).text();
  const failed = raw.split(/\r?\n\r?\n/).filter(block => block.startsWith('data: ')).map(block => JSON.parse(block.slice(6))).find(event => event.type === 'response.failed');
  assert.equal(failed.response.error.code, 'context_length_exceeded');
  assert.match(failed.response.error.message, /HTTP 400: the request exceeds the available context size/);
});

test('the phone gets goal questions, file ids, enabled skill names and links to the right chat, and nothing more', () => {
  const state = appState({
    extensions: { skills: [{ name: 'trip-planner', description: 'Plan a trip', content: 'SECRET SKILL BODY', enabled: true }, { name: 'off-skill', description: 'Disabled', content: 'x', enabled: false }] },
    chats: [
      { id: 'chat-1', status: 'idle', messages: [{ id: 'q', role: 'assistant', kind: 'goal', goalId: 'g1', goalQuestionId: 'gq1', text: 'Which pots get sun?' },
        { id: 'f', role: 'assistant', text: 'Here it is', attachments: [{ id: 'att_1', kind: 'file', name: 'plan.pdf', size: 10, path: 'C:\private\plan.pdf' }] }] },
      { id: 'quick-1', private: true, status: 'idle', messages: [] },
      { id: 's1', session: true, title: 'Lisbon', status: 'running', updatedAt: 2, messages: [{ id: 's1u', role: 'user', text: 'plan it' }] },
    ],
    approvals: [{ requestId: 'r1', chatId: 's1', kind: 'question', dynamicTool: 'ask_user', questions: [{ question: 'How many days?', options: [] }] }],
  });
  state.autonomy.goals[0].pendingQuestion = { id: 'gq1', question: 'Which pots get sun?', options: ['Balcony'], createdAt: 1 };
  const snap = view.snapshot(state);
  assert.deepEqual(snap.skills, [{ name: 'trip-planner', description: 'Plan a trip' }]);
  assert.equal(JSON.stringify(snap).includes('SECRET SKILL BODY'), false);
  assert.equal(JSON.stringify(snap).includes('C:\\private'), false);
  assert.deepEqual(snap.goals[0].question, { id: 'gq1', question: 'Which pots get sun?', options: ['Balcony'] });
  assert.deepEqual([snap.messages[0].goalId, snap.messages[0].goalQuestionId], ['g1', 'gq1']);
  assert.deepEqual(snap.messages[1].attachments, [{ id: 'att_1', kind: 'file', name: 'plan.pdf', size: 10 }]);
  const notes = view.notifications(view.snapshot(appState()), snap);
  assert.equal(notes.find(note => note.tag === 'approval-r1').url, '/#session=s1');
  const done = structuredClone(state); done.chats[2].status = 'idle'; done.chats[2].messages.push({ id: 's1a', role: 'assistant', text: 'Day 1…' });
  assert.equal(view.notifications(snap, view.snapshot(done)).find(note => note.tag === 'reply-s1').url, '/#session=s1');
});

test('the phone keeps a Quick session, answers goal questions, uses /skill and opens files through short links', async t => {
  const state = appState({
    extensions: { skills: [{ name: 'trip-planner', description: 'Plan a trip', content: 'x', enabled: true }] },
    chats: [
      { id: 'chat-1', status: 'idle', messages: [{ id: 'img', role: 'assistant', text: 'A photo', attachments: [{ id: 'att_img', kind: 'image', name: 'photo.png' }] },
        { id: 'doc', role: 'assistant', text: 'A page', attachments: [{ id: 'att_html', kind: 'file', name: 'page.html' }] }] },
      { id: 'quick-1', private: true, status: 'idle', messages: [{ id: 'qu', role: 'user', text: 'hi' }] },
    ],
  });
  state.autonomy.goals[0].pendingQuestion = { id: 'gq1', question: 'Which day?', options: [], createdAt: 1 };
  const files = { att_img: { buffer: Buffer.from('PNG'), mime: 'image/png', name: 'photo.png' }, att_html: { buffer: Buffer.from('<script>steal()</script>'), mime: 'text/html', name: 'page.html' } };
  const { relay, base, calls } = await startRelay(t, { state, options: { readAttachment: async id => { if (!files[id]) throw new Error('missing'); return files[id]; } } });
  const token = await pair(relay, base);
  const post = (name, body) => fetch(`${base}/api/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

  assert.equal((await (await post('keepQuick', {})).json()).chatId, 'quick-1');
  assert.deepEqual(calls.at(-1), ['saveQuickSession', { chatId: 'quick-1' }]);

  assert.equal((await post('goalAnswer', { id: 'g1', questionId: 'old', answer: 'Monday' })).status, 400);
  assert.equal((await post('goalAnswer', { id: 'g1', questionId: 'gq1', answer: ' Monday ' })).status, 200);
  assert.deepEqual(calls.at(-1), ['answerGoal', { id: 'g1', questionId: 'gq1', answer: 'Monday' }]);

  assert.equal((await post('send', { text: '/skill Trip-Planner three days in Lisbon' })).status, 200);
  assert.deepEqual(calls.at(-1), ['send', { chatId: 'chat-1', text: '$trip-planner three days in Lisbon' }]);
  const unknown = await post('send', { text: '/skill nope hello' });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /No enabled skill/);

  const picture = await (await post('fileLink', { id: 'att_img' })).json();
  assert.equal(picture.kind, 'image');
  const shown = await fetch(`${base}${picture.url}`);
  assert.equal(shown.status, 200, 'the link works without the token header');
  assert.equal(shown.headers.get('content-type'), 'image/png');
  assert.match(shown.headers.get('content-disposition'), /^inline/);
  const page = await fetch(`${base}${(await (await post('fileLink', { id: 'att_html' })).json()).url}`);
  assert.equal(page.headers.get('content-type'), 'application/octet-stream', 'a page never runs on the phone origin');
  assert.match(page.headers.get('content-disposition'), /^attachment; filename="page.html"/);
  assert.match(page.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await post('fileLink', { id: 'att_secret' })).status, 400, 'only files of messages the phone was shown');
  assert.equal((await fetch(`${base}/api/file?ticket=forged`)).status, 404);
  assert.equal((await fetch(`${base}/slash-commands.js`)).status, 200);
});
