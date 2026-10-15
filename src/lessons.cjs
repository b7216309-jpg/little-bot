'use strict';

const MAX_LESSONS = 12;
const MAX_BLOCK_CHARS = 1000;
const MAX_MODEL_ID = 200;
const MAX_TEXT = 260;
const DECAY_AFTER_MS = 100 * 24 * 60 * 60 * 1000;
const SEEDS = [
  ['powershell-shell', 'The shell is PowerShell: use PowerShell syntax and cmdlets; use Get-Content -TotalCount N instead of head -N.'],
  ['powershell-numbered-lines', 'For numbered lines, use Get-Content with a ForEach-Object counter; cat -n is not PowerShell syntax.'],
  ['patch-through-exec-command', 'Apply patches through exec_command using the patch heredoc form; apply_patch is not a separate tool.'],
];

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyText = value => typeof value === 'string' && /^[a-z0-9][a-z0-9:_-]{0,100}$/i.test(value) ? value : '';
const modelKey = value => {
  if (typeof value !== 'string') return '';
  const model = value.trim().slice(0, MAX_MODEL_ID);
  return ['__proto__', 'constructor', 'prototype'].includes(model.toLowerCase()) ? '' : model;
};
const normalizeText = value => typeof value === 'string' ? value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '';

function normalizeLessons(value, now = Date.now()) {
  const source = object(value?.models) ? value.models : {};
  const models = {};
  for (const [rawId, rawModel] of Object.entries(source)) {
    const id = modelKey(rawId);
    if (!id || !object(rawModel) || !Array.isArray(rawModel.items)) continue;
    const byKey = new Map();
    for (const raw of rawModel.items) {
      if (!object(raw)) continue;
      const key = keyText(raw.key), text = normalizeText(raw.text), lastSeenAt = Number.isFinite(raw.lastSeenAt) ? raw.lastSeenAt : now;
      if (!key || !text || now - lastSeenAt > DECAY_AFTER_MS || lastSeenAt > now + 60 * 60 * 1000) continue;
      const item = { key, text, hits: Number.isSafeInteger(raw.hits) && raw.hits > 0 ? raw.hits : 0, lastSeenAt };
      if (raw.seeded === true) item.seeded = true;
      if (Number.isSafeInteger(raw.misses) && raw.misses > 0) item.misses = Math.min(3, raw.misses);
      const existing = byKey.get(key);
      if (!existing || item.lastSeenAt >= existing.lastSeenAt) byKey.set(key, item);
    }
    const items = [...byKey.values()].sort((a, b) => b.hits - a.hits || b.lastSeenAt - a.lastSeenAt).slice(0, MAX_LESSONS);
    models[id] = { seededAt: Number.isFinite(rawModel.seededAt) ? rawModel.seededAt : now, items };
  }
  return { models };
}

function ensureSeeded(state, id, now = Date.now()) {
  if (!object(state)) return false;
  if (!object(state.models)) state.models = {};
  const model = modelKey(id);
  if (!model) return false;
  if (object(state.models[model])) {
    const before = state.models[model].items?.length || 0;
    state.models[model].items = (state.models[model].items || []).filter(item => item && now - item.lastSeenAt <= DECAY_AFTER_MS);
    if (!Number.isFinite(state.models[model].seededAt)) state.models[model].seededAt = now;
    return state.models[model].items.length !== before;
  }
  state.models[model] = { seededAt: now, items: SEEDS.map(([key, text]) => ({ key, text, hits: 0, lastSeenAt: now, seeded: true })) };
  return true;
}

function active(state, id) {
  const model = modelKey(id);
  const items = state?.models?.[model]?.items;
  return Array.isArray(items) ? [...items].sort((a, b) => b.hits - a.hits || b.lastSeenAt - a.lastSeenAt).slice(0, MAX_LESSONS) : [];
}

function block(state, id) {
  const items = active(state, id);
  if (!items.length) return { text: '', keys: [] };
  const header = 'Lessons from this PC:\n';
  let text = header;
  const keys = [];
  for (const item of items) {
    const line = `- ${item.text}`;
    if (text.length + line.length + 1 <= MAX_BLOCK_CHARS) {
      text += `${line}\n`;
      keys.push(item.key);
      continue;
    }
    const room = MAX_BLOCK_CHARS - text.length - 2;
    if (room >= 20) {
      text += `- ${item.text.slice(0, room)}…`;
      keys.push(item.key);
    }
    break;
  }
  return { text: text.trimEnd().slice(0, MAX_BLOCK_CHARS), keys };
}

function record(state, id, key, text, now = Date.now()) {
  if (!object(state)) return false;
  ensureSeeded(state, id, now);
  const model = modelKey(id), normalizedKey = keyText(key), normalized = normalizeText(text);
  if (!model || !normalizedKey || !normalized) return false;
  const entry = state.models[model];
  let item = entry.items.find(candidate => candidate.key === normalizedKey);
  if (item) {
    item.hits = (item.hits || 0) + 1;
    item.lastSeenAt = now;
    item.text = normalized;
  } else entry.items.push(item = { key: normalizedKey, text: normalized, hits: 1, lastSeenAt: now });
  entry.items = entry.items.filter(candidate => now - candidate.lastSeenAt <= DECAY_AFTER_MS)
    .sort((a, b) => b.hits - a.hits || b.lastSeenAt - a.lastSeenAt).slice(0, MAX_LESSONS);
  return true;
}

function remove(state, id, key) {
  const model = modelKey(id), items = state?.models?.[model]?.items;
  if (!Array.isArray(items)) return false;
  const next = items.filter(item => item.key !== key);
  if (next.length === items.length) return false;
  state.models[model].items = next;
  return true;
}

function markMiss(state, id, key) {
  const model = modelKey(id), item = state?.models?.[model]?.items?.find(entry => entry.key === key);
  if (!item) return false;
  item.misses = (item.misses || 0) + 1;
  if (item.misses >= 3) state.models[model].items = state.models[model].items.filter(entry => entry !== item);
  return true;
}

function matchingFailure(state, id, { tool = '', args = {}, error = '' } = {}) {
  const items = active(state, id), message = String(error).toLowerCase();
  const fields = object(args) ? Object.keys(args) : [];
  const hasPath = fields.some(key => /(?:path|file|folder|directory|workspace)$/i.test(key));
  const base = message.split(/corrected example:/i)[0];
  const key = hasPath && /invalid (?:path|file|directory)|(?:path|file|directory).*(?:not found|not exist|cannot find|no such|invalid)|(?:not found|not exist|cannot find|no such).*(?:path|file|directory)|enoent/i.test(message)
    ? 'workspace-paths'
    : /unknown tool/.test(base) ? 'unknown-tool-name'
      : /unknown action|(?:unsupported|missing|required|invalid|expected).*(?:argument|field|action|property|object|number|string|boolean|array)|(?:argument|field|action|property).*(?:unsupported|unknown|invalid|missing|required|must be|expected)|arguments for .* must be/i.test(base)
      ? `tool-arguments:${String(tool).slice(0, 70)}` : '';
  return key ? items.find(item => item.key === key) || null : null;
}

module.exports = { MAX_LESSONS, MAX_BLOCK_CHARS, DECAY_AFTER_MS, SEEDS, normalizeLessons, ensureSeeded, active, block, record, remove, markMiss, matchingFailure };
