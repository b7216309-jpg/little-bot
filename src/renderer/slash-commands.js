(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotSlashCommands = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const commands = Object.freeze([
    { name: 'help', usage: '/help', description: 'Show available chat commands.' },
    { name: 'skill', usage: '/skill <name> [message]', description: 'Use one of your enabled skills; pick it from the list.' },
    { name: 'goal', usage: '/goal <done when…> [--check "cmd"] [--turns N] [--time 90m]', description: 'Keep working until the condition is met. Also /goal status, pause, resume, clear.' },
    { name: 'goals', usage: '/goals [objective]', description: 'Open background goals, or start a new one with an objective.' },
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

  // A draft is a command only when it starts with "/" and a command-like word. "/etc/hosts is wrong" or
  // "//note" is an ordinary message, and so is anything typed after a leading space.
  function parse(value) {
    const raw = String(value ?? '');
    if (!raw.startsWith('/')) return null;
    const text = raw.trim();
    if (text === '/') return { known: false, name: '', args: '' };
    const match = /^\/([a-z][a-z0-9_-]{0,31})(?:\s+([\s\S]*))?$/i.exec(text);
    if (!match) return null;
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

  // After "/skill " the menu lists skills instead of commands: names starting with the typed text
  // first, then names or descriptions containing it. null means the draft is not picking a skill.
  function skillMatches(value, skills) {
    const match = /^\/skill\s+\$?([a-z0-9_-]*)$/i.exec(String(value ?? ''));
    if (!match) return null;
    const typed = match[1].toLowerCase();
    const list = Array.isArray(skills) ? skills : [];
    const starts = list.filter(skill => skill.name.startsWith(typed));
    const contains = list.filter(skill => !starts.includes(skill) && typed && `${skill.name} ${skill.description || ''}`.toLowerCase().includes(typed));
    return [...starts, ...contains];
  }

  // "/skill name the rest" as a skill name and the message that goes with it.
  function skillInvocation(args) {
    const match = /^\$?([a-z0-9][a-z0-9_-]{0,63})(?:\s+([\s\S]*))?$/i.exec(String(args ?? '').trim());
    return match ? { name: match[1].toLowerCase(), message: String(match[2] || '').trim() } : null;
  }

  // A command that needs nothing after its name runs as soon as it is picked.
  const takesArguments = command => /\s/.test(command.usage);

  function helpText() {
    return commands.map(command => command.usage).join(' · ');
  }

  // The goal drawer's fields as /goal arguments, so both paths share one parser. The check
  // command is wrapped in the first quote character it does not contain.
  function goalArguments({ condition, check, turns, minutes } = {}) {
    const parts = [String(condition ?? '').replace(/\s+/g, ' ').trim()];
    if (!parts[0]) throw new Error('Describe what must be true when the goal is done.');
    if (/(^|\s)--(check|turns?|time)\b/i.test(parts[0])) throw new Error('Leave --check, --turns and --time out of the condition; use the fields below it.');
    const command = String(check ?? '').trim();
    if (command) {
      const quote = ['"', "'", '`'].find(mark => !command.includes(mark));
      if (!quote) throw new Error('The check command cannot use all three quote characters.');
      parts.push(`--check ${quote}${command}${quote}`);
    }
    if (Number.isInteger(turns) && turns > 0) parts.push(`--turns ${turns}`);
    if (Number.isInteger(minutes) && minutes > 0) parts.push(`--time ${minutes}m`);
    return parts.join(' ');
  }

  return { commands, parse, matches, skillMatches, skillInvocation, takesArguments, helpText, goalArguments };
});
