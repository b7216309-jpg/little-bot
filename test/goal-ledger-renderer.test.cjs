'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../src/renderer/goal-ledger-ui.js');

test('builds a current plan, archived versions, and one active step', () => {
  const result = ledger.view({
    status: 'queued',
    ledger: {
      plans: [
        { version: 1, createdAt: 1000, source: 'user', reason: 'Initial plan', steps: [
          { id: 'one', text: 'Old step', status: 'superseded' },
        ] },
        { version: 2, createdAt: 2000, source: 'agent', reason: 'Evidence changed the plan', steps: [
          { id: 'two', text: 'Inspect evidence', status: 'completed', summary: 'Inspected.' },
          { id: 'three', text: 'Write result', status: 'active' },
          { id: 'four', text: 'Verify result', status: 'pending' },
        ] },
      ],
    },
  });
  assert.equal(result.current.version, 2);
  assert.equal(result.current.sourceLabel, 'Agent');
  assert.equal(result.archived.length, 1);
  assert.equal(result.active.id, 'three');
  assert.equal(result.counts.completedSteps, 1);
  assert.equal(result.migrated, false);
});

test('falls back to legacy goal steps without changing source data', () => {
  const goal = { status: 'queued', steps: ['First', 'Second'], createdAt: 1000 };
  const before = structuredClone(goal);
  const result = ledger.view(goal);
  assert.equal(result.current.version, 1);
  assert.deepEqual(result.current.steps.map(step => step.status), ['active', 'pending']);
  assert.equal(result.current.sourceLabel, 'Migrated');
  assert.equal(result.migrated, true);
  assert.deepEqual(goal, before);
});

test('shows completed legacy goals without an active step', () => {
  const result = ledger.view({ status: 'completed', steps: ['First', 'Second'] });
  assert.deepEqual(result.current.steps.map(step => step.status), ['completed', 'completed']);
  assert.equal(result.active, null);
});

test('keeps only the latest status for repeated assumptions', () => {
  const result = ledger.view({ ledger: {
    plans: [{ version: 1, steps: [{ text: 'Act', status: 'active' }] }],
    assumptions: [
      { id: 'a', at: 1000, text: 'The file is UTF-8.', status: 'open', source: 'agent' },
      { id: 'b', at: 2000, text: '  the FILE is utf-8. ', status: 'confirmed', source: 'verification' },
      { id: 'c', at: 1500, text: 'The folder is writable.', status: 'open', source: 'agent' },
    ],
  } });
  assert.equal(result.assumptions.length, 2);
  assert.equal(result.assumptions[0].text, 'the FILE is utf-8.');
  assert.equal(result.assumptions[0].statusLabel, 'Confirmed');
  assert.equal(result.assumptions[0].sourceLabel, 'Verification');
  assert.equal(result.counts.openAssumptions, 1);
});

test('orders observations and decisions newest first and labels evidence', () => {
  const result = ledger.view({ ledger: {
    plans: [{ version: 1, steps: [{ text: 'Act', status: 'active' }] }],
    observations: [
      { id: 'old', at: 1000, text: 'Old observation.', source: 'agent' },
      { id: 'new', at: 3000, text: 'New observation.', source: 'verification', evidence: { type: 'completion', passed: false, path: 'report.md' } },
    ],
    decisions: [
      { id: 'd1', at: 2000, text: 'Use Markdown.', rationale: 'The check expects report.md.', source: 'agent' },
    ],
  } });
  assert.equal(result.observations[0].id, 'new');
  assert.equal(result.decisions[0].rationale, 'The check expects report.md.');
  assert.equal(ledger.evidenceLabel(result.observations[0].evidence), 'Failed · report.md');
  assert.equal(ledger.evidenceLabel({ type: 'snapshot', changes: 1 }), '1 changed path');
  assert.equal(ledger.evidenceLabel({ type: 'snapshot', changes: 2 }), '2 changed paths');
});

test('normalizes unknown statuses and sources for safe display', () => {
  const result = ledger.view({ ledger: {
    plans: [{ version: 1, source: 'unknown', steps: [{ id: 'x', text: 'Step', status: 'mystery' }] }],
    assumptions: [{ id: 'a', text: 'Assumption', status: 'mystery', source: 'unknown' }],
  } });
  assert.equal(result.current.steps[0].status, 'pending');
  assert.equal(result.current.steps[0].label, 'Pending');
  assert.equal(result.current.sourceLabel, 'Little Bot');
  assert.equal(result.assumptions[0].status, 'open');
  assert.equal(result.assumptions[0].sourceLabel, 'Little Bot');
});
