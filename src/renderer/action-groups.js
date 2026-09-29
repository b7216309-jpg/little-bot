(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotActionGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function isTool(message) {
    return message?.role === 'tool';
  }

  function isProgress(message) {
    return message?.role === 'assistant' && (message.kind === 'reasoning' || ['commentary', 'analysis'].includes(message.phase));
  }

  function groupConversation(messages = []) {
    const units = [];
    for (let index = 0; index < messages.length;) {
      const message = messages[index];
      if (!isTool(message)) {
        units.push({ type: 'message', message, index });
        index += 1;
        continue;
      }
      const start = index;
      const tools = [];
      const entries = [];
      while (index < messages.length && (isTool(messages[index]) || isProgress(messages[index]))) {
        const entry = { message: messages[index], index };
        entries.push(entry);
        if (isTool(messages[index])) tools.push(entry);
        index += 1;
      }
      // Keep trailing progress visible until another tool arrives.
      while (entries.length && !isTool(entries[entries.length - 1].message)) { entries.pop(); index -= 1; }
      units.push({
        type: 'actions',
        key: String(tools[0].message?.id || start),
        start,
        tools,
        entries,
      });
    }
    return units;
  }

  function summarize(messages = []) {
    let running = 0, failed = 0, completed = 0;
    for (const message of messages) {
      const status = String(message?.status || '').toLowerCase();
      if (['running', 'inprogress', 'in_progress', 'pending'].includes(status)) running += 1;
      else if (['failed', 'error', 'cancelled', 'canceled', 'interrupted'].includes(status)) failed += 1;
      else completed += 1;
    }
    const count = messages.length;
    const status = [running ? `${running} running` : '', failed ? `${failed} failed` : ''].filter(Boolean).join(' · ') || 'Completed';
    return { count, running, failed, completed, status, label: `${count} ${count === 1 ? 'action' : 'actions'}` };
  }

  return { groupConversation, summarize };
});
