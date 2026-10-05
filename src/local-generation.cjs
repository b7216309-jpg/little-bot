'use strict';

const MAX_OUTPUT_TOKENS = 15360;
const MAX_THINKING_TOKENS = 12288;
const OUTPUT_LIMITS = ['max_output_tokens', 'max_completion_tokens', 'max_tokens', 'n_predict'];
const THINKING_LIMITS = ['reasoning_budget_tokens', 'thinking_budget_tokens'];
const finiteLimit = value => Number.isSafeInteger(value) && value >= 0;

function applyQwenGeneration(body, thinking) {
  // Custom aliases for other models must keep their own generation defaults.
  if (typeof body.model !== 'string' || !/(?:^|\/)qwen3\.6(?:[-:/.]|$)/i.test(body.model)) return body;
  Object.assign(body, {
    temperature: thinking ? 1.0 : 0.7,
    top_p: thinking ? 0.95 : 0.8,
    top_k: 20,
    min_p: 0,
    presence_penalty: 1.5,
    repeat_penalty: 1.0,
  });

  const output = Math.min(MAX_OUTPUT_TOKENS, ...OUTPUT_LIMITS.map(key => body[key]).filter(finiteLimit));
  const reserve = Math.min(3072, Math.ceil(output / 5));
  const reasoning = thinking
    ? Math.min(MAX_THINKING_TOKENS, Math.max(0, output - reserve), ...THINKING_LIMITS.map(key => body[key]).filter(finiteLimit))
    : 0;
  // Responses maps max_output_tokens to max_tokens. llama.cpp also accepts
  // n_predict, which can take precedence; keep any supplied aliases consistent.
  body.max_output_tokens = output;
  for (const key of OUTPUT_LIMITS.slice(1)) if (Object.hasOwn(body, key)) body[key] = output;
  // b10068 uses a nonnegative request budget before the launcher default.
  // Leave room for the closing think tag and final answer within the total cap.
  body.reasoning_budget_tokens = reasoning;
  if (Object.hasOwn(body, 'thinking_budget_tokens')) body.thinking_budget_tokens = reasoning;
  return body;
}

// Sampling chosen in Little Bot for the Strata server. Each key is optional; a missing key leaves
// Strata's own setting in charge, the same as an empty field in Strata's panel.
const SAMPLING_LIMITS = {
  temperature: { min: 0, max: 2, integer: false, field: 'temperature' },
  topP: { min: 0, max: 1, integer: false, field: 'top_p' },
  topK: { min: 0, max: 200, integer: true, field: 'top_k' },
  maxTokens: { min: 256, max: 131072, integer: true, field: 'max_completion_tokens' },
  seed: { min: 0, max: 2147483647, integer: true, field: 'seed' },
};
function normalizeSampling(value, { strict = false } = {}) {
  const result = {};
  if (value === null || value === undefined) return result;
  if (typeof value !== 'object' || Array.isArray(value)) { if (strict) throw new Error('Sampling settings must be an object.'); return result; }
  for (const [key, limit] of Object.entries(SAMPLING_LIMITS)) {
    const raw = value[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const number = Number(raw);
    const valid = Number.isFinite(number) && number >= limit.min && number <= limit.max && (!limit.integer || Number.isInteger(number));
    if (valid) result[key] = limit.integer ? number : Math.round(number * 100) / 100;
    else if (strict) throw new Error(`${key} must be between ${limit.min} and ${limit.max}.`);
  }
  return result;
}
// Applied to the Chat Completions body sent to Strata. Little Bot's choices override the engine's.
function applySampling(body, sampling) {
  for (const [key, value] of Object.entries(normalizeSampling(sampling))) body[SAMPLING_LIMITS[key].field] = value;
  return body;
}

module.exports = { applyQwenGeneration, normalizeSampling, applySampling, SAMPLING_LIMITS };
