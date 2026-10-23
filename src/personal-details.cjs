'use strict';

// Who the user is (email, phone, details they list) must not leave the PC unless they
// asked for it. Little Bot finds these details in USER.md plus the Security page list,
// and checks every call that can reach the internet for them.
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
// A run of 9+ digits with the separators phone numbers are written with. In USER.md a
// run counts as a phone number only when it starts with + or its line says so, so dates,
// timestamps and IDs are not taken for one.
const PHONE_RUN = /\+?\d[\d ().-]{7,}\d/g;
const PHONE_LINE = /phone|\btel\b|t[ée]l[ée]phone|mobile|\bcell|portable|whatsapp|num[ée]ro/i;
const PHONE_DIGITS = 9;
const EXTRA_LIMIT = 50;
const EXTRA_LENGTH = 200;
const MIN_EXTRA = 4;
const LABELS = { email: 'your email address', phone: 'your phone number', custom: 'a private detail you listed' };

// Tools that act only on this PC (or the user's own phone) may carry personal details.
const LOCAL_TOOLS = new Set(['ask_user', 'attachment_send', 'calendar_list', 'calendar_manage', 'clipboard', 'document_render',
  'followup_manage', 'games_list', 'goal_finish', 'goal_manage', 'intention_manage', 'launch_propose', 'memory_forget',
  'memory_save', 'memory_search', 'phone_action', 'schedule_manage', 'screen_capture', 'session_read', 'skill_list',
  'skill_read', 'standing_intent_manage', 'windows_ui', 'workspace_list', 'workspace_read', 'workspace_write']);
// Commands that can send data off the PC.
const NETWORK_COMMAND = /:\/\/|\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|send-mailmessage|scp|sftp|ssh|ftp|nc|ncat|telnet|bitsadmin|certutil)\b|webclient|httpclient|requests\.|urllib|fetch\(/i;

const phoneDigits = text => String(text).replace(/\D/g, '');
const phoneRuns = text => (String(text).match(PHONE_RUN) || []).map(phoneDigits).filter(digits => digits.length >= PHONE_DIGITS);
// The last nine digits identify a number however its country code is written.
const phoneKey = digits => digits.slice(-PHONE_DIGITS);

function normalizeExtra(value) {
  const lines = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
  const seen = new Set();
  return lines.map(line => typeof line === 'string' ? line.trim() : '')
    .filter(line => line.length >= MIN_EXTRA && line.length <= EXTRA_LENGTH && !seen.has(line.toLowerCase()) && seen.add(line.toLowerCase()))
    .slice(0, EXTRA_LIMIT);
}

// The details to guard: emails and phone numbers found in USER.md, then the user's own list.
function detectDetails(profileText = '', extra = []) {
  const details = [], seen = new Set();
  const add = (kind, value, key) => { if (!seen.has(key)) { seen.add(key); details.push({ kind, value, key, label: LABELS[kind] }); } };
  for (const email of String(profileText).match(EMAIL) || []) add('email', email, email.toLowerCase());
  for (const line of String(profileText).split(/\r?\n/)) {
    for (const run of line.match(PHONE_RUN) || []) {
      const digits = phoneDigits(run);
      if (digits.length >= PHONE_DIGITS && digits.length <= 15 && (run.trim().startsWith('+') || PHONE_LINE.test(line))) add('phone', run.trim(), phoneKey(digits));
    }
  }
  for (const term of normalizeExtra(extra)) add('custom', term, term.toLowerCase());
  return details;
}

// Percent-encoding (%40 for @) and JSON escapes are undone before matching.
function flatten(value) {
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); } catch { return ''; }
  text = String(text || '').replace(/(?:%[0-9a-f]{2})+/gi, part => { try { return decodeURIComponent(part); } catch { return part; } });
  return text.replace(/\\u0040/gi, '@').toLowerCase();
}

function carries(text, runs, detail) {
  return detail.kind === 'phone' ? runs.some(digits => phoneKey(digits) === detail.key) : text.includes(detail.key);
}

// The first detail the value carries that the user did not put in their own request.
function findDetail(value, details, allowText = '') {
  if (!details?.length || value === undefined || value === null) return null;
  const text = flatten(value), runs = phoneRuns(text);
  const allowed = flatten(allowText), allowedRuns = phoneRuns(allowed);
  return details.find(detail => carries(text, runs, detail) && !carries(allowed, allowedRuns, detail)) || null;
}

const outwardTool = name => !LOCAL_TOOLS.has(String(name || ''));
const networkCommand = command => NETWORK_COMMAND.test(String(command || ''));

module.exports = { LOCAL_TOOLS, detectDetails, findDetail, networkCommand, normalizeExtra, outwardTool };
