'use strict';

// Draughts against Little Bot: international rules on a 10×10 board, in a panel beside the conversation. The rules
// live here, so no illegal move is ever played. The user moves on the board; their move goes to the conversation
// and Little Bot answers by playing through the draughts tool. A small search gives Little Bot a verdict on each of
// its moves (how much depends on the level) and plays for it when the model forgets to.
// Each conversation keeps its own game: the main conversation under "main", saved sessions under their id.

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const rules = require('./draughts/rules.cjs');
const { verdicts, chooseMove } = require('./draughts/search.cjs');

const { WHITE, BLACK, KING } = rules;
const LEVELS = ['easy', 'medium', 'hard'];
const MAX_GAMES = 12;
const UNDO_DEPTH = 40;
const ACTIVE_FOR = 30 * 60 * 1000; // a game this fresh is mentioned to the model even without a move
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sideName = side => side === WHITE ? 'White' : 'Black';

const SPEC = {
  type: 'function',
  name: 'draughts',
  description: 'Play draughts with the user on the board in Little Bot\'s draughts panel: international rules on a 10×10 board, as played in France '
    + '(men capture backwards too, capturing is compulsory and you must take the most pieces, kings fly). Squares are numbered 1–50; 1–5 is Black\'s back row, 46–50 White\'s. '
    + 'The user plays one colour on the board, you play the other. Actions: board (the position, whose turn it is, and your legal moves, with a verdict on each when the level allows), '
    + 'move (play one of your legal moves on your turn, written as listed, e.g. "32-28" or "19x30"), analyse (the engine\'s verdict on a move, or on what the piece on a square can do, for questions about the game), '
    + 'new (start a new game, only when the user asks for one). On your turn, play exactly one move, then talk to the user in one or two short, friendly sentences. Never describe a move you did not play.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['board', 'move', 'analyse', 'new'] },
      move: { type: 'string', maxLength: 80, description: 'move: your move as listed, e.g. "32-28" or "19x30". analyse: any legal move of the side to move.' },
      square: { type: 'integer', minimum: 1, maximum: 50, description: 'analyse: a square, to see what the piece on it can do.' },
      userColor: { type: 'string', enum: ['white', 'black'], description: 'new: the colour the user plays (White moves first). Default white.' },
      level: { type: 'string', enum: LEVELS, description: 'new: how strongly you play. Default the current level.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
};

class DraughtsTable {
  constructor({ store, keyOf, onChange, beforeShow, workerFile = path.join(__dirname, 'draughts', 'worker.cjs'), Worker = null }) {
    this.store = store;
    this.keyOf = keyOf;
    this.onChange = onChange || (() => {});
    this.beforeShow = beforeShow || (() => {}); // puts away another side panel
    this.workerFile = workerFile;
    this.Worker = Worker;
    this.panel = false;
    this.worker = null;
    this.pending = new Map();
    this.thinking = new Set(); // keys whose fallback move is being chosen
  }

  get enabled() { return this.store.data.settings.draughtsEnabled === true; }
  get data() {
    if (!object(this.store.data.draughts)) this.store.data.draughts = {};
    const data = this.store.data.draughts;
    if (!object(data.games)) data.games = {};
    if (!object(data.prefs)) data.prefs = {};
    return data;
  }
  get prefs() {
    const prefs = this.data.prefs;
    return { level: LEVELS.includes(prefs.level) ? prefs.level : 'medium', sound: prefs.sound !== false, numbers: prefs.numbers === true, dots: prefs.dots !== false };
  }

  specs() { return this.enabled ? [structuredClone(SPEC)] : []; }
  owns(name) { return name === 'draughts'; }

  _requireEnabled() { if (!this.enabled) throw new Error('Draughts is off. Turn it on in Extensions › Tools.'); }
  _key(key) {
    if (typeof key !== 'string' || !/^(?:main|[\w-]{1,128})$/.test(key)) throw new Error('Play draughts in the main conversation or a saved session.');
    return key;
  }
  game(key) { return this.data.games[key] || null; }

  _save() { this.store.save(); this.onChange(); }

  // ------------------------------------------------------------------------------------------------ the search

  // The search runs in a worker thread; without one (tests, or if it fails) it runs here.
  _search(op, payload) {
    if (this.Worker) {
      try {
        if (!this.worker) {
          this.worker = new this.Worker(this.workerFile);
          this.worker.on('message', ({ id, result, error }) => { const job = this.pending.get(id); if (!job) return; this.pending.delete(id); error ? job.reject(new Error(error)) : job.resolve(result); });
          const fail = error => { for (const job of this.pending.values()) job.reject(error instanceof Error ? error : new Error('The draughts search stopped.')); this.pending.clear(); this.worker = null; };
          this.worker.on('error', fail);
          this.worker.on('exit', code => { if (code) fail(new Error('The draughts search stopped.')); else this.worker = null; });
          this.worker.unref?.();
        }
        const id = randomUUID();
        return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, op, ...payload }); });
      } catch { /* Fall back to this thread. */ }
    }
    if (op === 'verdicts') return Promise.resolve(verdicts(payload.board, payload.side, { depth: payload.depth }).map(({ notation, outcome, gain, best, score }) => ({ notation, outcome, gain, best, score })));
    return Promise.resolve(chooseMove(payload.board, payload.side, payload.level).notation);
  }

  // ------------------------------------------------------------------------------------------------ games

  newGame(key, { userColor = 'white', level } = {}) {
    this._requireEnabled();
    key = this._key(key);
    if (!['white', 'black'].includes(userColor)) throw new Error('Play White or Black.');
    const chosen = level === undefined ? this.prefs.level : level;
    if (!LEVELS.includes(chosen)) throw new Error(`Choose a level: ${LEVELS.join(', ')}.`);
    const board = rules.initialBoard();
    const now = Date.now();
    const game = {
      id: randomUUID(), userSide: userColor === 'white' ? WHITE : BLACK, level: chosen, board, turn: WHITE, moves: [],
      positions: { [rules.positionKey(board, WHITE)]: 1 }, quietPlies: 0, endgamePlies: 0, status: 'playing', winner: null, reason: null,
      createdAt: now, updatedAt: now, note: null,
    };
    this.data.games[key] = game;
    this.data.prefs = { ...this.data.prefs, level: chosen };
    // Keep the most recent games only.
    const keys = Object.keys(this.data.games).sort((a, b) => (this.data.games[b].updatedAt || 0) - (this.data.games[a].updatedAt || 0));
    for (const old of keys.slice(MAX_GAMES)) delete this.data.games[old];
    this._save();
    return game;
  }

  setPrefs(input) {
    if (!object(input)) throw new Error('Give the draughts preferences.');
    const next = { ...this.data.prefs };
    if (input.level !== undefined) { if (!LEVELS.includes(input.level)) throw new Error(`Choose a level: ${LEVELS.join(', ')}.`); next.level = input.level; }
    for (const name of ['sound', 'numbers', 'dots']) if (input[name] !== undefined) next[name] = input[name] === true;
    this.data.prefs = next;
    this._save();
  }

  // Plays a move for whichever side is to move. by: 'you', 'bot' or 'auto' (chosen by the search for the bot).
  _play(game, text, by) {
    const moves = rules.legalMoves(game.board, game.turn);
    const move = rules.findMove(moves, text);
    if (!move) {
      const listed = moves.map(item => item.notation).join(', ');
      const forced = moves[0]?.captures.length ? ` A capture is compulsory, and the one taking the most pieces (${moves[0].captures.length}).` : '';
      throw new Error(`${String(text || '').slice(0, 40) || 'That'} is not a legal move for ${sideName(game.turn)}.${forced} Legal moves: ${listed}.`);
    }
    const piece = game.board[move.from];
    const before = game.board;
    game.board = rules.applyMove(before, move);
    game.moves.push({ n: game.moves.length + 1, side: game.turn, by, notation: move.notation, from: move.from, to: move.to, path: move.path, captures: move.captures, crown: move.crown, king: Math.abs(piece) === KING, before, at: Date.now() });
    // Old positions are kept for taking moves back only.
    for (const entry of game.moves.slice(0, -UNDO_DEPTH)) delete entry.before;
    Object.assign(game, rules.afterMove(game, game.board, move, piece));
    game.turn = -game.turn;
    // A man's move or a capture can never be undone, so no earlier position can come back.
    if (Math.abs(piece) !== KING || move.captures.length) game.positions = {};
    const key = rules.positionKey(game.board, game.turn);
    game.positions[key] = (game.positions[key] || 0) + 1;
    const result = rules.outcome(game);
    if (result.status === 'over') Object.assign(game, { status: 'over', winner: result.winner, reason: result.reason });
    game.updatedAt = Date.now();
    game.note = null;
    return move;
  }

  // The user's move from the board, checked before the message is accepted and played once it is.
  checkUserMove(key, text) {
    this._requireEnabled();
    const game = this.game(this._key(key));
    if (!game) throw new Error('Start a game first.');
    if (game.status !== 'playing') throw new Error('This game is over. Start a new one.');
    if (game.turn !== game.userSide) throw new Error('It is Little Bot\'s turn.');
    const move = rules.findMove(rules.legalMoves(game.board, game.turn), text);
    if (!move) throw new Error(`${text} is not a legal move here.`);
    return move.notation;
  }
  userMove(key, text) {
    const notation = this.checkUserMove(key, text);
    const game = this.game(key);
    const move = this._play(game, notation, 'you');
    this._save();
    return move;
  }

  // Back to before the user's last move, taking Little Bot's reply with it.
  takeBack(key) {
    this._requireEnabled();
    const game = this.game(this._key(key));
    if (!game) throw new Error('There is no game here.');
    const index = game.moves.findLastIndex(move => move.side === game.userSide);
    if (index < 0 || !game.moves[index].before) throw new Error('There is no move of yours to take back.');
    game.board = game.moves[index].before;
    game.turn = game.userSide;
    game.moves = game.moves.slice(0, index);
    // Rebuild the position counts and the draw counters from the moves still played.
    const start = rules.initialBoard();
    game.positions = { [rules.positionKey(start, WHITE)]: 1 };
    let board = start, side = WHITE, counters = { quietPlies: 0, endgamePlies: 0 };
    for (const entry of game.moves) {
      const piece = board[entry.from];
      board = rules.applyMove(board, entry);
      counters = rules.afterMove(counters, board, entry, piece);
      side = -side;
      if (Math.abs(piece) !== KING || entry.captures.length) game.positions = {};
      const k = rules.positionKey(board, side);
      game.positions[k] = (game.positions[k] || 0) + 1;
    }
    Object.assign(game, counters, { status: 'playing', winner: null, reason: null, note: null, updatedAt: Date.now() });
    this._save();
    return game;
  }

  resign(key) {
    this._requireEnabled();
    const game = this.game(this._key(key));
    if (!game || game.status !== 'playing') throw new Error('There is no game in progress.');
    Object.assign(game, { status: 'over', winner: -game.userSide, reason: 'you resigned', updatedAt: Date.now(), note: null });
    this._save();
  }

  // ------------------------------------------------------------------------------------------------ for the model

  async _verdictLines(game) {
    const moves = rules.legalMoves(game.board, game.turn);
    if (game.level === 'easy') return moves.map(move => `- ${move.notation}`);
    let judged = null;
    try { judged = await this._search('verdicts', { board: game.board, side: game.turn, depth: game.level === 'hard' ? 7 : 5 }); } catch { /* Moves without verdicts still work. */ }
    if (!judged) return moves.map(move => `- ${move.notation}`);
    return judged.map(entry => {
      const notes = [];
      if (game.level === 'hard') { notes.push(entry.outcome); if (entry.best) notes.push('strongest'); }
      else if (entry.gain < 0) notes.push(entry.outcome);
      return `- ${entry.notation}${notes.length ? ` (${notes.join(', ')})` : ''}`;
    });
  }

  _position(game) {
    const list = (side, king) => {
      const squares = [];
      for (let n = 1; n <= 50; n++) if (game.board[n] === side * (king ? KING : 1)) squares.push(n);
      return squares.length ? squares.join(', ') : 'none';
    };
    const counts = rules.count(game.board);
    return [
      `White men: ${list(WHITE, false)}. White kings: ${list(WHITE, true)}.`,
      `Black men: ${list(BLACK, false)}. Black kings: ${list(BLACK, true)}.`,
      `Pieces left: White ${counts[WHITE].men + counts[WHITE].kings}, Black ${counts[BLACK].men + counts[BLACK].kings}.`,
    ].join('\n');
  }

  _recent(game, count = 6) {
    const recent = game.moves.slice(-count);
    if (!recent.length) return 'No moves yet.';
    return 'Last moves: ' + recent.map(move => `${move.n}. ${move.side === game.userSide ? 'user' : 'you'} ${move.notation}${move.captures.length ? ` (took ${move.captures.length})` : ''}${move.crown ? ' (crowned)' : ''}`).join('; ') + '.';
  }

  _result(game) {
    if (game.status !== 'over') return null;
    if (!game.winner) return `The game is over: a draw (${game.reason}).`;
    return `The game is over: ${game.winner === game.userSide ? 'the user won' : 'you won'} (${game.reason}).`;
  }

  async describe(game) {
    const bot = -game.userSide;
    const lines = [
      `Draughts: you play ${sideName(bot)}, the user plays ${sideName(game.userSide)}. Level: ${game.level}${game.level === 'easy' ? ' (play casually, like a friendly beginner)' : ''}.`,
      'Squares are numbered 1–50: 1–5 is Black\'s back row, 46–50 White\'s; White men move towards 1–5.',
      this._position(game),
      this._recent(game),
    ];
    const over = this._result(game);
    if (over) lines.push(over, 'Congratulate or console the user in a sentence, and offer a new game if they want one.');
    else if (game.turn === bot) {
      lines.push(`It is your turn. Your legal moves${rules.legalMoves(game.board, bot)[0]?.captures.length ? ' (a capture is compulsory, and you must take the most pieces)' : ''}:`);
      lines.push(...await this._verdictLines(game));
      lines.push('Play exactly one of them with the draughts tool, e.g. {"action": "move", "move": "…"}, then say one or two short sentences to the user.');
    } else lines.push('It is the user\'s turn. Do not play a move; answer what they say.');
    return lines.join('\n');
  }

  // The block added to the user's message: always after a move on the board, otherwise while a game is fresh.
  async messageContext(key, { played = null, points = [] } = {}) {
    if (!this.enabled || !key) return null;
    const game = this.game(key);
    if (!game) return null;
    const fresh = game.status === 'playing' && Date.now() - (game.updatedAt || 0) < ACTIVE_FOR && this.panel;
    if (!played && !points.length && !fresh) return null;
    const lines = [];
    if (played) lines.push(`The user just played ${played} on the board.`);
    const marks = (Array.isArray(points) ? points : []).filter(Number.isInteger).filter(n => n >= 1 && n <= 50).slice(0, 8);
    if (marks.length) lines.push(`The user is pointing at ${marks.map(n => `square ${n} (${this._pieceName(game, n)})`).join(', ')}.`);
    lines.push(await this.describe(game));
    return { text: lines.join('\n'), label: played ? `♟ ${played}` : null, points: marks };
  }

  _pieceName(game, square) {
    const piece = game.board[square];
    if (!piece) return 'empty';
    const owner = Math.sign(piece) === game.userSide ? 'the user\'s' : 'your';
    return `${owner} ${Math.abs(piece) === KING ? 'king' : 'man'}`;
  }

  async call(args, { chat } = {}) {
    if (!object(args)) throw new Error('Tool arguments must be an object.');
    this._requireEnabled();
    if (!chat || chat.internal || chat.status !== 'running') throw new Error('Draughts is played in your own conversation with the user, not in background work.');
    const key = this.keyOf(chat);
    if (!key) throw new Error('Draughts is played in the main conversation or a saved session.');
    const { action } = args;
    if (action === 'new') {
      const game = this.newGame(key, { userColor: args.userColor || 'white', level: args.level });
      this._showForModel();
      return { started: true, user: sideName(game.userSide), you: sideName(-game.userSide), level: game.level, position: await this.describe(game) };
    }
    const game = this.game(key);
    if (!game) return { game: null, message: 'There is no game in this conversation. Start one with the new action if the user wants to play.' };
    if (action === 'board') return { position: await this.describe(game) };
    if (action === 'move') {
      if (game.status !== 'playing') return { error: this._result(game) };
      if (game.turn === game.userSide) throw new Error('It is the user\'s turn: wait for their move.');
      if (typeof args.move !== 'string' || !args.move.trim()) throw new Error('Give your move, e.g. "19-23".');
      const move = this._play(game, args.move, 'bot');
      this._save();
      const reply = { played: move.notation, ...(move.captures.length ? { took: move.captures.length } : {}), ...(move.crown ? { crowned: true } : {}) };
      const over = this._result(game);
      if (over) return { ...reply, result: over };
      const answers = rules.legalMoves(game.board, game.turn);
      return { ...reply, next: `The user's turn (${answers.length} legal move${answers.length === 1 ? '' : 's'}${answers[0]?.captures.length ? ', and they must capture' : ''}). Now talk to the user briefly; do not move again.` };
    }
    if (action === 'analyse') {
      if (game.status !== 'playing') return { result: this._result(game) };
      const judged = await this._search('verdicts', { board: game.board, side: game.turn, depth: 6 });
      const mover = game.turn === game.userSide ? 'the user' : 'you';
      if (Number.isInteger(args.square)) {
        const own = judged.filter(entry => entry.notation.split(/[-x]/)[0] === String(args.square));
        return { square: args.square, piece: this._pieceName(game, args.square), toMove: mover, moves: own.length ? own.map(entry => `${entry.notation}: ${entry.outcome}${entry.best ? ', strongest' : ''}`) : ['No legal move for this piece now.'] };
      }
      if (typeof args.move === 'string' && args.move.trim()) {
        const moves = rules.legalMoves(game.board, game.turn);
        const move = rules.findMove(moves, args.move);
        if (!move) return { move: args.move, verdict: `Not a legal move for ${mover} now.`, legal: moves.map(item => item.notation) };
        const entry = judged.find(item => item.notation === move.notation);
        return { move: move.notation, toMove: mover, verdict: entry.outcome, strongest: judged.filter(item => item.best).map(item => item.notation) };
      }
      return { toMove: mover, moves: judged.map(entry => `${entry.notation}: ${entry.outcome}${entry.best ? ', strongest' : ''}`) };
    }
    throw new Error('Use one of the listed actions.');
  }

  _showForModel() { if (!this.panel) { this.beforeShow(); this.panel = true; this.onChange(); } }

  // A turn ended. If it was Little Bot's move and the model did not play, the search plays for it.
  async turnFinished(chat, error) {
    if (!this.enabled || !chat || chat.internal || chat.automationId) return;
    const key = this.keyOf(chat);
    const game = key ? this.game(key) : null;
    if (!game || game.status !== 'playing' || game.turn === game.userSide) return;
    if (error) { game.note = 'Little Bot has not played yet. Ask it to play.'; this._save(); return; }
    if (this.thinking.has(key)) return;
    this.thinking.add(key);
    this.onChange();
    try {
      const notation = await this._search('choose', { board: game.board, side: game.turn, level: game.level });
      if (this.game(key) !== game || game.turn === game.userSide || game.status !== 'playing') return;
      const move = this._play(game, notation, 'auto');
      game.note = `Little Bot did not move, so the board played ${move.notation} for it.`;
      this._save();
    } catch (failure) {
      game.note = `Little Bot has not played yet (${failure.message}). Ask it to play.`;
      this._save();
    } finally { this.thinking.delete(key); this.onChange(); }
  }

  // ------------------------------------------------------------------------------------------------ the panel

  showPanel(visible) {
    this._requireEnabled();
    this.panel = visible === true;
    if (this.panel) this.beforeShow();
    this.onChange();
  }

  _publicGame(game, key) {
    const legal = game.status === 'playing' && game.turn === game.userSide ? rules.legalMoves(game.board, game.turn).map(({ from, to, path, captures, notation, crown }) => ({ from, to, path, captures, notation, crown })) : [];
    const counts = rules.count(game.board);
    return {
      id: game.id, userSide: game.userSide, level: game.level, board: [...game.board], turn: game.turn, status: game.status, winner: game.winner, reason: game.reason,
      moves: game.moves.map(({ n, side, by, notation, from, to, path, captures, crown }) => ({ n, side, by, notation, from, to, path, captures, crown })),
      legal, counts: { white: counts[WHITE].men + counts[WHITE].kings, black: counts[BLACK].men + counts[BLACK].kings },
      canTakeBack: game.moves.some(move => move.side === game.userSide && move.before), thinking: this.thinking.has(key), note: game.note || null,
    };
  }

  state() {
    const games = {};
    for (const [key, game] of Object.entries(this.data.games)) if (object(game) && Array.isArray(game.board)) games[key] = this._publicGame(game, key);
    return { enabled: this.enabled, panel: this.panel && this.enabled, prefs: this.prefs, games };
  }

  close() {
    for (const job of this.pending.values()) job.reject(new Error('Little Bot is closing.'));
    this.pending.clear();
    this.worker?.terminate().catch(() => {});
    this.worker = null;
  }
}

module.exports = { DraughtsTable, DRAUGHTS_TOOL: SPEC };
