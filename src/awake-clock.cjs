'use strict';

// When the PC slept, so time budgets (a /goal's minutes, a goal step's time) count only time it was awake.
// main.cjs reports the system's suspend and resume events; without them nothing is subtracted.
const MAX_SLEEPS = 100;
const sleeps = [];
let suspendedAt = null;

function suspended(at = Date.now()) { suspendedAt = at; }

function resumed(at = Date.now()) {
  if (suspendedAt !== null && at > suspendedAt) {
    sleeps.push([suspendedAt, at]);
    if (sleeps.length > MAX_SLEEPS) sleeps.shift();
  }
  suspendedAt = null;
}

// Milliseconds of sleep between two moments.
function asleepBetween(from, to = Date.now()) {
  let total = 0;
  for (const [start, end] of sleeps) total += Math.max(0, Math.min(end, to) - Math.max(start, from));
  return total;
}

// Awake time between two moments.
const awakeBetween = (from, to = Date.now()) => Math.max(0, to - from - asleepBetween(from, to));

function reset() { sleeps.length = 0; suspendedAt = null; }

module.exports = { suspended, resumed, asleepBetween, awakeBetween, reset };
