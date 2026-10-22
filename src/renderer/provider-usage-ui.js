'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotProviderUsage = api;
})(typeof globalThis === 'object' ? globalThis : window, () => {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' ? value.trim() : '';
  const number = value => Number.isFinite(value) && value >= 0 ? value : null;
  const time = value => Number.isFinite(value) && value > 0 ? value : null;

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

  function localView(value) {
    const latest = object(value.latest) ? value.latest : null;
    const average = object(value.average) ? value.average : null;
    const status = ['ready', 'waiting', 'offline'].includes(value.status) ? value.status : 'waiting';
    return {
      kind: 'local',
      title: 'Speed',
      subtitle: text(value.model) || text(latest?.model) || 'Local model',
      status,
      statusLabel: { ready: 'Measured', waiting: 'Waiting for a turn', offline: 'Offline' }[status],
      message: status === 'offline' ? text(value.error) || 'Start the local model to measure performance.'
        : !latest ? 'Appears after a local model turn.' : '',
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
      note: 'As reported by the engine. The average uses turns without tools.',
    };
  }

  function view(value = {}) {
    return localView(value || {});
  }

  return { formatRate, formatDuration, formatCount, view };
});
