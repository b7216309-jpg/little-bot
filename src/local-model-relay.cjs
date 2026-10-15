'use strict';

const http = require('node:http');
const https = require('node:https');
const { createHash, randomBytes } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { localBaseUrl, LOCAL_STREAM_IDLE_TIMEOUT_MS } = require('./connections.cjs');
const { applyQwenGeneration, applySampling } = require('./local-generation.cjs');
const { prepareNamespaceTools, restoreNamespaceCalls } = require('./responses-namespace-compat.cjs');
const { StrataStreamAdapter, estimateResponsesInputTokens, responsesToChat, withoutImages, hasImages, stableJson } = require('./strata-responses-adapter.cjs');

const messagesHash = messages => createHash('sha1').update(stableJson(messages)).digest('hex');

// A 50 MiB attachment turn can exceed 64 MiB after base64 encoding.
const MAX_BODY_BYTES = 96 * 1024 * 1024;
const KEEPALIVE_INTERVAL_MS = 15000;
const CONNECT_RETRY_DELAYS_MS = [100, 250, 500, 750];
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

// Asks Strata's /health whether this server loaded its vision encoder. The answer
// is read per request, so swapping models or restarting the server is picked up.
// null means unknown; images are then sent as before.
function strataImages(base) {
  const target = new URL('/health', base);
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise(resolve => {
    const request = transport.get(target, { agent: false, timeout: 3000 }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { if (raw.length < 65536) raw += chunk; });
      response.on('end', () => {
        try { const images = JSON.parse(raw)?.images; resolve(typeof images === 'boolean' ? images : null); } catch { resolve(null); }
      });
      response.on('error', () => resolve(null));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

function replyError(response, status, message) {
  if (response.destroyed) return;
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' });
  response.end(JSON.stringify({ error: { message, type: 'local_model_error', code: status } }));
}

function streamAdapted(result, adapter, namespaceTools, response) {
  const events = responseEvents(namespaceTools);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      response.off('finish', onFinish);
      response.off('close', onClose);
      response.off('error', onResponseError);
      adapter.off('error', onAdapterError);
      events.off('error', onAdapterError);
      if (error) { adapter.unpipe(events); events.unpipe(response); }
      if (error) reject(error); else resolve();
    };
    const onFinish = () => finish();
    const onClose = () => finish(response.writableFinished ? null : Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }));
    const onResponseError = error => finish(error);
    const onAdapterError = error => finish(error);
    const onResultError = error => {
      if (adapter.degenerate && adapter.completed) return;
      result.unpipe(adapter);
      finish(error);
    };
    response.once('finish', onFinish);
    response.once('close', onClose);
    response.once('error', onResponseError);
    adapter.once('error', onAdapterError);
    events.once('error', onAdapterError);
    result.on('error', onResultError);
    result.once('close', () => result.off('error', onResultError));
    adapter.pipe(events);
    events.pipe(response);
    result.pipe(adapter);
  });
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
  constructor({ thinking = () => true, sampling = () => ({}), onError = () => {}, onToolRepair = () => {} } = {}) {
    if (typeof thinking !== 'function') throw new TypeError('thinking must be a function.');
    if (typeof sampling !== 'function') throw new TypeError('sampling must be a function.');
    this.sampling = sampling;
    if (typeof onError !== 'function') throw new TypeError('onError must be a function.');
    if (typeof onToolRepair !== 'function') throw new TypeError('onToolRepair must be a function.');
    this.thinking = thinking;
    this.onError = onError;
    this.onToolRepair = onToolRepair;
    this.server = null;
    this.starting = null;
    this.closing = null;
    this.origin = null;
    this.secret = token();
    this.routes = new Map();
    this.upstreams = new Map();
    this.adapters = new Map();
    this.textCallHistory = new Map();
    this.toolBlocks = [];
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
        if (request.aborted || response.destroyed) return;
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

  endpoint(baseUrl, adapter = null) {
    if (!this.server?.listening || this.closing) throw new Error('The local model connection is not ready.');
    const base = localBaseUrl(baseUrl);
    const mode = adapter === 'strata' ? 'strata' : 'responses';
    const key = `${mode}\0${base}`;
    let route = this.upstreams.get(key);
    if (!route) {
      route = token();
      this.upstreams.set(key, route);
      this.routes.set(route, base);
      this.adapters.set(route, mode === 'strata' ? 'strata' : null);
    }
    return `${this.origin}/${this.secret}/${route}/v1`;
  }

  async _handle(request, response) {
    let cancelled = false, upstream, upstreamResponse, heartbeat, streamStarted = false, strataAdapter = null;
    const stopHeartbeat = () => { if (heartbeat) clearInterval(heartbeat); heartbeat = null; };
    const cancelUpstream = () => {
      cancelled = true;
      stopHeartbeat();
      upstream?.destroy();
      upstreamResponse?.destroy();
    };
    const requestAborted = () => cancelUpstream();
    const responseClosed = () => { if (!response.writableFinished) cancelUpstream(); };
    request.once('aborted', requestAborted);
    response.once('close', responseClosed);
    response.once('finish', stopHeartbeat);
    try {
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
      let upstreamPath = match[3], strataTools = null, noToolCalls = false;
      if (adapter === 'strata') {
        const translated = responsesToChat(body, thinking, this.textCallHistory);
        body = translated.body;
        applySampling(body, this.sampling());
        if (hasImages(body.messages) && await strataImages(base) === false) {
          const removed = withoutImages(body.messages);
          this.onError('images-omitted', new Error(`Removed ${removed} image(s): the local server has no vision encoder.`), { removed });
        }
        // Official Strata matches complete token/image prefixes automatically.
        // Slot metadata belongs to the retired PR #175 server protocol.
        strataTools = translated.toolKinds;
        // Qwen's template renders the tool block at the very top of the prompt. A tool-less follow-up in the
        // same conversation (the engine's compaction request) would lose Strata's whole cache without it
        // (live: 0 of 55k tokens reused, 49 s, versus 99.8% and 13 s). Keep the block and drop any call here:
        // Strata 0.1.40+ answers tool_choice "none" by leaving the tools out, which changes the prompt again.
        if (Array.isArray(body.tools) && body.tools.length) {
          this.toolBlocks.push({ count: body.messages.length, hash: messagesHash(body.messages), tools: body.tools });
          if (this.toolBlocks.length > 16) this.toolBlocks.shift();
        } else if (!body.response_format) {
          // Only a request that extends a recent tool request byte for byte: the same conversation, continued.
          const extended = [...this.toolBlocks].reverse().find(block => block.count <= body.messages.length
            && messagesHash(body.messages.slice(0, block.count)) === block.hash);
          if (extended) { body.tools = extended.tools; noToolCalls = true; }
        }
        upstreamPath = 'chat/completions';
      } else if (match[3] === 'responses') {
        applyQwenGeneration(body, thinking);
      }
      const data = Buffer.from(stableJson(body));
      const headers = headersWithoutHopByHop(request.headers);
      for (const name of ['host', 'content-length', 'content-encoding', 'origin', 'referer', 'cookie', 'authorization', 'expect']) delete headers[name];
      headers['content-length'] = String(data.length);
      headers['accept-encoding'] = 'identity';
      const target = new URL(`${base}/${upstreamPath}`);
      const transport = target.protocol === 'https:' ? https : http;
      if (adapter === 'strata' && match[3] === 'responses') {
        strataAdapter = new StrataStreamAdapter({ model: body.model, toolKinds: strataTools, noToolCalls, textCallHistory: this.textCallHistory, onToolRepair: this.onToolRepair, onDegenerate: () => {
          if (!upstreamResponse || !strataAdapter?.completed) return;
          upstreamResponse.unpipe(strataAdapter);
          upstreamResponse.on('error', () => {});
          upstreamResponse.destroy();
          if (!strataAdapter.writableEnded) strataAdapter.end();
        } });
      }
      const beginResponseStream = () => {
        if (!strataAdapter || streamStarted || cancelled || response.destroyed) return;
        streamStarted = true;
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        response.write(strataAdapter.start());
        heartbeat = setInterval(() => { if (!response.destroyed && !response.writableEnded) response.write(': keep-alive\n\n'); }, KEEPALIVE_INTERVAL_MS);
        heartbeat.unref?.();
      };
      try {
        if (cancelled || response.destroyed || !this.server?.listening || this.closing) return;
        let retries = 0;
        for (;;) {
          try {
            upstreamResponse = await new Promise((resolve, reject) => {
              upstream = transport.request(target, { method: 'POST', headers, agent: false }, resolve);
              this.requests.add(upstream);
              upstream.once('error', reject);
              upstream.once('close', () => this.requests.delete(upstream));
              if (strataAdapter) upstream.once('socket', socket => {
                const event = target.protocol === 'https:' ? 'secureConnect' : 'connect';
                if (socket.connecting) socket.once(event, beginResponseStream);
                else setImmediate(beginResponseStream);
              });
              upstream.setTimeout(LOCAL_STREAM_IDLE_TIMEOUT_MS, () => {
                const error = Object.assign(new Error('Local model server timed out.'), { code: 'ETIMEDOUT' });
                upstream.destroy(error);
              });
              upstream.end(data);
            });
            break;
          } catch (error) {
            if (cancelled || response.destroyed) return;
            if (error.code !== 'ECONNREFUSED' || retries >= CONNECT_RETRY_DELAYS_MS.length) throw error;
            await new Promise(resolve => setTimeout(resolve, CONNECT_RETRY_DELAYS_MS[retries++]));
            if (cancelled || response.destroyed || !this.server?.listening || this.closing) return;
          }
        }
        if (cancelled || response.destroyed) { upstreamResponse.destroy(); return; }
        // Do not pass a redirect back to a client that might follow it elsewhere.
        if (strataAdapter) {
          beginResponseStream();
          const status = upstreamResponse.statusCode || 502;
          if (status >= 300 && status < 400) {
            upstreamResponse.destroy();
            response.end(strataAdapter.failure('The local model server returned an unexpected redirect.', 'upstream_redirect'));
            return;
          }
          if (status >= 400) {
            if (status >= 500) this.onError('upstream-status', new Error(`Local model server returned HTTP ${status}.`), { status });
            upstreamResponse.resume();
            response.end(strataAdapter.failure(`The local model server returned HTTP ${status}.`, 'upstream_status'));
            return;
          }
          if (!/^text\/event-stream(?:\s*;|$)/i.test(upstreamResponse.headers['content-type'] || '')) {
            upstreamResponse.resume();
            response.end(strataAdapter.failure('The local model server returned an invalid streaming response.', 'invalid_upstream_response'));
            return;
          }
          try { await streamAdapted(upstreamResponse, strataAdapter, namespaceTools, response); }
          catch (error) {
            if (cancelled || request.aborted || response.destroyed) return;
            this.onError('request', error, { method: request.method, status: 502 });
            if (!response.destroyed && !response.writableEnded) {
              response.end(strataAdapter.failure('The local model stream ended unexpectedly.', 'upstream_stream_error'));
            }
          }
          return;
        }
        if ((upstreamResponse.statusCode || 0) >= 500) this.onError('upstream-status', new Error(`Local model server returned HTTP ${upstreamResponse.statusCode}.`), { status: upstreamResponse.statusCode });
        const resultHeaders = headersWithoutHopByHop(upstreamResponse.headers);
        for (const name of Object.keys(resultHeaders)) if (name.startsWith('access-control-') || name === 'set-cookie') delete resultHeaders[name];
        const repairEvents = /^text\/event-stream(?:\s*;|$)/i.test(upstreamResponse.headers['content-type'] || '')
          && (!upstreamResponse.headers['content-encoding'] || upstreamResponse.headers['content-encoding'] === 'identity');
        if (repairEvents) delete resultHeaders['content-length'];
        response.writeHead(upstreamResponse.statusCode || 502, resultHeaders);
        if (repairEvents) {
          await pipeline(upstreamResponse, responseEvents(namespaceTools), response);
        } else {
          await pipeline(upstreamResponse, response);
        }
      } catch (error) {
        if (cancelled || request.aborted || response.destroyed) return;
        const status = error instanceof RequestError ? error.status : 502;
        if (!(error instanceof RequestError) || status >= 500) this.onError('request', error, { method: request.method, status });
        if (strataAdapter && streamStarted && !response.writableEnded) {
          response.end(strataAdapter.failure('Could not reach the local model server.', 'upstream_unavailable'));
        } else {
          replyError(response, status, error instanceof RequestError ? error.message : 'Could not reach the local model server.');
        }
      }
    } finally {
      stopHeartbeat();
      request.off('aborted', requestAborted);
      response.off('close', responseClosed);
      response.off('finish', stopHeartbeat);
      upstream?.destroy();
      upstreamResponse?.destroy();
    }
  }

  async close() {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      await this.starting?.catch(() => {});
      const server = this.server;
      this.server = null;
      this.origin = null;
      this.routes.clear(); this.upstreams.clear(); this.adapters.clear(); this.secret = token();
      for (const request of this.requests) request.destroy();
      for (const socket of this.sockets) socket.destroy();
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      this.textCallHistory = new Map();
      this.toolBlocks = [];
      this.requests.clear(); this.sockets.clear();
    })();
    try { await this.closing; } finally { this.closing = null; }
  }
}

module.exports = { LocalModelRelay };
