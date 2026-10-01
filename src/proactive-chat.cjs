'use strict';

const { randomUUID } = require('node:crypto');

// The Activity inbox is a log; the conversation is where proactive work is delivered.
// Messages that arrive while a turn is running or waiting wait in the chat's outbox,
// and every proactive message stays unseen by the model until the user's next turn carries it.
const MAX_PENDING = 20;
const MAX_BRIDGE = 10;
const PROACTIVE_KINDS = ['heartbeat', 'goal', 'memory'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';

function normalizePending(value) {
  return (Array.isArray(value) ? value : []).filter(item => object(item) && PROACTIVE_KINDS.includes(item.kind)
    && typeof item.text === 'string' && item.text.trim()).slice(-MAX_PENDING).map(item => {
    const entry = { id: text(item.id, 128) || randomUUID(), role: 'assistant', kind: item.kind, status: 'completed',
      text: text(item.text, 20000), createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(), modelSeen: false };
    for (const key of ['goalId', 'goalName', 'goalRunId', 'goalQuestionId', 'heartbeatId', 'heartbeatTopic']) {
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
  const message = { id: randomUUID(), role: 'assistant', status: 'completed', createdAt: nowMs, modelSeen: false, ...fields };
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
      const source = message.kind === 'goal' ? `goal "${message.goalName || 'Goal'}"` : message.kind === 'memory' ? 'memory learned' : `heartbeat${message.heartbeatTopic ? ` · ${message.heartbeatTopic}` : ''}`;
      return `[${new Date(message.createdAt).toISOString()} · ${source}] ${message.text.slice(0, 2000)}`;
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

module.exports = { post, flush, deliverLearned, unseen, bridgeText, markSeen, deliverHeartbeat, normalizePending, PROACTIVE_KINDS };
