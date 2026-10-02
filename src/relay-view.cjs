'use strict';
// What a paired phone may see: the one conversation, its pending questions, and goal status.
// Settings, profile, keys, memory and extension details never leave the PC.
const { PROACTIVE_KINDS } = require('./proactive-chat.cjs');

const MAX_MESSAGES = 200;
const MAX_TEXT = 20000;
const cut = (value, max) => String(value ?? '').slice(0, max);

function messageLabel(message) {
  if (message.role === 'user') return message.kind === 'clarification' ? 'You · answer' : 'You';
  if (message.role === 'tool') return 'Action';
  if (message.goalId) return `Goal · ${message.goalName || 'Little Bot'}`;
  if (message.kind === 'heartbeat') return `Little Bot · on its own${message.heartbeatTopic ? ` · ${message.heartbeatTopic}` : ''}`;
  if (message.kind === 'memory') return 'Little Bot · learned';
  if (message.kind === 'watch') return 'Little Bot · web watch';
  if (message.kind === 'offer') return 'Little Bot · offer';
  if (message.automationId) return `Little Bot · ${message.automationName || 'Automation'}`;
  return 'Little Bot';
}

function slimMessage(message) {
  const entry = { id: cut(message.id, 128), role: message.role, text: cut(message.text, MAX_TEXT), label: messageLabel(message) };
  for (const key of ['kind', 'status', 'phase']) if (typeof message[key] === 'string') entry[key] = cut(message[key], 40);
  for (const key of ['createdAt', 'updatedAt']) if (Number.isFinite(message[key])) entry[key] = message[key];
  if (PROACTIVE_KINDS.includes(message.kind)) entry.proactive = true;
  if (Array.isArray(message.actions) && message.actions.length) entry.actions = message.actions.map(({ id, label }) => ({ id, label }));
  if (message.answer?.choice) entry.answer = { choice: message.answer.choice };
  if (Array.isArray(message.attachments) && message.attachments.length) entry.attachments = message.attachments.map(item => ({
    name: cut(item.name, 200), size: Number.isFinite(item.size) ? item.size : undefined,
    ...(typeof item.thumbnail === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(item.thumbnail) && item.thumbnail.length < 200000 ? { thumbnail: item.thumbnail } : {}),
  }));
  return entry;
}

function slimApproval(approval) {
  const question = approval.dynamicTool === 'ask_user' ? approval.questions?.[0] : null;
  return {
    requestId: approval.requestId, kind: approval.kind, title: cut(approval.title, 200), detail: cut(approval.detail, 4000),
    ...(question ? { question: cut(question.question, 2000), options: (question.options || []).map(option => cut(option.label, 200)).slice(0, 6), ask: true } : {}),
  };
}

function snapshot(state, { allowApprovals = false } = {}) {
  const chat = (state.chats || [])[0] || null;
  const messages = chat ? chat.messages.slice(-MAX_MESSAGES) : [];
  return {
    version: state.appVersion,
    ready: state.runtime?.status === 'ready' && state.account?.status === 'connected',
    runtimeError: state.runtime?.status === 'error' ? cut(state.runtime.error || 'The local engine could not start.', 400) : '',
    chat: chat ? { id: chat.id, status: chat.status, error: cut(chat.error, 1000), more: chat.messages.length > messages.length } : null,
    messages: messages.map(slimMessage),
    approvals: (state.approvals || []).filter(item => !chat || item.chatId === chat.id).map(slimApproval),
    allowApprovals,
    goals: (state.autonomy?.goals || []).map(goal => ({ id: goal.id, name: cut(goal.name, 120), status: goal.status,
      nextRunAt: Number.isFinite(goal.nextRunAt) ? goal.nextRunAt : null, nextStep: cut(goal.nextStep, 300) })),
    autonomyPaused: Boolean(state.autonomy?.paused),
  };
}

const excerpt = text => { const value = String(text || '').replace(/\s+/g, ' ').trim(); return value.length > 160 ? `${value.slice(0, 157)}…` : value; };

// Notifications to send when moving from one snapshot to the next.
function notifications(previous, next) {
  if (!previous) return [];
  const result = [];
  const known = new Set(previous.messages.map(message => message.id));
  for (const message of next.messages) {
    if (known.has(message.id) || !message.proactive) continue;
    result.push({ title: message.label, body: excerpt(message.text) || 'New message', tag: `message-${message.id}` });
  }
  const before = new Set(previous.approvals.map(item => item.requestId));
  for (const approval of next.approvals) {
    if (before.has(approval.requestId)) continue;
    result.push(approval.ask
      ? { title: 'Little Bot has a question', body: excerpt(approval.question), tag: `approval-${approval.requestId}` }
      : { title: 'Little Bot needs your approval', body: excerpt(approval.title), tag: `approval-${approval.requestId}` });
  }
  if (previous.chat?.status === 'running' && next.chat?.status === 'idle') {
    const latest = [...next.messages].reverse().find(message => message.role === 'user' || (message.role === 'assistant' && !message.proactive && message.kind !== 'question'));
    const reply = latest?.role === 'assistant' ? latest : null;
    if (reply) result.push({ title: 'Little Bot replied', body: excerpt(reply.text) || 'Your reply is ready.', tag: 'reply' });
  }
  return result;
}

module.exports = { snapshot, slimMessage, notifications, messageLabel, MAX_MESSAGES };
