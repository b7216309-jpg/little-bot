'use strict';

(function expose(root, factory) {
  const model = typeof module === 'object' && module.exports ? require('./provider-usage-ui.js') : root.LittleBotProviderUsage;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotProviderUsagePanel = api;
})(typeof globalThis === 'object' ? globalThis : window, model => {
  let latestValue = null;

  function node(doc, tag, className, value) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function metric(doc, label, value, hint = '') {
    const item = node(doc, 'div', 'provider-usage-metric');
    item.append(node(doc, 'span', 'provider-usage-metric-label', label), node(doc, 'strong', '', value));
    if (hint) item.append(node(doc, 'small', '', hint));
    return item;
  }

  function localContent(doc, view) {
    const fragment = doc.createDocumentFragment();
    if (!view.latest) return fragment;
    const grid = node(doc, 'div', 'provider-usage-metrics');
    grid.append(
      metric(doc, 'Reported output', view.latest.tokensPerSecond, view.latest.includesTools ? 'Turn included tools' : 'Model output interval'),
      metric(doc, 'First output', view.latest.firstOutput),
      metric(doc, 'Turn duration', view.latest.turnDuration),
      metric(doc, 'Generated tokens', view.latest.generatedTokens, `${view.latest.outputTokens} output · ${view.latest.reasoningTokens} reasoning subset`),
      metric(doc, 'Input tokens', view.latest.inputTokens, `${view.latest.cachedInputTokens} cached`),
    );
    fragment.append(grid);
    if (view.average) {
      const average = node(doc, 'div', 'provider-usage-average');
      average.append(node(doc, 'span', '', 'Tool-free rolling average'), node(doc, 'strong', '', view.average.tokensPerSecond),
        node(doc, 'small', '', `${view.average.sampleCount} measured turn${view.average.sampleCount === 1 ? '' : 's'}`));
      fragment.append(average);
    } else if (view.latest.includesTools) {
      fragment.append(node(doc, 'p', 'provider-usage-hint', 'This turn included tools, so it is shown but not added to the rolling throughput average.'));
    }
    return fragment;
  }

  function render(value, options = {}) {
    if (!model?.view) return false;
    const doc = options.document || globalThis.document;
    const host = doc?.getElementById?.('provider-usage-content');
    if (!host) return false;
    latestValue = value || latestValue || {};
    const view = model.view(latestValue, options.now);
    const title = doc.getElementById('provider-usage-title');
    const subtitle = doc.getElementById('provider-usage-subtitle');
    const status = doc.getElementById('provider-usage-status');
    const updated = doc.getElementById('provider-usage-updated');
    const note = doc.getElementById('provider-usage-note');
    title.textContent = view.title;
    subtitle.textContent = view.subtitle;
    status.textContent = view.statusLabel;
    status.className = `service-status provider-usage-status ${view.status === 'ready' ? 'configured' : ''}`.trim();
    updated.textContent = view.updatedLabel;
    updated.classList.toggle('hidden', !view.updatedLabel);
    note.textContent = view.note;
    host.replaceChildren();
    if (view.message) host.append(node(doc, 'p', 'provider-usage-message', view.message));
    if (view.latest) host.append(localContent(doc, view));
    return true;
  }

  return { render };
});
