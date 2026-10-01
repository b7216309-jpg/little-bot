'use strict';

// Small local models wrap JSON in reasoning tags, Markdown fences or a sentence of prose.
// Recover the object instead of failing the run; callers still validate its shape.
function parseModelJson(text, message = 'The model returned an unreadable result.') {
  const raw = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
  const candidates = [raw, raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]];
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try { return JSON.parse(candidate); } catch { /* Try the next shape. */ }
  }
  throw new Error(message);
}

module.exports = { parseModelJson };
