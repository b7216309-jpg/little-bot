'use strict';

const { randomBytes } = require('node:crypto');
const { Transform } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = prefix => `${prefix}_${randomBytes(12).toString('hex')}`;

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  return content.filter(object).map(part => {
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    return '';
  }).join('');
}

function chatContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  const parts = [];
  for (const part of content) {
    if (!object(part)) continue;
    if (['input_text', 'output_text', 'text'].includes(part.type) && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text });
    } else if (part.type === 'input_image' && typeof part.image_url === 'string' && part.image_url) {
      parts.push({ type: 'image_url', image_url: { url: part.image_url } });
    }
  }
  if (!parts.some(part => part.type === 'image_url')) return parts.map(part => part.text || '').join('');
  return parts;
}

function toolOutputText(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const text = output.filter(object).map(part => part.text || part.content || '').filter(Boolean).join('\n');
    return text || JSON.stringify(output);
  }
  if (object(output) && typeof output.content === 'string') return output.content;
  if (output == null) return '';
  try { return JSON.stringify(output); } catch { return String(output); }
}

function reasoningText(item) {
  const raw = Array.isArray(item.content) ? item.content.filter(object).map(part => part.text || '').join('') : '';
  if (raw) return raw;
  return Array.isArray(item.summary) ? item.summary.filter(object).map(part => part.text || '').join('') : '';
}

function responsesToChat(body, thinking) {
  if (!object(body)) throw new TypeError('Responses request must be an object.');
  const messages = [];
  const pending = { content: '', reasoning: '', tool_calls: [] };
  const hasPending = () => pending.content || pending.reasoning || pending.tool_calls.length;
  const flush = () => {
    if (!hasPending()) return;
    const message = { role: 'assistant', content: pending.content };
    if (pending.reasoning) message.reasoning_content = pending.reasoning;
    if (pending.tool_calls.length) message.tool_calls = pending.tool_calls.splice(0);
    messages.push(message);
    pending.content = ''; pending.reasoning = '';
  };

  if (typeof body.instructions === 'string' && body.instructions.trim()) {
    messages.push({ role: 'developer', content: body.instructions });
  }
  const input = Array.isArray(body.input) ? body.input : (typeof body.input === 'string'
    ? [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: body.input }] }] : []);
  for (const item of input) {
    if (!object(item)) continue;
    if (item.type === 'reasoning') {
      pending.reasoning += reasoningText(item);
      continue;
    }
    if (item.type === 'function_call') {
      pending.tool_calls.push({ id: item.call_id || item.id || id('call'), type: 'function', function: {
        name: item.name || 'tool', arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
      } });
      continue;
    }
    if (item.type === 'custom_tool_call') {
      pending.tool_calls.push({ id: item.call_id || item.id || id('call'), type: 'function', function: {
        name: item.name || 'tool', arguments: JSON.stringify({ input: typeof item.input === 'string' ? item.input : '' }),
      } });
      continue;
    }
    if (item.type === 'tool_search_call') {
      pending.tool_calls.push({ id: item.call_id || item.id || id('call'), type: 'function', function: {
        name: 'tool_search', arguments: JSON.stringify(item.arguments || {}),
      } });
      continue;
    }
    if (['function_call_output', 'custom_tool_call_output', 'tool_search_output'].includes(item.type)) {
      flush();
      const output = item.type === 'tool_search_output' ? (item.tools ?? item.output ?? item) : item.output;
      messages.push({ role: 'tool', tool_call_id: item.call_id || '', content: toolOutputText(output) });
      continue;
    }
    if (item.type === 'message') {
      const role = item.role || 'user';
      if (role === 'assistant') {
        pending.content += contentText(item.content);
      } else {
        flush();
        messages.push({ role, content: role === 'user' ? chatContent(item.content) : contentText(item.content) });
      }
    }
  }
  flush();

  const toolKinds = new Map();
  const tools = [];
  for (const tool of Array.isArray(body.tools) ? body.tools : []) {
    if (!object(tool)) continue;
    if (tool.type === 'function' && typeof tool.name === 'string' && tool.name) {
      toolKinds.set(tool.name, { type: 'function' });
      tools.push({ type: 'function', function: {
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: object(tool.parameters) ? tool.parameters : { type: 'object', properties: {} },
      } });
    } else if (tool.type === 'custom' && typeof tool.name === 'string' && tool.name) {
      toolKinds.set(tool.name, { type: 'custom' });
      tools.push({ type: 'function', function: {
        name: tool.name,
        description: `${typeof tool.description === 'string' ? tool.description : ''}\nReturn the freeform tool input in the JSON string field named input.`.trim(),
        parameters: { type: 'object', properties: { input: { type: 'string', description: 'Freeform tool input.' } }, required: ['input'], additionalProperties: false },
      } });
    } else if (tool.type === 'tool_search') {
      toolKinds.set('tool_search', { type: 'tool_search', execution: typeof tool.execution === 'string' ? tool.execution : 'client' });
      tools.push({ type: 'function', function: {
        name: 'tool_search',
        description: typeof tool.description === 'string' ? tool.description : 'Search available tools.',
        parameters: object(tool.parameters) ? tool.parameters : { type: 'object', properties: {} },
      } });
    }
  }

  const out = { model: body.model, messages, stream: true };
  if (tools.length) out.tools = tools;
  const max = [body.max_output_tokens, body.max_completion_tokens, body.max_tokens].find(value => Number.isSafeInteger(value) && value > 0);
  if (max) out.max_completion_tokens = max;
  for (const key of ['temperature', 'top_p', 'top_k', 'min_p', 'seed', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'penalty_last_n']) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  if (object(body.reasoning)) out.reasoning = { ...body.reasoning };
  out.chat_template_kwargs = { ...(object(body.chat_template_kwargs) ? body.chat_template_kwargs : {}), enable_thinking: thinking !== false };
  return { body: out, toolKinds };
}

function estimateResponsesInputTokens(body) {
  let text;
  try { text = JSON.stringify(body); } catch { text = String(body ?? ''); }
  // Conservative UTF-8 approximation for preflight/context UI. The real prompt
  // count arrives from Strata in Chat Completions usage after generation.
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 3));
}

function parseArguments(value) {
  if (object(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return object(parsed) ? parsed : { input: value };
  } catch { return { input: value }; }
}

class StrataStreamAdapter extends Transform {
  constructor({ model, toolKinds = new Map() } = {}) {
    super();
    this.model = model || 'strata';
    this.toolKinds = toolKinds;
    this.decoder = new StringDecoder('utf8');
    this.buffer = '';
    this.responseId = id('resp');
    this.messageId = id('msg');
    this.reasoningId = id('rs');
    this.created = false;
    this.messageAdded = false;
    this.reasoningAdded = false;
    this.reasoningDone = false;
    this.completed = false;
    this.text = '';
    this.reasoning = '';
    this.calls = new Map();
    this.usage = null;
  }

  _event(event) { this.push(Buffer.from(`data: ${JSON.stringify(event)}\n\n`)); }

  _created() {
    if (this.created) return;
    this.created = true;
    this._event({ type: 'response.created', response: { id: this.responseId, object: 'response', status: 'in_progress', model: this.model } });
  }

  _reasoningDelta(delta) {
    if (!delta) return;
    this._created();
    if (!this.reasoningAdded) {
      this.reasoningAdded = true;
      this._event({ type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: this.reasoningId, summary: [] } });
    }
    this.reasoning += delta;
    this._event({ type: 'response.reasoning_text.delta', item_id: this.reasoningId, output_index: 0, content_index: 0, delta });
  }

  _finishReasoning() {
    if (!this.reasoningAdded || this.reasoningDone) return;
    this.reasoningDone = true;
    const item = { type: 'reasoning', id: this.reasoningId, summary: [], encrypted_content: null };
    if (this.reasoning) item.content = [{ type: 'reasoning_text', text: this.reasoning }];
    this._event({ type: 'response.output_item.done', output_index: 0, item });
  }

  _textDelta(delta) {
    if (!delta) return;
    this._created();
    this._finishReasoning();
    if (!this.messageAdded) {
      this.messageAdded = true;
      this._event({ type: 'response.output_item.added', output_index: this.reasoningAdded ? 1 : 0,
        item: { type: 'message', id: this.messageId, role: 'assistant', content: [] } });
    }
    this.text += delta;
    this._event({ type: 'response.output_text.delta', item_id: this.messageId,
      output_index: this.reasoningAdded ? 1 : 0, content_index: 0, delta });
  }

  _toolDelta(tool) {
    const index = Number.isSafeInteger(tool?.index) ? tool.index : this.calls.size;
    let call = this.calls.get(index);
    if (!call) {
      call = { id: tool?.id || id('call'), name: '', arguments: '' };
      this.calls.set(index, call);
    }
    if (tool?.id) call.id = tool.id;
    const fn = object(tool?.function) ? tool.function : {};
    if (typeof fn.name === 'string') call.name += fn.name;
    if (typeof fn.arguments === 'string') call.arguments += fn.arguments;
  }

  _toolItem(call) {
    const kind = this.toolKinds.get(call.name) || { type: 'function' };
    if (kind.type === 'custom') {
      const args = parseArguments(call.arguments);
      return { type: 'custom_tool_call', call_id: call.id, name: call.name,
        input: typeof args.input === 'string' ? args.input : toolOutputText(args.input ?? call.arguments) };
    }
    if (kind.type === 'tool_search') {
      return { type: 'tool_search_call', call_id: call.id, execution: kind.execution || 'client', arguments: parseArguments(call.arguments) };
    }
    return { type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments || '{}' };
  }

  _complete() {
    if (this.completed) return;
    this.completed = true;
    this._created();
    this._finishReasoning();
    const output = [];
    let outputIndex = 0;
    if (this.reasoningAdded) {
      const r = { type: 'reasoning', id: this.reasoningId, summary: [], encrypted_content: null };
      if (this.reasoning) r.content = [{ type: 'reasoning_text', text: this.reasoning }];
      output.push(r); outputIndex += 1;
    }
    if (this.messageAdded || this.text) {
      const item = { type: 'message', id: this.messageId, role: 'assistant', content: [{ type: 'output_text', text: this.text }] };
      if (!this.messageAdded) {
        this.messageAdded = true;
        this._event({ type: 'response.output_item.added', output_index: outputIndex, item: { ...item, content: [] } });
      }
      this._event({ type: 'response.output_item.done', output_index: outputIndex, item });
      output.push(item); outputIndex += 1;
    }
    for (const index of [...this.calls.keys()].sort((a, b) => a - b)) {
      const item = this._toolItem(this.calls.get(index));
      this._event({ type: 'response.output_item.done', output_index: outputIndex++, item });
      output.push(item);
    }
    const inputTokens = Number(this.usage?.prompt_tokens) || 0;
    const outputTokens = Number(this.usage?.completion_tokens) || 0;
    this._event({ type: 'response.completed', response: {
      id: this.responseId, object: 'response', status: 'completed', model: this.model, output,
      usage: { input_tokens: inputTokens, input_tokens_details: null, output_tokens: outputTokens,
        output_tokens_details: null, total_tokens: Number(this.usage?.total_tokens) || inputTokens + outputTokens },
    } });
  }

  _line(line) {
    if (!line) return;
    if (line.startsWith(':')) { this.push(Buffer.from(`${line}\n\n`)); return; }
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') { if (payload === '[DONE]') this._complete(); return; }
    let chunk;
    try { chunk = JSON.parse(payload); } catch { return; }
    if (chunk?.error) {
      this._created();
      this._event({ type: 'response.failed', response: { id: this.responseId, object: 'response', status: 'failed',
        error: { code: chunk.error.type || 'server_error', message: chunk.error.message || 'Strata generation failed.' } } });
      this.completed = true;
      return;
    }
    const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : null;
    if (!choice) return;
    this.model = chunk.model || this.model;
    const delta = object(choice.delta) ? choice.delta : {};
    if (typeof delta.reasoning_content === 'string') this._reasoningDelta(delta.reasoning_content);
    if (typeof delta.content === 'string') this._textDelta(delta.content);
    for (const tool of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) this._toolDelta(tool);
    if (object(chunk.usage)) this.usage = chunk.usage;
    if (choice.finish_reason != null) this._complete();
  }

  _transform(chunk, encoding, callback) {
    this.buffer += this.decoder.write(chunk);
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this._line(line);
    }
    callback();
  }

  _flush(callback) {
    this.buffer += this.decoder.end();
    if (this.buffer) this._line(this.buffer.replace(/\r$/, ''));
    callback();
  }
}

module.exports = { StrataStreamAdapter, estimateResponsesInputTokens, responsesToChat };
