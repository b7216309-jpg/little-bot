'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Who the user is (email, phone, name, details they list) must not leave the PC unless they
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
const LABELS = { email: 'your email address', phone: 'your phone number', name: 'your name', custom: 'a private detail you listed' };
// A full name on a "Name:" line of USER.md. Two to four words only: a lone first name would block ordinary searches.
const NAME_LINE = /^\s*[-*]?\s*(?:preferred name|full name|name|nom complet|nom|pr[ée]nom et nom)\s*:\s*(.+?)\s*\.?\s*$/i;
const FULL_NAME = /^\p{L}[\p{L}'’.-]*(?:\s+\p{L}[\p{L}'’.-]*){1,3}$/u;
const UNSET = /^(?:not set|unknown|none|n\/a|non renseign[ée])$/i;
// Listed details and names also match with spacing, punctuation and & / "and" written differently.
const LOOSE_MIN = 6;
const loose = text => String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
// Scripts a command runs: `python fetch.py` shows nothing, so the script's own text is checked with it.
const SCRIPT_EXT = 'py|pyw|js|mjs|cjs|ts|ps1|psm1|sh|bash|bat|cmd|rb|pl|php|vbs|lua';
const QUOTED_SCRIPT = new RegExp(`["']([^"'\\r\\n]+\\.(?:${SCRIPT_EXT}))["']`, 'gi');
const BARE_SCRIPT = new RegExp(`(?:^|[\\s=(&|;])((?:[a-z]:)?[\\w~.\\\\/-]+\\.(?:${SCRIPT_EXT}))(?=$|[\\s;|&)"'])`, 'gi');
const PYTHON_MODULE = /\b(?:import|from)\s+([A-Za-z_]\w*)|\s-m\s+([A-Za-z_][\w.]*)/g;
// Folders a command moves into before it runs a script (`cd tools; node send.js`).
const CHANGE_DIR = /(?:^|[;&|\r\n]\s*)(?:cd|chdir|pushd|set-location|sl)\s+(?:-(?:literal)?path\s+)?["']?([^"';&|\r\n]+?)["']?\s*(?=$|[;&|\r\n])/gi;
const SCRIPT_LIMIT = 256 * 1024;
const SCRIPTS_PER_COMMAND = 6;

// Tools that act only on this PC (or the user's own phone) may carry personal details.
const LOCAL_TOOLS = new Set(['ask_user', 'attachment_send', 'calendar_list', 'calendar_manage', 'clipboard', 'document_render',
  'followup_manage', 'games_list', 'goal_finish', 'goal_manage', 'intention_manage', 'launch_propose', 'memory_forget',
  'memory_save', 'memory_search', 'phone_action', 'schedule_manage', 'screen_capture', 'session_read', 'skill_list',
  'skill_read', 'standing_intent_manage', 'windows_ui', 'workspace_list', 'workspace_read', 'workspace_write']);
// Commands that can send data off the PC.
const NETWORK_COMMAND = /:\/\/|\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|send-mailmessage|scp|sftp|ssh|ftp|nc|ncat|telnet|bitsadmin|certutil|httpx|aiohttp|axios|smtplib)\b|webclient|httpclient|http\.client|requests\.|urllib|fetch\(|socket\./i;

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

// The details to guard: emails, phone numbers and a full name found in USER.md, then the user's own list.
function detectDetails(profileText = '', extra = []) {
  const details = [], seen = new Set();
  const add = (kind, value, key, more = {}) => { if (!seen.has(key)) { seen.add(key); details.push({ kind, value, key, label: LABELS[kind], ...more }); } };
  for (const email of String(profileText).match(EMAIL) || []) {
    // The address also counts when its two halves appear apart ("sam.doe at example.com").
    const [local, domain] = email.toLowerCase().split('@');
    add('email', email, email.toLowerCase(), loose(local).length >= 5 ? { parts: { local: loose(local), domain } } : {});
  }
  for (const line of String(profileText).split(/\r?\n/)) {
    for (const run of line.match(PHONE_RUN) || []) {
      const digits = phoneDigits(run);
      if (digits.length >= PHONE_DIGITS && digits.length <= 15 && (run.trim().startsWith('+') || PHONE_LINE.test(line))) add('phone', run.trim(), phoneKey(digits));
    }
    const name = NAME_LINE.exec(line)?.[1]?.trim();
    if (name && !UNSET.test(name) && FULL_NAME.test(name)) add('name', name, name.toLowerCase(), { loose: loose(name) });
  }
  for (const term of normalizeExtra(extra)) add('custom', term, term.toLowerCase(), loose(term).length >= LOOSE_MIN ? { loose: loose(term) } : {});
  return details;
}

// Percent-encoding (%40 for @) and JSON escapes are undone before matching.
function flatten(value) {
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); } catch { return ''; }
  text = String(text || '').replace(/(?:%[0-9a-f]{2})+/gi, part => { try { return decodeURIComponent(part); } catch { return part; } });
  return text.replace(/\\u0040/gi, '@').toLowerCase();
}

function carries(view, detail) {
  if (detail.kind === 'phone') return view.runs.some(digits => phoneKey(digits) === detail.key);
  if (view.text.includes(detail.key)) return true;
  if (detail.loose && view.loose.includes(detail.loose)) return true;
  return Boolean(detail.parts && view.loose.includes(detail.parts.local) && view.text.includes(detail.parts.domain));
}
const view = value => { const text = flatten(value); return { text, runs: phoneRuns(text), loose: loose(text) }; };

// The first detail the value carries that the user did not put in their own request.
function findDetail(value, details, allowText = '') {
  if (!details?.length || value === undefined || value === null) return null;
  const sent = view(value), allowed = view(allowText);
  return details.find(detail => carries(sent, detail) && !carries(allowed, detail)) || null;
}

// A command with the text of the scripts it runs from disk (by path, or a Python module from its folder).
function commandPayload(command, cwd = process.cwd()) {
  const text = Array.isArray(command) ? command.join(' ') : String(command || '');
  const files = new Set();
  for (const match of text.matchAll(QUOTED_SCRIPT)) files.add(match[1]);
  for (const match of text.matchAll(BARE_SCRIPT)) files.add(match[1]);
  if (/\bpy(?:thon\d*(?:\.exe)?)?\b/i.test(text)) for (const match of text.matchAll(PYTHON_MODULE)) files.add(`${(match[1] || match[2]).replace(/\./g, '/')}.py`);
  const home = value => value.trim().replace(/^~(?=$|[\\/])/, os.homedir());
  const folders = [cwd, ...[...text.matchAll(CHANGE_DIR)].map(match => path.resolve(cwd, home(match[1])))];
  const scripts = [];
  for (const file of [...files].slice(0, SCRIPTS_PER_COMMAND)) {
    for (const folder of new Set(folders)) {
      try {
        const full = path.resolve(folder, home(file));
        const stat = fs.statSync(full);
        if (stat.isFile() && stat.size <= SCRIPT_LIMIT) { scripts.push(fs.readFileSync(full, 'utf8')); break; }
      } catch { /* Not a file on this PC. */ }
    }
  }
  const all = [text, ...scripts].join('\n');
  return { text: all, network: NETWORK_COMMAND.test(all) };
}

const outwardTool = name => !LOCAL_TOOLS.has(String(name || ''));
const networkCommand = command => NETWORK_COMMAND.test(String(command || ''));

module.exports = { LOCAL_TOOLS, commandPayload, detectDetails, findDetail, networkCommand, normalizeExtra, outwardTool };
