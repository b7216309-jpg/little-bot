// The draughts panel. The game itself lives in the main process (draughts-table.cjs); this draws the board, lets
// the user move by clicking or dragging, and sends each move to the conversation, where Little Bot answers with
// its own. Right-clicking a square points at it: the square goes with the next message as a numbered chip.

const $ = id => document.getElementById(id);
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const glyph = name => (typeof globalThis.icon === 'function' ? globalThis.icon(name) : make('span'));
const say = (message, error = false) => globalThis.notify?.(message, error);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const WHITE = 1, BLACK = -1, KING = 2;
// Square n sits on row (n-1)/5 of the dark squares; the top-left corner is light. Same as rules.cjs.
const COORDS = [null];
for (let n = 1; n <= 50; n++) { const row = Math.floor((n - 1) / 5), k = (n - 1) % 5; COORDS.push([row, row % 2 === 0 ? 2 * k + 1 : 2 * k]); }
const squareAt = (row, col) => row < 0 || row > 9 || col < 0 || col > 9 || (row + col) % 2 === 0 ? 0 : row * 5 + Math.floor(col / 2) + 1;

let draughts = null;         // state.draughts
let lastState = null;
let key = null, busy = false, game = null;
let shown = null;            // what the board shows: { id, count, sig, board }
let pieces = new Map();      // square -> piece element
let selected = null;
let points = [];             // squares pointed at, for the next message
let generation = 0;          // bumped on a rebuild, so a running animation stops
let queue = Promise.resolve();
let animatingCount = 0;
let sending = false;
let hiddenResult = null;     // the game id whose result card the user put away
let formChoice = { color: 'white', level: null };
let resignArmed = null;

// ------------------------------------------------------------------------------------------------ sound

const SOUNDS = { move: ['move-1', 'move-2', 'move-3'], capture: ['capture-1', 'capture-2'], stack: ['stack-1', 'stack-2'], crown: ['crown'] };
const audio = new Map();
function play(kind, volume = 0.5) {
  if (!draughts?.prefs?.sound) return;
  const names = SOUNDS[kind];
  const name = names[Math.floor(Math.random() * names.length)];
  let clip = audio.get(name);
  if (!clip) { clip = new Audio(`assets/draughts/${name}.ogg`); audio.set(name, clip); }
  const voice = clip.cloneNode();
  voice.volume = volume;
  voice.play().catch(() => {});
}

// ------------------------------------------------------------------------------------------------ the board

const flipped = () => game?.userSide === BLACK;
function place(square) {
  const [row, col] = COORDS[square];
  return flipped() ? [9 - row, 9 - col] : [row, col];
}
function squareFromPoint(x, y) {
  const rect = $('draughts-grid').getBoundingClientRect();
  const col = Math.floor((x - rect.left) / rect.width * 10), row = Math.floor((y - rect.top) / rect.height * 10);
  if (row < 0 || row > 9 || col < 0 || col > 9) return 0;
  return flipped() ? squareAt(9 - row, 9 - col) : squareAt(row, col);
}

function buildGrid() {
  const grid = $('draughts-grid');
  if (grid.childElementCount) return;
  for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
    const cell = make('div', `draughts-square ${(row + col) % 2 ? 'dark' : 'light'}`);
    cell.dataset.row = row; cell.dataset.col = col;
    cell.style.left = `${col * 10}%`; cell.style.top = `${row * 10}%`;
    // Each square shows its own patch of the grain, so the wood does not look repeated.
    const seed = row * 10 + col;
    cell.style.backgroundPosition = `${(seed * 37) % 100}% ${(seed * 61 + 13) % 100}%`;
    grid.append(cell);
  }
}

// Which square each dark cell shows depends on the side the user plays.
function labelSquares() {
  for (const cell of $('draughts-grid').querySelectorAll('.draughts-square.dark')) {
    const row = Number(cell.dataset.row), col = Number(cell.dataset.col);
    const square = flipped() ? squareAt(9 - row, 9 - col) : squareAt(row, col);
    if (cell.dataset.square === String(square)) continue;
    cell.dataset.square = square;
    cell.replaceChildren(make('span', 'draughts-number', String(square)));
  }
}

function cellOf(square) { return $('draughts-grid').querySelector(`.draughts-square[data-square="${square}"]`); }

function pieceElement(code) {
  const node = make('div', `draughts-piece ${code > 0 ? 'white' : 'black'}${Math.abs(code) === KING ? ' king' : ''}`);
  node.append(make('i'));
  return node;
}
function moveTo(node, square) {
  const [row, col] = place(square);
  node.style.left = `${col * 10}%`; node.style.top = `${row * 10}%`;
  node.dataset.square = square;
}

function rebuild(board) {
  generation++;
  queue = Promise.resolve();
  animatingCount = 0;
  for (const node of pieces.values()) node.remove();
  pieces = new Map();
  labelSquares();
  if (!board) return;
  const grid = $('draughts-grid');
  for (let square = 1; square <= 50; square++) {
    if (!board[square]) continue;
    const node = pieceElement(board[square]);
    moveTo(node, square);
    grid.append(node);
    pieces.set(square, node);
  }
}

function applyLocal(board, move) {
  const next = board.slice();
  const piece = next[move.from];
  next[move.from] = 0;
  for (const square of move.captures) next[square] = 0;
  next[move.to] = move.crown ? Math.sign(piece) * KING : piece;
  return next;
}

// One move, square by square along its path; taken pieces lift off at the end, as the rules say.
async function animate(move, mine, dropped = false) {
  const run = generation;
  const node = pieces.get(move.from);
  if (!node) return;
  animatingCount++;
  try {
    // A piece dropped by hand on its square is already there.
    const step = reduced() || (dropped && !move.captures.length) ? 0 : move.captures.length ? 210 : 260;
    node.style.transition = step ? `left ${step}ms cubic-bezier(.3,.7,.25,1),top ${step}ms cubic-bezier(.3,.7,.25,1)` : 'none';
    node.classList.add('selected');
    for (const square of move.path.slice(1)) {
      if (run !== generation) return;
      moveTo(node, square);
      await sleep(step + 20);
    }
    node.classList.remove('selected');
    pieces.delete(move.from);
    pieces.set(move.to, node);
    play(move.captures.length ? 'capture' : 'move', mine ? 0.45 : 0.55);
    for (const square of move.captures) {
      const taken = pieces.get(square);
      pieces.delete(square);
      if (!taken) continue;
      taken.classList.add('taken');
      if (!reduced()) taken.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(-14px) scale(1.15)', opacity: 0 }], { duration: 320, easing: 'ease-in' });
      setTimeout(() => taken.remove(), reduced() ? 0 : 300);
      if (!reduced()) await sleep(110);
    }
    if (move.captures.length) setTimeout(() => play('stack', 0.4), 240);
    if (move.crown) { node.classList.add('king'); setTimeout(() => play('crown', 0.5), 120); }
    node.style.transition = '';
  } finally { animatingCount = Math.max(0, animatingCount - 1); }
}

// Brings the board to the game: new moves are animated, anything else is redrawn.
function sync() {
  if (!game) { if (shown) { shown = null; rebuild(null); } return; }
  const sig = game.board.join(',');
  if (shown?.id === game.id && shown.sig === sig && shown.flip === flipped()) return;
  // The user's move is already on the board while the main process takes it.
  if (sending && shown?.id === game.id && game.moves.length === shown.count - 1) return;
  const extra = shown?.id === game.id && shown.flip === flipped() ? game.moves.length - shown.count : -1;
  if (extra > 0 && extra <= 3) {
    let board = shown.board;
    const fresh = game.moves.slice(shown.count);
    for (const move of fresh) board = applyLocal(board, move);
    if (board.join(',') === sig) {
      for (const move of fresh) queue = queue.then(() => animate(move, move.side === game.userSide)).then(renderTrays);
      shown = { id: game.id, count: game.moves.length, sig, board: game.board.slice(), flip: flipped() };
      return;
    }
  }
  shown = { id: game.id, count: game.moves.length, sig, board: game.board.slice(), flip: flipped() };
  rebuild(game.board);
}

// ------------------------------------------------------------------------------------------------ moving

const myTurn = () => Boolean(game && game.status === 'playing' && game.turn === game.userSide && !busy && !sending && shown?.id === game.id && shown.count === game.moves.length);
const movesFrom = square => (game?.legal || []).filter(move => move.from === square);

function markPlayable() {
  const playable = new Set(myTurn() ? game.legal.map(move => move.from) : []);
  for (const [square, node] of pieces) {
    const mine = game && Math.sign(shown?.board?.[square] || 0) === game.userSide;
    node.classList.toggle('mine', Boolean(mine) && playable.has(square));
    node.classList.toggle('can-move', playable.has(square) && !selected);
    node.classList.toggle('selected', square === selected);
  }
  const targets = new Set(selected ? movesFrom(selected).map(move => move.to) : []);
  for (const cell of $('draughts-grid').querySelectorAll('.draughts-square.dark')) {
    cell.classList.toggle('target', targets.has(Number(cell.dataset.square)));
    cell.classList.toggle('pointed', points.includes(Number(cell.dataset.square)));
  }
  const last = game?.moves.at(-1);
  const lit = new Set(last && shown?.count === game.moves.length ? [last.from, last.to] : []);
  for (const cell of $('draughts-grid').querySelectorAll('.draughts-square.dark')) cell.classList.toggle('last', lit.has(Number(cell.dataset.square)));
  $('draughts-grid').classList.toggle('no-dots', draughts?.prefs?.dots === false);
}

function select(square) {
  selected = square && movesFrom(square).length ? square : null;
  closeChooser();
  showDoomed(null);
  markPlayable();
}

function showDoomed(target) {
  const doomed = new Set();
  if (target && selected) for (const move of movesFrom(selected)) if (move.to === target) move.captures.forEach(square => doomed.add(square));
  for (const [square, node] of pieces) node.classList.toggle('doomed', doomed.has(square));
}

async function tryMove(from, to, at, dropped = false) {
  const options = movesFrom(from).filter(move => move.to === to);
  if (!options.length) return false;
  if (options.length === 1) { commit(options[0], dropped); return true; }
  // Two captures end on the same square: ask which pieces to take.
  openChooser(options, at);
  return true;
}

function openChooser(options, at) {
  closeChooser();
  const box = make('div', 'draughts-choose');
  box.id = 'draughts-choose';
  box.append(make('p', '', 'Which pieces do you take?'));
  for (const move of options) {
    const button = make('button', '', `${move.notation} · takes ${move.captures.join(', ')}`);
    button.type = 'button';
    button.addEventListener('mouseenter', () => { for (const [square, node] of pieces) node.classList.toggle('doomed', move.captures.includes(square)); });
    button.addEventListener('click', () => { closeChooser(); commit(move); });
    box.append(button);
  }
  const wrap = $('draughts-board-wrap');
  const rect = wrap.getBoundingClientRect();
  box.style.left = `${Math.min(Math.max(8, at.x - rect.left), rect.width - 170)}px`;
  box.style.top = `${Math.min(Math.max(8, at.y - rect.top), rect.height - 40 - options.length * 30)}px`;
  wrap.append(box);
  box.querySelector('button')?.focus();
}
function closeChooser() { $('draughts-choose')?.remove(); }

async function commit(move, dropped = false) {
  if (!myTurn()) return;
  selected = null;
  showDoomed(null);
  sending = true;
  // The board moves at once; the main process checks the move again before Little Bot is asked.
  const board = applyLocal(shown.board, move);
  shown = { ...shown, count: shown.count + 1, sig: board.join(','), board };
  queue = queue.then(() => animate(move, true, dropped)).then(renderTrays);
  markPlayable();
  renderChrome();
  let ok = false;
  try { ok = await globalThis.sendDraughts?.({ played: move.notation }); }
  catch (error) { say(error.message || String(error), true); }
  sending = false;
  if (ok && points.length) { points = []; pointsChanged(); }
  // A refused move snaps back on the next render.
  if (!ok) { shown = null; }
  if (lastState) render(lastState);
}

// Pointer: press a piece to pick it up, drag or click a square to put it down.
let press = null;
function onPointerDown(event) {
  if (event.button !== 0) return;
  closeChooser();
  const square = squareFromPoint(event.clientX, event.clientY);
  if (!square) return;
  if (selected && movesFrom(selected).some(move => move.to === square)) { tryMove(selected, square, { x: event.clientX, y: event.clientY }); return; }
  if (!myTurn() || !movesFrom(square).length) { if (selected) select(null); return; }
  const node = pieces.get(square);
  const wasSelected = selected === square;
  select(square);
  press = { square, node, x: event.clientX, y: event.clientY, dragging: false, wasSelected, pointerId: event.pointerId };
  $('draughts-grid').setPointerCapture(event.pointerId);
}
function onPointerMove(event) {
  const square = squareFromPoint(event.clientX, event.clientY);
  if (!press) {
    // Hovering a destination shows what it takes.
    if (selected) showDoomed(movesFrom(selected).some(move => move.to === square) ? square : null);
    return;
  }
  const dx = event.clientX - press.x, dy = event.clientY - press.y;
  if (!press.dragging && Math.hypot(dx, dy) < 5) return;
  press.dragging = true;
  press.node.classList.add('dragging');
  press.node.style.transform = `translate(${dx}px, ${dy}px)`;
  for (const cell of $('draughts-grid').querySelectorAll('.draughts-square.drop')) cell.classList.remove('drop');
  if (movesFrom(press.square).some(move => move.to === square)) cellOf(square)?.classList.add('drop');
  showDoomed(movesFrom(press.square).some(move => move.to === square) ? square : null);
}
async function onPointerUp(event) {
  if (!press) return;
  const current = press;
  press = null;
  try { $('draughts-grid').releasePointerCapture(current.pointerId); } catch { /* Already released. */ }
  for (const cell of $('draughts-grid').querySelectorAll('.draughts-square.drop')) cell.classList.remove('drop');
  current.node.classList.remove('dragging');
  const square = squareFromPoint(event.clientX, event.clientY);
  if (current.dragging) {
    current.node.style.transition = 'none';
    current.node.style.transform = '';
    const played = square !== current.square && await tryMove(current.square, square, { x: event.clientX, y: event.clientY }, true);
    if (!played) select(null);
  } else if (current.wasSelected) select(null);
}

// Right-click: point at a square for the next message.
function onContextMenu(event) {
  event.preventDefault();
  const square = squareFromPoint(event.clientX, event.clientY);
  if (!square || !game) return;
  points = points.includes(square) ? points.filter(n => n !== square) : [...points, square].slice(-8);
  pointsChanged();
  $('message-input')?.focus();
}

// ------------------------------------------------------------------------------------------------ the chips

function describe(square) {
  const piece = shown?.board?.[square] || 0;
  if (!piece) return `Square ${square} · empty`;
  const whose = Math.sign(piece) === game?.userSide ? 'your' : 'Little Bot’s';
  return `Square ${square} · ${whose} ${Math.abs(piece) === KING ? 'king' : 'man'}`;
}
function pointsChanged() {
  renderPoints();
  markPlayable();
  document.dispatchEvent(new Event('draughts-selection'));
}
function renderPoints() {
  const tray = $('draughts-selection');
  const visible = Boolean(draughts?.enabled) && points.length > 0;
  tray.classList.toggle('hidden', !visible);
  if (!visible) { tray.replaceChildren(); return; }
  tray.replaceChildren(...points.map((square, index) => {
    const chip = make('div', 'cad-chip draughts-chip');
    const text = describe(square);
    const name = make('span', 'cad-chip-label', text);
    name.title = text;
    const remove = make('button');
    remove.type = 'button'; remove.title = 'Remove'; remove.setAttribute('aria-label', `Stop pointing at square ${square}`);
    remove.append(glyph('x'));
    remove.addEventListener('click', () => { points = points.filter(n => n !== square); pointsChanged(); });
    chip.append(make('span', 'cad-chip-n', String(index + 1)), name, remove);
    return chip;
  }));
}

// ------------------------------------------------------------------------------------------------ around the board

function captured(color) {
  // Pieces of this colour that have been taken: 20 minus those left, counted on the board as shown.
  let left = 0;
  for (let square = 1; square <= 50; square++) if (Math.sign(shown?.board?.[square] || 0) === color) left++;
  return game ? 20 - left : 0;
}
function renderTrays() {
  if (!game) { $('draughts-tray-top').replaceChildren(); $('draughts-tray-bottom').replaceChildren(); return; }
  const bot = -game.userSide;
  for (const [id, owner, takenColor] of [['draughts-tray-top', 'Little Bot', game.userSide], ['draughts-tray-bottom', 'You', bot]]) {
    const tray = $(id);
    const count = captured(takenColor);
    const before = Number(tray.dataset.count || 0);
    const pile = make('div', 'draughts-tray-pile');
    for (let i = 0; i < count; i++) pile.append(make('i', `${takenColor === WHITE ? 'white' : 'black'}${i >= before && tray.dataset.game === game.id ? ' fresh' : ''}`));
    tray.dataset.count = count; tray.dataset.game = game.id;
    tray.replaceChildren(make('span', 'draughts-tray-name', owner), pile, make('span', 'draughts-tray-count', count ? `took ${count}` : ''));
  }
}

function renderMoves() {
  const list = $('draughts-moves');
  const moves = game?.moves || [];
  const rows = [];
  for (const move of moves) {
    if (move.side === WHITE || !rows.length) rows.push({ n: rows.length + 1, white: null, black: null });
    rows.at(-1)[move.side === WHITE ? 'white' : 'black'] = move;
  }
  const cell = move => {
    const span = make('span', move?.by === 'auto' ? 'auto' : '', move ? move.notation : '');
    if (move?.by === 'auto') span.title = 'Played by the board for Little Bot';
    return span;
  };
  list.replaceChildren(...rows.map((row, index) => {
    const item = make('li', index === rows.length - 1 ? 'latest' : '');
    item.append(make('span', '', `${row.n}.`), cell(row.white), cell(row.black));
    return item;
  }));
  list.lastElementChild?.scrollIntoView({ block: 'nearest' });
}

function status() {
  if (!key) return { text: 'Play in the main conversation or a saved session', kind: '' };
  if (!game) return { text: 'No game yet', kind: '' };
  if (game.status === 'over') {
    if (!game.winner) return { text: 'Draw', kind: '' };
    return game.winner === game.userSide ? { text: 'You won!', kind: 'won' } : { text: 'Little Bot won', kind: 'lost' };
  }
  if (game.turn === game.userSide) {
    if (sending || busy) return { text: 'Sending your move…', kind: '', dot: true };
    return { text: game.legal[0]?.captures.length ? 'Your move · you must capture' : 'Your move', kind: 'yours' };
  }
  if (game.thinking) return { text: 'The board is choosing for Little Bot…', kind: '', dot: true };
  if (busy || sending) return { text: 'Little Bot is thinking…', kind: '', dot: true };
  return { text: 'Little Bot’s turn', kind: '' };
}

function renderChrome() {
  const now = status();
  const line = $('draughts-status');
  line.className = `draughts-status ${now.kind}`;
  line.replaceChildren(...(now.dot ? [make('span', 'status-dot running')] : []), make('span', '', now.text));
  $('draughts-level').textContent = game ? game.level : '';
  $('draughts-undo').disabled = !game?.canTakeBack || busy || sending;
  for (const [id, pref] of [['draughts-sound', 'sound'], ['draughts-numbers', 'numbers'], ['draughts-dots', 'dots']]) $(id).setAttribute('aria-pressed', String(Boolean(draughts?.prefs?.[pref])));
  $('draughts-grid').classList.toggle('show-numbers', Boolean(draughts?.prefs?.numbers));
  for (const label of $('draughts-grid').querySelectorAll('.draughts-number')) label.hidden = !draughts?.prefs?.numbers;
  // The empty state, with the new game form, when there is no game.
  const empty = $('draughts-empty');
  empty.classList.toggle('hidden', Boolean(game));
  if (!game) {
    const card = empty.querySelector('.draughts-card');
    card.replaceChildren(make('h2', '', 'Draughts'), make('p', '', key
      ? 'International rules on a 10×10 board, against Little Bot. Move by clicking or dragging; right-click a square to ask about it. You can chat between moves.'
      : 'Open the main conversation or a saved session to play.'));
    if (key) card.append(newGameForm());
  }
  // The result, until the user puts it away.
  const result = $('draughts-result');
  const over = game?.status === 'over' && hiddenResult !== game.id && !animatingCount;
  result.classList.toggle('hidden', !over);
  if (over) {
    const title = !game.winner ? 'A draw' : game.winner === game.userSide ? 'You won!' : 'Little Bot won';
    const again = make('button', 'button primary', 'New game'); again.type = 'button';
    again.addEventListener('click', () => toggleMenu(true));
    const look = make('button', 'text-button', 'Look at the board'); look.type = 'button';
    look.addEventListener('click', () => { hiddenResult = game.id; renderChrome(); });
    result.replaceChildren(make('h2', '', title), make('p', '', `By ${game.reason}.`), again, look);
  }
  // A note from the board, and the buttons under the moves.
  $('draughts-note').textContent = game?.note || '';
  $('draughts-note').classList.toggle('hidden', !game?.note);
  const botTurn = game?.status === 'playing' && game.turn !== game.userSide && !busy && !sending && !game.thinking;
  $('draughts-ask').classList.toggle('hidden', !botTurn);
  $('draughts-resign').classList.toggle('hidden', game?.status !== 'playing');
  $('draughts-resign').disabled = busy || sending;
  $('draughts-resign').textContent = resignArmed === game?.id ? 'Resign? Click again' : 'Resign';
  renderMoves();
}

function newGameForm(onDone) {
  const form = make('form', 'draughts-form');
  const level = formChoice.level || draughts?.prefs?.level || 'medium';
  const segment = (name, options, value, set) => {
    const group = make('div', 'draughts-segment');
    group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-label', name);
    for (const [id, label, hint] of options) {
      const button = make('button');
      button.type = 'button'; button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', String(id === value));
      button.append(make('span', '', label), make('small', '', hint));
      button.addEventListener('click', () => { set(id); for (const other of group.children) other.setAttribute('aria-checked', String(other === button)); });
      group.append(button);
    }
    return group;
  };
  const start = make('button', 'button primary', 'Start the game'); start.type = 'submit';
  form.append(
    make('p', '', 'You play'),
    segment('Your colour', [['white', 'White', 'moves first'], ['black', 'Black', 'Little Bot starts']], formChoice.color, value => { formChoice.color = value; }),
    make('p', '', 'Little Bot plays'),
    segment('Level', [['easy', 'Easy', 'casual'], ['medium', 'Medium', 'careful'], ['hard', 'Hard', 'sharp']], level, value => { formChoice.level = value; }),
    start,
  );
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      globalThis.applyState?.(await window.bot.draughtsNew({ key, userColor: formChoice.color, level: formChoice.level || level }));
      onDone?.();
      hiddenResult = null; selected = null;
      // As Black, the user waits for Little Bot's first move.
      if (formChoice.color === 'black') await globalThis.sendDraughts?.({ resume: true });
    } catch (error) { say(error.message || String(error), true); }
  });
  return form;
}

function toggleMenu(open) {
  const menu = $('draughts-new-menu');
  const opening = open ?? menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !opening);
  $('draughts-new').setAttribute('aria-expanded', String(opening));
  if (opening) menu.replaceChildren(newGameForm(() => toggleMenu(false)));
}

function fitBoard() {
  const stage = $('draughts-stage');
  const size = Math.max(200, Math.floor(Math.min(stage.clientWidth - 36, stage.clientHeight - 28 - 2 * 34)));
  stage.style.setProperty('--board-size', `${size}px`);
}

function render(state) {
  if (window.LittleBotWidget?.widget) return;
  lastState = state;
  draughts = state?.draughts || null;
  const enabled = Boolean(draughts?.enabled);
  const open = enabled && Boolean(draughts?.panel) && !state?.browser?.panel;
  const button = $('open-draughts');
  button.classList.toggle('hidden', !enabled);
  button.classList.toggle('browser-active', open);
  button.setAttribute('aria-pressed', String(open));
  button.title = open ? 'Hide the draughts board' : 'Show the draughts board';
  $('draughts-panel').classList.toggle('hidden', !open);
  document.querySelector('.app-shell')?.classList.toggle('draughts-open', open);
  if (!enabled && points.length) { points = []; pointsChanged(); }
  const context = globalThis.draughtsChat?.() || { key: null, busy: false };
  if (context.key !== key) { points = []; selected = null; }
  key = context.key; busy = context.busy;
  game = key ? draughts?.games?.[key] || null : null;
  renderPoints();
  if (!open) return;
  buildGrid();
  fitBoard();
  sync();
  if (selected && !myTurn()) selected = null;
  markPlayable();
  if (!animatingCount) renderTrays();
  renderChrome();
}

// ------------------------------------------------------------------------------------------------ wiring

const prefs = async change => {
  try { globalThis.applyState?.(await window.bot.draughtsPrefs({ prefs: change })); } catch (error) { say(error.message || String(error), true); }
};
$('open-draughts').addEventListener('click', async () => {
  try { globalThis.applyState?.(await window.bot.draughtsPanel({ visible: !(draughts?.panel) })); } catch (error) { say(error.message || String(error), true); }
});
$('draughts-hide').addEventListener('click', async () => {
  try { globalThis.applyState?.(await window.bot.draughtsPanel({ visible: false })); } catch (error) { say(error.message || String(error), true); }
});
$('draughts-new').addEventListener('click', () => toggleMenu());
document.addEventListener('click', event => { if (!event.target.closest?.('.draughts-menu-wrap') && !$('draughts-new-menu').classList.contains('hidden')) toggleMenu(false); });
$('draughts-undo').addEventListener('click', async () => {
  try { selected = null; globalThis.applyState?.(await window.bot.draughtsTakeBack({ key })); } catch (error) { say(error.message || String(error), true); }
});
$('draughts-sound').addEventListener('click', () => prefs({ sound: !draughts?.prefs?.sound }));
$('draughts-numbers').addEventListener('click', () => prefs({ numbers: !draughts?.prefs?.numbers }));
$('draughts-dots').addEventListener('click', () => prefs({ dots: !draughts?.prefs?.dots }));
$('draughts-ask').addEventListener('click', () => globalThis.sendDraughts?.({ resume: true }));
$('draughts-resign').addEventListener('click', async () => {
  if (resignArmed !== game?.id) {
    resignArmed = game?.id;
    renderChrome();
    setTimeout(() => { if (resignArmed) { resignArmed = null; renderChrome(); } }, 3500);
    return;
  }
  resignArmed = null;
  try { globalThis.applyState?.(await window.bot.draughtsResign({ key })); } catch (error) { say(error.message || String(error), true); }
});
const grid = $('draughts-grid');
grid.addEventListener('pointerdown', onPointerDown);
grid.addEventListener('pointermove', onPointerMove);
grid.addEventListener('pointerup', event => { onPointerUp(event); });
grid.addEventListener('pointercancel', () => { if (press) { press.node.classList.remove('dragging'); press.node.style.transform = ''; press = null; } });
grid.addEventListener('pointerleave', () => { if (!press) showDoomed(null); });
grid.addEventListener('contextmenu', onContextMenu);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && selected) { select(null); closeChooser(); } });
new ResizeObserver(() => { if (!$('draughts-panel').classList.contains('hidden')) fitBoard(); }).observe($('draughts-stage'));

window.LittleBotDraughts = {
  render,
  // The squares pointed at, for the next message.
  selection() { return draughts?.enabled && key ? [...points] : []; },
  clearSelection() { points = []; pointsChanged(); },
};
document.dispatchEvent(new Event('draughts-ready'));
