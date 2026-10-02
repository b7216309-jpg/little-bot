'use strict';

// A reply cut off before its last brackets ({"memories":[{...}] with no final brace): close what is still open.
function closeBrackets(text) {
  const stack = [];
  let inString = false, escaped = false;
  for (const char of text) {
    if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
    else if (char === '}' || char === ']') { if (stack.pop() !== char) return null; }
  }
  if (inString || !stack.length) return null;
  return text.replace(/,\s*$/, '') + stack.reverse().join('');
}

// Small local models wrap JSON in reasoning tags, Markdown fences or a sentence of prose.
// Recover the object instead of failing the run; callers still validate its shape.
function parseModelJson(text, message = 'The model returned an unreadable result.') {
  const raw = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
  const candidates = [raw, raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]];
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  if (start >= 0) candidates.push(closeBrackets(raw.slice(start).trim()));
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try { return JSON.parse(candidate); } catch { /* Try the next shape. */ }
  }
  throw new Error(message);
}

module.exports = { parseModelJson };
