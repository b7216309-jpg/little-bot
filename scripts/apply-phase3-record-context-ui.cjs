'use strict';

const fs = require('node:fs');

function replaceOnce(file, before, after, label) {
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}

replaceOnce('src/renderer/goal-ledger-ui.js',
`  function records(value, kind) {
    return array(value).map(item => normalizeRecord(item, kind)).filter(Boolean)
      .sort((left, right) => (right.at || 0) - (left.at || 0));
  }

  function evidenceLabel(value) {`,
`  function records(value, kind) {
    return array(value).map(item => normalizeRecord(item, kind)).filter(Boolean)
      .sort((left, right) => (right.at || 0) - (left.at || 0));
  }

  function addRecordContext(records, allPlans) {
    const steps = new Map();
    for (const plan of allPlans) {
      plan.steps.forEach((step, index) => steps.set(step.id, {
        label: \`v${'${plan.version}'} · Step ${'${index + 1}'}\`,
        text: step.text,
      }));
    }
    return records.map(record => {
      const linked = steps.get(record.stepId);
      return {
        ...record,
        contextLabel: linked?.label || (record.planVersion ? \`v${'${record.planVersion}'}\` : ''),
        contextText: linked?.text || '',
      };
    });
  }

  function evidenceLabel(value) {`,
'record context model');

replaceOnce('src/renderer/goal-ledger-ui.js',
`    const assumptions = latestAssumptions(goal?.ledger?.assumptions);
    const observations = records(goal?.ledger?.observations, 'observation');
    const decisions = records(goal?.ledger?.decisions, 'decision');`,
`    const assumptions = addRecordContext(latestAssumptions(goal?.ledger?.assumptions), allPlans);
    const observations = addRecordContext(records(goal?.ledger?.observations, 'observation'), allPlans);
    const decisions = addRecordContext(records(goal?.ledger?.decisions, 'decision'), allPlans);`,
'contextualized records');

replaceOnce('src/renderer/goal-ledger-panel.js',
`    head.append(node(doc, 'span', 'goal-ledger-record-source', record.sourceLabel));
    if (kind === 'assumption') head.append(node(doc, 'span', \`goal-ledger-record-badge ${'${record.status}'}\`, record.statusLabel));
    if (record.at) head.append(node(doc, 'time', 'goal-ledger-record-time', dateLabel(record.at)));`,
`    head.append(node(doc, 'span', 'goal-ledger-record-source', record.sourceLabel));
    if (kind === 'assumption') head.append(node(doc, 'span', \`goal-ledger-record-badge ${'${record.status}'}\`, record.statusLabel));
    if (record.contextLabel) {
      const context = node(doc, 'span', 'goal-ledger-record-context', record.contextLabel);
      if (record.contextText) context.title = record.contextText;
      head.append(context);
    }
    if (record.at) head.append(node(doc, 'time', 'goal-ledger-record-time', dateLabel(record.at)));`,
'visible record context');

replaceOnce('src/renderer/goal-ledger.css',
`.goal-ledger-record-source{font-size:8px;font-weight:650;color:#7e8976}
.goal-ledger-record-time{margin-left:auto;font-size:8px;color:#a0a59c;white-space:nowrap}`,
`.goal-ledger-record-source{font-size:8px;font-weight:650;color:#7e8976}
.goal-ledger-record-context{display:inline-flex;min-width:0;padding:2px 5px;border:1px solid #e1e4dc;border-radius:4px;background:#f7f8f3;color:#7a8473;font-size:7px;font-weight:650;letter-spacing:.25px;white-space:nowrap}
.goal-ledger-record-time{margin-left:auto;font-size:8px;color:#a0a59c;white-space:nowrap}`,
'record context style');

replaceOnce('test/goal-ledger-fixture.js',
`        { id: 'a1', at: 2500, text: 'The source uses UTF-8.', status: 'confirmed', source: 'verification' },`,
`        { id: 'a1', at: 2500, text: 'The source uses UTF-8.', status: 'confirmed', source: 'verification', stepId: 'done', planVersion: 2 },`,
'fixture assumption context');

replaceOnce('test/goal-ledger-fixture.js',
`        { id: 'o1', at: 2600, text: 'The report exists but totals are missing.', source: 'verification', evidence: { type: 'completion', passed: false, path: 'report.md' } },`,
`        { id: 'o1', at: 2600, text: 'The report exists but totals are missing.', source: 'verification', stepId: 'done', planVersion: 2, evidence: { type: 'completion', passed: false, path: 'report.md' } },`,
'fixture observation context');

replaceOnce('test/goal-ledger-fixture.js',
`        { id: 'd1', at: 2700, text: 'Recalculate totals before final verification.', rationale: 'The saved content check failed.', source: 'agent' },`,
`        { id: 'd1', at: 2700, text: 'Recalculate totals before final verification.', rationale: 'The saved content check failed.', source: 'agent', stepId: 'done', planVersion: 2 },`,
'fixture decision context');

replaceOnce('test/goal-ledger-electron.cjs',
`          evidence: document.querySelector('.goal-ledger-evidence.failed')?.textContent || '',
          decision: Array.from(document.querySelectorAll('.goal-ledger-record-section')).at(-1)?.textContent || '',`,
`          evidence: document.querySelector('.goal-ledger-evidence.failed')?.textContent || '',
          contexts: Array.from(document.querySelectorAll('.goal-ledger-record-context')).map(node => ({ text: node.textContent, title: node.title })),
          decision: Array.from(document.querySelectorAll('.goal-ledger-record-section')).at(-1)?.textContent || '',`,
'Electron context capture');

replaceOnce('test/goal-ledger-electron.cjs',
`    assert.equal(result.evidence, 'Failed · report.md');
    assert.match(result.decision, /Recalculate totals/);`,
`    assert.equal(result.evidence, 'Failed · report.md');
    assert.equal(result.contexts.length, 3);
    assert.ok(result.contexts.every(item => item.text === 'v2 · Step 1'));
    assert.ok(result.contexts.every(item => item.title === 'Inspect the newer source.'));
    assert.match(result.decision, /Recalculate totals/);`,
'Electron context assertions');
