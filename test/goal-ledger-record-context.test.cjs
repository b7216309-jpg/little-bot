'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../src/renderer/goal-ledger-ui.js');

test('ledger records resolve their saved plan version and step for display', () => {
  const view = ledger.view({
    status: 'queued',
    ledger: {
      plans: [
        { version: 1, steps: [{ id: 'old-step', text: 'Inspect the original source', status: 'completed' }] },
        { version: 2, steps: [
          { id: 'current-step', text: 'Write the corrected report', status: 'active' },
          { id: 'future-step', text: 'Verify the report', status: 'pending' },
        ] },
      ],
      assumptions: [
        { id: 'a1', at: 1, text: 'The original source is UTF-8.', status: 'confirmed', source: 'verification', stepId: 'old-step', planVersion: 1 },
      ],
      observations: [
        { id: 'o1', at: 2, text: 'The corrected report exists.', source: 'agent', stepId: 'current-step', planVersion: 2 },
      ],
      decisions: [
        { id: 'd1', at: 3, text: 'Verify next.', rationale: 'The draft is ready.', source: 'agent', stepId: 'current-step', planVersion: 2 },
      ],
    },
  });

  assert.equal(view.assumptions[0].contextLabel, 'v1 · Step 1');
  assert.equal(view.assumptions[0].contextText, 'Inspect the original source');
  assert.equal(view.observations[0].contextLabel, 'v2 · Step 1');
  assert.equal(view.observations[0].contextText, 'Write the corrected report');
  assert.equal(view.decisions[0].contextLabel, 'v2 · Step 1');
});

test('records retain a useful version label when an old bounded plan is no longer present', () => {
  const view = ledger.view({
    status: 'queued',
    ledger: {
      plans: [{ version: 20, steps: [{ id: 'current', text: 'Current work', status: 'active' }] }],
      observations: [{ id: 'old-record', at: 1, text: 'Old evidence.', source: 'system', stepId: 'trimmed-step', planVersion: 3 }],
      decisions: [{ id: 'unscoped', at: 2, text: 'Global decision.', source: 'user' }],
    },
  });

  assert.equal(view.observations[0].contextLabel, 'v3');
  assert.equal(view.observations[0].contextText, '');
  assert.equal(view.decisions[0].contextLabel, '');
  assert.equal(view.decisions[0].contextText, '');
});
