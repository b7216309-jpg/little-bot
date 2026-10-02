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
let clientId = '';
let connected = false;
let streamAbort = null;
let retryDelay = 1000;
let retryTimer = null;
let busy = false;

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
  for (const id of ['chat', 'composer', 'goals-button', 'menu-button']) $(id).classList.toggle('hidden', name !== 'chat');
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
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
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
    if (controller.signal.aborted && streamAbort !== controller) return;
    if (streamAbort === controller) scheduleReconnect();
  }
}

function applyMessages(upsert, ids) {
  for (const message of upsert || []) {
    messages.set(message.id, message);
    if (!ids && !order.includes(message.id)) order.push(message.id);
  }
  if (ids) {
    order = ids.slice();
    const keep = new Set(ids);
    for (const id of messages.keys()) if (!keep.has(id)) messages.delete(id);
  }
}
function handle(event) {
  if (event.type === 'hello') {
    messages.clear(); order = [];
    clientId = event.clientId; connected = true; retryDelay = 1000;
    reportPresence();
  }
  if (event.type === 'hello' || event.type === 'state') {
    const { type, ids, upsert, clientId: _, ...rest } = event;
    snap = rest;
    applyMessages(upsert, ids);
  } else if (event.type === 'messages') {
    applyMessages(event.upsert);
  }
  render();
}
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
function renderText(parent, text) {
  const source = String(text || '');
  const fences = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let last = 0;
  for (const match of source.matchAll(fences)) {
    appendInline(parent, source.slice(last, match.index));
    const pre = el('pre'); pre.append(el('code', '', match[2].replace(/\n$/, ''))); parent.append(pre);
    last = match.index + match[0].length;
  }
  appendInline(parent, source.slice(last));
}

function messageNode(message) {
  const node = el('div', `msg ${message.role}`);
  if (message.proactive) node.classList.add('proactive');
  if (message.kind === 'question') node.classList.add('question');
  if (message.role === 'assistant' && ['running', 'inProgress'].includes(message.status)) node.classList.add('streaming');
  node.append(el('span', 'label', message.label));
  if (message.attachments?.length) {
    const thumbs = el('div', 'thumbs');
    for (const file of message.attachments) {
      if (file.thumbnail) { const img = el('img'); img.src = file.thumbnail; img.alt = file.name; thumbs.append(img); }
      else thumbs.append(el('span', 'file', `📎 ${file.name}`));
    }
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
  return node;
}
function toolsNode(group) {
  const details = el('details', 'tools');
  const failed = group.some(item => item.status === 'failed');
  const running = group.some(item => ['running', 'inProgress'].includes(item.status));
  const actions = group.filter(item => !item.thinking).length, thoughts = group.length - actions;
  const parts = [thoughts ? 'Thinking' : '', actions ? `${actions} action${actions === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  details.append(el('summary', '', `${parts}${running ? ' · running' : failed ? ' · some failed' : ''}`));
  const body = el('div');
  for (const item of group.slice(-30)) body.append(el('p', item.thinking ? 'thought' : item.status === 'failed' ? 'failed' : '', (item.text || item.kind || 'Action').slice(0, item.thinking ? 2000 : 600)));
  details.append(body);
  return details;
}

function nearBottom() {
  const chat = $('chat');
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120;
}
function render() {
  const chatStatus = snap?.chat?.status || 'idle';
  const running = chatStatus === 'running' || chatStatus === 'waiting';
  if (connected) {
    if (!snap?.ready) setStatus(snap?.runtimeError || 'PC connected · engine not ready', 'offline');
    else if (chatStatus === 'waiting') setStatus('Waiting for you', 'busy');
    else if (running) setStatus('Thinking…', 'busy');
    else setStatus('Connected to your PC', 'online');
  }
  const stick = nearBottom();
  const items = [];
  if (snap?.chat?.more) items.push(el('div', 'more', 'Older messages are on your PC'));
  let tools = [];
  const flush = () => { if (tools.length) { items.push(toolsNode(tools)); tools = []; } };
  for (const id of order) {
    const message = messages.get(id);
    if (!message) continue;
    if (message.role === 'tool' || message.thinking) { tools.push(message); continue; }
    flush();
    items.push(messageNode(message));
  }
  flush();
  if (chatStatus === 'running' && !order.some(id => ['running', 'inProgress'].includes(messages.get(id)?.status) && messages.get(id)?.role === 'assistant')) items.push(el('div', 'thinking', 'Little Bot is working'));
  if (snap?.chat?.error) items.push(el('div', 'error-line', snap.chat.error));
  if (!items.length) items.push(el('div', 'empty', connected ? 'Say hi to Little Bot.' : 'Connecting to your PC…'));
  // Keep open tool groups open across re-renders.
  const open = new Set([...$('messages').querySelectorAll('details[open]')].map((_, index) => index));
  $('messages').replaceChildren(...items);
  [...$('messages').querySelectorAll('details')].forEach((node, index) => { if (open.has(index)) node.open = true; });
  renderApprovals();
  $('send').classList.toggle('hidden', running);
  $('stop').classList.toggle('hidden', !running);
  $('send').disabled = busy || !connected || !snap?.ready || !$('input').value.trim();
  if (stick) $('chat').scrollTop = $('chat').scrollHeight;
  if ($('goals-sheet').open) renderGoals();
}

function renderApprovals() {
  const cards = (snap?.approvals || []).map(approval => {
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
$('input').addEventListener('input', () => { sizeInput(); render(); });
$('composer').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('input').value.trim();
  if (!text || busy) return;
  busy = true; render();
  const ok = await attempt(() => api('send', { text }));
  busy = false;
  if (ok) { $('input').value = ''; sizeInput(); $('chat').scrollTop = $('chat').scrollHeight; }
  render();
});
$('stop').addEventListener('click', () => attempt(() => api('stop', {})));

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
    top.append(el('strong', '', goal.name), el('span', `pill ${goal.status}`, GOAL_LABELS[goal.status] || goal.status));
    node.append(top);
    const detail = goal.status === 'queued' && goal.nextRunAt ? `Next run ${when(goal.nextRunAt)}` : goal.nextStep;
    if (detail) node.append(el('p', '', detail));
    const row = el('div', 'row');
    const add = (label, action, cls = 'chip') => {
      const button = el('button', cls, label); button.type = 'button';
      button.onclick = async () => { button.disabled = true; if (await attempt(() => api('goal', { id: goal.id, action }))) toast(`${label}: ${goal.name}`); button.disabled = false; };
      row.append(button);
    };
    if (goal.status !== 'running') add('Run now', 'run');
    if (goal.status === 'paused' || goal.status === 'blocked') add('Resume', 'resume');
    else if (goal.status !== 'completed') add('Pause', 'pause');
    node.append(row);
    return node;
  });
  if (snap?.autonomyPaused) list.unshift(el('p', 'hint', 'All autonomous work is paused on the PC.'));
  $('goal-list').replaceChildren(...(list.length ? list : [el('p', 'hint', 'No goals yet. Create one with /goal on your PC.')]));
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
async function renderMenu() {
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
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && token && !connected) { retryDelay = 1000; connect(); }
  reportPresence();
});
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#pair=')) { streamAbort?.abort(); streamAbort = null; connected = false; boot(); } });
window.addEventListener('online', () => { if (token && !connected) { retryDelay = 1000; connect(); } });

function boot() {
  const pair = /^#pair=([A-Za-z0-9_-]{8,64})$/.exec(location.hash);
  if (pair) { startPairing(pair[1]); return; }
  if (!token) { unpaired(); return; }
  showScreen('chat');
  render();
  connect();
  if (!native) registration().catch(() => {});
}
boot();
