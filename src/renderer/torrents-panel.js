// The torrents panel: search the user's sources, read a torrent before downloading it (size, files, free space),
// follow transfers, and manage sources and settings. The transfers live in the main process (torrents.cjs);
// speeds arrive once a second as torrentStats events and update the rows in place.

const $ = id => document.getElementById(id);
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const glyph = name => (typeof globalThis.icon === 'function' ? globalThis.icon(name) : make('span'));
const say = (message, error = false) => globalThis.notify?.(message, error);
const apply = state => globalThis.applyState?.(state);
const button = (label, onClick, className = 'button secondary', iconName = null) => {
  const node = make('button', className);
  node.type = 'button';
  if (iconName) node.append(glyph(iconName));
  if (label) node.append(make('span', '', label));
  node.addEventListener('click', onClick);
  return node;
};
const run = async (job, done) => { try { const result = await job(); done?.(result); return result; } catch (error) { say(error.message || String(error), true); return null; } };

function bytes(value) {
  if (!Number.isFinite(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = value, unit = 0;
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
  return `${n >= 100 || unit === 0 ? Math.round(n) : n.toFixed(1)} ${units[unit]}`;
}
const speed = value => value > 512 ? `${bytes(value)}/s` : '';
function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
  return `${Math.round(seconds / 86400)} days`;
}
const ago = at => { const days = Math.floor((Date.now() - at) / 86400000); return !at ? '' : days < 1 ? 'today' : days < 2 ? 'yesterday' : days < 60 ? `${days} days ago` : new Date(at).toLocaleDateString(); };
const STATUS = { queued: 'Waiting', downloading: 'Downloading', seeding: 'Sharing', paused: 'Paused', finished: 'Done', error: 'Failed' };

let torrents = null;
let tab = 'search';
let live = {};               // key -> numbers from the engine
let results = [], searchErrors = [], searching = false, lastQuery = '';
let draft = null, drafting = false, draftError = '', chosen = null;
let addKind = 'rss';

// ------------------------------------------------------------------------------------------------ search

async function search(event) {
  event?.preventDefault();
  const query = $('torrents-query').value.trim();
  if (!query) return;
  searching = true; lastQuery = query; renderSearch();
  const found = await run(() => window.bot.torrentsSearch({ query }));
  searching = false;
  results = found?.results || []; searchErrors = found?.errors || [];
  renderSearch();
}

function renderSearch() {
  const list = $('torrents-results');
  const items = [];
  if (searching) items.push(make('p', 'torrents-empty', `Searching your sources for “${lastQuery}”…`));
  else if (!lastQuery) {
    const hint = make('div', 'torrents-empty');
    hint.append(make('strong', '', 'Search your sources'), make('p', '', 'The Internet Archive, Academic Torrents and official Linux images are on by default; add your own feeds in Sources. You can also paste a magnet link with Add, or drop a .torrent file here.'));
    items.push(hint);
  } else if (!results.length) items.push(make('p', 'torrents-empty', `Nothing found for “${lastQuery}”.`));
  for (const result of results) {
    const row = make('div', 'torrents-result');
    const copy = make('div', 'torrents-result-copy');
    const title = make('strong', '', result.title);
    title.title = result.title;
    const meta = [result.source, result.size ? bytes(result.size) : null, result.seeders !== null && result.seeders !== undefined ? `${result.seeders} seeders` : null, result.date ? ago(result.date) : null].filter(Boolean).join(' · ');
    copy.append(title, make('span', '', meta), ...(result.note ? [make('span', 'torrents-note', result.note)] : []));
    const actions = make('div', 'torrents-result-actions');
    if (result.page) { const link = button('', () => window.open(result.page, '_blank'), 'icon-button', 'arrow-up-right'); link.title = 'Open its page'; actions.append(link); }
    actions.append(button('Look inside', () => openDraft({ result }), 'button secondary small'));
    row.append(copy, actions);
    items.push(row);
  }
  for (const error of searchErrors) items.push(make('p', 'torrents-source-error', `${error.source}: ${error.error}`));
  list.replaceChildren(...items);
}

// ------------------------------------------------------------------------------------------------ reading a torrent

async function openDraft(input) {
  drafting = true; draftError = ''; draft = null; chosen = null;
  renderDraft();
  try {
    draft = await window.bot.torrentsPrepare(input);
    chosen = new Set(draft.files.map(file => file.index));
  } catch (error) { draftError = error.message || String(error); }
  drafting = false;
  renderDraft();
}

function closeDraft() {
  if (draft && !draft.request) window.bot.torrentsCancel({ id: draft.id }).catch(() => {});
  draft = null; drafting = false; draftError = ''; chosen = null;
  renderDraft();
}

function renderDraft() {
  const layer = $('torrents-draft');
  layer.classList.toggle('hidden', !drafting && !draft && !draftError);
  const card = make('div', 'torrents-draft-card');
  if (drafting) card.append(make('h3', '', 'Reading the torrent…'), make('p', 'torrents-muted', 'A magnet link gets its file list from other peers; this can take a moment.'));
  else if (draftError) card.append(make('h3', '', 'This torrent could not be read'), make('p', 'torrents-muted', draftError), make('div', 'torrents-draft-actions'));
  else if (draft) {
    const files = draft.files;
    const picked = files.filter(file => chosen.has(file.index));
    const size = picked.reduce((sum, file) => sum + file.length, 0);
    card.append(make('h3', '', draft.name));
    const facts = make('p', 'torrents-muted', [draft.source?.name, `${files.length} file${files.length === 1 ? '' : 's'}`, `${bytes(draft.length)} in all`].filter(Boolean).join(' · '));
    card.append(facts);
    if (draft.note) card.append(make('p', 'torrents-request-note', `Little Bot: “${draft.note}”`));
    if (files.length > 1) {
      const list = make('div', 'torrents-files');
      const all = make('label', 'torrents-file all');
      const allBox = make('input'); allBox.type = 'checkbox'; allBox.checked = picked.length === files.length;
      allBox.addEventListener('change', () => { chosen = new Set(allBox.checked ? files.map(file => file.index) : []); renderDraft(); });
      all.append(allBox, make('span', '', 'All files'));
      list.append(all);
      for (const file of files.slice(0, 400)) {
        const row = make('label', `torrents-file${file.risky ? ' risky' : ''}`);
        const box = make('input'); box.type = 'checkbox'; box.checked = chosen.has(file.index);
        box.addEventListener('change', () => { box.checked ? chosen.add(file.index) : chosen.delete(file.index); renderDraft(); });
        const name = make('span', '', file.path); name.title = file.path;
        row.append(box, name, make('em', '', bytes(file.length)));
        list.append(row);
      }
      card.append(list);
    }
    const risky = picked.some(file => file.risky);
    if (risky) card.append(make('p', 'torrents-warning', 'It contains programs, disk images or archives. Nothing opens by itself; scan them with Defender before opening.'));
    const short = draft.free !== null && draft.free < size + 200 * 1024 * 1024;
    card.append(make('p', short ? 'torrents-warning' : 'torrents-muted', `Saves ${bytes(size)} to ${draft.folder}${draft.free !== null ? ` · ${bytes(draft.free)} free` : ''}`));
    if (draft.existing) card.append(make('p', 'torrents-muted', 'It is already in your transfers; starting it again picks up what is on disk.'));
    const actions = make('div', 'torrents-draft-actions');
    const start = button(`Download ${bytes(size)}`, async () => {
      start.disabled = true;
      const select = picked.length === files.length ? null : picked.map(file => file.index);
      const state = await run(() => draft.request ? window.bot.torrentsAnswer({ id: draft.id, accept: true, select }) : window.bot.torrentsStart({ id: draft.id, select }));
      if (state) { draft = null; renderDraft(); apply(state); setTab('transfers'); } else start.disabled = false;
    }, 'button primary', 'import');
    start.disabled = !picked.length || short;
    const cancel = button(draft.request ? 'Decline' : 'Cancel', async () => {
      if (draft.request) { const state = await run(() => window.bot.torrentsAnswer({ id: draft.id, accept: false })); draft = null; renderDraft(); if (state) apply(state); }
      else closeDraft();
    });
    actions.append(cancel, start);
    card.append(actions);
  }
  if (!drafting && (draftError || !draft)) card.querySelector('.torrents-draft-actions')?.append(button('Close', closeDraft));
  layer.replaceChildren(card);
}

// ------------------------------------------------------------------------------------------------ transfers

function renderTransfers() {
  const list = $('torrents-transfers');
  const items = torrents?.items || [];
  $('torrents-count').textContent = items.filter(item => ['queued', 'downloading', 'seeding'].includes(item.status)).length || '';
  if (!items.length) { list.replaceChildren(make('p', 'torrents-empty', 'No transfers yet. Find something in Search, or add a magnet link.')); return; }
  list.replaceChildren(...items.map(item => {
    const row = make('div', `torrents-transfer ${item.status}`);
    row.dataset.key = item.key;
    const head = make('div', 'torrents-transfer-head');
    const name = make('strong', '', item.name); name.title = item.name;
    head.append(name, make('span', `torrents-status ${item.status}`, STATUS[item.status] || item.status));
    const bar = make('div', 'torrents-progress'); const fill = make('i'); bar.append(fill);
    const line = make('span', 'torrents-transfer-line');
    const actions = make('div', 'torrents-transfer-actions');
    if (['queued', 'downloading', 'seeding'].includes(item.status)) actions.append(iconButton('pause', 'Pause', () => run(() => window.bot.torrentsPause({ key: item.key }), apply)));
    else if (['paused', 'error'].includes(item.status)) actions.append(iconButton('play', 'Resume', () => run(() => window.bot.torrentsResume({ key: item.key }), apply)));
    else if (item.status === 'finished') actions.append(iconButton('refresh', 'Share again', () => run(() => window.bot.torrentsResume({ key: item.key }), apply)));
    actions.append(iconButton('folder', 'Show in folder', () => run(() => window.bot.torrentsShow({ key: item.key }))));
    if (item.progress > 0) {
      const scan = iconButton('shield', item.scan?.status === 'running' ? 'Scanning…' : 'Scan with Microsoft Defender', () => run(() => window.bot.torrentsScan({ key: item.key }), result => say(result.status === 'clean' ? `${item.name}: no threats found.` : result.status === 'threats' ? `Defender found a threat in ${item.name}: ${result.detail}` : `Scan: ${result.detail}`, result.status === 'threats')));
      scan.disabled = item.scan?.status === 'running';
      if (item.risky && !item.scan) scan.classList.add('attention');
      actions.append(scan);
    }
    actions.append(iconButton('trash', 'Remove', () => confirmRemove(row, item)));
    const notes = make('div', 'torrents-transfer-notes');
    if (item.error) notes.append(make('span', 'torrents-source-error', item.error));
    if (item.risky && !item.scan) notes.append(make('span', 'torrents-warning-inline', 'Contains programs or archives: scan before opening.'));
    if (item.scan && item.scan.status !== 'running') notes.append(make('span', item.scan.status === 'threats' ? 'torrents-source-error' : 'torrents-muted', item.scan.status === 'clean' ? 'Defender: no threats found.' : item.scan.status === 'threats' ? `Defender: ${item.scan.detail}` : `Scan failed: ${item.scan.detail}`));
    row.append(head, bar, line, actions, notes);
    paint(row, item);
    return row;
  }));
}

// Progress and speeds, from the last engine numbers when the transfer runs.
function paint(row, item) {
  const stats = live[item.key];
  const progress = stats?.progress ?? item.progress ?? 0;
  row.querySelector('.torrents-progress > i').style.width = `${Math.round(progress * 1000) / 10}%`;
  const parts = [];
  if (item.status === 'downloading' || item.status === 'queued') parts.push(`${bytes(progress * item.length)} of ${bytes(item.length)}`);
  else parts.push(bytes(item.length));
  if (stats && item.status === 'downloading') {
    if (speed(stats.downloadSpeed)) parts.push(`↓ ${speed(stats.downloadSpeed)}`);
    if (duration(stats.timeRemaining)) parts.push(`${duration(stats.timeRemaining)} left`);
  }
  if (stats && speed(stats.uploadSpeed)) parts.push(`↑ ${speed(stats.uploadSpeed)}`);
  if (stats && ['downloading', 'seeding'].includes(item.status)) parts.push(`${stats.peers || 0} peer${stats.peers === 1 ? '' : 's'}`);
  const shared = stats?.uploaded ?? item.uploaded;
  if (['seeding', 'finished'].includes(item.status) && item.length) parts.push(`shared ${(shared / item.length).toFixed(2)}×`);
  row.querySelector('.torrents-transfer-line').textContent = parts.join(' · ');
}

function iconButton(name, label, onClick) {
  const node = button('', onClick, 'icon-button', name);
  node.title = label; node.setAttribute('aria-label', label);
  return node;
}

function confirmRemove(row, item) {
  row.querySelector('.torrents-confirm')?.remove();
  const box = make('div', 'torrents-confirm');
  box.append(make('span', '', 'Remove from the list?'),
    button('Keep the files', () => run(() => window.bot.torrentsRemove({ key: item.key, deleteFiles: false }), apply), 'button secondary small'),
    button('Delete the files too', () => run(() => window.bot.torrentsRemove({ key: item.key, deleteFiles: true }), apply), 'button danger small'),
    button('Cancel', () => box.remove(), 'text-button'));
  row.append(box);
}

// ------------------------------------------------------------------------------------------------ requests from Little Bot

function renderRequests() {
  const box = $('torrents-requests');
  const requests = torrents?.requests || [];
  box.classList.toggle('hidden', !requests.length);
  box.replaceChildren(...requests.map(request => {
    const card = make('div', 'torrents-request');
    const copy = make('div', 'torrents-request-copy');
    copy.append(make('span', 'torrents-eyebrow', 'Little Bot asks to download'), make('strong', '', request.name),
      make('span', '', [request.source?.name, `${request.files.length} file${request.files.length === 1 ? '' : 's'}`, bytes(request.length)].filter(Boolean).join(' · ')),
      ...(request.note ? [make('span', 'torrents-request-note', `“${request.note}”`)] : []));
    const actions = make('div', 'torrents-request-actions');
    actions.append(
      button('Decline', () => run(() => window.bot.torrentsAnswer({ id: request.id, accept: false }), apply)),
      button('Look inside', () => { draft = { ...request, request: true }; chosen = new Set(request.files.map(file => file.index)); drafting = false; draftError = ''; renderDraft(); }),
      button('Download', () => run(() => window.bot.torrentsAnswer({ id: request.id, accept: true }), state => { apply(state); setTab('transfers'); }), 'button primary', 'import'));
    card.append(copy, actions);
    return card;
  }));
}

// ------------------------------------------------------------------------------------------------ sources and settings

function renderSources() {
  const list = $('torrents-sources');
  list.replaceChildren(...(torrents?.sources || []).map(source => {
    const row = make('div', 'torrents-source');
    const copy = make('div', 'torrents-source-copy');
    copy.append(make('strong', '', source.name), make('span', '', source.kind === 'built-in' ? source.description : `${source.kind === 'torznab' ? 'Torznab' : 'RSS feed'} · ${source.url}${source.hasKey ? ' · key saved' : ''}`));
    const toggle = make('input'); toggle.type = 'checkbox'; toggle.checked = source.enabled;
    const wrap = make('label', 'switch'); wrap.append(toggle, make('span', 'switch-track'));
    toggle.setAttribute('aria-label', `Use ${source.name}`);
    toggle.addEventListener('change', () => run(() => window.bot.torrentsSources({ change: { action: 'toggle', id: source.id, enabled: toggle.checked } }), result => apply(result.state)));
    row.append(copy, wrap);
    if (source.kind !== 'built-in') row.append(iconButton('trash', `Remove ${source.name}`, () => run(() => window.bot.torrentsSources({ change: { action: 'remove', id: source.id } }), result => apply(result.state))));
    return row;
  }));
  $('torrents-add-key-row').classList.toggle('hidden', addKind !== 'torznab');
  for (const option of document.querySelectorAll('[data-torrents-kind]')) option.setAttribute('aria-checked', String(option.dataset.torrentsKind === addKind));
}

async function addSource(event) {
  event.preventDefault();
  const status = $('torrents-add-status');
  status.textContent = 'Checking the source…'; status.className = 'torrents-muted';
  const change = { action: 'add', kind: addKind, name: $('torrents-add-name').value.trim(), url: $('torrents-add-url').value.trim(), apiKey: addKind === 'torznab' ? $('torrents-add-key').value.trim() : undefined };
  try {
    const { result, state } = await window.bot.torrentsSources({ change });
    status.textContent = `Added ${result.added}: it lists ${result.items} item${result.items === 1 ? '' : 's'}.`;
    $('torrents-add-form').reset();
    apply(state);
  } catch (error) { status.textContent = error.message || String(error); status.className = 'torrents-source-error'; }
}

function renderSettings() {
  const settings = torrents?.settings;
  if (!settings) return;
  $('torrents-folder').textContent = settings.folder;
  const set = (id, value) => { const node = $(id); if (document.activeElement !== node) node.value = value; };
  set('torrents-down', settings.downloadLimit || '');
  set('torrents-up', settings.uploadLimit || '');
  set('torrents-active', settings.maxActive);
  set('torrents-stop', settings.stopSharing);
  set('torrents-ratio', settings.ratio);
  set('torrents-hours', settings.hours);
  $('torrents-ratio-row').classList.toggle('hidden', settings.stopSharing !== 'ratio');
  $('torrents-hours-row').classList.toggle('hidden', settings.stopSharing !== 'time');
  for (const [id, name] of [['torrents-upnp', 'upnp'], ['torrents-magnet', 'magnetLinks'], ['torrents-games', 'pauseForGames']]) $(id).checked = Boolean(settings[name]);
}

function saveSettings(change) { return run(() => window.bot.torrentsSettings({ settings: change }), apply); }

// ------------------------------------------------------------------------------------------------ the panel

function setTab(next) {
  tab = next;
  for (const node of document.querySelectorAll('[data-torrents-tab]')) node.setAttribute('aria-selected', String(node.dataset.torrentsTab === next));
  for (const section of document.querySelectorAll('[data-torrents-panel]')) section.classList.toggle('hidden', section.dataset.torrentsPanel !== next);
}

function renderTotals() {
  let down = 0, up = 0;
  for (const stats of Object.values(live)) { down += stats.downloadSpeed || 0; up += stats.uploadSpeed || 0; }
  const text = [speed(down) && `↓ ${speed(down)}`, speed(up) && `↑ ${speed(up)}`].filter(Boolean).join('  ');
  $('torrents-speed').textContent = torrents?.gamePaused ? 'Slowed for a full-screen game' : text;
  $('open-torrents-speed').textContent = speed(down) ? `↓ ${speed(down)}` : '';
}

function render(state) {
  if (window.LittleBotWidget?.widget) return;
  torrents = state?.torrents || null;
  const enabled = Boolean(torrents?.enabled);
  const open = enabled && Boolean(torrents?.panel) && !state?.browser?.panel;
  const toggle = $('open-torrents');
  toggle.classList.toggle('hidden', !enabled);
  toggle.classList.toggle('browser-active', open);
  toggle.setAttribute('aria-pressed', String(open));
  toggle.title = open ? 'Hide torrents' : 'Show torrents';
  $('torrents-panel').classList.toggle('hidden', !open);
  document.querySelector('.app-shell')?.classList.toggle('torrents-open', open);
  if (!enabled) { live = {}; renderTotals(); return; }
  renderTotals();
  if (!open) return;
  renderRequests();
  renderTransfers();
  renderSources();
  renderSettings();
}

$('open-torrents').addEventListener('click', () => run(() => window.bot.torrentsPanel({ visible: !torrents?.panel }), apply));
$('torrents-hide').addEventListener('click', () => run(() => window.bot.torrentsPanel({ visible: false }), apply));
$('torrents-open-folder').addEventListener('click', () => run(() => window.bot.torrentsShow({})));
$('torrents-search-form').addEventListener('submit', search);
for (const node of document.querySelectorAll('[data-torrents-tab]')) node.addEventListener('click', () => setTab(node.dataset.torrentsTab));
$('torrents-add').addEventListener('click', () => {
  const menu = $('torrents-add-menu');
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) $('torrents-link').focus();
});
$('torrents-add-menu').addEventListener('submit', event => {
  event.preventDefault();
  const link = $('torrents-link').value.trim();
  if (!link) return;
  $('torrents-add-menu').classList.add('hidden');
  $('torrents-link').value = '';
  openDraft(/^magnet:\?/i.test(link) ? { magnet: link } : { url: link });
});
document.addEventListener('click', event => { if (!event.target.closest?.('.torrents-add-wrap')) $('torrents-add-menu').classList.add('hidden'); });
for (const option of document.querySelectorAll('[data-torrents-kind]')) option.addEventListener('click', () => { addKind = option.dataset.torrentsKind; renderSources(); });
$('torrents-add-form').addEventListener('submit', addSource);
$('torrents-choose-folder').addEventListener('click', () => run(() => window.bot.torrentsChooseFolder(), apply));
for (const [id, name, scale] of [['torrents-down', 'downloadLimit'], ['torrents-up', 'uploadLimit'], ['torrents-active', 'maxActive'], ['torrents-ratio', 'ratio'], ['torrents-hours', 'hours']]) {
  $(id).addEventListener('change', event => { const value = Number(event.target.value || 0); saveSettings({ [name]: name === 'maxActive' ? Math.round(value) : value }); });
}
$('torrents-stop').addEventListener('change', event => saveSettings({ stopSharing: event.target.value }));
for (const [id, name] of [['torrents-upnp', 'upnp'], ['torrents-magnet', 'magnetLinks'], ['torrents-games', 'pauseForGames']]) $(id).addEventListener('change', event => saveSettings({ [name]: event.target.checked }));

// A .torrent file dropped on the panel is read, not attached to the conversation.
const panel = $('torrents-panel');
panel.addEventListener('dragover', event => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); panel.classList.add('drop-active'); } });
panel.addEventListener('dragleave', event => { if (!panel.contains(event.relatedTarget)) panel.classList.remove('drop-active'); });
panel.addEventListener('drop', async event => {
  event.preventDefault(); event.stopPropagation();
  panel.classList.remove('drop-active');
  const file = Array.from(event.dataTransfer?.files || []).find(item => /\.torrent$/i.test(item.name));
  if (!file) { say('Drop a .torrent file here.', true); return; }
  if (file.size > 10 * 1024 * 1024) { say('That .torrent file is too large.', true); return; }
  openDraft({ bytes: Array.from(new Uint8Array(await file.arrayBuffer())), name: file.name });
});

window.bot?.onEvent?.(event => {
  if (event?.type === 'torrentStats') {
    live = event.stats || {};
    renderTotals();
    for (const row of document.querySelectorAll('.torrents-transfer')) {
      const item = torrents?.items?.find(entry => entry.key === row.dataset.key);
      if (item) paint(row, item);
    }
  } else if (event?.type === 'torrentDraft') {
    // A magnet link opened from the browser.
    if (event.pending) { drafting = true; draft = null; draftError = ''; renderDraft(); }
    else if (event.error) { drafting = false; draftError = event.error; renderDraft(); }
    else if (event.draft) { drafting = false; draft = event.draft; chosen = new Set(draft.files.map(file => file.index)); renderDraft(); }
  }
});

window.LittleBotTorrents = { render };
setTab('search');
renderSearch();
document.dispatchEvent(new Event('torrents-ready'));
