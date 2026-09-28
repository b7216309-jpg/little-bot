'use strict';

(function expose(root, factory) {
  const api = factory(root.LittleBotProviderUsage);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotProviderUsagePanel = api;
})(typeof globalThis === 'object' ? globalThis : window, model => {
  let refreshing = false;
  let refreshError = '';
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

  function codexContent(doc, view) {
    const fragment = doc.createDocumentFragment();
    if (view.ordinaryUsageAllowed === false) {
      fragment.append(node(doc, 'p', 'provider-usage-warning', 'Ordinary provider usage is currently unavailable.'));
    }
    for (const bucket of view.buckets) {
      const card = node(doc, 'article', `provider-usage-bucket${bucket.limitReached ? ' reached' : ''}`);
      const heading = node(doc, 'div', 'provider-usage-bucket-heading');
      heading.append(node(doc, 'h4', '', bucket.label));
      if (bucket.limitReached) heading.append(node(doc, 'span', 'provider-usage-reached', 'Limit reached'));
      card.append(heading);
      for (const window of bucket.windows) {
        const row = node(doc, 'div', 'provider-usage-window');
        const copy = node(doc, 'div', 'provider-usage-window-copy');
        copy.append(node(doc, 'strong', '', window.label), node(doc, 'span', '', window.usageLabel));
        const reset = node(doc, 'span', 'provider-usage-reset', window.resetLabel);
        const top = node(doc, 'div', 'provider-usage-window-top');
        top.append(copy, reset);
        row.append(top);
        if (window.usedPercent !== null) {
          const progress = node(doc, 'progress', 'provider-usage-progress');
          progress.max = 100;
          progress.value = window.usedPercent;
          progress.setAttribute('aria-label', `${window.label}: ${window.usageLabel}`);
          row.append(progress);
        }
        card.append(row);
      }
      fragment.append(card);
    }
    return fragment;
  }

  function localContent(doc, view) {
    const fragment = doc.createDocumentFragment();
    if (!view.latest) return fragment;
    const grid = node(doc, 'div', 'provider-usage-metrics');
    grid.append(
      metric(doc, 'Reported output', view.latest.tokensPerSecond, view.latest.includesTools ? 'Turn included tools' : 'Model output interval'),
      metric(doc, 'First output', view.latest.firstOutput),
      metric(doc, 'Turn duration', view.latest.turnDuration),
      metric(doc, 'Generated tokens', view.latest.generatedTokens, `${view.latest.outputTokens} output · ${view.latest.reasoningTokens} reasoning`),
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

  async function refresh(button, doc) {
    if (refreshing || typeof globalThis.window?.bot?.refreshProviderUsage !== 'function') return;
    refreshing = true;
    refreshError = '';
    render(latestValue, { document: doc });
    try {
      const result = await globalThis.window.bot.refreshProviderUsage();
      latestValue = result?.providerUsage || result || latestValue;
    } catch (error) {
      refreshError = error?.message || 'Could not refresh provider usage.';
    } finally {
      refreshing = false;
      render(latestValue, { document: doc });
    }
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
    const button = doc.getElementById('provider-usage-refresh');
    title.textContent = view.title;
    subtitle.textContent = view.subtitle;
    status.textContent = refreshing ? 'Refreshing…' : view.statusLabel;
    status.className = `service-status provider-usage-status ${view.status === 'ready' ? 'configured' : ''}`.trim();
    updated.textContent = view.updatedLabel;
    updated.classList.toggle('hidden', !view.updatedLabel);
    note.textContent = view.note;
    button.disabled = refreshing;
    button.textContent = refreshing ? 'Refreshing…' : 'Refresh';
    if (!button.dataset.providerUsageBound) {
      button.dataset.providerUsageBound = 'true';
      button.addEventListener('click', () => refresh(button, doc));
    }
    host.replaceChildren();
    const message = refreshError || view.message;
    if (message) host.append(node(doc, 'p', refreshError ? 'provider-usage-message error' : 'provider-usage-message', message));
    if (view.kind === 'codex' && view.buckets.length) host.append(codexContent(doc, view));
    if (view.kind === 'local' && view.latest) host.append(localContent(doc, view));
    return true;
  }

  return { render };
});
