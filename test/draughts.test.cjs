'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/draughts/rules.cjs');
const { verdicts, chooseMove } = require('../src/draughts/search.cjs');
const { DraughtsTable } = require('../src/draughts-table.cjs');
const { AgentTools } = require('../src/agent-tools.cjs');

const { WHITE, BLACK, KING, squareAt } = rules;
const empty = () => new Array(51).fill(0);
const at = (board, row, col, piece) => { board[squareAt(row, col)] = piece; return board; };

test('move generation matches the published counts for international draughts', () => {
  const perft = (board, side, depth) => depth ? rules.legalMoves(board, side).reduce((sum, move) => sum + perft(rules.applyMove(board, move), -side, depth - 1), 0) : 1;
  assert.deepEqual([1, 2, 3, 4, 5].map(depth => perft(rules.initialBoard(), WHITE, depth)), [9, 81, 658, 4265, 27117]);
});

test('men capture backwards, and the sequence taking the most pieces is compulsory', () => {
  const board = empty();
  at(board, 5, 4, WHITE);
  at(board, 6, 5, BLACK);             // behind: a backward capture of one
  at(board, 4, 3, BLACK); at(board, 2, 3, BLACK); // ahead: a capture of two
  const moves = rules.legalMoves(board, WHITE);
  assert.equal(moves.length, 1, moves.map(move => move.notation).join(' '));
  assert.deepEqual(moves[0].captures.sort(), [squareAt(4, 3), squareAt(2, 3)].sort());
  assert.equal(moves[0].to, squareAt(1, 4));
  // Without the longer one, the backward capture is the move.
  board[squareAt(2, 3)] = 0;
  const shorter = rules.legalMoves(board, WHITE);
  assert.ok(shorter.some(move => move.to === squareAt(7, 6)), 'the man captures backwards');
  assert.ok(shorter.every(move => move.captures.length === 1));
});

test('kings fly: they move and capture from a distance and land on any square beyond', () => {
  const board = empty();
  at(board, 9, 0, WHITE * KING);
  at(board, 5, 4, BLACK);
  const moves = rules.legalMoves(board, WHITE);
  assert.deepEqual(moves.map(move => move.to).sort((a, b) => a - b), [squareAt(4, 5), squareAt(3, 6), squareAt(2, 7), squareAt(1, 8), squareAt(0, 9)].sort((a, b) => a - b));
  assert.ok(moves.every(move => move.notation.includes('x')));
  board[squareAt(5, 4)] = 0;
  assert.equal(rules.legalMoves(board, WHITE).length, 9, 'a lone king in the corner reaches the whole long diagonal');
});

test('a man passing over the far row during a capture is not crowned', () => {
  const board = empty();
  at(board, 2, 1, WHITE);
  at(board, 1, 2, BLACK);   // lands on the far row…
  at(board, 1, 4, BLACK);   // …then must go on, back down
  const [move] = rules.legalMoves(board, WHITE);
  assert.equal(move.captures.length, 2);
  assert.equal(move.to, squareAt(2, 5));
  assert.equal(move.crown, false);
  const after = rules.applyMove(board, move);
  assert.equal(after[move.to], WHITE);
  // Ending there crowns it.
  const simple = at(empty(), 1, 0, WHITE);
  const crowning = rules.legalMoves(simple, WHITE)[0];
  assert.equal(crowning.crown, true);
  assert.equal(rules.applyMove(simple, crowning)[crowning.to], WHITE * KING);
});

test('a taken piece cannot be jumped twice and blocks the way until the sequence ends', () => {
  // A king that could loop round the same piece: it may take each piece once only.
  const board = empty();
  at(board, 9, 0, WHITE * KING);
  at(board, 7, 2, BLACK);
  const moves = rules.legalMoves(board, WHITE);
  for (const move of moves) assert.equal(new Set(move.captures).size, move.captures.length);
  // Random games never take a piece twice or lose track of one.
  let random = 7;
  const next = () => { random = (random * 1103515245 + 12345) % 2147483648; return random / 2147483648; };
  for (let gameNo = 0; gameNo < 20; gameNo++) {
    let position = rules.initialBoard(), side = WHITE;
    for (let ply = 0; ply < 150; ply++) {
      const legal = rules.legalMoves(position, side);
      if (!legal.length) break;
      const move = legal[Math.floor(next() * legal.length)];
      assert.equal(new Set(move.captures).size, move.captures.length);
      const before = position.filter(Boolean).length;
      position = rules.applyMove(position, move);
      assert.equal(position.filter(Boolean).length, before - move.captures.length);
      side = -side;
    }
  }
});

test('moves are found from what was typed, and two captures with the same ends need the path', () => {
  const moves = rules.legalMoves(rules.initialBoard(), WHITE);
  assert.equal(rules.findMove(moves, '32-28')?.notation, '32-28');
  assert.equal(rules.findMove(moves, ' 32 28 ')?.notation, '32-28');
  assert.equal(rules.findMove(moves, '32-27')?.notation, '32-27');
  assert.equal(rules.findMove(moves, '32-23'), null);
  // A king that can take either of two pieces and land on the same square.
  const board = empty();
  at(board, 5, 4, WHITE * KING);
  at(board, 4, 3, BLACK); at(board, 4, 5, BLACK); at(board, 2, 3, BLACK); at(board, 2, 5, BLACK);
  const both = rules.legalMoves(board, WHITE);
  const ends = new Map();
  for (const move of both) ends.set(`${move.from}-${move.to}`, (ends.get(`${move.from}-${move.to}`) || 0) + 1);
  for (const move of both) if (ends.get(`${move.from}-${move.to}`) > 1) {
    assert.match(move.notation, /^\d+(x\d+){2,}$/, 'ambiguous captures list their path');
    assert.equal(rules.findMove(both, move.notation), move);
  }
});

test('draws: three repetitions, and 25 moves each of kings only', () => {
  const board = empty();
  at(board, 9, 0, WHITE * KING); at(board, 0, 9, BLACK * KING); at(board, 0, 1, BLACK * KING);
  const game = { board, turn: WHITE, positions: { [rules.positionKey(board, WHITE)]: 3 }, quietPlies: 0 };
  assert.equal(rules.outcome(game).winner, 0);
  assert.match(rules.outcome(game).reason, /three times/);
  assert.match(rules.outcome({ ...game, positions: {}, quietPlies: 50 }).reason, /25 moves/);
  assert.equal(rules.outcome({ ...game, positions: {}, quietPlies: 0 }).status, 'playing');
  // No move left loses.
  const blocked = empty();
  at(blocked, 0, 1, WHITE); // a white man on the far row cannot move forward
  assert.deepEqual(rules.outcome({ board: blocked, turn: WHITE, positions: {}, quietPlies: 0 }), { status: 'over', winner: BLACK, reason: 'no move left' });
});

test('the search sees a piece lost and plays the safe move', () => {
  // White to move: 32-28 walks into 23x32 (wait: the black man on 23 takes it); 31-26 is safe.
  const board = empty();
  board[32] = WHITE; board[31] = WHITE; board[46] = WHITE; board[23] = BLACK; board[1] = BLACK;
  const judged = verdicts(board, WHITE, { depth: 4 });
  const blunder = judged.find(entry => entry.notation === '32-28');
  assert.ok(blunder && blunder.gain < 0, JSON.stringify(judged.map(entry => [entry.notation, entry.outcome])));
  assert.notEqual(chooseMove(board, WHITE, 'hard').notation, '32-28');
});

// ---------------------------------------------------------------------------------------------- the table

function setup({ enabled = true } = {}) {
  const store = { data: { settings: { draughtsEnabled: enabled }, chats: [] }, saves: 0, save() { this.saves++; } };
  const changes = [];
  const table = new DraughtsTable({ store, keyOf: chat => chat.session ? chat.id : 'main', onChange: () => changes.push(1) });
  const chat = { id: 'c1', status: 'running' };
  return { store, table, chat, changes };
}

test('a game: the user moves on the board, Little Bot answers through its tool', async () => {
  const { table, chat } = setup();
  table.newGame('main', { userColor: 'white', level: 'medium' });
  assert.throws(() => table.checkUserMove('main', '32-23'), /not a legal move/);
  table.userMove('main', '32-28');
  const game = table.game('main');
  assert.equal(game.turn, BLACK);
  assert.throws(() => table.userMove('main', '31-27'), /Little Bot's turn/);
  const context = await table.messageContext('main', { played: '32-28', points: [28, 99] });
  assert.match(context.text, /The user just played 32-28/);
  assert.match(context.text, /pointing at square 28 \(the user's man\)/);
  assert.match(context.text, /It is your turn\. Your legal moves/);
  assert.match(context.text, /- 19-23/);
  await assert.rejects(table.call({ action: 'move', move: '32-28' }, { chat }), /not a legal move for Black.*Legal moves: /);
  const reply = await table.call({ action: 'move', move: '19-23' }, { chat });
  assert.equal(reply.played, '19-23');
  assert.match(reply.next, /The user's turn/);
  await assert.rejects(table.call({ action: 'move', move: '20-24' }, { chat }), /user's turn/);
  assert.deepEqual(game.moves.map(move => [move.notation, move.by]), [['32-28', 'you'], ['19-23', 'bot']]);
  // The exchange: 28x19 is forced for the user.
  const state = table.state().games.main;
  assert.deepEqual(state.legal.map(move => move.notation), ['28x19']);
  const look = await table.call({ action: 'analyse', square: 28 }, { chat });
  assert.equal(look.toMove, 'the user');
  assert.match(look.moves[0], /^28x19: /);
});

test('the level decides how much Little Bot is told about its moves', async () => {
  for (const [level, expect] of [['easy', /- 19-23\n/], ['hard', /strongest/]]) {
    const { table } = setup();
    table.newGame('main', { userColor: 'white', level });
    table.userMove('main', '32-28');
    const { text } = await table.messageContext('main', { played: '32-28' });
    assert.match(text, expect, level);
    if (level === 'easy') { assert.doesNotMatch(text, /\(even|\(loses|strongest/); assert.match(text, /friendly beginner/); }
  }
});

test('when the model does not move, the board plays for it; taking back undoes both moves', async () => {
  const { table, chat } = setup();
  table.newGame('main', { level: 'easy' });
  table.userMove('main', '33-29');
  await table.turnFinished({ ...chat, status: 'idle' }, null);
  const game = table.game('main');
  assert.equal(game.turn, WHITE);
  assert.equal(game.moves.at(-1).by, 'auto');
  assert.match(game.note, /did not move, so the board played/);
  // A stopped turn leaves the move to Little Bot, with a note.
  table.userMove('main', table.state().games.main.legal[0].notation);
  await table.turnFinished(chat, 'Stopped by you.');
  assert.equal(game.turn, BLACK);
  assert.match(game.note, /has not played yet/);
  // Back to before the user's last move.
  table.takeBack('main');
  assert.equal(game.turn, WHITE);
  assert.equal(game.moves.length, 2);
  table.takeBack('main');
  assert.equal(game.moves.length, 0);
  assert.deepEqual(game.board, rules.initialBoard());
  assert.throws(() => table.takeBack('main'), /no move of yours/);
});

test('a game is over when a side cannot move, and the model is told who won', async () => {
  const { table, chat } = setup();
  const game = table.newGame('main', { level: 'medium' });
  // White to move with one capture that takes Black's last piece.
  game.board = empty(); game.board[32] = WHITE; game.board[28] = BLACK;
  table.userMove('main', '32x23');
  assert.equal(game.status, 'over');
  assert.equal(game.winner, WHITE);
  const reply = await table.call({ action: 'board' }, { chat });
  assert.match(reply.position, /the user won/);
  assert.deepEqual(await table.call({ action: 'move', move: '1-6' }, { chat }), { error: 'The game is over: the user won (no piece left).' });
});

test('draughts is a plugin: off, there is no tool; it plays only in the user\'s own running conversation', async () => {
  const off = setup({ enabled: false });
  assert.ok(!new AgentTools({ store: off.store, draughts: off.table }).specs().some(tool => tool.name === 'draughts'));
  await assert.rejects(off.table.call({ action: 'board' }, { chat: off.chat }), /Draughts is off/);
  assert.equal(await off.table.messageContext('main', { played: '32-28' }), null);
  const on = setup();
  const tools = new AgentTools({ store: on.store, draughts: on.table });
  assert.ok(tools.specs({ loaded: ['draughts'] }).some(tool => tool.name === 'draughts'));
  await assert.rejects(on.table.call({ action: 'board' }, { chat: { id: 'h', internal: true, status: 'running' } }), /not in background work/);
  await assert.doesNotReject(on.table.call({ action: 'board' }, { chat: { id: 'a', automationId: 'x', status: 'running' } }), 'a scheduled task has full access');
  const started = await on.table.call({ action: 'new', userColor: 'black', level: 'hard' }, { chat: on.chat });
  assert.equal(started.you, 'White');
  assert.match(started.position, /It is your turn/);
  assert.equal(on.table.panel, true, 'starting a game shows the board');
  // Each conversation keeps its own game.
  on.table.newGame('s-1', {});
  assert.deepEqual(Object.keys(on.table.state().games).sort(), ['main', 's-1']);
});

test('the store keeps games and preferences and drops anything malformed', () => {
  const { Store } = require('../src/store.cjs');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-draughts-store-'));
  try {
    const store = new Store({ filePath: path.join(dir, 'state.json'), defaultWorkspace: dir });
    const table = new DraughtsTable({ store, keyOf: () => 'main' });
    store.data.settings.draughtsEnabled = true;
    // A saved session's game, keyed by the session's id.
    table.newGame('3f2b8c1e-5d4a-4b7e-9c2d-1a0e6f8b7c9d', { level: 'easy' });
    table.newGame('main', { level: 'hard' });
    table.userMove('main', '32-28');
    table.setPrefs({ sound: false, numbers: true });
    store.data.draughts.games['bad key!'] = { board: [1, 2] };
    store.data.draughts.games.broken = { board: new Array(51).fill(7), turn: 1, userSide: 1 };
    store.save();
    const again = new Store({ filePath: path.join(dir, 'state.json'), defaultWorkspace: dir });
    assert.equal(again.data.settings.draughtsEnabled, true);
    assert.deepEqual(Object.keys(again.data.draughts.games).sort(), ['3f2b8c1e-5d4a-4b7e-9c2d-1a0e6f8b7c9d', 'main']);
    const game = again.data.draughts.games.main;
    assert.equal(game.level, 'hard');
    assert.deepEqual(game.moves.map(move => move.notation), ['32-28']);
    assert.equal(game.moves[0].before.length, 51);
    assert.deepEqual(again.data.draughts.prefs, { level: 'hard', sound: false, numbers: true });
    store.close(); again.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
