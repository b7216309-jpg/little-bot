'use strict';

// Streams one Chat Completions request from the local model server (Strata, or any OpenAI-compatible server).
// Strata parses Qwen's tool calls itself and streams reasoning separately, so this only assembles the stream.

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ERROR_BODY_BYTES = 8192;

class ModelError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

// A model stuck in a loop repeats the same short run of text. Cut it at the second copy.
function repeatedSuffix(value) {
  const max = Math.min(32, Math.floor(value.length / 4));
  for (let size = max; size >= 8; size--) {
    const part = value.slice(-size);
    if (new Set(part.replace(/\s/g, '')).size < 4) continue; // banners, zero arrays and table rules repeat legitimately
    let count = 1, end = value.length - size;
    while (end >= size && value.slice(end - size, end) === part) { count++; end -= size; }
    if (count >= 4 && count * size >= 96) return { keep: end + size * 2 };
  }
  return null;
}

// Object keys are sorted so an unchanged conversation produces the same request bytes, which keeps the server's
// prompt cache matching. Arrays keep their order.
function stableJson(value) {
  const visit = item => {
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(item[key])]));
    return item;
  };
  return JSON.stringify(visit(value));
}

async function errorMessage(response) {
  let text = '';
  try {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    while (reader && text.length < ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    reader?.cancel().catch(() => {});
  } catch { /* The status alone still explains the failure. */ }
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message || parsed?.error || parsed?.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch { /* Not JSON. */ }
  return text.trim().slice(0, 500) || `The local model returned HTTP ${response.status}.`;
}

/**
 * Sends `body` with stream: true and calls the handlers as the answer arrives.
 * Resolves to { content, reasoning, toolCalls: [{ id, name, arguments }], finishReason, usage, firstByteAt }.
 */
async function streamChat({ baseUrl, body, signal, onReasoning = () => {}, onContent = () => {}, onFirstByte = () => {}, fetchImpl = fetch }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let idle;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new ModelError('The local model stopped sending for 30 minutes.')), IDLE_TIMEOUT_MS);
    idle.unref?.();
  };
  touch();
  const result = { content: '', reasoning: '', toolCalls: [], finishReason: null, usage: null, firstByteAt: null };
  const calls = new Map();
  try {
    let response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: stableJson({ ...body, stream: true }),
      });
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new ModelError('The model request was stopped.', { code: 'aborted' });
      throw new ModelError(`The local model is not reachable: ${error.cause?.message || error.message}`, { code: 'unreachable' });
    }
    if (!response.ok) {
      const message = await errorMessage(response);
      const overflow = response.status === 400 && /context|too long|exceed|maximum.*tokens|prompt.*tokens/i.test(message);
      throw new ModelError(message, { status: response.status, code: overflow ? 'context_length_exceeded' : null });
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', done = false, degenerate = false;
    const handle = data => {
      if (data === '[DONE]') { done = true; return; }
      let chunk;
      try { chunk = JSON.parse(data); } catch { return; }
      if (chunk?.error) throw new ModelError(chunk.error.message || String(chunk.error));
      if (chunk.usage) result.usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return;
      const delta = choice.delta || {};
      if (!result.firstByteAt && (delta.content || delta.reasoning_content || delta.tool_calls)) { result.firstByteAt = Date.now(); onFirstByte(); }
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        result.reasoning += delta.reasoning_content;
        onReasoning(delta.reasoning_content);
      }
      if (typeof delta.content === 'string' && delta.content && !degenerate) {
        const before = result.content.length;
        result.content += delta.content;
        const repeated = repeatedSuffix(result.content);
        if (repeated) { result.content = result.content.slice(0, repeated.keep); degenerate = true; }
        if (result.content.length > before) onContent(result.content.slice(before));
      }
      for (const part of delta.tool_calls || []) {
        const index = Number.isInteger(part.index) ? part.index : calls.size;
        const call = calls.get(index) || { id: '', name: '', arguments: '' };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (typeof part.function?.arguments === 'string') call.arguments += part.function.arguments;
        calls.set(index, call);
      }
      if (choice.finish_reason) result.finishReason = choice.finish_reason;
    };
    while (!done && !degenerate) {
      const { done: ended, value } = await reader.read();
      if (ended) break;
      touch();
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) handle(line.slice(5).trim());
        if (done || degenerate) break;
      }
    }
    if (degenerate) { result.finishReason = 'stop'; reader.cancel().catch(() => {}); controller.abort(); }
    result.toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call).filter(call => call.name);
    if (result.finishReason === 'length' && !result.content && !result.toolCalls.length) throw new ModelError('The model reached its output limit before answering.', { code: 'max_output' });
    if (!result.content.trim() && !result.toolCalls.length && !result.reasoning.trim() && !degenerate) throw new ModelError('The model returned an empty answer.');
    return result;
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof ModelError)) {
      const reason = controller.signal.reason;
      throw reason instanceof Error ? reason : new ModelError('The model request was stopped.', { code: 'aborted' });
    }
    throw error;
  } finally {
    clearTimeout(idle);
    signal?.removeEventListener('abort', abort);
  }
}

module.exports = { streamChat, stableJson, repeatedSuffix, ModelError };
