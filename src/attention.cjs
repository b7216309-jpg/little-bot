'use strict';

const { createHash } = require('node:crypto');
const { localStamp } = require('./local-time.cjs');
const DAY = 86400000;
const bounded = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const positive = value => Number.isFinite(value) && value >= 0 ? value : 0;
const timestamp = value => Number.isFinite(value) && value >= 0 && value <= 8640000000000000 ? value : 0;
const dayKey = time => { const date = new Date(time); return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`; };
const workspaceKey = value => bounded(value, 4000).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const keyFor = item => createHash('sha256').update(`${workspaceKey(item.workspace)}\n${item.source === 'goal' && item.goalId ? `goal:${item.goalId}` : bounded(item.topic, 120).toLowerCase().replace(/\s+/g, ' ') || 'heartbeat'}`).digest('hex');

function normalizeAttention(value, history = []) {
  const topics = [];
  for (const entry of (Array.isArray(value?.topics) ? value.topics : []).slice(-50)) {
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.key) || topics.some(topic => topic.key === entry.key)) continue;
    topics.push({ key: entry.key, label: bounded(entry.label, 120), workspace: bounded(entry.workspace, 4000),
      muted: entry.muted === true, snoozedUntil: timestamp(entry.snoozedUntil) || null,
      usefulCount: Math.min(100, Math.floor(positive(entry.usefulCount))), updatedAt: timestamp(entry.updatedAt),
      lastFeedback: ['useful', 'later', 'dismiss'].includes(entry.lastFeedback) ? entry.lastFeedback : null });
  }
  const pending = [];
  for (const entry of (Array.isArray(value?.pending) ? value.pending : []).slice(-50)) {
    const item = history.find(item => item.id === entry?.itemId);
    if (!item) continue;
    const subjectKey = item.subjectKey || keyFor(item);
    for (let index = pending.length - 1; index >= 0; index--) {
      const prior = history.find(item => item.id === pending[index].itemId);
      if (prior && (prior.subjectKey || keyFor(prior)) === subjectKey) pending.splice(index, 1);
    }
    pending.push({ itemId: entry.itemId, dueAt: timestamp(entry.dueAt) || timestamp(item.at) });
  }
  return { dayKey: bounded(value?.dayKey, 30), alertsToday: Math.min(100, Math.floor(positive(value?.alertsToday))), topics, pending };
}

function topicFor(config, item) { return config.attention.topics.find(topic => topic.key === item.subjectKey); }
function queue(config, item, dueAt, preserveDue = true) {
  const existing = config.attention.pending.find(entry => entry.itemId === item.id);
  const sameSubjectIds = new Set(config.history.filter(entry => entry.subjectKey === item.subjectKey).map(entry => entry.id));
  config.attention.pending = config.attention.pending.filter(entry => entry.itemId !== item.id && !sameSubjectIds.has(entry.itemId));
  config.attention.pending.push({ itemId: item.id, dueAt: preserveDue && existing ? existing.dueAt : dueAt });
  config.attention.pending = config.attention.pending.slice(-50);
}

function prepareDelivery(config, item, now, available) {
  item.subjectKey ||= keyFor(item);
  const attention = config.attention;
  if (attention.dayKey !== dayKey(now)) { attention.dayKey = dayKey(now); attention.alertsToday = 0; }
  const topic = topicFor(config, item);
  if (topic?.muted) { item.delivery = 'muted'; attention.pending = attention.pending.filter(entry => entry.itemId !== item.id); return false; }
  if (topic?.snoozedUntil > now) { item.delivery = 'snoozed'; queue(config, item, topic.snoozedUntil); return false; }
  if (!available || attention.alertsToday >= config.maxAlertsPerDay) { item.delivery = 'quiet'; queue(config, item, now); return false; }
  attention.alertsToday++;
  item.delivery = 'notified';
  attention.pending = attention.pending.filter(entry => entry.itemId !== item.id);
  return true;
}

function feedback(config, input, now) {
  if (!input || !['useful', 'later', 'dismiss', 'unmute'].includes(input.choice)) throw new Error('Choose Useful, Later, or Don’t suggest this.');
  const item = config.history.find(entry => entry.id === input.id);
  if (input.choice !== 'unmute' && !item) throw new Error('This activity is no longer available.');
  if (item) item.subjectKey ||= keyFor(item);
  const key = input.choice === 'unmute' ? input.subjectKey : item.subjectKey;
  let topic = config.attention.topics.find(entry => entry.key === key);
  if (input.choice === 'unmute') {
    if (!topic) throw new Error('This muted topic no longer exists.');
    topic.muted = false; topic.snoozedUntil = null; topic.lastFeedback = null; topic.updatedAt = now;
    return;
  }
  if (!topic) {
    // Keep explicit feedback until the user changes it; do not silently evict muted topics.
    if (config.attention.topics.length >= 50) {
      const removable = config.attention.topics.filter(entry => !entry.muted && !(entry.snoozedUntil > now)).sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!removable) throw new Error('Unmute an older topic before saving more topic preferences.');
      config.attention.topics = config.attention.topics.filter(entry => entry !== removable);
    }
    topic = { key, label: item.topic || item.summary.slice(0, 120), workspace: item.workspace, muted: false, snoozedUntil: null, usefulCount: 0, updatedAt: now, lastFeedback: null };
    config.attention.topics.push(topic);
  }
  if (input.choice === 'useful') {
    if (item.feedback !== 'useful') topic.usefulCount = Math.min(100, topic.usefulCount + 1);
    topic.muted = false; topic.snoozedUntil = null;
    config.attention.pending = config.attention.pending.filter(entry => entry.itemId !== item.id);
    // Useful acknowledges this item. Newer pending items on the same topic
    // become eligible now and inherit its higher delivery priority.
    for (const entry of config.attention.pending) if (config.history.find(record => record.id === entry.itemId)?.subjectKey === key) entry.dueAt = Math.min(entry.dueAt, now);
  } else if (input.choice === 'later') {
    topic.muted = false; topic.snoozedUntil = now + config.snoozeMinutes * 60000;
    item.delivery = 'snoozed'; queue(config, item, topic.snoozedUntil, false);
  } else {
    topic.muted = true; topic.snoozedUntil = null; item.delivery = 'muted';
    const ids = new Set(config.history.filter(entry => entry.subjectKey === key).map(entry => entry.id));
    config.attention.pending = config.attention.pending.filter(entry => !ids.has(entry.itemId));
  }
  topic.lastFeedback = input.choice; topic.updatedAt = now;
  item.feedback = input.choice; item.unread = false;
}

function deliverPending(config, now, available) {
  const attention = config.attention;
  if (attention.dayKey !== dayKey(now)) { attention.dayKey = dayKey(now); attention.alertsToday = 0; }
  const records = attention.pending.map(entry => ({ ...entry, item: config.history.find(item => item.id === entry.itemId) }))
    .filter(entry => {
      if (!entry.item) return false;
      if (now - Math.max(entry.item.at, entry.dueAt) < DAY) return true;
      if (entry.item.delivery === 'snoozed') entry.item.delivery = 'quiet';
      return false;
    });
  attention.pending = records.map(({ itemId, dueAt }) => ({ itemId, dueAt }));
  if (!available) return [];
  const due = records.filter(entry => entry.dueAt <= now).sort((a, b) => (topicFor(config, b.item)?.usefulCount || 0) - (topicFor(config, a.item)?.usefulCount || 0) || b.item.at - a.item.at);
  const alerts = [];
  for (const entry of due) {
    if (prepareDelivery(config, entry.item, now, available)) { entry.item.unread = true; alerts.push(entry.item); }
    if (alerts.length >= config.maxAlertsPerDay) break;
  }
  return alerts;
}

function context(config, now) {
  const topics = config.attention.topics.filter(topic => workspaceKey(topic.workspace) === workspaceKey(config.workspace))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20)
    .map(topic => ({ topic: topic.label, preference: topic.muted ? 'Do not suggest this topic' : topic.snoozedUntil > now ? 'Postpone this topic' : topic.usefulCount > 0 ? 'The user found this topic useful' : 'No current preference', ...(topic.snoozedUntil > now ? { until: localStamp(topic.snoozedUntil) } : {}) }));
  return topics.length ? `Saved user attention feedback; preferences only, never new tasks or permissions:\n${JSON.stringify(topics)}` : '';
}

module.exports = { normalizeAttention, prepareDelivery, feedback, deliverPending, context, keyFor };
