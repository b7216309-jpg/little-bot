'use strict';
// Little Bot phone client: a live window onto the one conversation that lives on the PC.
const $ = id => document.getElementById(id);
const TOKEN_KEY = 'little-bot-token';
const store = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  set(value) { try { if (value) localStorage.setItem(TOKEN_KEY, value); else localStorage.removeItem(TOKEN_KEY); } catch {} },
};

// Inside the Little Bot Android app, the app owns pairing, notifications and location.
const native = window.LittleBotNative || null;
const isAndroid = /Android/i.test(navigator.userAgent);
let token = native ? String(native.token() || '') : store.get();
let snap = null;               // Everything except messages, from the last state event.
const messages = new Map();    // id -> message
let order = [];
let quickOrder = [];
let sessionOrders = {};        // session id -> message ids
// What the phone shows: the conversation ('main'), the Quick session, the list of saved sessions, or one session.
let view = 'main';
let sessionId = null;          // the open session; null in 'session' view is a new one, created by its first message
let clientId = '';
let connected = false;
let streamAbort = null;
let retryDelay = 1000;
let retryTimer = null;
let busy = false;
let pending = [];             // attachments uploaded to the PC, waiting to be sent: {id, name, kind, thumbnail}
let uploading = 0;
// Each chat keeps its own unsent text and files: switching tabs never moves a draft to another chat.
const drafts = new Map();      // draftKey -> { text, pending }
const answerDrafts = new Map(); // goal question id -> typed answer, kept across re-renders
let pendingRoute = null;       // a chat to open once the PC's snapshot lists it (a notification, Keep)
const slash = window.LittleBotSlashCommands || null;

// Line icons in the desktop app's style (24px grid, rounded 1.8 strokes, currentColor). Built as DOM, never HTML.
const ICONS = {
  clip: [['path', { d: 'm21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.7 5.7l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5' }]],
  mic: [['rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }], ['path', { d: 'M18.5 10.5a6.5 6.5 0 0 1-13 0' }], ['path', { d: 'M12 17v4M9 21h6' }]],
  send: [['path', { d: 'M12 19V5' }], ['path', { d: 'm6 11 6-6 6 6' }]],
  stop: [['rect', { x: 7, y: 7, width: 10, height: 10, rx: 2, fill: 'currentColor' }]],
  goal: [['circle', { cx: 12, cy: 12, r: 9 }], ['circle', { cx: 12, cy: 12, r: 5 }], ['circle', { cx: 12, cy: 12, r: 1.4, fill: 'currentColor' }]],
  more: [['circle', { cx: 5.5, cy: 12, r: 1.4, fill: 'currentColor' }], ['circle', { cx: 12, cy: 12, r: 1.4, fill: 'currentColor' }], ['circle', { cx: 18.5, cy: 12, r: 1.4, fill: 'currentColor' }]],
  x: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  file: [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M14 3v5h5' }]],
  tools: [['path', { d: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z' }]],
  thinking: [['path', { d: 'M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V17h5.2v-1.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z' }], ['path', { d: 'M9.8 20.5h4.4' }]],
  list: [['path', { d: 'M9 6h11M9 12h11M9 18h11' }], ['path', { d: 'm3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17' }]],
  download: [['path', { d: 'M12 4v11' }], ['path', { d: 'm7 10 5 5 5-5' }], ['path', { d: 'M5 20h14' }]],
};
function svgIcon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attributes] of ICONS[name] || []) {
    const shape = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, String(value));
    svg.append(shape);
  }
  const span = document.createElement('span');
  span.className = 'i';
  span.append(svg);
  return span;
}
for (const slot of document.querySelectorAll('[data-icon]')) slot.replaceWith(svgIcon(slot.dataset.icon));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function toast(text, bad = false) {
  const node = $('toast');
  node.textContent = text; node.classList.toggle('bad', bad); node.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.add('hidden'), bad ? 5000 : 2500);
}

async function api(path, body) {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { unpaired(); throw new Error(data.error || 'This phone is no longer paired.'); }
  if (!response.ok) throw new Error(data.error || `Little Bot answered ${response.status}.`);
  return data;
}
async function attempt(action) {
  try { return await action(); } catch (error) { toast(error.message || String(error), true); return null; }
}

// Pairing
function showScreen(name) {
  $('pair').classList.toggle('hidden', name !== 'pair');
  for (const id of ['chat', 'composer', 'goals-button', 'menu-button', 'tabs']) $(id).classList.toggle('hidden', name !== 'chat');
}
function unpaired() {
  if (native) { native.unpaired(); return; }
  token = ''; store.set('');
  streamAbort?.abort(); streamAbort = null; connected = false;
  setStatus('Not paired', 'offline');
  showScreen('pair');
}
function startPairing(code) {
  showScreen('pair');
  $('pair-form').classList.remove('hidden');
  $('pair-hint').textContent = 'Little Bot on your PC is ready to pair with this phone.';
  setStatus('Ready to pair', '');
  // Hand the pairing to the installed Android app (Chrome opens it through an intent link).
  if (isAndroid && !native) {
    const link = $('pair-native');
    link.href = `intent://pair?base=${encodeURIComponent(location.origin)}&code=${encodeURIComponent(code)}#Intent;scheme=littlebot;package=com.littlebot.app;S.browser_fallback_url=${encodeURIComponent(location.origin + '/little-bot.apk')};end`;
    link.classList.remove('hidden');
  }
  $('pair-form').onsubmit = async event => {
    event.preventDefault();
    $('pair-error').classList.add('hidden');
    try {
      const response = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: $('pair-name').value }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Pairing failed.');
      token = data.token; store.set(token);
      history.replaceState(null, '', '/');
      $('pair-form').classList.add('hidden');
      boot();
    } catch (error) {
      $('pair-error').textContent = error.message; $('pair-error').classList.remove('hidden');
    }
  };
}

// Live stream (Server-Sent Events over fetch, so the token stays in a header)
function setStatus(text, kind) {
  const node = $('status');
  node.textContent = text;
  node.className = `status ${kind || ''}`;
}
function scheduleReconnect() {
  connected = false;
  clearTimeout(retryTimer);
  setStatus(navigator.onLine === false ? 'No network' : 'PC unreachable · retrying', 'offline');
  render();
  retryTimer = setTimeout(connect, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 15000);
}
// The PC pings every 25 s. A stream that stays silent longer is dead even if it never closed (a VPN restart,
// a network switch), so drop it and reconnect; the reconnect starts with a full snapshot.
const STREAM_SILENCE_MS = 65000;
let lastStreamByte = 0;
let hiddenSince = 0;
setInterval(() => {
  if (connected && streamAbort && Date.now() - lastStreamByte > STREAM_SILENCE_MS) streamAbort.abort();
}, 10000);
function restartStream() {
  if (!token) return;
  retryDelay = 1000;
  connected = false;
  connect();
}
async function connect() {
  if (!token) return;
  clearTimeout(retryTimer);
  streamAbort?.abort();
  const controller = new AbortController();
  streamAbort = controller;
  try {
    const response = await fetch('/api/events', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' });
    if (response.status === 401) return unpaired();
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    lastStreamByte = Date.now();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      lastStreamByte = Date.now();
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const data = block.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
        if (data) { try { handle(JSON.parse(data)); } catch (error) { console.error(error); } }
      }
    }
    if (streamAbort === controller) scheduleReconnect();
  } catch (error) {
    // Aborted by a newer connect(): that one owns the stream. Aborted by the silence watchdog: reconnect.
    if (controller.signal.aborted && streamAbort !== controller) return;
    if (streamAbort === controller) scheduleReconnect();
  }
}

function applyMessages(upsert, ids, quickIds, sessionIds, quick = false, session = null) {
  for (const message of upsert || []) {
    messages.set(message.id, message);
    if (ids) continue;
    const list = quick ? quickOrder : session ? (sessionOrders[session] ||= []) : order;
    if (!list.includes(message.id)) list.push(message.id);
  }
  if (ids) {
    order = ids.slice(); quickOrder = (quickIds || []).slice();
    sessionOrders = Object.fromEntries(Object.entries(sessionIds || {}).map(([id, list]) => [id, list.slice()]));
    const keep = new Set([...order, ...quickOrder, ...Object.values(sessionOrders).flat()]);
    for (const id of messages.keys()) if (!keep.has(id)) messages.delete(id);
  }
}
function handle(event) {
  if (event.type === 'hello') {
    messages.clear(); order = []; quickOrder = [];
    clientId = event.clientId; connected = true; retryDelay = 1000;
    reportPresence();
  }
  if (event.type === 'hello' || event.type === 'state') {
    const { type, ids, quickIds, sessionIds, upsert, clientId: _, ...rest } = event;
    snap = rest;
    applyMessages(upsert, ids, quickIds, sessionIds);
  } else if (event.type === 'messages') {
    applyMessages(event.upsert, null, null, null, event.quick === true, typeof event.session === 'string' ? event.session : null);
  }
  if (pendingRoute && snap && !openRoute(pendingRoute)) { if (Date.now() > pendingRoute.until) pendingRoute = null; }
  render();
}

// Routes: "#session=<id>", "#quick" and "#goals", from a notification or Keep. Returns false while the
// snapshot does not list that chat yet.
function parseRoute(hash) {
  const session = /^#session=([^&]+)$/.exec(hash || '');
  if (session) return { view: 'session', id: decodeURIComponent(session[1]), until: Date.now() + 15000 };
  if (hash === '#quick') return { view: 'quick', until: Date.now() + 15000 };
  if (hash === '#goals') return { view: 'goals', until: Date.now() + 15000 };
  return null;
}
function openRoute(route) {
  if (!route || !snap) return false;
  if (route.view === 'session' && !(snap.sessions || []).some(item => item.id === route.id)) return false;
  pendingRoute = null;
  if (route.view === 'goals') { renderGoals(); if (!$('goals-sheet').open) $('goals-sheet').showModal(); }
  else setView(route.view, route.id || null);
  return true;
}
function routeTo(route) { if (route && !openRoute(route)) pendingRoute = { until: Date.now() + 15000, ...route }; }
function reportPresence() {
  if (!clientId || !token) return;
  api('presence', { clientId, visible: document.visibilityState === 'visible' }).catch(() => {});
}

// Rendering
function appendInline(parent, source) {
  const expression = /(\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*]))/g;
  let last = 0;
  for (const match of source.matchAll(expression)) {
    parent.append(document.createTextNode(source.slice(last, match.index)));
    if (match[2]) parent.append(el('strong', '', match[2]));
    else if (match[3]) parent.append(el('code', '', match[3]));
    else if (match[7]) parent.append(el('em', '', match[7]));
    else {
      const link = el('a', '', match[4] || match[6]);
      link.href = match[5] || match[6]; link.target = '_blank'; link.rel = 'noopener noreferrer';
      parent.append(link);
    }
    last = match.index + match[0].length;
  }
  parent.append(document.createTextNode(source.slice(last)));
}
// Lists, headings and quotes, like the desktop: the model's Markdown, built as DOM nodes (never HTML strings).
function appendBlocks(parent, source) {
  let text = [], list = null;
  const flush = () => {
    if (!text.length) return;
    const value = text.join('\n').replace(/^\n+|\n+$/g, '');
    if (value) appendInline(parent, value);
    text = [];
  };
  for (const line of source.split('\n')) {
    const bullet = /^\s{0,3}[-*•]\s+(.*)$/.exec(line), numbered = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = el(tag, 'md-list');
        if (numbered && numbered[1] !== '1') list.start = Number(numbered[1]);
        parent.append(list);
      }
      const item = el('li'); appendInline(item, bullet ? bullet[1] : numbered[2]); list.append(item);
      continue;
    }
    if (list && !line.trim()) continue;
    list = null;
    const heading = /^\s{0,3}#{1,4}\s+(.*?)\s*#*$/.exec(line), quote = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (heading) { flush(); const node = el('strong', 'md-heading'); appendInline(node, heading[1]); parent.append(node); }
    else if (quote) { flush(); const node = el('blockquote', 'md-quote'); appendInline(node, quote[1]); parent.append(node); }
    else if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); parent.append(el('hr', 'md-rule')); }
    else text.push(line);
  }
  flush();
}
function renderText(parent, text) {
  const source = String(text || '');
  const fences = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let last = 0;
  for (const match of source.matchAll(fences)) {
    appendBlocks(parent, source.slice(last, match.index));
    const pre = el('pre'); pre.append(el('code', '', match[2].replace(/\n$/, ''))); parent.append(pre);
    last = match.index + match[0].length;
  }
  appendBlocks(parent, source.slice(last));
}

// A file in a message: tapping a picture shows it full size, tapping any other file downloads it.
async function openFile(file) {
  const link = await attempt(() => api('fileLink', { id: file.id }));
  if (!link) return;
  if (link.kind === 'image') { $('viewer-image').src = link.url; $('viewer-image').alt = link.name || ''; $('viewer').showModal(); return; }
  if (native?.openFile) { native.openFile(new URL(link.url, location.origin).href, link.name || 'file'); return; }
  const anchor = el('a'); anchor.href = link.url; anchor.download = link.name || 'file';
  document.body.append(anchor); anchor.click(); anchor.remove();
  toast(`Downloading ${link.name || 'the file'}`);
}
function fileNode(file) {
  const button = el('button', file.thumbnail ? 'thumb' : 'file'); button.type = 'button';
  if (file.thumbnail) { const img = el('img'); img.src = file.thumbnail; img.alt = file.name; button.append(img); }
  else button.append(svgIcon('file'), document.createTextNode(file.name), svgIcon('download'));
  button.setAttribute('aria-label', file.thumbnail ? `Show ${file.name}` : `Download ${file.name}`);
  if (file.id) button.onclick = () => openFile(file); else button.disabled = true;
  return button;
}
// A background goal's question, answered here like on the desktop's goal card.
function goalAnswerForm(goal) {
  const question = goal.question;
  const form = el('form', 'goal-answer');
  const key = `${goal.id}:${question.id}`;
  const send = async value => {
    const answer = String(value || '').trim();
    if (!answer) return;
    for (const item of form.querySelectorAll('button,input')) item.disabled = true;
    const ok = await attempt(() => api('goalAnswer', { id: goal.id, questionId: question.id, answer }));
    if (ok) { answerDrafts.delete(key); toast('Answer sent'); }
    else for (const item of form.querySelectorAll('button,input')) item.disabled = false;
  };
  if (question.options?.length) {
    const row = el('div', 'row');
    for (const option of question.options) { const chip = el('button', 'chip', option); chip.type = 'button'; chip.onclick = () => send(option); row.append(chip); }
    form.append(row);
  }
  const line = el('div', 'answer-row');
  const input = el('input'); input.placeholder = 'Your answer'; input.maxLength = 2000; input.dataset.answerKey = key;
  input.value = answerDrafts.get(key) || '';
  input.addEventListener('input', () => answerDrafts.set(key, input.value));
  const submit = el('button', 'primary', 'Send'); submit.type = 'submit';
  line.append(input, submit);
  form.append(line);
  form.onsubmit = event => { event.preventDefault(); send(input.value); };
  return form;
}
// Re-rendering replaces the nodes: an answer being typed keeps its focus and caret.
function keepAnswerFocus(build) {
  const active = document.activeElement, key = active?.dataset?.answerKey;
  const caret = key ? [active.selectionStart, active.selectionEnd] : null;
  build();
  if (!key) return;
  const again = document.querySelector(`[data-answer-key="${CSS.escape(key)}"]`);
  if (again && again !== active) { again.focus({ preventScroll: true }); try { again.setSelectionRange(...caret); } catch { /* Not a text field. */ } }
}

function messageNode(message) {
  const node = el('div', `msg ${message.role}`);
  if (message.proactive) node.classList.add('proactive');
  if (message.scheduled) node.classList.add('scheduled');
  if (message.kind === 'question') node.classList.add('question');
  if (message.role === 'assistant' && ['running', 'inProgress'].includes(message.status)) node.classList.add('streaming');
  node.append(el('span', 'label', message.label));
  if (message.attachments?.length) {
    const thumbs = el('div', 'thumbs');
    for (const file of message.attachments) thumbs.append(fileNode(file));
    node.append(thumbs);
  }
  if (message.text || !message.attachments?.length) {
    const bubble = el('div', 'bubble');
    renderText(bubble, message.text || (message.status === 'running' ? '' : '…'));
    node.append(bubble);
  }
  if (message.actions?.length) {
    const bar = el('div', 'actions');
    if (message.answer) {
      const chosen = message.actions.find(item => item.id === message.answer.choice);
      bar.append(el('span', '', `You chose ${chosen?.label || message.answer.choice}`));
    } else for (const choice of message.actions) {
      const button = el('button', choice.id === 'do' || choice.id === 'launch' ? 'primary' : 'chip', choice.label);
      button.type = 'button';
      button.onclick = async () => {
        for (const item of bar.querySelectorAll('button')) item.disabled = true;
        const ok = await attempt(() => api('proactive', { messageId: message.id, choice: choice.id }));
        if (!ok) for (const item of bar.querySelectorAll('button')) item.disabled = false;
      };
      bar.append(button);
    }
    node.append(bar);
  }
  const goal = message.goalQuestionId ? (snap?.goals || []).find(item => item.id === message.goalId && item.question?.id === message.goalQuestionId) : null;
  if (goal) node.append(goalAnswerForm(goal));
  return node;
}
function toolsNode(group) {
  const details = el('details', 'tools');
  const failed = group.some(item => item.status === 'failed');
  const running = group.some(item => ['running', 'inProgress'].includes(item.status));
  const actions = group.filter(item => !item.thinking).length, thoughts = group.length - actions;
  const parts = [thoughts ? 'Thinking' : '', actions ? `${actions} action${actions === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  const summary = el('summary');
  summary.append(svgIcon(actions ? 'tools' : 'thinking'), document.createTextNode(`${parts}${running ? ' · running' : failed ? ' · some failed' : ''}`));
  details.append(summary);
  const body = el('div');
  for (const item of group.slice(-30)) body.append(el('p', item.thinking ? 'thought' : item.status === 'failed' ? 'failed' : '', (item.text || item.kind || 'Action').slice(0, item.thinking ? 2000 : 600)));
  details.append(body);
  return details;
}

function nearBottom() {
  const chat = $('chat');
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120;
}
const draftKey = (name = view, id = sessionId) => name === 'session' ? `session:${id || 'new'}` : name;
function saveDraft() { drafts.set(draftKey(), { text: $('input').value, pending }); }
function loadDraft() {
  const draft = drafts.get(draftKey()) || { text: '', pending: [] };
  $('input').value = draft.text; pending = draft.pending;
  renderPending(); sizeInput();
}
function setView(next, id = null) {
  saveDraft();
  view = next; sessionId = next === 'session' ? id : null;
  loadDraft();
  closeSlashMenu();
  const tab = view === 'session' ? 'sessions' : view;
  for (const [name, node] of [['main', $('tab-main')], ['quick', $('tab-quick')], ['sessions', $('tab-sessions')]]) {
    node.classList.toggle('active', tab === name); node.setAttribute('aria-pressed', String(tab === name));
  }
  $('input').placeholder = view === 'quick' ? 'Quick task for Little Bot…' : view === 'session' ? 'Message this session…' : 'Message Little Bot…';
  render();
  $('chat').scrollTop = view === 'sessions' ? 0 : $('chat').scrollHeight;
}
const activeChat = () => view === 'quick' ? snap?.quick : view === 'session' ? (snap?.sessions || []).find(item => item.id === sessionId) || null : view === 'main' ? snap?.chat : null;
// Every request that targets the open chat says which one it is.
const target = () => view === 'quick' ? { quick: true } : view === 'session' ? (sessionId ? { sessionId } : { newSession: true }) : {};
function ago(time) {
  if (!time) return '';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h` : when(time);
}
function sessionsList() {
  const items = [];
  const create = el('button', 'session-new', '+ New session'); create.type = 'button';
  create.onclick = () => setView('session', null);
  items.push(create);
  for (const session of snap?.sessions || []) {
    const row = el('button', 'session-row'); row.type = 'button';
    const busy = session.status === 'running' || session.status === 'waiting';
    row.append(el('strong', '', session.title), el('span', busy ? 'busy' : '', busy ? 'working…' : ago(session.updatedAt)));
    row.onclick = () => setView('session', session.id);
    items.push(row);
  }
  if (!(snap?.sessions || []).length) items.push(el('div', 'empty small', 'No saved sessions yet. A session is a separate conversation with its own history; the main conversation stays as it is.'));
  return items;
}
// A /goal running in this chat (set from the PC or by typing /goal here).
function renderGoalStrip(active) {
  const goal = active?.goal;
  $('goal-strip').classList.toggle('hidden', !goal);
  if (!goal) return;
  $('goal-strip').dataset.status = goal.status;
  $('goal-strip-condition').textContent = goal.condition;
  const step = `turn ${Math.min(goal.turns + (active.status === 'running' ? 1 : 0), goal.maxTurns)}/${goal.maxTurns}`;
  const label = goal.status === 'pursuing' ? (active.status === 'running' ? 'Working' : goal.phase === 'checking' ? 'Checking' : 'Continuing')
    : { paused: 'Paused', achieved: 'Reached', unmet: 'Can’t be finished', budget: 'Budget used' }[goal.status] || goal.status;
  $('goal-strip-status').textContent = [label, goal.status === 'pursuing' ? step : '', goal.reason].filter(Boolean).join(' · ');
  $('goal-strip-toggle').classList.toggle('hidden', goal.status === 'achieved');
  $('goal-strip-toggle').textContent = goal.status === 'pursuing' ? 'Pause' : 'Resume';
  $('goal-strip-clear').textContent = ['pursuing', 'paused'].includes(goal.status) ? 'Clear' : 'Dismiss';
}
function render() {
  // A session deleted on the PC sends the phone back to the list.
  if (view === 'session' && sessionId && snap && !(snap.sessions || []).some(item => item.id === sessionId)) { view = 'sessions'; sessionId = null; }
  const active = activeChat();
  const visible = view === 'quick' ? quickOrder : view === 'session' ? (sessionOrders[sessionId] || []) : view === 'main' ? order : [];
  const chatStatus = active?.status || 'idle';
  $('quick-bar').classList.toggle('hidden', view !== 'quick');
  $('session-bar').classList.toggle('hidden', view !== 'session');
  $('session-title').textContent = view === 'session' ? (active?.title || 'New session') : '';
  $('session-delete').classList.toggle('hidden', !active || view !== 'session');
  $('composer').classList.toggle('hidden', view === 'sessions' || !token);
  renderGoalStrip(view === 'sessions' ? null : active);
  $('quick-end').disabled = !snap?.quick;
  $('quick-keep').disabled = busy;
  $('goals-button').classList.toggle('badge', (snap?.goals || []).some(goal => goal.question));
  const running = chatStatus === 'running' || chatStatus === 'waiting';
  if (connected) {
    if (!snap?.ready) setStatus(snap?.runtimeError || 'PC connected · engine not ready', 'offline');
    else if (chatStatus === 'waiting') setStatus('Waiting for you', 'busy');
    else if (running) setStatus('Thinking…', 'busy');
    else setStatus('Connected to your PC', 'online');
  }
  const stick = nearBottom();
  const items = [];
  if (view === 'sessions') items.push(...sessionsList());
  if (view === 'main' && snap?.chat?.more) items.push(el('div', 'more', 'Older messages are on your PC'));
  if (view === 'session' && active?.more) items.push(el('div', 'more', 'Older messages are on your PC'));
  let tools = [];
  const flush = () => { if (tools.length) { items.push(toolsNode(tools)); tools = []; } };
  for (const id of visible) {
    const message = messages.get(id);
    if (!message) continue;
    if (message.role === 'tool' || message.thinking) { tools.push(message); continue; }
    flush();
    items.push(messageNode(message));
  }
  flush();
  if (chatStatus === 'running' && !visible.some(id => ['running', 'inProgress'].includes(messages.get(id)?.status) && messages.get(id)?.role === 'assistant')) items.push(el('div', 'thinking', 'Little Bot is working'));
  if (active?.error) items.push(el('div', 'error-line', active.error));
  if (!items.length) items.push(el('div', 'empty', !connected ? 'Connecting to your PC…' : view === 'quick' ? 'A side chat for one-off tasks. Little Bot won’t remember it, and your main conversation stays clean.'
    : view === 'session' ? 'A new saved session. Its first message creates it; the main conversation stays as it is.' : 'Say hi to Little Bot.'));
  // Keep open tool groups open across re-renders.
  const open = new Set([...$('messages').querySelectorAll('details[open]')].map((_, index) => index));
  keepAnswerFocus(() => $('messages').replaceChildren(...items));
  [...$('messages').querySelectorAll('details')].forEach((node, index) => { if (open.has(index)) node.open = true; });
  renderApprovals();
  $('send').classList.toggle('hidden', running);
  $('stop').classList.toggle('hidden', !running);
  $('send').disabled = busy || uploading > 0 || !connected || !snap?.ready || (!$('input').value.trim() && !pending.length);
  if (stick) $('chat').scrollTop = $('chat').scrollHeight;
  if ($('goals-sheet').open) keepAnswerFocus(renderGoals);
  if ($('menu-sheet').open) renderBackground();
}

const activeChatId = () => view === 'main' ? snap?.chat?.id : view === 'quick' ? snap?.quick?.id : view === 'session' ? sessionId : null;
function chatName(chatId) {
  if (chatId === snap?.chat?.id) return 'the conversation';
  if (chatId === snap?.quick?.id) return 'Quick';
  const session = (snap?.sessions || []).find(item => item.id === chatId);
  return session ? `“${session.title}”` : 'another chat';
}
const chatRoute = chatId => chatId === snap?.quick?.id ? { view: 'quick' } : (snap?.sessions || []).some(item => item.id === chatId) ? { view: 'session', id: chatId } : { view: 'main' };
// A chat's questions and approvals show in that chat only; elsewhere they are one line with a way there.
function renderElsewhere(here) {
  const others = (snap?.approvals || []).filter(approval => approval.chatId !== here);
  $('elsewhere').replaceChildren(...others.map(approval => {
    const row = el('div', 'elsewhere-row');
    row.append(el('span', '', `${approval.ask ? 'Little Bot asks something' : 'Little Bot needs your approval'} in ${chatName(approval.chatId)}`));
    const go = el('button', 'chip', 'Open'); go.type = 'button';
    go.onclick = () => routeTo(chatRoute(approval.chatId));
    row.append(go);
    return row;
  }));
}
function renderApprovals() {
  const here = activeChatId();
  renderElsewhere(here);
  const cards = (snap?.approvals || []).filter(approval => approval.chatId === here).map(approval => {
    const card = el('div', 'card');
    if (approval.ask) {
      card.append(el('h3', '', 'Little Bot asks'), el('p', '', approval.question));
      if (approval.options?.length) {
        const row = el('div', 'row');
        for (const option of approval.options) {
          const button = el('button', 'chip', option); button.type = 'button';
          button.onclick = () => answer(approval, option, card);
          row.append(button);
        }
        card.append(row);
      }
      const form = el('form', 'answer-row');
      const input = el('input'); input.placeholder = 'Your answer'; input.maxLength = 2000;
      const send = el('button', 'primary', 'Send'); send.type = 'submit';
      form.append(input, send);
      form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) answer(approval, input.value.trim(), card); };
      const skip = el('button', 'secondary', 'Skip'); skip.type = 'button';
      skip.onclick = () => answer(approval, null, card);
      card.append(form, skip);
    } else {
      card.append(el('h3', '', approval.title || 'Little Bot needs your approval'));
      if (approval.detail) card.append(el('pre', '', approval.detail));
      if (snap.allowApprovals) {
        const row = el('div', 'row');
        for (const [decision, label, cls] of [['accept', 'Allow', 'primary'], ['decline', 'Decline', 'secondary']]) {
          const button = el('button', cls, label); button.type = 'button';
          button.onclick = async () => {
            for (const item of card.querySelectorAll('button')) item.disabled = true;
            const ok = await attempt(() => api('approval', { requestId: approval.requestId, decision }));
            if (!ok) for (const item of card.querySelectorAll('button')) item.disabled = false;
          };
          row.append(button);
        }
        card.append(row);
      } else card.append(el('p', 'hint', 'Approve or decline this on your PC. (You can allow approvals from the phone in Little Bot settings.)'));
    }
    return card;
  });
  // Don't wipe an answer the user is typing.
  const active = document.activeElement;
  if (active && $('approvals').contains(active) && active.tagName === 'INPUT') return;
  $('approvals').replaceChildren(...cards);
}
async function answer(approval, text, card) {
  for (const item of card.querySelectorAll('button,input')) item.disabled = true;
  const ok = await attempt(() => api('answer', text === null ? { requestId: approval.requestId, skip: true } : { requestId: approval.requestId, text }));
  if (!ok) for (const item of card.querySelectorAll('button,input')) item.disabled = false;
}

// Composer
function sizeInput() {
  const input = $('input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight + 2, window.innerHeight * 0.4)}px`;
}
$('input').addEventListener('input', () => { sizeInput(); renderSlashMenu(); render(); });
$('composer').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('input').value.trim();
  if ((!text && !pending.length) || busy || uploading) return;
  busy = true; closeSlashMenu(); render();
  const sentFrom = view, sentTo = sessionId, sentKey = draftKey();
  const ok = await attempt(() => api('send', { text, attachmentIds: pending.map(item => item.id), ...target() }));
  busy = false;
  // The first message of a new session created it: keep showing that session.
  if (ok?.chatId && sentFrom === 'session' && !sentTo && view === 'session' && !sessionId) sessionId = ok.chatId;
  if (ok) {
    // Clear the box only if the phone still shows the chat it was sent to; the sent draft goes either way.
    const here = draftKey() === sentKey || (sentFrom === 'session' && !sentTo && view === 'session' && sessionId === ok.chatId);
    drafts.delete(sentKey);
    if (here) { $('input').value = ''; pending = []; renderPending(); sizeInput(); $('chat').scrollTop = $('chat').scrollHeight; }
  }
  render();
});

// The "/" menu: the phone's commands, and after "/skill " the enabled skills (the same matching as the desktop).
function phoneCommands() {
  return [
    { name: 'skill', hint: 'Use one of your skills' },
    { name: 'goal', hint: 'Keep this chat working until a check passes' },
    ...(view === 'quick' ? [{ name: 'keep', hint: 'Keep this Quick session as a saved session' }] : []),
  ];
}
function closeSlashMenu() { $('slash-menu').classList.add('hidden'); $('slash-menu').replaceChildren(); }
function slashItem(title, hint, pick) {
  const button = el('button', 'slash-item'); button.type = 'button'; button.setAttribute('role', 'option');
  button.append(el('strong', '', title), el('span', '', hint));
  button.onclick = pick;
  return button;
}
function renderSlashMenu() {
  const value = $('input').value;
  const skills = slash?.skillMatches(value, snap?.skills || []);
  const typed = /^\/([a-z]*)$/i.exec(value)?.[1]?.toLowerCase();
  let items = [];
  if (skills) {
    items = skills.slice(0, 30).map(skill => slashItem(skill.name, skill.description || '', () => {
      $('input').value = `$${skill.name} `; closeSlashMenu(); sizeInput(); $('input').focus(); render();
    }));
    if (!items.length) items = [el('p', 'hint slash-empty', (snap?.skills || []).length ? 'No enabled skill matches.' : 'No skills are turned on. Turn them on in Extensions on your PC.')];
  } else if (typed !== undefined && slash) {
    items = phoneCommands().filter(command => command.name.startsWith(typed)).map(command => slashItem(`/${command.name}`, command.hint, () => {
      if (command.name === 'skill') { $('input').value = '/skill '; renderSlashMenu(); $('input').focus(); return; }
      $('input').value = ''; closeSlashMenu(); sizeInput(); render();
      if (command.name === 'goal') openGoalForm();
      else keepQuick();
    }));
  }
  $('slash-menu').replaceChildren(...items);
  $('slash-menu').classList.toggle('hidden', !items.length);
}

// Keep: the Quick session becomes a saved session, as on the desktop. Before its first message there is
// nothing to keep, so the draft moves to a new saved session instead.
async function keepQuick() {
  const started = quickOrder.some(id => messages.get(id)?.role === 'user');
  saveDraft();
  const draft = drafts.get('quick') || { text: '', pending: [] };
  if (!snap?.quick || !started) {
    drafts.delete('quick'); drafts.set('session:new', draft);
    $('input').value = ''; pending = [];
    setView('session', null);
    toast('New saved session: your first message starts it.');
    return;
  }
  $('quick-keep').disabled = true;
  const ok = await attempt(() => api('keepQuick', {}));
  $('quick-keep').disabled = false;
  if (!ok?.chatId) return;
  drafts.delete('quick'); drafts.set(`session:${ok.chatId}`, draft);
  if (view === 'quick') { $('input').value = ''; pending = []; }
  toast('Kept as a saved session. Memory works there from now on.');
  routeTo({ view: 'session', id: ok.chatId, until: Date.now() + 15000 });
}
$('quick-keep').addEventListener('click', keepQuick);

// The goal form: the same /goal the desktop's drawer sends, built by the shared goalArguments.
function openGoalForm() {
  if (!slash) return toast('Reload the page to set a goal.', true);
  const goal = activeChat()?.goal;
  const live = goal && ['pursuing', 'paused'].includes(goal.status);
  $('goal-form-note').textContent = live ? `This chat already works toward “${goal.condition}”. A new goal replaces it.` : '';
  $('goal-form-note').classList.toggle('hidden', !live);
  $('goal-form-error').classList.add('hidden');
  $('goal-form-sheet').showModal();
  $('goal-condition').focus();
}
$('goal-open').addEventListener('click', openGoalForm);
$('goal-form').addEventListener('submit', async event => {
  event.preventDefault();
  let args;
  try {
    args = slash.goalArguments({ condition: $('goal-condition').value, check: $('goal-check').value,
      turns: Number.parseInt($('goal-turns').value, 10), minutes: Number.parseInt($('goal-minutes').value, 10) });
  } catch (error) {
    $('goal-form-error').textContent = error.message; $('goal-form-error').classList.remove('hidden');
    return;
  }
  $('goal-form-error').classList.add('hidden');
  $('goal-start').disabled = true;
  const sentFrom = view, sentTo = sessionId;
  const ok = await attempt(() => api('send', { text: `/goal ${args}`, ...target() }));
  $('goal-start').disabled = false;
  if (!ok) return;
  if (ok.chatId && sentFrom === 'session' && !sentTo && view === 'session' && !sessionId) sessionId = ok.chatId;
  for (const id of ['goal-condition', 'goal-check', 'goal-turns', 'goal-minutes']) $(id).value = '';
  $('goal-form-sheet').close();
  toast('Goal started');
  render();
});
// Attachments: photos are shrunk on the phone before upload (the PC resizes images again anyway).
function renderPending() {
  const box = $('pending');
  box.classList.toggle('hidden', !pending.length && !uploading);
  box.replaceChildren(...pending.map(item => {
    const chip = el('div', 'chip-file');
    if (item.thumbnail) { const img = el('img'); img.src = item.thumbnail; img.alt = ''; chip.append(img); }
    else { const icon = el('span', 'file-icon'); icon.append(svgIcon('file')); chip.append(icon); }
    chip.append(el('span', 'file-name', item.name));
    const remove = el('button', 'file-remove'); remove.append(svgIcon('x')); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${item.name}`);
    remove.onclick = () => { const index = pending.indexOf(item); if (index >= 0) pending.splice(index, 1); renderPending(); render(); };
    chip.append(remove);
    return chip;
  }), ...(uploading ? [el('div', 'chip-file uploading', `Uploading ${uploading}…`)] : []));
}
function readAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read this file.'));
    reader.readAsDataURL(blob);
  });
}
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size < 1500000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
async function uploadFiles(files) {
  // The files belong to the chat they were picked in, even if the phone switches tabs while they upload.
  const list = pending;
  for (const original of [...files].slice(0, 8 - list.length)) {
    uploading++; renderPending(); render();
    try {
      const file = await shrinkImage(original);
      if (file.size > 20 * 1024 * 1024) throw new Error(`${original.name} is over 20 MB.`);
      const { attachment } = await api('attach', { name: file.name || 'Photo.jpg', data: await readAsBase64(file) });
      list.push(attachment);
    } catch (error) { toast(error.message || 'Upload failed.', true); }
    finally { uploading--; renderPending(); render(); }
  }
}
$('attach').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => { const files = event.target.files; if (files?.length) uploadFiles(files); event.target.value = ''; });
// The Android app hands over things shared from other apps (already uploaded) and dictated text.
function takeShared(json) {
  let shared = {};
  try { shared = JSON.parse(json || '{}'); } catch { return; }
  for (const item of shared.attachments || []) if (pending.length < 8) pending.push(item);
  if (shared.text) { $('input').value = [$('input').value.trim(), shared.text].filter(Boolean).join('\n'); sizeInput(); }
  if (shared.error) toast(shared.error, true);
  renderPending(); render();
}
window.littleBotShared = takeShared;
window.littleBotDictated = text => {
  if (!text) return;
  const input = $('input');
  input.value = input.value.trim() ? `${input.value.trim()} ${text}` : text;
  sizeInput(); render(); input.focus();
};
$('mic').addEventListener('click', () => native?.dictate?.());
$('stop').addEventListener('click', () => attempt(() => api('stop', target())));
$('tab-main').addEventListener('click', () => setView('main'));
$('goal-strip-toggle').addEventListener('click', () => {
  const goal = activeChat()?.goal;
  attempt(() => api('chatGoal', { ...target(), command: goal?.status === 'pursuing' ? 'pause' : 'resume' }));
});
$('goal-strip-clear').addEventListener('click', () => attempt(() => api('chatGoal', { ...target(), command: 'clear' })));
$('tab-quick').addEventListener('click', () => setView('quick'));
$('tab-sessions').addEventListener('click', () => setView('sessions'));
$('session-back').addEventListener('click', () => setView('sessions'));
$('session-delete').addEventListener('click', async () => {
  const session = activeChat();
  if (!session || !confirm(`Delete “${session.title}” and its history? Facts Little Bot already learned from it stay.`)) return;
  if (await attempt(() => api('deleteSession', { sessionId: session.id }))) { toast('Session deleted'); setView('sessions'); }
});
$('quick-end').addEventListener('click', () => attempt(() => api('endQuick', {})));

// Goals
const GOAL_LABELS = { queued: 'Scheduled', running: 'Running', paused: 'Paused', blocked: 'Blocked', completed: 'Done', failed: 'Failed' };
function when(time) {
  if (!time) return '';
  const date = new Date(time);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
function renderGoals() {
  const goals = snap?.goals || [];
  const list = goals.map(goal => {
    const node = el('div', 'goal');
    const top = el('div', 'goal-top');
    top.append(el('strong', '', goal.name), el('span', `pill ${goal.question ? 'asking' : goal.status}`, goal.question ? 'Asks you' : GOAL_LABELS[goal.status] || goal.status));
    node.append(top);
    if (goal.question) {
      // A goal waiting on a question continues once it is answered; no other button is needed.
      node.append(el('p', 'goal-question', goal.question.question), goalAnswerForm(goal));
      return node;
    }
    const detail = goal.status === 'queued' && goal.nextRunAt ? `Next run ${when(goal.nextRunAt)}` : goal.nextStep;
    if (detail) node.append(el('p', '', detail));
    const row = el('div', 'row');
    const add = (label, action, cls = 'chip') => {
      const button = el('button', cls, label); button.type = 'button';
      button.onclick = async () => { button.disabled = true; if (await attempt(() => api('goal', { id: goal.id, action }))) toast(`${label}: ${goal.name}`); button.disabled = false; };
      row.append(button);
    };
    // One button per thing to do: Resume and Run now start the same step.
    if (goal.status === 'running') add('Pause', 'pause');
    else if (goal.status === 'queued') { add('Run now', 'run'); add('Pause', 'pause'); }
    else if (goal.status === 'paused' || goal.status === 'blocked') add('Resume', 'resume');
    else add(goal.status === 'completed' || goal.status === 'failed' ? 'Run again' : 'Run now', 'run');
    node.append(row);
    return node;
  });
  if (snap?.autonomyPaused) list.unshift(el('p', 'hint', 'All autonomous work is paused on the PC.'));
  $('goal-list').replaceChildren(...(list.length ? list : [el('p', 'hint', 'No background goals yet. Create them in Goals on your PC. To keep one chat working toward something, use the goal button next to the message box.')]));
}
$('goals-button').addEventListener('click', () => { renderGoals(); $('goals-sheet').showModal(); });

// Menu and notifications
const pushSupported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function registration() {
  if (!pushSupported()) return null;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}
function renderNative() {
  $('native-section').classList.remove('hidden');
  const sharing = native.locationEnabled();
  $('location-state').textContent = String(native.locationStatus() || '');
  $('location-toggle').textContent = sharing ? 'Stop sharing my location' : 'Share my location';
  $('location-toggle').className = sharing ? 'secondary' : 'primary';
  $('home-set').classList.toggle('hidden', !sharing);
}
function renderBackground() {
  const paused = Boolean(snap?.autonomyPaused);
  $('background-toggle').setAttribute('aria-checked', String(!paused));
  $('background-state').textContent = paused ? 'Off: nothing runs on its own until you turn it back on' : 'On: heartbeat, goals and routines run on their own';
}
async function renderMenu() {
  renderBackground();
  $('version').textContent = snap?.version ? `Little Bot ${snap.version} on your PC` : '';
  const enable = $('push-enable'), test = $('push-test'), disable = $('push-disable');
  $('get-apk').classList.toggle('hidden', !isAndroid || Boolean(native));
  if (native) {
    renderNative();
    $('push-state').textContent = '';
    enable.classList.add('hidden'); test.classList.add('hidden'); disable.classList.add('hidden');
    return;
  }
  if (!pushSupported()) {
    $('push-state').textContent = window.isSecureContext
      ? 'This browser cannot show notifications. Use Chrome on Android.'
      : 'Notifications need a secure (https) address. In Little Bot settings › Phone relay, turn on Tailscale HTTPS, then pair again with the https link.';
    enable.classList.add('hidden'); test.classList.add('hidden'); disable.classList.add('hidden');
    return;
  }
  let reg = null, subscription = null;
  try { reg = await registration(); subscription = await reg?.pushManager.getSubscription(); }
  catch {
    $('push-state').textContent = 'This browser could not set up notifications. Use Chrome on Android.';
    enable.classList.add('hidden'); test.classList.add('hidden'); disable.classList.add('hidden');
    return;
  }
  const on = Boolean(subscription) && Notification.permission === 'granted';
  $('push-state').textContent = on ? 'Notifications are on. You get one when Little Bot reaches out, replies, or needs you while you are away.' : Notification.permission === 'denied' ? 'Notifications are blocked for this site in your browser settings.' : 'Get a notification when Little Bot reaches out, replies, or needs you.';
  enable.classList.toggle('hidden', on); test.classList.toggle('hidden', !on); disable.classList.toggle('hidden', !on);
}
function keyBytes(base64url) {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - base64url.length % 4) % 4));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
$('push-enable').addEventListener('click', () => attempt(async () => {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed.');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const { key } = await api('push-key');
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api('push', { subscription: subscription.toJSON() });
  toast('Notifications are on');
  await renderMenu();
}));
$('push-test').addEventListener('click', () => attempt(async () => { await api('push-test', {}); toast('Sent. Lock your phone to see it.'); }));
$('push-disable').addEventListener('click', () => attempt(async () => {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  await api('push', { subscription: null });
  await renderMenu();
}));
$('unpair').addEventListener('click', () => attempt(async () => {
  if (!confirm('Unpair this phone? You will need a new QR code from your PC to pair again.')) return;
  await api('unpair', {}).catch(() => {});
  $('menu-sheet').close();
  unpaired();
}));
$('location-toggle').addEventListener('click', () => {
  if (!native) return;
  native.setLocationEnabled(!native.locationEnabled());
  setTimeout(renderNative, 400);
});
$('home-set').addEventListener('click', () => attempt(async () => {
  native?.shareNow?.();
  await new Promise(resolve => setTimeout(resolve, 1500));
  await api('home', {});
  toast('Home saved. Little Bot will know when you leave or get back.');
  renderNative();
}));
// The app calls this after it gains or loses location permission.
window.littleBotNativeChanged = () => { if ($('menu-sheet').open) renderNative(); };
$('menu-button').addEventListener('click', () => { renderMenu(); $('menu-sheet').showModal(); });
$('background-toggle').addEventListener('click', async () => {
  const on = Boolean(snap?.autonomyPaused);
  $('background-toggle').disabled = true;
  const ok = await attempt(() => api('background', { on }));
  $('background-toggle').disabled = false;
  if (ok) { snap = { ...snap, autonomyPaused: !on }; renderBackground(); toast(on ? 'Background work is on' : 'Background work is off'); }
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenSince = Date.now();
  // Back in front: a background tab's stream is often stale, so refresh it unless it just spoke.
  else if (token && (!connected || (hiddenSince && Date.now() - hiddenSince > 15000) || Date.now() - lastStreamByte > 30000)) restartStream();
  reportPresence();
});
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#pair=')) { streamAbort?.abort(); streamAbort = null; connected = false; boot(); return; }
  const route = parseRoute(location.hash);
  if (route && token) { history.replaceState(null, '', '/'); routeTo(route); }
});
// A tapped notification, when the app is already open: the service worker says which chat to show.
navigator.serviceWorker?.addEventListener('message', event => {
  if (event.data?.type !== 'open' || !token) return;
  try { routeTo(parseRoute(new URL(event.data.url, location.origin).hash)); } catch { /* Not a route. */ }
});
$('viewer').addEventListener('close', () => $('viewer-image').removeAttribute('src'));
// A network change (Wi-Fi to mobile data) can leave the old stream hanging: always start a fresh one.
window.addEventListener('online', () => restartStream());

function boot() {
  const pair = /^#pair=([A-Za-z0-9_-]{8,64})$/.exec(location.hash);
  if (pair) { startPairing(pair[1]); return; }
  if (!token) { unpaired(); return; }
  // Opened from a notification: show its chat once the PC's snapshot arrives.
  const route = parseRoute(location.hash);
  if (route) { pendingRoute = route; history.replaceState(null, '', '/'); }
  showScreen('chat');
  $('mic').classList.toggle('hidden', !native?.dictate);
  if (native?.takeShared) takeShared(native.takeShared());
  render();
  connect();
  if (!native) registration().catch(() => {});
}
boot();
