'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const webPush = require('../src/web-push.cjs');
const view = require('../src/relay-view.cjs');
const { Relay } = require('../src/relay.cjs');

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
  assert.deepEqual(view.notifications(before, view.snapshot(proactive)), [{ title: 'Little Bot · on its own · games', body: 'Want to play Hades tonight?', tag: 'message-p1' }]);

  const asking = appState({ approvals: [{ requestId: 'r1', chatId: 'chat-1', kind: 'question', dynamicTool: 'ask_user', title: 'Little Bot has a question', questions: [{ question: 'Which day?', options: [{ label: 'Monday' }] }] }] });
  const asked = view.snapshot(asking);
  assert.equal(asked.approvals[0].ask, true);
  assert.deepEqual(asked.approvals[0].options, ['Monday']);
  assert.equal(view.notifications(before, asked)[0].title, 'Little Bot has a question');

  const running = appState(); running.chats[0].status = 'running';
  running.chats[0].messages.push({ id: 'u2', role: 'user', text: 'plan my evening' }, { id: 'a2', role: 'assistant', text: 'Working…', status: 'running' });
  const done = structuredClone(running); done.chats[0].status = 'idle'; done.chats[0].messages[3] = { id: 'a2', role: 'assistant', text: 'Here is your evening.' };
  assert.deepEqual(view.notifications(view.snapshot(running), view.snapshot(done)), [{ title: 'Little Bot replied', body: 'Here is your evening.', tag: 'reply' }]);
  const stopped = structuredClone(running); stopped.chats[0].status = 'idle'; stopped.chats[0].messages.pop();
  assert.deepEqual(view.notifications(view.snapshot(running), view.snapshot(stopped)), [], 'no reply after the last message');
});

async function startRelay(t, { state = appState(), handlers = {}, pushes = [] } = {}) {
  const dir = tempDir(t);
  const calls = [];
  const current = { state };
  const relay = new Relay({ file: path.join(dir, 'relay.json'), protector, getState: () => current.state,
    handlers: new Proxy({}, { get: (_t, name) => async payload => { calls.push([name, payload]); return handlers[name]?.(payload); } }),
    tailscale: async () => ({ ok: false, stdout: '', stderr: 'not found' }),
    push: async (subscription, payload) => { pushes.push(payload); return { status: 201, gone: false }; } });
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
  assert.equal(relay.pairing, null, 'five wrong codes burn the pairing code');
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
