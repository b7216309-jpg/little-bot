(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotActionGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function isTool(message) {
    return message?.role === 'tool';
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
      while (index < messages.length && isTool(messages[index])) {
        tools.push({ message: messages[index], index });
        index += 1;
      }
      if (tools.length === 1) units.push({ type: 'message', ...tools[0] });
      else units.push({
        type: 'actions',
        key: String(tools[0].message?.id || start),
        start,
        tools,
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
    const status = failed ? `${failed} failed` : running ? `${running} running` : 'Completed';
    return { count, running, failed, completed, status, label: `${count} ${count === 1 ? 'action' : 'actions'}` };
  }

  return { groupConversation, summarize };
});
