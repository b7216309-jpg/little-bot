'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { SHELL_CONDUCT } = require('./shell-conduct.cjs');

// Fixed texts Little Bot sends with each request. The user can replace any of them
// on the Security page; null restores the default.
// engineBase is the engine's base prompt, sent before everything else (BASE.md).
const PROMPT_LIMIT = 20000;
const LIMITS = { quickNote: PROMPT_LIMIT, shellConduct: PROMPT_LIMIT, engineBase: 60000 };
const DEFAULTS = Object.freeze({
  quickNote: 'This is a Quick session: a side chat for one-off work. Saved memory, background goals and follow-ups are off here, and nothing from it is remembered. You keep your own personality.',
  shellConduct: SHELL_CONDUCT,
  engineBase: fs.readFileSync(path.resolve(__dirname, '../resources/prompts/BASE.md'), 'utf8').replace(/\r\n/g, '\n'),
});
const NAMES = { quickNote: 'The Quick session note', shellConduct: 'Shell conduct', engineBase: 'The engine base prompt' };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function normalizeInjectedPrompts(raw) {
  const source = object(raw) ? raw : {};
  return Object.fromEntries(Object.keys(DEFAULTS)
    .filter(key => typeof source[key] === 'string' && source[key].length <= LIMITS[key])
    .map(key => [key, source[key]]));
}

function applyInjectedPromptsPatch(current, patch) {
  if (!object(patch)) throw new Error('Injected prompts must be an object.');
  const next = normalizeInjectedPrompts(current);
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`Unknown injected prompt: ${key}.`);
    if (value === null) { delete next[key]; continue; }
    if (typeof value !== 'string' || value.length > LIMITS[key] || /[\0-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
      throw new Error(`${NAMES[key]} must be plain text of at most ${LIMITS[key].toLocaleString('en-US')} characters.`);
    }
    next[key] = value.replace(/\r\n/g, '\n');
  }
  return next;
}

const injectedPrompt = (settings, key) => normalizeInjectedPrompts(settings)[key] ?? DEFAULTS[key];

// The base prompt sent when a thread starts.
const engineBaseInstructions = settings => injectedPrompt(settings, 'engineBase');
// A thread keeps the base prompt it started with, so a chat records this key and moves
// to a new thread when it changes. Threads from before 0.37.0 have '', the engine's own.
const engineBaseKey = settings => createHash('sha256').update(engineBaseInstructions(settings)).digest('hex').slice(0, 16);

function publicInjectedPrompts(settings) {
  const saved = normalizeInjectedPrompts(settings);
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, { text: saved[key] ?? DEFAULTS[key], customized: saved[key] !== undefined }]));
}

module.exports = {
  PROMPT_LIMIT,
  LIMITS,
  DEFAULTS,
  applyInjectedPromptsPatch,
  engineBaseInstructions,
  engineBaseKey,
  injectedPrompt,
  normalizeInjectedPrompts,
  publicInjectedPrompts,
};
