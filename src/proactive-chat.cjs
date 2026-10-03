'use strict';

const { randomUUID } = require('node:crypto');
const { localStamp } = require('./local-time.cjs');

// The Activity inbox is a log; the conversation is where proactive work is delivered.
// Messages that arrive while a turn is running or waiting wait in the chat's outbox,
// and every proactive message stays unseen by the model until the user's next turn carries it.
const MAX_PENDING = 20;
const MAX_BRIDGE = 10;
const PROACTIVE_KINDS = ['heartbeat', 'goal', 'memory', 'watch', 'offer'];
const MAX_FEEDBACK = 200;
// Proactive messages carry buttons only for a concrete offer (a game launch). Notes, tips and check-ins get none:
// the user simply replies in the chat, and a reply to a goal message already brings that goal's review forward.
// Older messages keep their saved buttons, and answering them still feeds the reaction log.
const LAUNCH_TARGET = /^steam:\/\/rungameid\/\d{1,10}$/;

function normalizeActions(value) {
  return (Array.isArray(value) ? value : []).filter(item => object(item) && ['do', 'later', 'no', 'launch'].includes(item.id)).slice(0, 4).map(item => ({
    id: item.id, label: text(item.label, 80) || item.id,
    ...(item.id === 'launch' && LAUNCH_TARGET.test(item.target) ? { target: item.target } : {}),
  })).filter(item => item.id !== 'launch' || item.target);
}

function normalizeAnswer(value) {
  return object(value) && ['do', 'later', 'no', 'launch'].includes(value.choice) && Number.isFinite(value.at) ? { choice: value.choice, at: value.at } : null;
}

function normalizeFeedbackLog(value) {
  return (Array.isArray(value) ? value : []).filter(item => object(item) && Number.isFinite(item.at) && ['do', 'later', 'no', 'launch'].includes(item.choice))
    .slice(-MAX_FEEDBACK).map(item => ({ id: text(item.id, 100) || randomUUID(), at: item.at, choice: item.choice, source: text(item.source, 40),
      topic: text(item.topic, 120), excerpt: text(item.excerpt, 300), ...(typeof item.goalId === 'string' ? { goalId: item.goalId.slice(0, 100) } : {}) }));
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';

function normalizePending(value) {
  return (Array.isArray(value) ? value : []).filter(item => object(item) && PROACTIVE_KINDS.includes(item.kind)
    && typeof item.text === 'string' && item.text.trim()).slice(-MAX_PENDING).map(item => {
    const entry = { id: text(item.id, 128) || randomUUID(), role: 'assistant', kind: item.kind, status: 'completed',
      text: text(item.text, 20000), createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(), modelSeen: false };
    const actions = normalizeActions(item.actions);
    if (actions.length) entry.actions = actions;
    for (const key of ['goalId', 'goalName', 'goalRunId', 'goalQuestionId', 'heartbeatId', 'heartbeatTopic', 'watchId']) {
      if (typeof item[key] === 'string') entry[key] = item[key].slice(0, 300);
    }
    return entry;
  });
}

// Posts into the idle conversation or queues for later. `duplicate` checks both delivered and queued messages.
function post(data, fields, { duplicate = null, nowMs = Date.now() } = {}) {
  const chat = data?.chats?.[0];
  if (!chat || !Array.isArray(chat.messages)) return null;
  const pending = Array.isArray(chat.pendingProactive) ? chat.pendingProactive : [];
  if (duplicate && [...chat.messages, ...pending].some(duplicate)) return null;
  const message = { id: randomUUID(), role: 'assistant', status: 'completed', createdAt: nowMs, modelSeen: false,
    ...fields };
  if (chat.status === 'idle') {
    chat.messages.push(message);
    chat.updatedAt = nowMs;
  } else {
    chat.pendingProactive = [...pending, message].slice(-MAX_PENDING);
  }
  return message;
}

function flush(chat, nowMs = Date.now()) {
  if (!chat || chat.status !== 'idle' || !Array.isArray(chat.pendingProactive) || !chat.pendingProactive.length) return 0;
  const pending = chat.pendingProactive;
  delete chat.pendingProactive;
  for (const message of pending) chat.messages.push({ ...message, createdAt: nowMs });
  chat.updatedAt = nowMs;
  return pending.length;
}

function unseen(chat) {
  return (chat?.messages || []).filter(message => PROACTIVE_KINDS.includes(message.kind) && message.modelSeen === false).slice(-MAX_BRIDGE);
}

function bridgeText(messages) {
  if (!messages.length) return '';
  return 'Messages you sent on your own since the user last wrote (the user sees them in this conversation and may be replying to them):\n'
    + messages.map(message => {
      const source = message.kind === 'goal' ? `goal "${message.goalName || 'Goal'}"` : message.kind === 'memory' ? 'memory learned'
        : message.kind === 'watch' ? 'web watch' : message.kind === 'offer' ? 'offer' : `heartbeat${message.heartbeatTopic ? ` · ${message.heartbeatTopic}` : ''}`;
      return `[${localStamp(message.createdAt)} · ${source}] ${message.text.slice(0, 2000)}`;
    }).join('\n\n');
}

function markSeen(messages) {
  for (const message of messages) delete message.modelSeen;
}

function deliverHeartbeat(data, item, nowMs = Date.now()) {
  if (!item || item.status !== 'alert' || item.source === 'goal' || typeof item.summary !== 'string' || !item.summary.trim()) return null;
  return post(data, { kind: 'heartbeat', heartbeatId: item.id, ...(item.topic ? { heartbeatTopic: item.topic } : {}), text: item.summary.trim() },
    { nowMs, duplicate: message => message.kind === 'heartbeat' && message.heartbeatId === item.id });
}

// Shows what automatic learning just saved, so a wrong memory can be corrected right away.
function deliverLearned(data, records, nowMs = Date.now()) {
  const learned = (Array.isArray(records) ? records : []).filter(record => record?.id && typeof record.text === 'string' && record.text.trim());
  if (!learned.length) return null;
  const text = learned.map(record => `📌 ${record.text.trim().slice(0, 400)} (${record.type || 'fact'} · id ${record.id})`).join('\n');
  return post(data, { kind: 'memory', text: `I'll remember:\n${text}\nTell me if any of this is wrong and I'll correct or forget it.` }, { nowMs });
}

function deliverWatch(data, change, nowMs = Date.now()) {
  if (!change?.id || !change.url) return null;
  const added = String(change.added || '').trim();
  return post(data, { kind: 'watch', watchId: change.id,
    text: `🔎 ${change.label || 'A page you watch'} changed: ${change.url}${added ? `\nNew text:\n${added.slice(0, 800)}` : ''}` }, { nowMs });
}

// A game launch is only ever offered; the user's click on the button starts it.
function deliverOffer(data, { appid, name, note = '' } = {}, nowMs = Date.now()) {
  const target = `steam://rungameid/${appid}`;
  if (!LAUNCH_TARGET.test(target) || !name) throw new Error('Choose an installed Steam game.');
  return post(data, { kind: 'offer', text: `${String(note || `How about ${name}?`).trim().slice(0, 600)}`,
    actions: [{ id: 'launch', label: `▶ Launch ${String(name).slice(0, 60)}`, target }, { id: 'no', label: '✖ Not now' }] }, { nowMs });
}

// Records the user's click. Side effects (launch, feedback, follow-up turn) belong to the caller.
function answer(data, { messageId, choice } = {}, nowMs = Date.now()) {
  const chat = data?.chats?.[0];
  const message = [...(chat?.messages || []), ...(chat?.pendingProactive || [])].find(item => item.id === messageId);
  if (!message || !Array.isArray(message.actions)) throw new Error('This suggestion is no longer available.');
  if (message.answer) throw new Error('This suggestion was already answered.');
  const action = message.actions.find(item => item.id === choice);
  if (!action) throw new Error('Choose one of the offered buttons.');
  message.answer = { choice, at: nowMs };
  const entry = { id: randomUUID(), at: nowMs, choice, source: message.kind, topic: message.heartbeatTopic || message.goalName || '',
    excerpt: String(message.text || '').slice(0, 300), ...(message.goalId ? { goalId: message.goalId } : {}) };
  data.feedbackLog = normalizeFeedbackLog([...(data.feedbackLog || []), entry]);
  return { message, action, entry };
}

module.exports = { post, flush, deliverLearned, deliverWatch, deliverOffer, answer, normalizeActions, normalizeAnswer, normalizeFeedbackLog, LAUNCH_TARGET, unseen, bridgeText, markSeen, deliverHeartbeat, normalizePending, PROACTIVE_KINDS };
