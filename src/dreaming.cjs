'use strict';
// Dreaming: once a night (or when the PC is idle after a long gap) Little Bot looks back over the recent
// conversation and writes three things: a short diary entry in its own voice, at most three durable
// memories backed by the user's own words, and at most three intentions to bring up later.
// It runs in the memory learning lane (MemoryConsolidator), so it never overlaps a conversation.
const fs = require('node:fs');
const path = require('node:path');
const companion = require('./companion.cjs');
const { localStamp } = require('./local-time.cjs');
const { sync } = require('./memory.cjs');

const HOUR = 3600000;
const MIN_NEW_USER_MESSAGES = 4;

const DREAM_SCHEMA = {
  type: 'object', properties: {
    diary: { type: 'string' },
    memories: { type: 'array', items: { type: 'object', properties: {
      text: { type: 'string' }, type: { type: 'string', enum: ['preference', 'fact', 'decision', 'issue'] }, key: { type: 'string' },
      supersedesId: { type: ['string', 'null'] }, sourceIds: { type: 'array', items: { type: 'string' } },
    }, required: ['text', 'type', 'key', 'supersedesId', 'sourceIds'], additionalProperties: false } },
    intentions: { type: 'array', items: { type: 'object', properties: {
      text: { type: 'string' }, why: { type: 'string' }, trigger: { type: 'string', enum: ['next_chat', 'topic', 'date', 'moment'] },
      keywords: { type: 'array', items: { type: 'string' } }, date: { type: ['string', 'null'] }, moment: { type: ['string', 'null'] },
    }, required: ['text', 'why', 'trigger', 'keywords', 'date', 'moment'], additionalProperties: false } },
  }, required: ['diary', 'memories', 'intentions'], additionalProperties: false,
};

const DREAM_INSTRUCTIONS = `It is night. You are Little Bot, the user's companion, looking back over the recent days you shared, the way sleep sorts out a day. You receive your recent conversation (messages with ids), what you already remember (facts with ids), your last diary entries, your open intentions, upcoming calendar events and your own recent heartbeat notes. Return one JSON object.

diary: 3 to 6 sentences in your own voice, first person, in the user's language and your personality: what happened between you, what you noticed across days, what you are glad or curious about. Specific and honest; use only what the material shows. Never invent events, feelings or facts. The user may read it.

memories: at most 3 things worth keeping for weeks: a pattern seen on several days, a stable preference, a decision. Each must cite sourceIds of the user's own messages that show it; your own messages are never evidence. If it corrects or refines a remembered fact, set supersedesId to that fact's id and reuse its key. Do not repeat what is already remembered. An empty list is normal.

intentions: at most 3 things to bring up later, so the user feels remembered: follow up on something they mentioned (an exam, a trip, a plan, a worry, a game they are waiting for), or a light question to know them better. trigger is next_chat (next time you talk), topic (when one of 1-4 short keywords in the user's language comes up), date (on a local YYYY-MM-DD) or moment (returned: back at the PC, home: got home, out: left home). Skip anything already in open intentions. No chores, no nagging, nothing they did not care about. An empty list is fine.

This is a reflection task. Do not use tools.`;

function mainChat(data) { return (data.chats || []).find(chat => !chat.private) || null; }
const conversational = message => ['user', 'assistant'].includes(message.role) && typeof message.text === 'string' && message.text.trim()
  && message.kind !== 'reasoning' && !['commentary', 'analysis'].includes(message.phase) && !message.automationId;

// Cheap check run on every idle tick, before any material is gathered.
function newUserMessages(data, since) {
  return (mainChat(data)?.messages || []).filter(message => message.role === 'user' && conversational(message) && (message.createdAt || 0) > since).length;
}
function isDreamDue({ now, lastDreamAt, idleSeconds, requested = false, fresh = 0 }) {
  if (requested) return true;
  if (fresh < MIN_NEW_USER_MESSAGES) return false;
  const since = Number.isFinite(lastDreamAt) ? now - lastDreamAt : Infinity;
  const idle = Number.isFinite(idleSeconds) ? idleSeconds : Infinity;
  const hour = new Date(now).getHours();
  // At night once the user has stepped away; otherwise catch up after a long gap (the PC may be off at night).
  if (hour < 6) return since >= 16 * HOUR && idle >= 15 * 60;
  return since >= 30 * HOUR && idle >= 10 * 60;
}

function dreamMaterial(controller, now = Date.now()) {
  const data = controller.store.data, state = data.companion;
  const since = Number.isFinite(state.lastDreamAt) ? state.lastDreamAt : now - 36 * HOUR;
  const chat = mainChat(data);
  let budget = 30000;
  const messages = [];
  for (const message of [...(chat?.messages || [])].reverse()) {
    if (!conversational(message) || (message.createdAt || 0) <= since - 6 * HOUR) continue;
    const text = message.text.length > 1500 ? `${message.text.slice(0, 1000)} […] ${message.text.slice(-400)}` : message.text;
    if ((budget -= text.length) < 0 || messages.length >= 60) break;
    messages.unshift({ id: message.id, role: message.role, at: localStamp(message.createdAt), ...(message.kind ? { kind: message.kind } : {}), text });
  }
  const service = controller.store.memoryService;
  let facts = [];
  try {
    const found = service?.search({ query: '', source: 'facts', scope: 'all', limit: 40 }) || {};
    facts = (found.records || found.results || []).map(({ id, key, type, text }) => ({ id, key, type, text: String(text).slice(0, 400) }));
  } catch { /* Dream without the fact list rather than not at all. */ }
  const calendar = (data.calendar?.events || []).filter(event => event.startAt >= now - HOUR && event.startAt <= now + 4 * 24 * HOUR)
    .slice(0, 10).map(event => ({ title: event.title, at: localStamp(event.startAt) }));
  const heartbeat = data.heartbeat || {};
  const notes = [...(heartbeat.history || []).slice(-4).map(item => item.summary), ...(heartbeat.pulse || []).slice(-4).map(item => item.note)]
    .filter(item => typeof item === 'string' && item.trim() && !/^\{"error"/.test(item)).map(item => item.slice(0, 300));
  let agenda = '';
  try { agenda = fs.readFileSync(path.join(heartbeat.workspace || '', 'agenda.md'), 'utf8').slice(0, 3000); } catch { /* No agenda yet. */ }
  return {
    chatId: chat?.id || '', now: localStamp(now), messages, facts,
    diary: state.dreams.slice(-3).map(({ day, diary }) => ({ day, diary })),
    openIntentions: companion.active(state, now).map(({ text, trigger }) => ({ text, trigger })),
    calendar, heartbeatNotes: notes, ...(agenda ? { agenda } : {}),
  };
}

// Small local models drift from the schema; keep whatever part of the dream is usable.
function normalizeDream(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('The dream did not return a JSON object.');
  const diary = typeof output.diary === 'string' ? output.diary.trim() : '';
  if (!diary) throw new Error('The dream did not return a diary entry.');
  const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
  return { diary: diary.slice(0, 4000), memories: list(output.memories).slice(0, 3), intentions: list(output.intentions).slice(0, 3) };
}

function applyDream(controller, output, material, now = Date.now()) {
  const data = controller.store.data, state = data.companion, service = controller.store.memoryService;
  const dream = normalizeDream(output);
  // Only the user's own words can back a durable memory, so a bot claim cannot launder itself into memory.
  const userIds = new Set(material.messages.filter(message => message.role === 'user').map(message => message.id));
  const known = new Set(material.facts.map(fact => fact.id));
  const learned = [];
  for (const item of dream.memories) {
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    const type = ['preference', 'fact', 'decision', 'issue'].includes(item.type) ? item.type : 'fact';
    const sourceIds = (Array.isArray(item.sourceIds) ? item.sourceIds : []).filter(id => userIds.has(id));
    if (!text || !sourceIds.length || !service) continue;
    const supersedesId = typeof item.supersedesId === 'string' && known.has(item.supersedesId) ? item.supersedesId : null;
    try {
      const record = service.save({ text, type, scope: 'global', key: typeof item.key === 'string' ? item.key : '', ...(supersedesId ? { supersedesId } : {}),
        automatic: true, source: { chatId: material.chatId, messageIds: sourceIds, label: 'Dream' } });
      if (record) learned.push(record);
    } catch { /* A rejected memory does not spoil the rest of the dream. */ }
  }
  if (learned.length) sync(data.memory);
  const created = [];
  for (const item of dream.intentions) {
    try {
      created.push(companion.create(state, { text: item.text, why: item.why,
        trigger: { type: item.trigger, keywords: item.keywords, date: item.date, moment: item.moment } }, { source: 'dream', now, ttlDays: 14 }));
    } catch { /* Full, duplicate or empty: skip it. */ }
  }
  companion.addDream(state, { at: now, day: companion.localDay(now), diary: dream.diary, learned: learned.length, intentions: created.length });
  state.lastDreamAt = now;
  state.lastDreamError = null;
  return { learned, intentions: created };
}

module.exports = { DREAM_SCHEMA, DREAM_INSTRUCTIONS, isDreamDue, newUserMessages, dreamMaterial, normalizeDream, applyDream, MIN_NEW_USER_MESSAGES };
