(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotSlashCommands = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const commands = Object.freeze([
    { name: 'help', usage: '/help', description: 'Show available chat commands.' },
    { name: 'new', usage: '/new', description: 'Start a new conversation.' },
    { name: 'plan', usage: '/plan', description: 'Use Plan mode for the next turn.' },
    { name: 'execute', usage: '/execute', description: 'Use Execute mode for the next turn.' },
    { name: 'private', usage: '/private', description: 'Toggle Private mode before a new chat starts.' },
    { name: 'goal', usage: '/goal [objective]', description: 'Open a new goal draft.' },
    { name: 'schedule', usage: '/schedule [task]', description: 'Open a new automation draft.' },
    { name: 'memory', usage: '/memory', description: 'Open saved memory.' },
    { name: 'activity', usage: '/activity', description: 'Open the agent activity panel.' },
    { name: 'settings', usage: '/settings', description: 'Open Settings.' },
    { name: 'clear', usage: '/clear', description: 'Clear the unsent draft and attachments.' },
  ]);

  const aliases = Object.freeze({
    goals: 'goal',
    automation: 'schedule',
    automations: 'schedule',
    exec: 'execute',
    incognito: 'private',
    inspector: 'activity',
  });

  function parse(value) {
    const text = String(value ?? '').trim();
    if (!text.startsWith('/')) return null;
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
    if (!match) return { known: false, name: '', args: '' };
    const rawName = match[1].toLowerCase();
    const name = aliases[rawName] || rawName;
    const command = commands.find(item => item.name === name) || null;
    return {
      known: Boolean(command),
      name,
      args: String(match[2] || '').trim(),
      command,
    };
  }

  function helpText() {
    return commands.map(command => command.usage).join(' · ');
  }

  return { commands, parse, helpText };
});
