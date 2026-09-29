'use strict';

const http = require('node:http');
const https = require('node:https');
const { randomBytes } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { localBaseUrl, LOCAL_STREAM_IDLE_TIMEOUT_MS } = require('./connections.cjs');
const { applyQwenGeneration } = require('./local-generation.cjs');
const { prepareNamespaceTools, restoreNamespaceCalls } = require('./responses-namespace-compat.cjs');
const { StrataStreamAdapter, estimateResponsesInputTokens, responsesToChat } = require('./strata-responses-adapter.cjs');

// A 50 MiB attachment turn can exceed 64 MiB after base64 encoding.
const MAX_BODY_BYTES = 96 * 1024 * 1024;
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const token = () => randomBytes(24).toString('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function headersWithoutHopByHop(headers) {
  const blocked = new Set(HOP_HEADERS);
  for (const name of String(headers.connection || '').split(',')) blocked.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => value !== undefined && !blocked.has(name.toLowerCase())));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const cleanup = () => {
      request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted);
    };
    const fail = failure => { cleanup(); reject(failure); };
    const error = () => fail(new RequestError(400, 'Local model request was interrupted.'));
    const aborted = () => fail(new RequestError(400, 'Local model request was cancelled.'));
    const data = chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.pause();
        fail(new RequestError(413, 'Local model request is too large.'));
      } else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, size)); };
    request.on('data', data); request.once('end', end); request.once('error', error); request.once('aborted', aborted);
  });
}

function replyError(response, status, message) {
  if (response.destroyed) return;
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' });
  response.end(JSON.stringify({ error: { message, type: 'local_model_error', code: status } }));
}

function responseEvents(namespaceTools) {
  const limit = 1024 * 1024;
  let parts = [], size = 0, passthrough = false;
  const line = buffer => {
    if (buffer.subarray(0, 5).toString('ascii') !== 'data:') return buffer;
    try {
      const event = JSON.parse(buffer.subarray(5).toString('utf8'));
      let changed = false;
      // llama.cpp b10068 omits the single reasoning part's index. Codex
      // 0.157.1 requires it to forward response.reasoning_text.delta live.
      if (event?.type === 'response.reasoning_text.delta' && typeof event.delta === 'string'
        && !Object.hasOwn(event, 'content_index')) {
        event.content_index = 0;
        changed = true;
      }
      changed = restoreNamespaceCalls(event, namespaceTools.byAlias) || changed;
      if (!changed) return buffer;
      const ending = buffer.at(-1) === 10 ? (buffer.at(-2) === 13 ? '\r\n' : '\n') : '';
      return Buffer.from(`data: ${JSON.stringify(event)}${ending}`);
    } catch { return buffer; }
  };
  return new Transform({
    transform(chunk, encoding, callback) {
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset), end = newline < 0 ? chunk.length : newline + 1;
        const piece = chunk.subarray(offset, end);
        if (passthrough || size + piece.length > limit) {
          for (const part of parts) this.push(part);
          parts = []; size = 0;
          this.push(piece); passthrough = newline < 0;
        } else {
          parts.push(piece); size += piece.length;
          if (newline >= 0) {
            this.push(line(parts.length === 1 ? parts[0] : Buffer.concat(parts, size)));
            parts = []; size = 0;
          }
        }
        offset = end;
      }
      callback();
    },
    flush(callback) {
      if (size) this.push(line(parts.length === 1 ? parts[0] : Buffer.concat(parts, size)));
      callback();
    },
  });
}

// Codex's custom-provider client cannot add chat_template_kwargs. This narrow
// local transport adds Qwen's real switch without altering history or SSE data.
class LocalModelRelay {
  constructor({ thinking = () => true, onError = () => {} } = {}) {
    if (typeof thinking !== 'function') throw new TypeError('thinking must be a function.');
    if (typeof onError !== 'function') throw new TypeError('onError must be a function.');
    this.thinking = thinking;
    this.onError = onError;
    this.server = null;
    this.starting = null;
    this.closing = null;
    this.origin = null;
    this.secret = token();
    this.routes = new Map();
    this.upstreams = new Map();
    this.adapters = new Map();
    this.cacheSlots = new Map();
    this.sockets = new Set();
    this.requests = new Set();
  }

  async start() {
    if (this.closing) await this.closing;
    if (this.server?.listening) return this;
    if (!this.starting) {
      this.starting = this._listen();
      this.starting.finally(() => { this.starting = null; }).catch(() => {});
    }
    await this.starting;
    return this;
  }

  async _listen() {
    const server = http.createServer((request, response) => {
      this._handle(request, response).catch(error => {
        const status = error instanceof RequestError ? error.status : 502;
        if (!(error instanceof RequestError) || status >= 500) this.onError('request', error, { method: request.method, status });
        replyError(response, status,
          error instanceof RequestError ? error.message : 'Could not reach the local model server.');
      });
    });
    this.server = server;
    server.headersTimeout = 15000;
    server.requestTimeout = 120000;
    server.keepAliveTimeout = 5000;
    server.on('connection', socket => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    try {
      await new Promise((resolve, reject) => {
        const failed = error => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); resolve(); };
        server.once('error', failed); server.once('listening', ready);
        server.listen(0, '127.0.0.1');
      });
      this.origin = `http://127.0.0.1:${server.address().port}`;
    } catch (error) {
      if (this.server === server) this.server = null;
      server.close();
      this.onError('listen', error);
      throw error;
    }
  }

  endpoint(baseUrl, adapter = null, cacheSlot = 0) {
    if (!Number.isInteger(cacheSlot) || cacheSlot < 0 || cacheSlot > 3) throw new Error("Invalid local cache slot.");
    if (!this.server?.listening || this.closing) throw new Error('The local model connection is not ready.');
    const base = localBaseUrl(baseUrl);
    const mode = adapter === 'strata' ? 'strata' : 'responses';
    const key = `${mode}\0${base}\0${cacheSlot}`;
    let route = this.upstreams.get(key);
    if (!route) {
      route = token();
      this.upstreams.set(key, route);
      this.routes.set(route, base);
      this.adapters.set(route, mode === 'strata' ? 'strata' : null);
      this.cacheSlots.set(route, cacheSlot);
    }
    return `${this.origin}/${this.secret}/${route}/v1`;
  }

  async _handle(request, response) {
    // Native clients have no Origin. Browser requests, including null origins,
    // are rejected; no CORS headers or preflight endpoint are provided.
    if (request.headers.origin !== undefined || request.headers.host !== new URL(this.origin).host) {
      throw new RequestError(403, 'This connection is only available to Little Bot.');
    }
    const match = /^\/([a-f0-9]{48})\/([a-f0-9]{48})\/v1\/(responses(?:\/input_tokens)?)$/.exec(request.url || '');
    const base = match?.[1] === this.secret ? this.routes.get(match[2]) : null;
    const adapter = base ? this.adapters.get(match[2]) : null;
    if (!base || request.method !== 'POST') throw new RequestError(404, 'Local model route not found.');
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new RequestError(415, 'The local model request must be JSON.');
    // Pinned Codex only compresses authenticated OpenAI-backend requests; local
    // providers send plain JSON. Fail clearly if that transport contract changes.
    if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw new RequestError(415, 'Compressed local model requests are not supported.');
    if (Number(request.headers['content-length'] || 0) > MAX_BODY_BYTES) throw new RequestError(413, 'Local model request is too large.');
    const thinking = this.thinking() !== false;
    let body;
    try { body = JSON.parse((await readBody(request)).toString('utf8')); }
    catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(400, 'The local model request contains invalid JSON.');
    }
    if (!object(body) || (body.chat_template_kwargs !== undefined && !object(body.chat_template_kwargs))) throw new RequestError(400, 'The local model request has invalid template settings.');
    body.chat_template_kwargs = { ...body.chat_template_kwargs, enable_thinking: thinking };
    const namespaceTools = prepareNamespaceTools(body);
    if (adapter === 'strata' && match[3] === 'responses/input_tokens') {
      const data = Buffer.from(JSON.stringify({ object: 'response.input_tokens', input_tokens: estimateResponsesInputTokens(body) }));
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(data.length), 'cache-control': 'no-store' });
      response.end(data);
      return;
    }
    let upstreamPath = match[3], strataTools = null;
    if (adapter === 'strata') {
      const translated = responsesToChat(body, thinking);
      body = translated.body;
      body.strata_cache_slot = this.cacheSlots.get(match[2]) || 0;
      strataTools = translated.toolKinds;
      upstreamPath = 'chat/completions';
    } else if (match[3] === 'responses') {
      applyQwenGeneration(body, thinking);
    }
    const data = Buffer.from(JSON.stringify(body));
    const headers = headersWithoutHopByHop(request.headers);
    for (const name of ['host', 'content-length', 'content-encoding', 'origin', 'referer', 'cookie', 'authorization', 'expect']) delete headers[name];
    headers['content-length'] = String(data.length);
    headers['accept-encoding'] = 'identity';
    const target = new URL(`${base}/${upstreamPath}`);
    const transport = target.protocol === 'https:' ? https : http;
    let upstream;
    const cancelled = () => upstream?.destroy();
    response.once('close', cancelled);
    try {
      if (response.destroyed || !this.server?.listening || this.closing) return;
      const result = await new Promise((resolve, reject) => {
        upstream = transport.request(target, { method: 'POST', headers, agent: false }, resolve);
        this.requests.add(upstream);
        upstream.once('error', reject);
        upstream.once('close', () => this.requests.delete(upstream));
        upstream.setTimeout(LOCAL_STREAM_IDLE_TIMEOUT_MS, () => upstream.destroy(new Error('Local model server timed out.')));
        upstream.end(data);
      });
      if (response.destroyed) { result.destroy(); return; }
      // Do not pass a redirect back to a client that might follow it elsewhere.
      if (result.statusCode >= 300 && result.statusCode < 400) {
        result.destroy();
        throw new RequestError(502, 'The local model server returned an unexpected redirect.');
      }
      if ((result.statusCode || 0) >= 500) this.onError('upstream-status', new Error(`Local model server returned HTTP ${result.statusCode}.`), { status: result.statusCode });
      const resultHeaders = headersWithoutHopByHop(result.headers);
      for (const name of Object.keys(resultHeaders)) if (name.startsWith('access-control-') || name === 'set-cookie') delete resultHeaders[name];
      const repairEvents = /^text\/event-stream(?:\s*;|$)/i.test(result.headers['content-type'] || '')
        && (!result.headers['content-encoding'] || result.headers['content-encoding'] === 'identity');
      if (repairEvents) delete resultHeaders['content-length'];
      response.writeHead(result.statusCode || 502, resultHeaders);
      if (repairEvents && adapter === 'strata') {
        await pipeline(result, new StrataStreamAdapter({ model: body.model, toolKinds: strataTools }), responseEvents(namespaceTools), response);
      } else if (repairEvents) {
        await pipeline(result, responseEvents(namespaceTools), response);
      } else {
        await pipeline(result, response);
      }
    } finally {
      response.off('close', cancelled);
      upstream?.destroy();
    }
  }

  async close() {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      await this.starting?.catch(() => {});
      const server = this.server;
      this.server = null;
      this.origin = null;
      this.routes.clear(); this.upstreams.clear(); this.adapters.clear(); this.cacheSlots.clear(); this.secret = token();
      for (const request of this.requests) request.destroy();
      for (const socket of this.sockets) socket.destroy();
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      this.requests.clear(); this.sockets.clear();
    })();
    try { await this.closing; } finally { this.closing = null; }
  }
}

module.exports = { LocalModelRelay };
