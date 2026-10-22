'use strict';

const { SHELL_CONDUCT } = require('./shell-conduct.cjs');

// Fixed texts Little Bot adds to each Quick session message. The user can replace
// either one on the Security page; null restores the default.
const PROMPT_LIMIT = 20000;
const DEFAULTS = Object.freeze({
  quickNote: 'This is a Quick session: a side chat for one-off work. Saved memory, background goals and follow-ups are off here, and nothing from it is remembered. You keep your own personality.',
  shellConduct: SHELL_CONDUCT,
});
const NAMES = { quickNote: 'The Quick session note', shellConduct: 'Shell conduct' };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function normalizeInjectedPrompts(raw) {
  const source = object(raw) ? raw : {};
  return Object.fromEntries(Object.keys(DEFAULTS)
    .filter(key => typeof source[key] === 'string' && source[key].length <= PROMPT_LIMIT)
    .map(key => [key, source[key]]));
}

function applyInjectedPromptsPatch(current, patch) {
  if (!object(patch)) throw new Error('Injected prompts must be an object.');
  const next = normalizeInjectedPrompts(current);
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`Unknown injected prompt: ${key}.`);
    if (value === null) { delete next[key]; continue; }
    if (typeof value !== 'string' || value.length > PROMPT_LIMIT || /[\0-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
      throw new Error(`${NAMES[key]} must be plain text of at most ${PROMPT_LIMIT.toLocaleString('en-US')} characters.`);
    }
    next[key] = value.replace(/\r\n/g, '\n');
  }
  return next;
}

const injectedPrompt = (settings, key) => normalizeInjectedPrompts(settings)[key] ?? DEFAULTS[key];

function publicInjectedPrompts(settings) {
  const saved = normalizeInjectedPrompts(settings);
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, { text: saved[key] ?? DEFAULTS[key], customized: saved[key] !== undefined }]));
}

module.exports = {
  PROMPT_LIMIT,
  DEFAULTS,
  applyInjectedPromptsPatch,
  injectedPrompt,
  normalizeInjectedPrompts,
  publicInjectedPrompts,
};
