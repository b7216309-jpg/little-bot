'use strict';
// Little Bot's continuity between conversations: the nightly dream diary and intentions.
// An intention is prospective memory, something to bring up later ("ask how the exam went").
// Like OpenClaw's standing intents they are budgeted so they never nag: offered at most once a
// day, at most three times, and they expire.
const { randomUUID } = require('node:crypto');

const HOUR = 3600000, DAY = 24 * HOUR;
const TRIGGERS = ['next_chat', 'topic', 'date', 'moment'];
// Presence events that count as each moment (see EventRuntime._wakeForPresence).
const MOMENTS = { returned: ['user.returned', 'app.opened'], home: ['phone.arrived_home'], out: ['phone.left_home'] };
const MAX_ACTIVE = 20, MAX_CLOSED = 30, MAX_DREAMS = 30, MAX_FIRES = 3;
const COOLDOWN = 20 * HOUR, NEXT_CHAT_GRACE = 12 * HOUR;

const clean = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
const fold = value => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
function localDay(ms = Date.now()) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Lenient on purpose: a small model's half-filled trigger becomes "next chat" rather than an error.
function normalizeTrigger(value) {
  const input = value && typeof value === 'object' ? value : {};
  const type = TRIGGERS.includes(input.type) ? input.type : 'next_chat';
  if (type === 'topic') {
    const keywords = [...new Set((Array.isArray(input.keywords) ? input.keywords : []).map(item => clean(item, 40)).filter(item => item.length >= 3))].slice(0, 6);
    return keywords.length ? { type, keywords } : { type: 'next_chat' };
  }
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? { type, date: input.date } : { type: 'next_chat' };
  if (type === 'moment') return MOMENTS[input.moment] ? { type, moment: input.moment } : { type: 'next_chat' };
  return { type };
}

function normalizeIntention(value, now) {
  if (!value || typeof value !== 'object') return null;
  const text = clean(value.text, 300);
  if (!text) return null;
  const status = ['active', 'done', 'cancelled', 'expired'].includes(value.status) ? value.status : 'active';
  return {
    id: clean(value.id, 100) || randomUUID(), text, why: clean(value.why, 300), trigger: normalizeTrigger(value.trigger),
    source: ['dream', 'chat', 'heartbeat'].includes(value.source) ? value.source : 'chat',
    createdAt: number(value.createdAt, now), expiresAt: number(value.expiresAt, now + 30 * DAY),
    fires: Math.min(MAX_FIRES, Math.max(0, Number.isInteger(value.fires) ? value.fires : 0)),
    lastOfferedAt: number(value.lastOfferedAt, null), status,
    ...(status !== 'active' ? { closedAt: number(value.closedAt, now) } : {}),
  };
}

function normalizeCompanion(value, now = Date.now()) {
  const input = value && typeof value === 'object' ? value : {};
  const intentions = (Array.isArray(input.intentions) ? input.intentions : []).map(item => normalizeIntention(item, now)).filter(Boolean);
  const active = intentions.filter(item => item.status === 'active').slice(-MAX_ACTIVE);
  const closed = intentions.filter(item => item.status !== 'active').slice(-MAX_CLOSED);
  const dreams = (Array.isArray(input.dreams) ? input.dreams : []).filter(item => item && typeof item === 'object' && clean(item.diary, 4000)).map(item => ({
    id: clean(item.id, 100) || randomUUID(), at: number(item.at, now), day: clean(item.day, 10) || localDay(number(item.at, now)),
    diary: clean(item.diary, 4000), learned: Number.isInteger(item.learned) ? item.learned : 0, intentions: Number.isInteger(item.intentions) ? item.intentions : 0,
  })).slice(-MAX_DREAMS);
  return { lastDreamAt: number(input.lastDreamAt, null), lastDreamError: clean(input.lastDreamError, 300) || null, dreams, intentions: [...closed, ...active] };
}

function expire(companion, now = Date.now()) {
  for (const item of companion.intentions) {
    if (item.status === 'active' && (now >= item.expiresAt || item.fires >= MAX_FIRES)) Object.assign(item, { status: 'expired', closedAt: now });
  }
}
function active(companion, now = Date.now()) {
  expire(companion, now);
  return companion.intentions.filter(item => item.status === 'active');
}
const ready = (item, now) => item.status === 'active' && now < item.expiresAt && item.fires < MAX_FIRES
  && (!item.lastOfferedAt || now - item.lastOfferedAt >= COOLDOWN);
function mentions(text, keyword) {
  const word = fold(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${word}([^\\p{L}\\p{N}]|$)`, 'u').test(fold(text));
}

function create(companion, input, { source = 'chat', now = Date.now(), ttlDays = 30 } = {}) {
  const intention = normalizeIntention({ ...input, id: randomUUID(), source, createdAt: now, expiresAt: now + ttlDays * DAY, fires: 0, status: 'active' }, now);
  if (!intention) throw new Error('Describe what to bring up.');
  const open = active(companion, now);
  const same = open.find(item => fold(item.text) === fold(intention.text));
  if (same) return same;
  if (open.length >= MAX_ACTIVE) throw new Error('There are already 20 open intentions. Mark one done or cancel one first.');
  companion.intentions.push(intention);
  return intention;
}
function close(companion, id, status) {
  const item = companion.intentions.find(entry => entry.id === id && entry.status === 'active');
  if (!item) throw new Error('That intention is not open.');
  Object.assign(item, { status, closedAt: Date.now() });
  return item;
}

// For a direct conversation turn: a keyword that just came up first, then dated ones, then "next chat".
function forChat(companion, text, now = Date.now()) {
  const today = localDay(now);
  const order = { topic: 0, date: 1, next_chat: 2 };
  return active(companion, now).filter(item => ready(item, now) && (
    (item.trigger.type === 'topic' && item.trigger.keywords.some(keyword => mentions(text, keyword)))
    || (item.trigger.type === 'date' && item.trigger.date <= today)
    || item.trigger.type === 'next_chat'))
    .sort((left, right) => order[left.trigger.type] - order[right.trigger.type] || left.createdAt - right.createdAt).slice(0, 2);
}
// For the heartbeat: things that are due now, the moment that woke it, or a "next chat" the user has not given a chance to yet.
function forHeartbeat(companion, { now = Date.now(), event = '' } = {}) {
  const today = localDay(now);
  return active(companion, now).filter(item => ready(item, now) && (
    (item.trigger.type === 'date' && item.trigger.date <= today)
    || (item.trigger.type === 'moment' && MOMENTS[item.trigger.moment].includes(event))
    || (item.trigger.type === 'next_chat' && now - item.createdAt >= NEXT_CHAT_GRACE))).slice(0, 2);
}
function markOffered(companion, ids, now = Date.now()) {
  for (const item of companion.intentions) if (ids.includes(item.id) && item.status === 'active') { item.fires += 1; item.lastOfferedAt = now; }
  expire(companion, now);
}
function contextText(list, { heartbeat = false } = {}) {
  const lines = list.map(item => `- [${item.id}] ${item.text}${item.why ? ` (why: ${item.why})` : ''}`);
  return `${heartbeat ? 'Things you meant to bring up that fit this moment' : 'Things you meant to bring up with the user'} (your own intentions):\n${lines.join('\n')}\n`
    + (heartbeat ? 'If this is a good moment, bring one up in your alert summary, warmly and briefly, then mark it done with intention_manage.'
      : 'Mention one only if it fits naturally in your reply; never force it or list them. When you have brought one up, mark it done with intention_manage.');
}
function addDream(companion, entry) {
  companion.dreams.push({ id: randomUUID(), ...entry });
  companion.dreams = companion.dreams.slice(-MAX_DREAMS);
}
function publicState(companion, dreaming = false, now = Date.now()) {
  const open = active(companion, now);
  return { dreaming, lastDreamAt: companion.lastDreamAt, lastDreamError: companion.lastDreamError,
    dreams: companion.dreams.slice(-10).reverse(),
    intentions: open.map(({ id, text, why, trigger, source, fires, createdAt, expiresAt }) => ({ id, text, why, trigger, source, fires, maxFires: MAX_FIRES, createdAt, expiresAt })) };
}

module.exports = { normalizeCompanion, normalizeTrigger, create, close, active, forChat, forHeartbeat, markOffered, contextText, addDream, publicState, localDay, MOMENTS, MAX_FIRES };
