'use strict';

window.addEventListener('DOMContentLoaded', () => {
  const now = Date.now();
  const codex = {
    kind: 'codex', status: 'ready', plan: 'plus', updatedAt: now, ordinaryUsageAllowed: true,
    buckets: [{
      id: 'main', label: 'Codex',
      primary: { usedPercent: 25, remainingPercent: 75, windowDurationMinutes: 300, resetsAt: now + 2 * 60 * 60 * 1000 },
      secondary: { usedPercent: 60, remainingPercent: 40, windowDurationMinutes: 10080, resetsAt: now + 3 * 24 * 60 * 60 * 1000 },
    }],
  };
  const local = {
    kind: 'local', status: 'ready', model: 'Qwen local', updatedAt: now, sampleCount: 2,
    latest: {
      tokensPerSecond: 48.5, firstOutputMs: 650, durationMs: 3200, generatedTokens: 140,
      outputTokens: 110, reasoningTokens: 30, inputTokens: 800, cachedInputTokens: 500, includesTools: true,
    },
    average: { tokensPerSecond: 44.2, sampleCount: 1 },
  };
  window.__providerUsageMounted = window.LittleBotProviderUsagePanel.render(codex, { now });
  window.__renderLocalUsage = () => window.LittleBotProviderUsagePanel.render(local, { now });
});
