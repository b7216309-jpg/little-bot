'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotProviderUsage = api;
})(typeof globalThis === 'object' ? globalThis : window, () => {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const array = value => Array.isArray(value) ? value : [];
  const text = value => typeof value === 'string' ? value.trim() : '';
  const number = value => Number.isFinite(value) && value >= 0 ? value : null;
  const percent = value => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const time = value => Number.isFinite(value) && value > 0 ? value : null;

  function durationLabel(minutes) {
    if (!Number.isSafeInteger(minutes) || minutes <= 0) return '';
    if (minutes % 10080 === 0) return minutes === 10080 ? '7-day window' : `${minutes / 10080}-week window`;
    if (minutes % 1440 === 0) return minutes === 1440 ? '24-hour window' : `${minutes / 1440}-day window`;
    if (minutes % 60 === 0) return `${minutes / 60}-hour window`;
    return `${minutes}-minute window`;
  }

  function resetLabel(value, now = Date.now()) {
    const at = time(value);
    if (!at) return 'Reset time unavailable';
    const remaining = at - now;
    if (remaining <= 0) return 'Reset due now';
    const minutes = Math.ceil(remaining / 60000);
    if (minutes < 60) return `Resets in ${minutes} min`;
    const hours = Math.floor(minutes / 60), leftoverMinutes = minutes % 60;
    if (hours < 48) return `Resets in ${hours}h${leftoverMinutes ? ` ${leftoverMinutes}m` : ''}`;
    const days = Math.floor(hours / 24), leftoverHours = hours % 24;
    return `Resets in ${days}d${leftoverHours ? ` ${leftoverHours}h` : ''}`;
  }

  function formatRate(value) {
    const rate = number(value);
    if (rate === null) return '—';
    return `${rate >= 100 ? rate.toFixed(0) : rate.toFixed(1)} tok/s`;
  }

  function formatDuration(value) {
    const milliseconds = number(value);
    if (milliseconds === null) return '—';
    if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
    if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(milliseconds < 10000 ? 1 : 0)} s`;
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.round((milliseconds % 60000) / 1000);
    return `${minutes}m${seconds ? ` ${seconds}s` : ''}`;
  }

  function formatCount(value) {
    const count = number(value);
    return count === null ? '—' : Math.round(count).toLocaleString();
  }

  function normalizeWindow(value, fallbackLabel, now) {
    if (!object(value)) return null;
    const usedPercent = percent(value.usedPercent);
    const remainingPercent = percent(value.remainingPercent);
    const label = durationLabel(value.windowDurationMinutes) || fallbackLabel;
    return {
      label,
      usedPercent,
      remainingPercent,
      usageLabel: remainingPercent === null ? 'Usage percentage unavailable' : `${Math.round(remainingPercent)}% remaining`,
      resetLabel: resetLabel(value.resetsAt, now),
      resetsAt: time(value.resetsAt),
    };
  }

  function codexView(value, now) {
    const buckets = array(value.buckets).map((bucket, index) => {
      if (!object(bucket)) return null;
      const windows = [
        normalizeWindow(bucket.primary, 'Primary window', now),
        normalizeWindow(bucket.secondary, 'Secondary window', now),
      ].filter(Boolean);
      if (!windows.length) return null;
      const rawLabel = text(bucket.label) || text(bucket.id);
      return {
        id: text(bucket.id) || `limit-${index + 1}`,
        label: !rawLabel || rawLabel === 'default' ? 'Provider limit' : rawLabel,
        limitReached: bucket.limitReached === true,
        reachedType: text(bucket.reachedType),
        windows,
      };
    }).filter(Boolean);
    const status = ['ready', 'loading', 'unavailable', 'signedOut'].includes(value.status) ? value.status : 'unavailable';
    return {
      kind: 'codex',
      title: 'Provider usage',
      subtitle: ['Codex', text(value.plan)].filter(Boolean).join(' · '),
      status,
      statusLabel: { ready: 'Current', loading: 'Refreshing…', unavailable: 'Unavailable', signedOut: 'Not connected' }[status],
      message: status === 'loading' ? 'Reading provider-reported limits…'
        : status === 'signedOut' ? 'Connect Codex to view provider-reported limits.'
        : status === 'unavailable' ? text(value.error) || 'The provider did not report usable limits.' : '',
      buckets,
      ordinaryUsageAllowed: typeof value.ordinaryUsageAllowed === 'boolean' ? value.ordinaryUsageAllowed : null,
      updatedAt: time(value.updatedAt),
      updatedLabel: time(value.updatedAt) ? `Updated ${new Date(value.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '',
      note: 'Read-only provider data. It does not change goal token, time, action, run, or retry budgets.',
    };
  }

  function localView(value) {
    const latest = object(value.latest) ? value.latest : null;
    const average = object(value.average) ? value.average : null;
    const status = ['ready', 'waiting', 'offline'].includes(value.status) ? value.status : 'waiting';
    return {
      kind: 'local',
      title: 'Local performance',
      subtitle: text(value.model) || text(latest?.model) || 'Local model',
      status,
      statusLabel: { ready: 'Measured', waiting: 'Waiting for a turn', offline: 'Offline' }[status],
      message: status === 'offline' ? text(value.error) || 'Start the local model to measure performance.'
        : !latest ? 'Complete a local model turn to show provider-reported token throughput.' : '',
      latest: latest ? {
        tokensPerSecond: formatRate(latest.tokensPerSecond),
        firstOutput: formatDuration(latest.firstOutputMs),
        turnDuration: formatDuration(latest.durationMs),
        generatedTokens: formatCount(latest.generatedTokens),
        outputTokens: formatCount(latest.outputTokens),
        reasoningTokens: formatCount(latest.reasoningTokens),
        inputTokens: formatCount(latest.inputTokens),
        cachedInputTokens: formatCount(latest.cachedInputTokens),
        includesTools: latest.includesTools === true,
      } : null,
      average: average ? {
        tokensPerSecond: formatRate(average.tokensPerSecond),
        sampleCount: Number.isSafeInteger(average.sampleCount) ? average.sampleCount : 0,
      } : null,
      sampleCount: Number.isSafeInteger(value.sampleCount) ? value.sampleCount : 0,
      updatedAt: time(value.updatedAt),
      updatedLabel: time(value.updatedAt) ? `Last turn ${new Date(value.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '',
      note: 'Whole-turn timing from engine-reported tokens. Tool-free turns form the rolling average. This is not a price, quota, or model benchmark.',
    };
  }

  function view(value = {}, now = Date.now()) {
    return value?.kind === 'codex' ? codexView(value, now) : localView(value);
  }

  return { durationLabel, resetLabel, formatRate, formatDuration, formatCount, view };
});
