'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotIndependentCheck = api;
})(typeof globalThis === 'object' ? globalThis : window, () => {
  function eligible(message) {
    return Boolean(message && message.role === 'assistant'
      && !['reasoning', 'compaction'].includes(message.kind)
      && !['analysis', 'commentary', 'internal'].includes(message.phase)
      && !['running', 'waiting', 'failed', 'interrupted', 'inProgress'].includes(message.status)
      && String(message.text || '').trim());
  }
  return { eligible };
});
