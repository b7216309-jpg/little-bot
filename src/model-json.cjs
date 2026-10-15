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

function loosen(text) {
  let out = '', quote = '', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (escaped) { out += char; escaped = false; continue; }
      if (char === '\\') { out += char; escaped = true; continue; }
      if (char === quote) {
        const next = text.slice(i + 1).match(/\S/)?.[0];
        if (quote === "'" && next && !',}:]'.includes(next)) { out += "'"; continue; }
        out += '"'; quote = ''; continue;
      }
      if (char === '"' && quote === "'") out += '\\"'; else out += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; out += '"'; continue; }
    out += char;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

// Small local models wrap JSON in reasoning tags, Markdown fences or a sentence of prose.
// Recover the object instead of failing the run; callers still validate its shape.
function parseModelJson(text, message = 'The model returned an unreadable result.', { local = false } = {}) {
  const raw = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
  const candidates = [raw, raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]];
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  if (start >= 0) candidates.push(closeBrackets(raw.slice(start).trim()));
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try { return JSON.parse(candidate); } catch { if (!local) continue; }
    const repaired = loosen(candidate);
    try { return JSON.parse(repaired); } catch { /* Try closing a cut-off object. */ }
    const closed = closeBrackets(repaired);
    if (closed) try { return JSON.parse(closed); } catch { /* Try the next shape. */ }
  }
  throw new Error(message);
}

const DEFAULT_ALIASES = Object.freeze({
  summary: ['message', 'description', 'result'], reason: ['explanation', 'why'], next: ['suggestion', 'nextStep'],
  met: ['complete', 'completed', 'satisfied', 'achieved'], impossible: ['unreachable', 'cannotComplete'],
  memories: ['memory', 'facts', 'items'], sourceIds: ['sources', 'evidenceIds'], diary: ['reflection', 'journal'],
  intentions: ['followups', 'followUps', 'reminders'], status: ['state'],
  text: ['content', 'fact'], type: ['category', 'kind'], scope: ['projectScope'], key: ['subject'], supersedesId: ['supersedes'],
  why: ['motivation', 'reason'], trigger: ['when'], keywords: ['topics', 'terms'],
  claimType: ['claim'], pressureDetected: ['pressure', 'biasDetected'], conclusionStable: ['stable', 'isConclusionStable'],
  strongestCounterpoint: ['counterpoint', 'bestCounterargument'], revisedAnswer: ['revision', 'correctedAnswer'],
  wouldChangeConclusion: ['changeConditions', 'conditions'], confidence: ['certainty'],
});

function normalizeModelOutput(value, schema, aliases = DEFAULT_ALIASES) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => normalizeModelOutput(item, schema?.items, aliases));
  const properties = schema?.properties || {};
  const out = { ...value };
  for (const [canonical, names] of Object.entries(aliases)) {
    if (out[canonical] !== undefined) continue;
    const alias = names.find(name => out[name] !== undefined);
    if (alias) out[canonical] = out[alias];
  }
  for (const [key, spec] of Object.entries(properties)) {
    let item = out[key];
    if (item === undefined || item === null) continue;
    const type = Array.isArray(spec.type) ? spec.type.find(name => name !== 'null') : spec.type;
    if (type === 'array' && !Array.isArray(item) && (item && typeof item === 'object' || typeof item === 'string')) item = [item];
    if (type === 'string' && typeof item !== 'string' && ['number', 'boolean'].includes(typeof item)) item = String(item);
    if (type === 'boolean' && typeof item === 'string' && /^(true|false|yes|no)$/i.test(item.trim())) item = /^(true|yes)$/i.test(item.trim());
    if (type === 'integer' && typeof item === 'string' && /^-?\d+$/.test(item.trim())) item = Number(item);
    if (Array.isArray(spec.enum) && typeof item === 'string') item = spec.enum.find(option => option.toLowerCase() === item.trim().toLowerCase()) || item;
    out[key] = normalizeModelOutput(item, spec, aliases);
  }
  return out;
}

module.exports = { parseModelJson, normalizeModelOutput };
