(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotSlashCommands = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const commands = Object.freeze([
    { name: 'help', usage: '/help', description: 'Show available chat commands.' },
    { name: 'goal', usage: '/goal <done when…> [--check "cmd"] [--turns N] [--time 90m]', description: 'Keep working until the condition is met. Also /goal status, pause, resume, clear.' },
    { name: 'goals', usage: '/goals [objective]', description: 'Open the goal panel, with a new goal when you add an objective.' },
    { name: 'plan', usage: '/plan', description: 'Use Plan mode for the next turn.' },
    { name: 'execute', usage: '/execute', description: 'Use Execute mode for the next turn.' },
    { name: 'keep', usage: '/keep', description: 'Keep this Quick session as a saved session.' },
    { name: 'schedule', usage: '/schedule [task]', description: 'Open a new automation draft.' },
    { name: 'calendar', usage: '/calendar', description: 'Open the local calendar.' },
    { name: 'memory', usage: '/memory', description: 'Open saved memory.' },
    { name: 'activity', usage: '/activity', description: 'Open the agent activity panel.' },
    { name: 'settings', usage: '/settings', description: 'Open Settings.' },
    { name: 'clear', usage: '/clear', description: 'Clear the unsent draft and attachments.' },
  ]);

  const aliases = Object.freeze({
    automation: 'schedule',
    automations: 'schedule',
    exec: 'execute',
    inspector: 'activity',
    cal: 'calendar',
    save: 'keep',
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

  // Commands for the menu while the draft is still just "/" and a partial name. Names starting
  // with the typed text come first, then aliases; nothing once an argument has started.
  function matches(value) {
    const match = /^\/([^\s/]*)$/.exec(String(value ?? ''));
    if (!match) return [];
    const typed = match[1].toLowerCase();
    const byName = commands.filter(command => command.name.startsWith(typed));
    const byAlias = Object.entries(aliases).filter(([alias]) => alias.startsWith(typed)).map(([, name]) => commands.find(command => command.name === name));
    return [...new Set([...byName, ...byAlias])];
  }

  // A command that needs nothing after its name runs as soon as it is picked.
  const takesArguments = command => /\s/.test(command.usage);

  function helpText() {
    return commands.map(command => command.usage).join(' · ');
  }

  return { commands, parse, matches, takesArguments, helpText };
});
