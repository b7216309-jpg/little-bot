'use strict';
// Every request Little Bot sends to the local model, counted on this PC: prompt tokens, how many came from the
// server's cache, and generated tokens, per local day, per source and per model, with generation and prefill speed.
// Counts only: no text, prompt or answer is kept here.

const MAX_DAYS = 400;
const MAX_MODELS = 12;
// Sources, grouped for the chart. Ids are stable on disk; labels and groups can change.
const SOURCES = {
  conversation: { label: 'Conversation', group: 'chats' },
  sessions: { label: 'Sessions', group: 'chats' },
  quick: { label: 'Quick session', group: 'chats' },
  routines: { label: 'Routines', group: 'background' },
  heartbeat: { label: 'Heartbeat', group: 'background' },
  night: { label: 'Night shift', group: 'background' },
  goals: { label: 'Goals', group: 'background' },
  memory: { label: 'Memory learning', group: 'memory' },
  dreams: { label: 'Night thoughts', group: 'memory' },
  checks: { label: 'Answer checks', group: 'checks' },
  compaction: { label: 'Compaction', group: 'compaction' },
  other: { label: 'Other', group: 'checks' },
};
const GROUPS = [
  { id: 'chats', label: 'Chats' }, { id: 'background', label: 'Background' }, { id: 'memory', label: 'Memory' },
  { id: 'checks', label: 'Checks' }, { id: 'compaction', label: 'Compaction' },
];
const COUNTS = ['requests', 'input', 'cached', 'output'];
const SPEED = ['genTokens', 'genMs', 'prefillTokens', 'prefillMs'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), Number.MAX_SAFE_INTEGER) : 0;
const blank = () => ({ requests: 0, input: 0, cached: 0, output: 0 });
const pad = value => String(value).padStart(2, '0');

function dayKey(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function dayStart(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}
function addDays(key, delta) {
  const [year, month, day] = key.split('-').map(Number);
  return dayKey(new Date(year, month - 1, day + delta).getTime());
}
function counts(value) { return Object.fromEntries(COUNTS.map(key => [key, count(value?.[key])])); }
function add(target, entry) { for (const key of COUNTS) target[key] = count(target[key]) + count(entry[key]); return target; }

function normalizeDay(value) {
  const day = { ...counts(value), ...Object.fromEntries(SPEED.map(key => [key, count(value?.[key])])), sources: {}, models: {}, hours: Array(24).fill(0) };
  for (const [id, item] of Object.entries(object(value?.sources) ? value.sources : {})) if (SOURCES[id]) day.sources[id] = counts(item);
  for (const [id, item] of Object.entries(object(value?.models) ? value.models : {}).slice(0, MAX_MODELS)) {
    if (typeof id === 'string' && id.length <= 200) day.models[id] = counts(item);
  }
  if (Array.isArray(value?.hours)) for (let hour = 0; hour < 24; hour++) day.hours[hour] = count(value.hours[hour]);
  return day;
}
function normalizeUsage(value) {
  const days = {};
  const keys = Object.keys(object(value?.days) ? value.days : {}).filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort().slice(-MAX_DAYS);
  for (const key of keys) days[key] = normalizeDay(value.days[key]);
  return { version: 1, since: Number.isFinite(value?.since) && value.since > 0 ? value.since : null, days };
}

class UsageLedger {
  constructor({ store, now = () => Date.now(), persist = () => {}, persistMs = 15000 } = {}) {
    this.store = store; this.now = now; this.persist = persist; this.persistMs = persistMs; this.timer = null;
    this.store.data.usage = normalizeUsage(this.store.data.usage);
  }
  get data() { return this.store.data.usage; }
  // One finished model request. Speeds use only requests that produced tokens and reported when output began.
  record({ source = 'other', model = '', input = 0, cached = 0, output = 0, startedAt, firstByteAt, finishedAt } = {}) {
    const at = Number.isFinite(finishedAt) ? finishedAt : this.now();
    const entry = { requests: 1, input: count(input), cached: Math.min(count(cached), count(input)), output: count(output) };
    if (!entry.input && !entry.output) return false;
    const id = SOURCES[source] ? source : 'other';
    const key = dayKey(at);
    const day = this.data.days[key] ||= normalizeDay(null);
    add(day, entry);
    add(day.sources[id] ||= blank(), entry);
    const name = String(model || 'unknown').slice(0, 200);
    if (day.models[name] || Object.keys(day.models).length < MAX_MODELS) add(day.models[name] ||= blank(), entry);
    day.hours[new Date(at).getHours()] += entry.output;
    if (Number.isFinite(startedAt) && Number.isFinite(firstByteAt) && firstByteAt >= startedAt && firstByteAt <= at) {
      if (entry.output && at > firstByteAt) { day.genTokens += entry.output; day.genMs += at - firstByteAt; }
      const fresh = entry.input - entry.cached;
      if (fresh > 0 && firstByteAt > startedAt) { day.prefillTokens += fresh; day.prefillMs += firstByteAt - startedAt; }
    }
    this.data.since ||= at;
    const keys = Object.keys(this.data.days);
    if (keys.length > MAX_DAYS) for (const old of keys.sort().slice(0, keys.length - MAX_DAYS)) delete this.data.days[old];
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; this.persist(); }, this.persistMs);
      this.timer.unref?.();
    }
    return true;
  }
  close() { clearTimeout(this.timer); this.timer = null; }

  // What the Usage page shows for the last `days` days (0 = everything recorded), ending today.
  summary({ days = 30 } = {}) {
    const today = dayKey(this.now());
    const recorded = Object.keys(this.data.days).sort();
    const first = days > 0 ? addDays(today, -(Math.min(days, MAX_DAYS) - 1)) : recorded[0] || today;
    const range = [];
    for (let key = first; key <= today && range.length <= MAX_DAYS; key = addDays(key, 1)) {
      const day = this.data.days[key] || normalizeDay(null);
      const groups = Object.fromEntries(GROUPS.map(group => [group.id, 0]));
      for (const [id, item] of Object.entries(day.sources)) groups[SOURCES[id].group] += item.output;
      range.push({ day: key, at: dayStart(key), ...counts(day), groups });
    }
    const totals = blank(), lifetime = blank(), sources = {}, models = {}, hours = Array(24).fill(0);
    const speed = { genTokens: 0, genMs: 0, prefillTokens: 0, prefillMs: 0 };
    for (const key of recorded) {
      const day = this.data.days[key];
      add(lifetime, day);
      if (key < first || key > today) continue;
      add(totals, day);
      for (const [id, item] of Object.entries(day.sources)) add(sources[id] ||= blank(), item);
      for (const [id, item] of Object.entries(day.models)) add(models[id] ||= blank(), item);
      day.hours.forEach((value, hour) => { hours[hour] += value; });
      // A speed counts only with its own timing, so a day without timing can never inflate it.
      if (day.genTokens && day.genMs) { speed.genTokens += day.genTokens; speed.genMs += day.genMs; }
      if (day.prefillTokens && day.prefillMs) { speed.prefillTokens += day.prefillTokens; speed.prefillMs += day.prefillMs; }
    }
    // Streak: consecutive days with generated tokens, ending today (or yesterday, if today has none yet).
    let streak = 0;
    for (let key = this.data.days[today]?.output ? today : addDays(today, -1); this.data.days[key]?.output; key = addDays(key, -1)) streak++;
    const best = recorded.reduce((top, key) => this.data.days[key].output > (top?.output || 0) ? { day: key, output: this.data.days[key].output } : top, null);
    return {
      today, first, since: this.data.since, totals, lifetime,
      activeDays: range.filter(day => day.output > 0).length, streak, best,
      days: range,
      groups: GROUPS,
      sources: Object.entries(sources).map(([id, item]) => ({ id, ...SOURCES[id], ...item })).sort((a, b) => b.output - a.output),
      models: Object.entries(models).map(([id, item]) => ({ id, ...item })).sort((a, b) => b.output - a.output),
      hours,
      generation: speed.genMs ? { tokensPerSecond: speed.genTokens / (speed.genMs / 1000), tokens: speed.genTokens } : null,
      prefill: speed.prefillMs ? { tokensPerSecond: speed.prefillTokens / (speed.prefillMs / 1000), tokens: speed.prefillTokens } : null,
    };
  }
}

module.exports = { UsageLedger, normalizeUsage, dayKey, SOURCES, GROUPS, MAX_DAYS };
