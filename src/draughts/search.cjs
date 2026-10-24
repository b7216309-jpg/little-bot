'use strict';

// A small alpha-beta search. It does not play for Little Bot: it gives each of the bot's legal moves a short
// verdict ("loses a piece", "wins two") so the model can choose with its eyes open, and it picks a move when the
// model fails to. Scores are in hundredths of a man, from the side to move.

const { WHITE, KING, COORDS, legalMoves, applyMove } = require('./rules.cjs');

const MAN_VALUE = 100, KING_VALUE = 300;
const WIN = 100000;

function material(board, side) {
  let score = 0;
  for (let n = 1; n <= 50; n++) {
    const piece = board[n];
    if (piece) score += Math.sign(piece) * side * (Math.abs(piece) === KING ? KING_VALUE : MAN_VALUE);
  }
  return score;
}

// Material, plus a little for advanced men, the centre and an unbroken back row. The extras stay well under a
// man, so a verdict rounded to whole pieces reads the material.
function evaluate(board, side) {
  let score = 0;
  for (let n = 1; n <= 50; n++) {
    const piece = board[n];
    if (!piece) continue;
    const owner = Math.sign(piece), sign = owner * side;
    if (Math.abs(piece) === KING) { score += sign * KING_VALUE; continue; }
    const [row, col] = COORDS[n];
    const advance = owner === WHITE ? 9 - row : row;
    score += sign * (MAN_VALUE + advance * 2 + (col >= 3 && col <= 6 ? 3 : 0) + (advance === 0 ? 2 : 0));
  }
  return score;
}

function createSearch({ nodeLimit = 400000 } = {}) {
  let nodes = 0;
  const negamax = (board, side, depth, alpha, beta, ply) => {
    nodes++;
    const moves = legalMoves(board, side);
    if (!moves.length) return -WIN + ply;
    // Captures are forced, so a position with one pending is not quiet: look a little further.
    const forced = moves[0].captures.length > 0;
    if ((depth <= 0 && (!forced || depth <= -6)) || nodes > nodeLimit) return evaluate(board, side);
    if (moves.length === 1 && depth > 0) depth++;
    let best = -Infinity;
    for (const move of moves) {
      const score = -negamax(applyMove(board, move), -side, depth - 1, -beta, -alpha, ply + 1);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  };
  return {
    // Each root move searched with a full window and its own budget, so every verdict is exact rather than a bound.
    scoreMoves(board, side, depth) {
      return legalMoves(board, side).map(move => {
        nodes = 0;
        return { move, score: -negamax(applyMove(board, move), -side, depth - 1, -Infinity, Infinity, 1) };
      });
    },
    get nodes() { return nodes; },
  };
}

// Verdicts for every legal move: the material it gains or loses within the search horizon, and which is best.
function verdicts(board, side, { depth = 6 } = {}) {
  const now = material(board, side);
  const scored = createSearch().scoreMoves(board, side, depth);
  const best = Math.max(...scored.map(entry => entry.score));
  return scored.map(({ move, score }) => {
    const mate = Math.abs(score) > WIN / 2;
    const pieces = mate ? 0 : Math.round((score - now) / MAN_VALUE);
    return {
      notation: move.notation, move, score,
      outcome: mate ? (score > 0 ? 'wins the game' : 'loses the game') : pieces > 0 ? `wins ${pieceWord(pieces)}` : pieces < 0 ? `loses ${pieceWord(-pieces)}` : 'even',
      gain: mate ? Math.sign(score) * 99 : pieces,
      best: score === best,
    };
  }).sort((a, b) => b.score - a.score);
}

const pieceWord = n => n === 1 ? 'a piece' : n === 2 ? 'two pieces' : n === 3 ? 'three pieces' : `${n} pieces`;

// A move for when the model does not play one: weaker on easier levels.
function chooseMove(board, side, difficulty = 'medium', random = Math.random) {
  const ranked = verdicts(board, side, { depth: difficulty === 'hard' ? 7 : 5 });
  if (difficulty === 'hard') return ranked[0].move;
  const safe = ranked.filter(entry => entry.gain >= 0);
  const pool = difficulty === 'easy' ? (random() < 0.3 ? ranked : safe.length ? safe : ranked) : (safe.length ? safe.slice(0, 3) : ranked.slice(0, 1));
  return pool[Math.floor(random() * pool.length)].move;
}

module.exports = { evaluate, material, verdicts, chooseMove, createSearch, WIN };
