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

module.exports = { applyQwenGeneration };
