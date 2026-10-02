'use strict';
// Minimal Web Push sender (RFC 8291 payload encryption + RFC 8292 VAPID), no dependencies.
const crypto = require('node:crypto');
const https = require('node:https');

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
const b64url = buffer => Buffer.from(buffer).toString('base64url');
const fromB64url = value => Buffer.from(String(value || ''), 'base64url');

function createVapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateJwk: privateKey.export({ format: 'jwk' }) };
}
function vapidPublicKey(keys) {
  const jwk = keys.privateJwk;
  return b64url(Buffer.concat([Buffer.from([4]), fromB64url(jwk.x), fromB64url(jwk.y)]));
}
function vapidHeader(keys, endpoint, subject, now = Date.now()) {
  const audience = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapidPublicKey(keys)}`;
}
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Encrypts one record with aes128gcm for the browser's p256dh key and auth secret.
function encrypt(payload, subscription, { salt = crypto.randomBytes(16), serverKeys = null } = {}) {
  const uaPublic = fromB64url(subscription.keys?.p256dh);
  const authSecret = fromB64url(subscription.keys?.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length < 16) throw new Error('The push subscription keys are invalid.');
  const ecdh = serverKeys || crypto.createECDH('prime256v1');
  if (!serverKeys) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

function allowedEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && PUSH_HOSTS.some(pattern => pattern.test(url.hostname));
  } catch { return false; }
}

function send(subscription, payload, { keys, subject, ttl = 86400, request = https.request } = {}) {
  if (!allowedEndpoint(subscription?.endpoint)) return Promise.reject(new Error('This push service is not allowed.'));
  const body = encrypt(JSON.stringify(payload), subscription);
  return new Promise((resolve, reject) => {
    const req = request(subscription.endpoint, { method: 'POST', timeout: 15000, headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Content-Length': body.length,
      TTL: String(ttl), Urgency: 'high', Authorization: vapidHeader(keys, subscription.endpoint, subject),
    } }, response => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode, gone: [404, 410].includes(response.statusCode) }));
    });
    req.on('timeout', () => req.destroy(new Error('The push service did not answer.')));
    req.on('error', reject);
    req.end(body);
  });
}

module.exports = { createVapidKeys, vapidPublicKey, vapidHeader, encrypt, allowedEndpoint, send };
