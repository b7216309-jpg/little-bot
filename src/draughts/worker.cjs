'use strict';

// Runs the draughts search off the main process's thread, so a deep look never freezes the window.

const { parentPort } = require('node:worker_threads');
const { verdicts, chooseMove } = require('./search.cjs');

parentPort.on('message', ({ id, op, board, side, depth, level }) => {
  try {
    if (op === 'verdicts') {
      const result = verdicts(board, side, { depth }).map(({ notation, outcome, gain, best, score }) => ({ notation, outcome, gain, best, score }));
      parentPort.postMessage({ id, result });
    } else if (op === 'choose') {
      parentPort.postMessage({ id, result: chooseMove(board, side, level).notation });
    } else parentPort.postMessage({ id, error: `Unknown operation ${op}.` });
  } catch (error) { parentPort.postMessage({ id, error: error.message || String(error) }); }
});
