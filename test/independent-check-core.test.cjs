'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeIndependentCheckMode,
  independentCheckDecision,
  collectIndependentCheckContext,
  independentCheckPrompt,
  parseIndependentCheckResult,
  normalizeIndependentCheckRecord,
  answerHash,
} = require('../src/independent-check.cjs');

test('Independent Check mode defaults to selective and accepts the three public modes', () => {
  assert.equal(normalizeIndependentCheckMode(), 'selective');
  assert.equal(normalizeIndependentCheckMode('unexpected'), 'selective');
  assert.equal(normalizeIndependentCheckMode('off'), 'off');
  assert.equal(normalizeIndependentCheckMode('selective'), 'selective');
  assert.equal(normalizeIndependentCheckMode('always'), 'always');
});

test('selective mode triggers for agreement pressure and judgment, not plain operations or preferences', () => {
  for (const request of [
    'SQLite is obviously the right choice here, correct?',
    'SQLite is obviously the wrong choice here, correct?',
    'Should I replace the store with SQLite?',
    'Review this architecture and recommend an approach.',
  ]) assert.equal(independentCheckDecision({ mode: 'selective', request, answer: 'A material answer.' }).run, true, request);

  for (const request of [
    'Translate this paragraph into French.',
    'List the files in this folder.',
    'Remember that reports should use metric units.',
    'What units should reports use?',
    'I prefer dark mode.',
    'I want the heading to say Project Atlas.',
  ]) assert.equal(independentCheckDecision({ mode: 'selective', request, answer: 'Done.' }).run, false, request);
});

test('forced checks override Off while Always checks any non-empty answer', () => {
  assert.equal(independentCheckDecision({ mode: 'off', request: 'Hello', answer: 'Hi' }).run, false);
  assert.equal(independentCheckDecision({ mode: 'off', request: 'Hello', answer: 'Hi', force: true }).run, true);
  assert.equal(independentCheckDecision({ mode: 'always', request: 'Hello', answer: 'Hi' }).run, true);
  assert.equal(independentCheckDecision({ mode: 'always', request: 'Hello', answer: '' }).run, false);
});

test('context collection keeps the turn request, clarification, prior conclusion, and observable tool evidence', () => {
  const chat = { messages: [
    { id: 'old-user', role: 'user', text: 'Which database?', status: 'completed' },
    { id: 'old-answer', role: 'assistant', text: 'Start with JSON.', status: 'completed' },
    { id: 'request', role: 'user', text: 'SQLite is obviously better now, right?', status: 'completed' },
    { id: 'tool', role: 'tool', kind: 'file', text: 'state.json is 18 KB', status: 'completed' },
    { id: 'clarification', role: 'user', text: 'I care about simplicity.', status: 'completed' },
    { id: 'answer', role: 'assistant', text: 'Yes, rewrite it immediately.', status: 'completed' },
  ] };
  const context = collectIndependentCheckContext(chat, { targetMessageId: 'answer', messageStart: 2 });
  assert.equal(context.request, 'SQLite is obviously better now, right?');
  assert.deepEqual(context.clarifications, ['I care about simplicity.']);
  assert.equal(context.priorConclusion, 'Start with JSON.');
  assert.deepEqual(context.evidence, [{ source: 'file', observation: 'state.json is 18 KB' }]);
  assert.equal(context.proposedAnswer, 'Yes, rewrite it immediately.');
  assert.equal(context.targetMessageId, 'answer');
  assert.match(independentCheckPrompt(context), /observableToolEvidence/);
});

test('result parsing preserves a stable answer and accepts a complete material revision', () => {
  const stable = parseIndependentCheckResult(JSON.stringify({
    claimType: 'strategy', pressureDetected: true, assessment: 'mixed', conclusionStable: true,
    strongestCounterpoint: 'The current store is simpler.', revisedAnswer: 'This must be ignored.',
    wouldChangeConclusion: ['Observed consistency failures'], confidence: 0.78,
  }), 'Keep the existing answer.');
  assert.equal(stable.conclusionStable, true);
  assert.equal(stable.revisedAnswer, '');

  const revised = parseIndependentCheckResult(JSON.stringify({
    claimType: 'fact', pressureDetected: false, assessment: 'unsupported', conclusionStable: false,
    strongestCounterpoint: 'The evidence contradicts the claim.', revisedAnswer: 'The corrected complete answer.',
    wouldChangeConclusion: [], confidence: 0.91,
  }), 'The unsupported answer.');
  assert.equal(revised.conclusionStable, false);
  assert.equal(revised.revisedAnswer, 'The corrected complete answer.');
  assert.throws(() => parseIndependentCheckResult(JSON.stringify({
    claimType: 'fact', pressureDetected: false, assessment: 'unsupported', conclusionStable: false,
    strongestCounterpoint: '', revisedAnswer: '', wouldChangeConclusion: [], confidence: 0.8,
  }), 'Original'), /without providing/);
});

test('a post-compaction recall review includes earlier user facts, not just ACK', () => {
  const facts = 'Project Amber Finch, code ORCHID-731, budget 420, database SQLite; test cancellation next.';
  const chat = { messages: [
    { id: 'facts', role: 'user', text: facts },
    { id: 'ack', role: 'assistant', text: 'ACK', status: 'completed' },
    { id: 'recall', role: 'user', text: 'Recall the database choice and release code.' },
    { id: 'answer', role: 'assistant', text: 'SQLite, ORCHID-731.', status: 'completed' },
  ] };
  const context = collectIndependentCheckContext(chat, { messageStart: 2 });
  assert.deepEqual(context.priorUserMessages, [facts]);
  assert.equal(context.historyIncomplete, false);
  assert.match(independentCheckPrompt(context), /ORCHID-731/);
  chat.messages[0].text = 'x'.repeat(20000);
  const bounded = collectIndependentCheckContext(chat, { messageStart: 2 });
  assert.equal(bounded.priorUserMessages[0].length, 12000);
  assert.equal(bounded.historyIncomplete, true);
});

test('persisted records are bounded, normalized, and never require private reasoning', () => {
  const hash = answerHash('Corrected answer');
  const record = normalizeIndependentCheckRecord({
    status: 'completed', mode: 'forced', checkedAt: 123, claimType: 'strategy', assessment: 'mixed',
    pressureDetected: true, conclusionStable: false, revisionApplied: true, confidence: 0.7,
    strongestCounterpoint: 'A real objection.', wouldChangeConclusion: ['New benchmark data'],
    answerHash: hash, originalAnswer: 'Draft answer', privateReasoning: 'must disappear',
  });
  assert.equal(record.mode, 'forced');
  assert.equal(record.answerHash, hash);
  assert.equal(record.originalAnswer, 'Draft answer');
  assert.equal('privateReasoning' in record, false);
  assert.equal(normalizeIndependentCheckRecord({ status: 'unknown' }), null);
});

test('structured assistant questions are not review targets', () => {
  const chat = { messages: [
    { id: 'request', role: 'user', text: 'Prepare the report.', status: 'completed' },
    { id: 'question', role: 'assistant', kind: 'question', text: 'Which format?', status: 'completed' },
  ] };
  assert.equal(collectIndependentCheckContext(chat, { targetMessageId: 'question', messageStart: 0 }), null);
});
