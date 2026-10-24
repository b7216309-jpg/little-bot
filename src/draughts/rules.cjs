'use strict';

// International draughts on a 10×10 board, as played in France: men move forward and capture both ways,
// capturing is compulsory and the sequence that takes the most pieces must be played, kings fly, and a man
// is crowned only if its move ends on the far row. Squares are numbered 1–50 from Black's side, as in the
// usual notation; White starts on 31–50 and moves first.

const WHITE = 1, BLACK = -1;
const MAN = 1, KING = 2;

// Square n sits on row (n-1)/5, on the dark squares (the top-left corner is light).
const COORDS = [null];
for (let n = 1; n <= 50; n++) {
  const row = Math.floor((n - 1) / 5), k = (n - 1) % 5;
  COORDS.push([row, row % 2 === 0 ? 2 * k + 1 : 2 * k]);
}
const squareAt = (row, col) => row < 0 || row > 9 || col < 0 || col > 9 || (row + col) % 2 === 0 ? 0 : row * 5 + Math.floor(col / 2) + 1;

// For each square, the squares along each diagonal: up-left, up-right, down-left, down-right.
const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const RAYS = [null];
for (let n = 1; n <= 50; n++) {
  const [row, col] = COORDS[n];
  RAYS.push(DIRS.map(([dr, dc]) => {
    const ray = [];
    for (let r = row + dr, c = col + dc; squareAt(r, c); r += dr, c += dc) ray.push(squareAt(r, c));
    return ray;
  }));
}
// White men go up the board (towards 1–5), Black men down.
const FORWARD = { [WHITE]: [0, 1], [BLACK]: [2, 3] };
const crownRow = side => side === WHITE ? 0 : 9;

function initialBoard() {
  const board = new Array(51).fill(0);
  for (let n = 1; n <= 20; n++) board[n] = BLACK * MAN;
  for (let n = 31; n <= 50; n++) board[n] = WHITE * MAN;
  return board;
}

// Every legal move for side: { from, to, path, captures, crown, notation }. Captures, when any exist, are the
// only legal moves, and only those taking the most pieces.
function legalMoves(board, side) {
  const captures = captureMoves(board, side);
  const moves = captures.length ? captures : quietMoves(board, side);
  return withNotation(moves);
}

function quietMoves(board, side) {
  const moves = [];
  for (let from = 1; from <= 50; from++) {
    const piece = board[from];
    if (piece * side <= 0) continue;
    const king = Math.abs(piece) === KING;
    for (const d of king ? [0, 1, 2, 3] : FORWARD[side]) {
      for (const to of RAYS[from][d]) {
        if (board[to] !== 0) break;
        moves.push({ from, to, path: [from, to], captures: [], crown: !king && COORDS[to][0] === crownRow(side) });
        if (!king) break;
      }
    }
  }
  return moves;
}

function captureMoves(board, side) {
  let best = 1;
  const found = [];
  const work = board.slice();
  for (let from = 1; from <= 50; from++) {
    const piece = work[from];
    if (piece * side <= 0) continue;
    const king = Math.abs(piece) === KING;
    // The piece leaves its square, so a sequence may pass over or end on it. Taken pieces stay on the board until
    // the sequence is over: they cannot be jumped twice and block the way.
    work[from] = 0;
    const walk = (at, path, taken) => {
      let extended = false;
      for (let d = 0; d < 4; d++) {
        const ray = RAYS[at][d];
        if (king) {
          let i = 0;
          while (i < ray.length && work[ray[i]] === 0) i++;
          if (i >= ray.length - 1) continue;
          const victim = ray[i];
          if (work[victim] * side > 0 || taken.includes(victim)) continue;
          for (let j = i + 1; j < ray.length && work[ray[j]] === 0; j++) {
            extended = true;
            walk(ray[j], [...path, ray[j]], [...taken, victim]);
          }
        } else if (ray.length >= 2) {
          const [victim, land] = ray;
          if (work[victim] * side < 0 && !taken.includes(victim) && work[land] === 0) {
            extended = true;
            walk(land, [...path, land], [...taken, victim]);
          }
        }
      }
      if (!extended && taken.length >= best) {
        if (taken.length > best) { best = taken.length; found.length = 0; }
        found.push({ from, to: at, path, captures: taken, crown: !king && COORDS[at][0] === crownRow(side) });
      }
    };
    walk(from, [from], []);
    work[from] = piece;
  }
  // Two routes over the same pieces to the same square are the same move.
  const seen = new Set();
  return found.filter(move => {
    const key = `${move.from}-${move.to}:${[...move.captures].sort((a, b) => a - b).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// "32-28" for a move, "19x30" for a capture. When two captures share both ends, the squares in between tell them apart.
function withNotation(moves) {
  const ends = new Map();
  for (const move of moves) ends.set(`${move.from}-${move.to}`, (ends.get(`${move.from}-${move.to}`) || 0) + 1);
  for (const move of moves) {
    const sep = move.captures.length ? 'x' : '-';
    move.notation = ends.get(`${move.from}-${move.to}`) > 1 ? move.path.join(sep) : `${move.from}${sep}${move.to}`;
  }
  return moves;
}

function applyMove(board, move) {
  const next = board.slice();
  const piece = next[move.from];
  next[move.from] = 0;
  for (const square of move.captures) next[square] = 0;
  next[move.to] = move.crown ? Math.sign(piece) * KING : piece;
  return next;
}

// Finds a legal move from what someone typed: "32-28", "32x28", "32 28", a full path "28x19x10", or the squares in any form.
function findMove(moves, text) {
  const squares = String(text ?? '').match(/\d+/g)?.map(Number) || [];
  if (squares.length < 2) return null;
  const exact = moves.find(move => move.notation === String(text).trim().replace(/\s+/g, ''));
  if (exact) return exact;
  const from = squares[0], to = squares.at(-1);
  const matches = moves.filter(move => move.from === from && move.to === to);
  if (matches.length <= 1) return matches[0] || null;
  // Several captures with the same ends: the squares given must lie on the path, in order.
  const middle = squares.slice(1, -1);
  const fitting = matches.filter(move => { let at = 1; return middle.every(square => { at = move.path.indexOf(square, at); return at++ > 0; }); });
  return fitting.length === 1 ? fitting[0] : null;
}

const positionKey = (board, side) => `${side}:${board.slice(1).join(',')}`;

function count(board) {
  const result = { [WHITE]: { men: 0, kings: 0 }, [BLACK]: { men: 0, kings: 0 } };
  for (let n = 1; n <= 50; n++) {
    const piece = board[n];
    if (piece) result[Math.sign(piece)][Math.abs(piece) === KING ? 'kings' : 'men']++;
  }
  return result;
}

// After a move: who has won, or whether the game is drawn. The draw rules follow the FMJD ones in a simplified
// form: the same position three times; 25 moves each with only kings moving and nothing taken; and, with a lone
// king against at most three pieces, 16 moves each (5 when only kings are left, at most two against one).
function outcome(game) {
  const { board, turn } = game;
  const pieces = count(board);
  const has = side => pieces[side].men + pieces[side].kings;
  if (!has(turn) || !legalMoves(board, turn).length) return { status: 'over', winner: -turn, reason: has(turn) ? 'no move left' : 'no piece left' };
  if ((game.positions?.[positionKey(board, turn)] || 0) >= 3) return { status: 'over', winner: 0, reason: 'the same position three times' };
  if (game.quietPlies >= 50) return { status: 'over', winner: 0, reason: '25 moves each with only kings moving' };
  for (const lone of [WHITE, BLACK]) {
    const other = -lone;
    if (pieces[lone].men || pieces[lone].kings !== 1 || has(other) > 3) continue;
    const limit = !pieces[other].men && has(other) <= 2 ? 10 : 32;
    if ((game.endgamePlies || 0) >= limit) return { status: 'over', winner: 0, reason: `${limit / 2} moves each in a king endgame` };
  }
  return { status: 'playing' };
}

// Counters for the draw rules, updated after each move.
function afterMove(game, board, move, piece) {
  const quiet = Math.abs(piece) === KING && !move.captures.length;
  const pieces = count(board);
  const lone = [WHITE, BLACK].some(side => !pieces[side].men && pieces[side].kings === 1 && pieces[-side].men + pieces[-side].kings <= 3);
  return {
    quietPlies: quiet ? (game.quietPlies || 0) + 1 : 0,
    endgamePlies: lone ? (game.endgamePlies || 0) + 1 : 0,
  };
}

module.exports = { WHITE, BLACK, MAN, KING, COORDS, RAYS, squareAt, initialBoard, legalMoves, applyMove, findMove, positionKey, count, outcome, afterMove };
