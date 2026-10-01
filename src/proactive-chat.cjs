'use strict';

const { randomUUID } = require('node:crypto');

// Puts a proactive heartbeat result into the conversation, so initiative reads as the bot talking
// to the user instead of a toast that disappears. It never interrupts a running or waiting turn.
function deliverHeartbeat(data, item, nowMs = Date.now()) {
  if (!item || item.status !== 'alert' || item.source === 'goal' || typeof item.summary !== 'string' || !item.summary.trim()) return null;
  const chat = data?.chats?.[0];
  if (!chat || chat.status !== 'idle' || !Array.isArray(chat.messages)) return null;
  if (chat.messages.some(message => message.kind === 'heartbeat' && message.heartbeatId === item.id)) return null;
  const message = { id: randomUUID(), role: 'assistant', kind: 'heartbeat', status: 'completed', createdAt: nowMs,
    heartbeatId: item.id, ...(item.topic ? { heartbeatTopic: item.topic } : {}), text: item.summary.trim() };
  chat.messages.push(message);
  chat.updatedAt = nowMs;
  return message;
}

module.exports = { deliverHeartbeat };
