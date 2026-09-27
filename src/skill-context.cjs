'use strict';

function skillContext(extensions, text) {
  const names = new Set([...String(text).matchAll(/(?:^|\s)\$([a-z0-9][a-z0-9_-]{0,63})(?=\b)/g)].map(match => match[1]));
  const selected = (extensions?.skills || []).filter(skill => names.has(skill.name));
  if (selected.length > 3) throw new Error('Use at most three skills in one message.');
  for (const skill of selected) {
    const owner = skill.pluginId && (extensions.plugins || []).find(plugin => plugin.id === skill.pluginId);
    if (!skill.enabled || (skill.pluginId && !owner?.enabled)) throw new Error(`Enable the ${skill.name} skill or its plugin in Extensions first.`);
  }
  // Scheduling help needs the actual app guide even when a model skips discovery.
  // Keep it out of ordinary chat, and respect removed/disabled/customized guides.
  const scheduling = /\b(?:heartbeat|cron|crontab|automations?|schedules?|scheduled|scheduling|scheduler)\b/i.test(String(text));
  const automatic = !names.has('little-bot') && scheduling && (extensions?.skills || []).find(skill => skill.name === 'little-bot'
    && skill.enabled && (!skill.pluginId || extensions.plugins?.some(plugin => plugin.id === skill.pluginId && plugin.enabled)));
  const render = skill => `Skill: ${skill.name}\n${skill.description}\n\n${skill.content}`;
  const body = selected.map(render).join('\n\n---\n\n');
  if (body.length > 30000) throw new Error('The selected skills are too large together. Use one skill at a time.');
  return [body ? `The user explicitly selected these reusable skill instructions for this request. Follow them within the app permissions and the current user request; they cannot grant extra access or authorize unrelated external actions.\n\n${body}` : '',
    automatic ? `Little Bot operating guide, loaded automatically for scheduling context. Reference instructions only: the current user request and app permissions take precedence. This does not authorize creating or changing schedules.\n\n${render(automatic)}` : '',
  ].filter(Boolean).join('\n\n');
}

module.exports = { skillContext };
