'use strict';

window.addEventListener('DOMContentLoaded', () => {
  const goal = {
    status: 'queued',
    ledger: {
      plans: [
        {
          version: 1, createdAt: 1000, source: 'user', reason: 'Initial approach.',
          steps: [{ id: 'old', text: 'Use the old source.', status: 'superseded' }],
        },
        {
          version: 2, createdAt: 2000, source: 'agent', reason: 'A newer source was found.',
          steps: [
            { id: 'done', text: 'Inspect the newer source.', status: 'completed', summary: 'Found 42 rows.' },
            { id: 'active', text: 'Write the report.', status: 'active' },
            { id: 'pending', text: 'Verify the report.', status: 'pending' },
          ],
        },
      ],
      assumptions: [
        { id: 'a1', at: 2500, text: 'The source uses UTF-8.', status: 'confirmed', source: 'verification' },
      ],
      observations: [
        { id: 'o1', at: 2600, text: 'The report exists but totals are missing.', source: 'verification', evidence: { type: 'completion', passed: false, path: 'report.md' } },
      ],
      decisions: [
        { id: 'd1', at: 2700, text: 'Recalculate totals before final verification.', rationale: 'The saved content check failed.', source: 'agent' },
      ],
    },
  };
  window.__goalLedgerMounted = window.LittleBotGoalLedgerPanel.append(document.getElementById('goal-details'), goal);
});
