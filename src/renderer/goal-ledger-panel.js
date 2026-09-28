'use strict';

(function expose(root, factory) {
  const model = typeof module === 'object' && module.exports ? require('./goal-ledger-ui.js') : root.LittleBotGoalLedger;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotGoalLedgerPanel = api;
})(typeof globalThis === 'object' ? globalThis : window, model => {
  const RECORD_LIMIT = 20;

  function node(doc, tag, className = '', text = '') {
    const value = doc.createElement(tag);
    if (className) value.className = className;
    if (text) value.textContent = text;
    return value;
  }

  function dateLabel(value) {
    if (!Number.isFinite(value)) return '';
    try {
      return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return ''; }
  }

  function stepNode(doc, step, index) {
    const row = node(doc, 'li', `goal-ledger-step ${step.status}`);
    const marker = node(doc, 'span', 'goal-ledger-step-marker', step.status === 'completed' ? '✓' : String(index + 1));
    marker.setAttribute('aria-hidden', 'true');
    const copy = node(doc, 'div', 'goal-ledger-step-copy');
    copy.append(node(doc, 'strong', '', step.text));
    if (step.summary) copy.append(node(doc, 'p', '', step.summary));
    row.append(marker, copy, node(doc, 'span', 'goal-ledger-step-status', step.label));
    return row;
  }

  function planNode(doc, plan, { archived = false } = {}) {
    const section = node(doc, 'section', archived ? 'goal-ledger-archived-plan' : 'goal-ledger-current');
    const header = node(doc, 'div', 'goal-ledger-plan-header');
    const title = node(doc, 'div', 'goal-ledger-plan-title');
    title.append(node(doc, 'h4', '', archived ? 'Earlier plan' : 'Current plan'), node(doc, 'span', 'goal-ledger-version', `v${plan.version}`));
    const metaParts = [plan.sourceLabel, dateLabel(plan.createdAt)].filter(Boolean);
    header.append(title, node(doc, 'span', 'goal-ledger-plan-meta', metaParts.join(' · ')));
    section.append(header, node(doc, 'p', 'goal-ledger-plan-reason', plan.reason));
    const list = node(doc, 'ol', 'goal-ledger-steps');
    plan.steps.forEach((step, index) => list.append(stepNode(doc, step, index)));
    section.append(list);
    return section;
  }

  function evidenceNode(doc, evidence) {
    const label = model.evidenceLabel(evidence);
    if (!label) return null;
    const kind = evidence?.type === 'snapshot' ? ' snapshot' : evidence?.passed === false ? ' failed' : '';
    return node(doc, 'span', `goal-ledger-evidence${kind}`, label);
  }

  function recordNode(doc, record, kind) {
    const item = node(doc, 'article', 'goal-ledger-record');
    const head = node(doc, 'div', 'goal-ledger-record-head');
    head.append(node(doc, 'span', 'goal-ledger-record-source', record.sourceLabel));
    if (kind === 'assumption') head.append(node(doc, 'span', `goal-ledger-record-badge ${record.status}`, record.statusLabel));
    if (record.contextLabel) {
      const context = node(doc, 'span', 'goal-ledger-record-context', record.contextLabel);
      if (record.contextText) context.title = record.contextText;
      head.append(context);
    }
    if (record.at) head.append(node(doc, 'time', 'goal-ledger-record-time', dateLabel(record.at)));
    item.append(head, node(doc, 'p', '', record.text));
    if (kind === 'decision' && record.rationale) item.append(node(doc, 'p', 'goal-ledger-record-rationale', record.rationale));
    if (kind === 'observation' && record.evidence) {
      const evidence = evidenceNode(doc, record.evidence);
      if (evidence) item.append(evidence);
    }
    return item;
  }

  function recordSection(doc, title, records, kind, limit) {
    const section = node(doc, 'section', 'goal-ledger-record-section');
    section.append(node(doc, 'h4', '', `${title} · ${records.length}`));
    const list = node(doc, 'div', 'goal-ledger-record-list');
    if (!records.length) list.append(node(doc, 'p', 'goal-ledger-empty', `No ${title.toLocaleLowerCase()} recorded yet.`));
    else {
      for (const record of records.slice(0, limit)) list.append(recordNode(doc, record, kind));
      if (records.length > limit) list.append(node(doc, 'p', 'goal-ledger-empty', `Showing the latest ${limit} of ${records.length} bounded records.`));
    }
    section.append(list);
    return section;
  }

  function append(container, goal, options = {}) {
    if (!container || typeof container.append !== 'function' || !model?.view) return false;
    const doc = options.document || container.ownerDocument || globalThis.document;
    if (!doc?.createElement) return false;
    const limit = Number.isInteger(options.recordLimit) && options.recordLimit > 0 ? Math.min(options.recordLimit, 100) : RECORD_LIMIT;
    const view = model.view(goal || {});
    container.append(planNode(doc, view.current));

    const columns = node(doc, 'div', 'goal-ledger-columns');
    columns.append(
      recordSection(doc, 'Assumptions', view.assumptions, 'assumption', limit),
      recordSection(doc, 'Observations', view.observations, 'observation', limit),
      recordSection(doc, 'Decisions', view.decisions, 'decision', limit),
    );
    container.append(columns);

    if (view.archived.length) {
      const archive = node(doc, 'details', 'goal-ledger-archive');
      archive.append(node(doc, 'summary', '', `Earlier plan versions · ${view.archived.length}`));
      const body = node(doc, 'div', 'goal-ledger-archive-body');
      for (const plan of view.archived) body.append(planNode(doc, plan, { archived: true }));
      archive.append(body);
      container.append(archive);
    }

    container.append(node(doc, 'p', 'goal-ledger-note', 'Ledger entries are concise public records of the plan and evidence, not hidden model reasoning.'));
    return true;
  }

  return { RECORD_LIMIT, dateLabel, append };
});
