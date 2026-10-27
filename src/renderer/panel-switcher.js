// The side panels (browser, CAD workshop, draughts, torrents) share one top bar button: it shows the open panel and
// opens a short menu with one row per enabled panel and what is going on in it. Each panel module still owns its own
// row (visibility, pressed state, click); this module only keeps the button, the hints, the dot and the shortcuts.

const $ = id => document.getElementById(id);
const ROWS = [
  { id: 'open-agent-browser', key: 'browser', name: 'Browser', icon: 'browser' },
  { id: 'open-cad', key: 'cad', name: 'CAD', icon: 'cube' },
  { id: 'open-draughts', key: 'draughts', name: 'Draughts', icon: 'draughts' },
  { id: 'open-torrents', key: 'torrents', name: 'Torrents', icon: 'import' },
];
let current = null;
// The top bar clips what overflows it (its labels shrink with the window), so the menu lives in the main column and
// is placed under the button when it opens.
const menu = $('panel-menu');
document.querySelector('.main')?.append(menu);

// The open panel, in the order the panels themselves use: the browser covers the others.
function openPanel(state) {
  if (state?.browser?.panel) return 'browser';
  for (const key of ['cad', 'draughts', 'torrents']) if (state?.[key]?.enabled && state[key].panel) return key;
  return null;
}

function hostOf(url) { try { return url && url !== 'about:blank' ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { return ''; } }

// The game in the conversation on screen, and whether it waits for the user.
function draughtsGame(state) {
  const key = globalThis.draughtsChat?.()?.key;
  return key ? state?.draughts?.games?.[key] || null : null;
}
function yourMove(game) { return Boolean(game && game.status === 'playing' && game.turn === game.userSide && !game.thinking); }

function render(state) {
  if (window.LittleBotWidget?.widget) return;
  const open = openPanel(state);
  const row = ROWS.find(item => item.key === open);
  if (row?.key !== current) {
    current = row?.key || null;
    globalThis.fillIcon?.($('panel-switch-icon'), row?.icon || 'panels');
  }
  $('panel-switch-label').textContent = row?.name || 'Panels';
  $('panel-switch').classList.toggle('browser-active', Boolean(row));
  for (const item of ROWS) $(item.id).setAttribute('aria-checked', String(item.key === open));
  $('panel-close').classList.toggle('hidden', !row);
  menu.querySelector('.panel-menu-divider').classList.toggle('hidden', !row);

  $('open-browser-hint').textContent = state?.browser?.active ? hostOf(state.browser.url) : '';
  $('open-cad-hint').textContent = state?.cad?.project?.name || '';
  const game = draughtsGame(state);
  $('open-draughts-hint').textContent = !game ? '' : game.status !== 'playing' ? 'Game over' : game.thinking ? 'Thinking…' : yourMove(game) ? 'Your move' : '';
  $('open-draughts-hint').classList.toggle('panel-menu-hint-ready', yourMove(game));

  // A dot when a closed panel waits for the user: a move to play, or a download the model asked for.
  const requests = state?.torrents?.enabled ? state.torrents.requests?.length || 0 : 0;
  const waiting = [];
  if (state?.draughts?.enabled && open !== 'draughts' && yourMove(game)) waiting.push('your move in draughts');
  if (requests && open !== 'torrents') waiting.push(`${requests} download request${requests === 1 ? '' : 's'}`);
  $('panel-switch-dot').classList.toggle('hidden', !waiting.length);
  $('panel-switch').title = waiting.length ? `Side panels · ${waiting.join(', ')}` : 'Side panels · Ctrl+1 to 4';
}

function setMenu(opening) {
  if (opening) {
    const button = $('panel-switch').getBoundingClientRect(), frame = menu.parentElement.getBoundingClientRect();
    menu.style.top = `${Math.round(button.bottom - frame.top + 6)}px`;
    menu.style.right = `${Math.max(8, Math.round(frame.right - button.right))}px`;
  }
  menu.classList.toggle('hidden', !opening);
  $('panel-switch').setAttribute('aria-expanded', String(opening));
  if (opening) ($('panel-menu').querySelector('.panel-menu-item[aria-checked="true"]') || $('panel-menu').querySelector('.panel-menu-item:not(.hidden)'))?.focus();
}
const menuOpen = () => !$('panel-menu').classList.contains('hidden');
function closePanel() { if (current) $(ROWS.find(item => item.key === current).id).click(); }

$('panel-switch').addEventListener('click', () => setMenu(!menuOpen()));
// A row's own handler opens or hides its panel; the menu only closes after it.
$('panel-menu').addEventListener('click', event => { if (event.target.closest('.panel-menu-item')) setMenu(false); });
$('panel-close').addEventListener('click', closePanel);
document.addEventListener('click', event => { if (menuOpen() && !event.target.closest('.panel-switch-wrap, #panel-menu')) setMenu(false); });
window.addEventListener('resize', () => { if (menuOpen()) setMenu(false); });
$('panel-menu').addEventListener('keydown', event => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...$('panel-menu').querySelectorAll('.panel-menu-item:not(.hidden)')];
  const at = items.indexOf(document.activeElement);
  items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
});
document.addEventListener('keydown', event => {
  if (window.LittleBotWidget?.widget || document.querySelector('dialog[open]')) return;
  // Esc only closes the menu: inside the panels it already cancels a measure or a selected piece.
  if (event.key === 'Escape') { if (menuOpen()) { event.preventDefault(); setMenu(false); $('panel-switch').focus(); } return; }
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || !/^[1-4]$/.test(event.key)) return;
  const row = $(ROWS[Number(event.key) - 1].id);
  if (row.classList.contains('hidden') || row.disabled) return;
  event.preventDefault();
  setMenu(false);
  row.click();
});

window.LittleBotPanels = { render };
document.dispatchEvent(new Event('panels-ready'));
