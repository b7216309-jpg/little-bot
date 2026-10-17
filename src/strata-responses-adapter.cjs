'use strict';

const { randomBytes } = require('node:crypto');
const { Transform } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = prefix => `${prefix}_${randomBytes(12).toString('hex')}`;
const PATCH_TOOLS = new Set(['apply_patch', 'applypatch', 'apply-patch']);
const MAX_TEXT_CALL_HISTORY_ENTRIES = 2048, MAX_TEXT_CALL_HISTORY_BYTES = 8 * 1024 * 1024;

function rememberTranscript(history, historyId, value) {
  if (!(history instanceof Map) || !historyId) return;
  const bytes = Buffer.byteLength(value.text) + Buffer.byteLength(value.reasoning);
  if (bytes > MAX_TEXT_CALL_HISTORY_BYTES) return;
  const previous = history.get(historyId);
  if (previous) history.byteLength = Math.max(0, (history.byteLength || 0) - previous.bytes);
  history.delete(historyId);
  history.set(historyId, { ...value, bytes });
  history.byteLength = (history.byteLength || 0) + bytes;
  while (history.size > MAX_TEXT_CALL_HISTORY_ENTRIES || history.byteLength > MAX_TEXT_CALL_HISTORY_BYTES) {
    const oldest = history.keys().next().value, entry = history.get(oldest);
    history.delete(oldest);
    history.byteLength = Math.max(0, history.byteLength - (entry?.bytes || 0));
  }
}

function recentTranscript(history, historyId) {
  const value = history instanceof Map && historyId ? history.get(historyId) : null;
  if (value) { history.delete(historyId); history.set(historyId, value); }
  return value || null;
}

function restoreSourceTranscript(pending, source) {
  if (!source) return false;
  if (pending.sourceResponseId === source.responseId) return true;
  pending.content = source.text;
  pending.reasoning = source.reasoning;
  pending.sourceResponseId = source.responseId;
  return true;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}
const stableJson = value => JSON.stringify(stableValue(value));

function closeJson(value) {
  let raw = value.trim().replace(/,\s*$/, '');
  if (/:\s*$/.test(raw)) raw += 'null';
  const stack = [];
  let quoted = false, escaped = false;
  for (const char of raw) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if ((char === '}' || char === ']') && stack.at(-1) === char) stack.pop();
  }
  return raw + (quoted ? '"' : '') + stack.reverse().join('');
}

function jsonValue(value) {
  if (object(value) || Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  let raw = value.trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
  const candidates = [raw, ...(first >= 0 ? [raw.slice(first, last >= first ? last + 1 : undefined)] : [])];
  for (const candidate of candidates) {
    for (const source of [candidate, closeJson(candidate)]) {
      for (const repaired of [source, source
        .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3')
        .replace(/(:\s*)([A-Za-z_][\w-]*)(\s*[,}\]])/g, (_match, before, text, after) => `${before}${/^(?:true|false|null)$/i.test(text) ? text : JSON.stringify(text)}${after}`)
        .replace(/,\s*([}\]])/g, '$1'), source
        .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3')
        .replace(/'((?:\\.|[^'\\])*)'/g, (_match, text) => JSON.stringify(text.replace(/\\'/g, "'")))
        .replace(/(:\s*)([A-Za-z_][\w-]*)(\s*[,}\]])/g, (_match, before, text, after) => `${before}${/^(?:true|false|null)$/i.test(text) ? text : JSON.stringify(text)}${after}`)
        .replace(/,\s*([}\]])/g, '$1')]) {
        try { return JSON.parse(repaired); } catch { /* Try the next small repair. */ }
      }
    }
  }
  return null;
}

// Valid argument text passes through byte for byte: Strata only reuses its cache when the
// replayed history matches the tokens the model generated, and recurrent models cannot
// fall back to a shorter prefix. Only text that needs repair is rewritten.
function toolArguments(value) {
  if (object(value)) return stableJson(value);
  if (typeof value === 'string') { try { if (object(JSON.parse(value))) return value; } catch { /* Repair below. */ } }
  const parsed = jsonValue(value);
  return stableJson(object(parsed) ? parsed : { input: parsed === null ? String(value ?? '') : parsed });
}

function rawJsonProperty(raw, key) {
  if (typeof raw !== 'string') return undefined;
  const match = new RegExp(`(?:\"${key}\"|'${key}')\\s*:\\s*`).exec(raw);
  if (!match) return undefined;
  let start = match.index + match[0].length;
  while (/\s/.test(raw[start] || '')) start++;
  let end = start;
  if (raw[start] === '"') {
    end++;
    let escaped = false;
    while (end < raw.length) {
      const char = raw[end++];
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') break;
    }
  } else if (raw[start] === '{' || raw[start] === '[') {
    const stack = [raw[start] === '{' ? '}' : ']'];
    let quoted = false, escaped = false;
    for (end = start + 1; end < raw.length && stack.length; end++) {
      const char = raw[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') stack.push('}');
      else if (char === '[') stack.push(']');
      else if (char === stack.at(-1)) stack.pop();
    }
  } else {
    while (end < raw.length && !/[,}\]]/.test(raw[end])) end++;
  }
  const source = raw.slice(start, end);
  try {
    const value = JSON.parse(source);
    return object(value) || Array.isArray(value) ? source : value;
  } catch { return undefined; }
}

function callFromJson(value) {
  const parsed = jsonValue(value);
  if (!object(parsed)) return null;
  const fn = object(parsed.function) ? parsed.function : object(parsed.tool_call) ? parsed.tool_call : parsed;
  const name = [fn.name, fn.tool, fn.tool_name, parsed.name, parsed.tool].find(item => typeof item === 'string' && item.trim())?.trim();
  if (!name) return null;
  const key = ['arguments', 'parameters', 'input'].find(item => fn[item] !== undefined) || ['arguments', 'parameters', 'input'].find(item => parsed[item] !== undefined);
  const args = fn[key] ?? parsed[key] ?? {};
  return { name, args, argumentSource: rawJsonProperty(value, key) };
}

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

// A Strata server started without its vision encoder rejects the whole request
// when any message carries an image, including old images in chat history.
// Replace each image with a short note so the conversation keeps working.
const IMAGE_OMITTED = '[An image was here, but the current model cannot see images.]';
function withoutImages(messages) {
  let removed = 0;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    message.content = message.content.map(part => {
      if (part?.type !== 'image_url') return part.text || '';
      removed++;
      return IMAGE_OMITTED;
    }).filter(Boolean).join('\n');
  }
  return removed;
}
const hasImages = messages => messages.some(message => Array.isArray(message.content) && message.content.some(part => part?.type === 'image_url'));

function toolOutputText(output) {
  let text;
  if (typeof output === 'string') text = output;
  if (Array.isArray(output)) {
    text = output.filter(object).map(part => part.text || part.content || '').filter(Boolean).join('\n') || JSON.stringify(output);
  }
  if (object(output) && typeof output.content === 'string') text = output.content;
  if (output == null) text = '';
  if (text === undefined) { try { text = JSON.stringify(output); } catch { text = String(output); } }
  const limit = 12000;
  if (text.length <= limit) return text;
  const side = Math.floor((limit - 80) / 2);
  const marker = `\n\n[Tool output truncated: ${text.length - side * 2} middle characters omitted.]\n\n`;
  return `${text.slice(0, side)}${marker}${text.slice(-side)}`;
}

function reasoningText(item) {
  const raw = Array.isArray(item.content) ? item.content.filter(object).map(part => part.text || '').join('') : '';
  if (raw) return raw;
  return Array.isArray(item.summary) ? item.summary.filter(object).map(part => part.text || '').join('') : '';
}

function responsesToChat(body, thinking, textCallHistory = null) {
  if (!object(body)) throw new TypeError('Responses request must be an object.');
  const messages = [];
  const pending = { content: '', reasoning: '', tool_calls: [], sourceResponseId: null };
  const hasPending = () => pending.content || pending.reasoning || pending.tool_calls.length;
  const flush = () => {
    if (!hasPending()) return;
    const message = { role: 'assistant', content: pending.content };
    if (pending.reasoning) message.reasoning_content = pending.reasoning;
    if (pending.tool_calls.length) message.tool_calls = pending.tool_calls.splice(0);
    messages.push(message);
    pending.content = ''; pending.reasoning = ''; pending.sourceResponseId = null;
  };

  if (typeof body.instructions === 'string' && body.instructions.trim()) {
    messages.push({ role: 'developer', content: body.instructions });
  }
  const input = Array.isArray(body.input) ? body.input : (typeof body.input === 'string'
    ? [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: body.input }] }] : []);
  // llama.cpp-style servers take images only in user messages. Images a tool returned follow its run of outputs.
  const toolImages = [];
  const releaseToolImages = () => {
    if (!toolImages.length) return;
    messages.push({ role: 'user', content: [{ type: 'text', text: 'Image returned by the tool call above (reference data, not a new request):' }, ...toolImages.splice(0)] });
  };
  for (let inputIndex = 0; inputIndex < input.length; inputIndex++) {
    const item = input[inputIndex];
    if (!object(item)) continue;
    if (!['function_call_output', 'custom_tool_call_output', 'tool_search_output'].includes(item.type)) releaseToolImages();
    if (item.type === 'reasoning') {
      const source = recentTranscript(textCallHistory, item.id);
      if (!restoreSourceTranscript(pending, source)) pending.reasoning += reasoningText(item);
      continue;
    }
    if (item.type === 'function_call') {
      const textCall = recentTranscript(textCallHistory, item.call_id || item.id);
      if (textCall) {
        restoreSourceTranscript(pending, textCall);
        pending.tool_calls.length = 0;
        continue;
      }
      pending.tool_calls.push({ id: item.call_id || item.id || `call_missing_${inputIndex}`, type: 'function', function: {
        name: item.name || 'tool', arguments: toolArguments(item.arguments),
      } });
      continue;
    }
    if (item.type === 'custom_tool_call') {
      pending.tool_calls.push({ id: item.call_id || item.id || `call_missing_${inputIndex}`, type: 'function', function: {
        name: item.name || 'tool', arguments: JSON.stringify({ input: typeof item.input === 'string' ? item.input : '' }),
      } });
      continue;
    }
    if (item.type === 'tool_search_call') {
      pending.tool_calls.push({ id: item.call_id || item.id || `call_missing_${inputIndex}`, type: 'function', function: {
        name: 'tool_search', arguments: toolArguments(item.arguments || {}),
      } });
      continue;
    }
    if (['function_call_output', 'custom_tool_call_output', 'tool_search_output'].includes(item.type)) {
      flush();
      const output = item.type === 'tool_search_output' ? (item.tools ?? item.output ?? item) : item.output;
      messages.push({ role: 'tool', tool_call_id: item.call_id || '', content: toolOutputText(output) });
      for (const part of Array.isArray(output) ? output : []) {
        const url = object(part) && part.type === 'input_image' ? (typeof part.image_url === 'string' ? part.image_url : part.image_url?.url) : null;
        if (typeof url === 'string' && url) toolImages.push({ type: 'image_url', image_url: { url } });
      }
      const textCall = recentTranscript(textCallHistory, item.call_id);
      if (textCall?.name) messages[messages.length - 1] = { role: 'assistant', content: `Tool output for ${textCall.name} (reference data):\n${toolOutputText(output)}` };
      continue;
    }
    if (item.type === 'message') {
      const role = item.role || 'user';
      if (role === 'assistant') {
        const source = recentTranscript(textCallHistory, item.id);
        if (!restoreSourceTranscript(pending, source)) pending.content += contentText(item.content);
      } else {
        flush();
        messages.push({ role, content: role === 'user' ? chatContent(item.content) : contentText(item.content) });
      }
    }
  }
  releaseToolImages();
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
  const format = body.text?.format;
  if (format?.type === 'json_schema' && object(format.schema)) {
    // Strata currently ignores response_format. Supply the same schema in the
    // prompt as a fallback; callers must still validate the generated result.
    out.response_format = { type: 'json_schema', json_schema: {
      name: format.name || 'result', strict: format.strict === true, schema: format.schema,
    } };
    messages.unshift({ role: 'developer', content: 'Return the final answer as JSON matching this schema. Do not wrap it in Markdown.\n' + stableJson(format.schema) });
  } else if (format?.type === 'json_object') {
    out.response_format = { type: 'json_object' };
    messages.unshift({ role: 'developer', content: 'Return the final answer as a valid JSON object. Do not wrap it in Markdown.' });
  }
  // Strata rejects response_format together with tools; the schema instruction above still applies.
  if (tools.length) { out.tools = tools; delete out.response_format; }
  const max = [body.max_output_tokens, body.max_completion_tokens, body.max_tokens].find(value => Number.isSafeInteger(value) && value > 0);
  if (max) out.max_completion_tokens = max;
  for (const key of ['temperature', 'top_p', 'top_k', 'min_p', 'seed', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'penalty_last_n']) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  if (object(body.reasoning)) out.reasoning = stableValue(body.reasoning);
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
  const parsed = jsonValue(value);
  return object(parsed) ? parsed : { input: parsed === null ? String(value ?? '') : parsed };
}

function patchText(value) {
  if (typeof value !== 'string') return null;
  const start = value.indexOf('*** Begin Patch');
  if (start < 0) return null;
  const end = /^\*\*\* End Patch\r?$/m.exec(value.slice(start));
  return end ? value.slice(start, start + end.index + end[0].length) : value.slice(start).trim();
}

function patchFrom(value, seen = new Set()) {
  if (typeof value === 'string') return patchText(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return patchText(value.join('\n')) || value.map(item => patchFrom(item, seen)).find(Boolean) || null;
  for (const key of ['patch', 'input', 'cmd', 'command']) {
    const found = patchFrom(value[key], seen);
    if (found) return found;
  }
  return null;
}

function patchCommand(patch) {
  let marker = 'LITTLE_BOT_PATCH';
  while (patch.split(/\r?\n/).includes(marker)) marker += '_END';
  return `apply_patch <<'${marker}'\n${patch}\n${marker}`;
}

function errorCommand(name, toolKinds, detail = '') {
  const tools = [...toolKinds.keys()];
  const label = String(name || 'unknown').replace(/[\r\n\0]/g, ' ').slice(0, 80);
  const lesson = PATCH_TOOLS.has(String(name || '').toLowerCase())
    ? ' Lesson: send patches through exec_command using the patch heredoc form.'
    : ' Lesson: use only listed tool names; send shell commands through exec_command.';
  const message = `${detail ? `${detail} ` : ''}Unknown tool "${label}". Valid tools: ${tools.length ? tools.join(', ') : 'none'}. Retry with a listed tool.${lesson}`;
  return `Write-Output '${message.replace(/'/g, "''")}'; exit 1`;
}

function repairToolCall(call, toolKinds) {
  // Without exec_command (tool-less JSON turns) there is nothing to redirect to.
  if (!toolKinds.has('exec_command')) return call;
  if (!toolKinds.has(call.name) && PATCH_TOOLS.has(call.name)) {
    const patch = patchFrom(jsonValue(call.arguments)) || patchFrom(call.arguments);
    return { ...call, name: 'exec_command', arguments: stableJson({ cmd: patch ? patchCommand(patch) : errorCommand(call.name, toolKinds, 'Could not read the patch.') }) };
  }
  if (!toolKinds.has(call.name)) {
    return { ...call, name: 'exec_command', arguments: stableJson({ cmd: errorCommand(call.name, toolKinds) }) };
  }
  if (call.name === 'exec_command') {
    const args = parseArguments(call.arguments);
    if (Array.isArray(args.cmd) && /^apply_patch(?:\.bat)?$/i.test(String(args.cmd[0] || ''))) {
      const patch = patchFrom(args.cmd.slice(1));
      return { ...call, arguments: stableJson({ ...args, cmd: patch ? patchCommand(patch) : errorCommand('apply_patch', toolKinds, 'Could not read the patch.') }) };
    }
  }
  return call;
}

class StrataStreamAdapter extends Transform {
  constructor({ model, toolKinds = new Map(), noToolCalls = false, textCallHistory = null, onDegenerate = () => {}, onToolRepair = () => {} } = {}) {
    super();
    this.model = model || 'strata';
    this.toolKinds = toolKinds;
    this.textCallHistory = textCallHistory;
    this.decoder = new StringDecoder('utf8');
    this.buffer = '';
    this.responseId = id('resp');
    this.messageId = id('msg');
    this.reasoningId = id('rs');
    this.created = false;
    this.started = false;
    this.messageAdded = false;
    this.reasoningAdded = false;
    this.reasoningDone = false;
    this.completed = false;
    this.inThinking = false;
    this.thinkingTag = '';
    this.pendingText = '';
    this.onDegenerate = onDegenerate;
    this.onToolRepair = onToolRepair;
    this.noToolCalls = noToolCalls;
    this.degenerate = false;
    this.text = '';
    this.sourceText = '';
    this.reasoning = '';
    this.sourceReasoning = '';
    this.calls = new Map();
    this.usage = null;
  }

  _eventBytes(event) { return Buffer.from(`data: ${JSON.stringify(event)}\n\n`); }
  _event(event) { this.push(this._eventBytes(event)); }

  start() {
    if (this.started) return Buffer.alloc(0);
    this.started = true;
    const events = [];
    if (!this.created) {
      this.created = true;
      events.push(this._eventBytes({ type: 'response.created', response: { id: this.responseId, object: 'response', status: 'in_progress', model: this.model } }));
    }
    events.push(this._eventBytes({ type: 'response.in_progress', response: { id: this.responseId, object: 'response', status: 'in_progress', model: this.model } }));
    return Buffer.concat(events);
  }

  failure(message, code = 'local_model_error') {
    if (this.completed) return Buffer.alloc(0);
    this.completed = true;
    const initial = this.start();
    return Buffer.concat([initial, this._eventBytes({ type: 'response.failed', response: { id: this.responseId, object: 'response', status: 'failed', model: this.model,
      error: { code, message: String(message || 'The local model request failed.') } } })]);
  }

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
    this.sourceText += delta;
    this.pendingText += delta;
    this._drainText(false);
    if (this.degenerate) this._complete('stop');
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
    return { type: 'function_call', call_id: call.id, name: call.name, arguments: toolArguments(call.arguments || '{}') };
  }

  _addTextCall(name, args, argumentSource) {
    if (typeof name !== 'string' || !name.trim()) return false;
    const index = Math.max(-1, ...this.calls.keys()) + 1;
    this.calls.set(index, { id: id('call'), name, sourceName: name, arguments: toolArguments(argumentSource ?? args), textCall: true });
    return true;
  }

  _parseTextCall(raw) {
    const call = callFromJson(raw);
    if (call) return this._addTextCall(call.name, call.args, call.argumentSource);
    const name = /(?:["']?name["']?|tool_name)\s*:\s*["']([^"']+)["']/i.exec(raw)?.[1]?.trim();
    if (name) return this._addTextCall(name, raw);
    return false;
  }

  _emitText(text) {
    if (!text) return;
    this._created();
    this._finishReasoning();
    if (!this.messageAdded) {
      this.messageAdded = true;
      this._event({ type: 'response.output_item.added', output_index: this.reasoningAdded ? 1 : 0,
        item: { type: 'message', id: this.messageId, role: 'assistant', content: [] } });
    }
    this.text += text;
    this._event({ type: 'response.output_text.delta', item_id: this.messageId,
      output_index: this.reasoningAdded ? 1 : 0, content_index: 0, delta: text });
  }

  _drainText(final) {
    const markers = [
      ['think', /<(think|reasoning|analysis)\s*>/i],
      ['stray', /<\/(think|reasoning|analysis)\s*>/i],
      ['tool', /<tool_call\s*>/i],
      ['function', /<function\s*=\s*([^>]+)>/i],
      ['fenced', /```json\s*/i],
    ];
    while (this.pendingText) {
      if (this.inThinking) {
        const closing = `</${this.thinkingTag}>`;
        const close = new RegExp(`<\\/${this.thinkingTag}\\s*>`, 'i').exec(this.pendingText);
        if (!close) {
          if (final) {
            this._reasoningDelta(this.pendingText);
            this.pendingText = ''; this.inThinking = false; this.thinkingTag = '';
          } else {
            let keep = 0;
            const lower = this.pendingText.toLowerCase(), prefix = closing.slice(0, -1).toLowerCase();
            for (let size = 1; size <= prefix.length; size++) if (lower.endsWith(prefix.slice(0, size))) keep = size;
            const partialClose = new RegExp(`<\\/${this.thinkingTag}\\s*$`, 'i').exec(this.pendingText);
            if (partialClose) keep = Math.max(keep, this.pendingText.length - partialClose.index);
            const safe = this.pendingText.length - keep;
            if (safe) this._reasoningDelta(this.pendingText.slice(0, safe));
            this.pendingText = this.pendingText.slice(safe);
          }
          return;
        }
        this._reasoningDelta(this.pendingText.slice(0, close.index));
        this.pendingText = this.pendingText.slice(close.index + close[0].length);
        this.inThinking = false;
        this.thinkingTag = '';
        continue;
      }
      const found = markers.map(([type, pattern]) => {
        const match = pattern.exec(this.pendingText);
        return match ? { type, match, index: match.index } : null;
      }).filter(Boolean).sort((a, b) => a.index - b.index)[0];
      if (!found) {
        const repeated = repeatedSuffix(this.pendingText);
        if (repeated) {
          this.pendingText = this.pendingText.slice(0, repeated.keep);
          this._emitText(this.pendingText);
          this.pendingText = '';
          this.degenerate = true;
          setImmediate(() => this.onDegenerate());
          return;
        }
        if (final) { this._emitText(this.pendingText); this.pendingText = ''; return; }
        const safe = Math.max(0, this.pendingText.length - 128);
        if (safe) { this._emitText(this.pendingText.slice(0, safe)); this.pendingText = this.pendingText.slice(safe); }
        return;
      }
      if (found.type === 'stray') {
        // Qwen sometimes writes the end of its thinking as answer text and then closes a think block it never
        // opened, before giving the real answer (live: "…SAFFRON-7.\n</think>\n\nYou gave me…SAFFRON-7."). Before any
        // answer text has gone out, the text so far was thinking; after that, only the tag is dropped.
        const before = this.pendingText.slice(0, found.index);
        if (!this.text && !this.reasoningDone) this._reasoningDelta(before.trim() ? before : '');
        else this._emitText(before);
        this.pendingText = this.pendingText.slice(found.index + found.match[0].length).replace(/^\s+/, '');
        continue;
      }
      if (found.index) this._emitText(this.pendingText.slice(0, found.index));
      this.pendingText = this.pendingText.slice(found.index);
      const opening = found.match[0];
      if (found.type === 'think') {
        this.pendingText = this.pendingText.slice(opening.length);
        this.inThinking = true;
        this.thinkingTag = found.match[1].toLowerCase();
        continue;
      }
      if (found.type === 'tool') {
        const innerStart = opening.length;
        const close = /<\/tool_call\s*>/i.exec(this.pendingText.slice(innerStart));
        if (!close && !final) return;
        const inner = close ? this.pendingText.slice(innerStart, innerStart + close.index) : this.pendingText.slice(innerStart);
        const block = close ? this.pendingText.slice(0, innerStart + close.index + close[0].length) : this.pendingText;
        if (!this._parseTextCall(inner)) this._emitText(block);
        this.pendingText = close ? this.pendingText.slice(innerStart + close.index + close[0].length) : '';
        continue;
      }
      if (found.type === 'function') {
        const name = found.match[1].trim().replace(/^(["'])(.*)\1$/, '$2');
        const innerStart = opening.length;
        const close = /<\/function\s*>/i.exec(this.pendingText.slice(innerStart));
        if (!close && !final) return;
        const inner = close ? this.pendingText.slice(innerStart, innerStart + close.index) : this.pendingText.slice(innerStart);
        const args = {};
        for (const param of inner.matchAll(/<parameter\s*=\s*([^>]+)>([\s\S]*?)<\/parameter\s*>/gi)) {
          const key = param[1].trim().replace(/^(["'])(.*)\1$/, '$2');
          const value = param[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
          const parsed = jsonValue(value);
          args[key] = parsed === null ? value : parsed;
        }
        const block = close ? this.pendingText.slice(0, innerStart + close.index + close[0].length) : this.pendingText;
        if (!this._addTextCall(name, args)) this._emitText(block);
        this.pendingText = close ? this.pendingText.slice(innerStart + close.index + close[0].length) : '';
        continue;
      }
      const closeIndex = this.pendingText.indexOf('```', opening.length);
      if (closeIndex < 0) {
        if (!final) return;
        this._emitText(this.pendingText); this.pendingText = ''; return;
      }
      const end = closeIndex + 3;
      const block = this.pendingText.slice(0, end);
      const inner = this.pendingText.slice(opening.length, closeIndex);
      if (!this._parseTextCall(inner)) this._emitText(block);
      this.pendingText = this.pendingText.slice(end);
    }
  }

  _complete(finishReason = 'stop') {
    if (this.completed) return;
    this._drainText(true);
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
    const limited = ['length', 'max_tokens', 'max_output_tokens'].includes(finishReason);
    // A cutoff may leave incomplete arguments. Never release those calls to the
    // engine as executable tools; preserve partial text and report the failure.
    const calls = limited ? [] : [...this.calls.keys()].sort((a, b) => a - b)
      .map(index => this.calls.get(index)).filter(call => call.name).map(call => {
        const repaired = repairToolCall(call, this.toolKinds);
        if (repaired !== call) {
          const args = parseArguments(call.arguments);
          const patch = PATCH_TOOLS.has(String(call.name).toLowerCase())
            || (call.name === 'exec_command' && Array.isArray(args.cmd) && /^apply_patch(?:\.bat)?$/i.test(String(args.cmd[0] || '')));
          this.onToolRepair({ modelId: this.model,
            key: patch ? 'patch-through-exec-command' : 'unknown-tool-name',
            text: patch ? 'Apply patches through exec_command using the patch heredoc form; apply_patch is not a separate tool.'
              : 'Use the available tool names shown in tool errors; choose the corrected tool name.' });
        }
        return repaired;
      })
      .filter(call => call.name && !this.noToolCalls && (!this.toolKinds.size || this.toolKinds.has(call.name)));
    const transcript = { responseId: this.responseId, text: this.sourceText, reasoning: this.sourceReasoning };
    if (!limited && (this.sourceText !== this.text || this.sourceReasoning !== this.reasoning)) {
      if (this.reasoningAdded) rememberTranscript(this.textCallHistory, this.reasoningId, transcript);
      if (this.messageAdded || this.text) rememberTranscript(this.textCallHistory, this.messageId, transcript);
    }
    if (!limited && calls.length && calls.every(call => call.textCall)) for (const call of calls) {
      rememberTranscript(this.textCallHistory, call.id, { ...transcript, name: call.sourceName || call.name });
    }
    for (const call of calls) {
      const item = this._toolItem(call);
      this._event({ type: 'response.output_item.done', output_index: outputIndex++, item });
      output.push(item);
    }
    const empty = !this.text.trim() && !calls.length;
    const failed = limited || empty;
    const inputTokens = Number(this.usage?.prompt_tokens) || 0;
    const outputTokens = Number(this.usage?.completion_tokens) || 0;
    this._event({ type: failed ? 'response.failed' : 'response.completed', response: {
      id: this.responseId, object: 'response', status: failed ? 'failed' : 'completed', model: this.model, output,
      ...(limited ? { incomplete_details: { reason: 'max_output_tokens' }, error: { code: 'max_output_tokens',
        message: 'The local model reached its output token limit before finishing. Partial text was kept; ask it to continue.' } }
        : empty ? { error: { code: 'empty_completion', message: 'The local model returned an empty response. Please try again.' } } : {}),
      usage: { input_tokens: inputTokens, input_tokens_details: this.usage?.prompt_tokens_details ? { cached_tokens: Math.min(inputTokens, Math.max(0, Number(this.usage.prompt_tokens_details.cached_tokens) || 0)) } : null, output_tokens: outputTokens,
        output_tokens_details: null, total_tokens: Number(this.usage?.total_tokens) || inputTokens + outputTokens },
    } });
  }

  _line(line) {
    if (this.completed) return;
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
    if (typeof delta.reasoning_content === 'string') { this.sourceReasoning += delta.reasoning_content; this._reasoningDelta(delta.reasoning_content); }
    if (typeof delta.content === 'string') this._textDelta(delta.content);
    for (const tool of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) this._toolDelta(tool);
    if (object(chunk.usage)) this.usage = chunk.usage;
    if (choice.finish_reason != null) this._complete(choice.finish_reason);
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
    if (!this.completed) this._complete();
    callback();
  }
}

module.exports = { StrataStreamAdapter, estimateResponsesInputTokens, responsesToChat, withoutImages, hasImages, stableJson };
