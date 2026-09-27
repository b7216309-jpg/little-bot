'use strict';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
function questionText(value, label, limit = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\0')) throw new Error(`${label} must contain 1–${limit} characters.`);
  return value.trim();
}
function questionInput(value) {
  if (!object(value)) throw new Error('A question is required.');
  const question = questionText(value.question, 'Question');
  const options = value.options ?? [];
  if (!Array.isArray(options) || options.length > 3) throw new Error('Use at most three suggested answers.');
  return { question, options: [...new Set(options.map(option => questionText(option, 'Suggested answer', 200)))] };
}
function questionSpec({ goal = false } = {}) {
  return { type: 'function', name: 'ask_user',
    description: `Ask the user one concise clarification when missing information prevents useful progress. Offer up to three optional choices; the user can always write an answer. Ask only what is needed, never passwords, API keys, or permission to exceed saved access.${goal ? ' This saves the question and ends this goal step until the user answers. Include a checkpoint of completed work and the next step; do not perform more work after asking.' : ' Wait for the answer before continuing. Answer ordinary questions directly when no clarification is needed.'}`,
    inputSchema: { type: 'object', properties: {
      question: { type: 'string', minLength: 1, maxLength: 2000 },
      options: { type: 'array', maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 200 } },
      ...(goal ? { checkpoint: { type: 'string', maxLength: 4000 }, nextStep: { type: 'string', maxLength: 2000 } } : {}),
    }, required: ['question'], additionalProperties: false },
  };
}
function pendingQuestion(value) {
  if (!object(value)) return null;
  try {
    const id = questionText(value.id, 'Question ID', 100);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
    return { id, ...questionInput(value), createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now() };
  } catch { return null; }
}
function clarifications(value) {
  const records = [];
  for (const entry of (Array.isArray(value) ? value : []).slice(-5)) {
    try { records.push({ id: questionText(entry.id, 'Question ID', 100), question: questionText(entry.question, 'Question'), answer: questionText(entry.answer, 'Answer'), answeredAt: Number.isFinite(entry.answeredAt) ? entry.answeredAt : Date.now() }); }
    catch { /* Ignore malformed saved answers without losing the goal. */ }
  }
  return records;
}

module.exports = { questionText, questionInput, questionSpec, pendingQuestion, clarifications };
