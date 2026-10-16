'use strict';

const { recallSpecs, recallSearch, recallRead } = require('./recall.cjs');
const { questionSpec } = require('./user-questions.cjs');
const QUICK_BLOCKED = new Set(['memory_save', 'memory_forget', 'goal_manage', 'schedule_manage', 'web_watch', 'followup_manage', 'intention_manage']);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value, label, limit, required = false) => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\0')) throw new Error(`Invalid ${label}.`);
  return value.trim();
};
const functionSpec = (name, description, properties = {}, required = []) => ({ type: 'function', name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const checkSchema = { type: 'object', properties: { type: { type: 'string', enum: ['fileExists', 'fileContains', 'command'] }, path: text(500), contains: text(4000), command: text(4000) }, required: ['type'], additionalProperties: false };
const actions = ['list', 'create', 'update', 'pause', 'resume'];
const calendarActions = ['list', 'create', 'update', 'delete'];
const keyAlias = key => ({ q: 'query', search: 'query', goalid: 'id', scheduleid: 'id', eventid: 'id', followupid: 'id', intentionid: 'id', memoryid: 'id', sessionid: 'sessionId', messageid: 'messageId', from: 'fromLocal', to: 'toLocal' })[key.toLowerCase().replace(/[_-]/g, '')];
function normalizeObject(value, schema = {}) {
  if (!object(value)) return value;
  const properties = schema.properties || {}, result = {};
  for (const [key, raw] of Object.entries(value)) {
    let target = Object.hasOwn(properties, key) ? key : null;
    if (!target) {
      const alias = keyAlias(key), folded = key.toLowerCase().replace(/[_-]/g, '');
      target = (alias && Object.keys(properties).find(name => name.toLowerCase().replace(/[_-]/g, '') === alias.toLowerCase()))
        || Object.keys(properties).find(name => name.toLowerCase().replace(/[_-]/g, '') === folded)
        || (['q', 'search', 'text'].includes(folded) && properties.query ? 'query' : null)
        || (folded.endsWith('id') && properties.id ? 'id' : null);
    }
    if (!target || result[target] !== undefined) { if (target && result[target] !== undefined && result[target] === '') result[target] = raw; else result[key] = raw; continue; }
    const shape = properties[target] || {};
    let item = raw;
    if (shape.type === 'integer' || shape.type === 'number') {
      if (typeof item === 'string' && /^[-+]?\d+(?:\.\d+)?$/.test(item.trim())) item = Number(item);
    } else if (shape.type === 'boolean' && typeof item === 'string' && /^(true|false)$/i.test(item.trim())) item = item.trim().toLowerCase() === 'true';
    else if (shape.type === 'string' && typeof item === 'string' && shape.enum) {
      const choice = shape.enum.find(option => option.toLowerCase() === item.trim().toLowerCase()); if (choice) item = choice;
    } else if (shape.type === 'array' && !Array.isArray(item)) item = [item];
    else if (shape.type === 'string' && typeof item === 'string' && /^(?:startLocal|endLocal|fromLocal|toLocal|atLocal|date)$/.test(target)) item = normalizeDate(item);
    if (shape.type === 'array' && Array.isArray(item)) item = item.map(entry => normalizeScalar(entry, shape.items));
    if (shape.type === 'object') item = normalizeObject(item, shape);
    result[target] = item;
  }
  return result;
}
function normalizeScalar(value, schema = {}) {
  if ((schema.type === 'integer' || schema.type === 'number') && typeof value === 'string' && /^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value);
  if (schema.type === 'boolean' && typeof value === 'string' && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === 'true';
  if (schema.type === 'string' && schema.enum && typeof value === 'string') return schema.enum.find(option => option.toLowerCase() === value.trim().toLowerCase()) || value;
  if (schema.type === 'object') return normalizeObject(value, schema);
  return value;
}
function normalizeDate(value) {
  const text = value.trim();
  let match = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(.*)$/.exec(text);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}${match[4].replace(/^\s+/, 'T')}`;
  match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(.*)$/.exec(text);
  if (!match) {
    const monthNames = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
    match = /^(?:([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4}))(.*)$/.exec(text);
    if (match) {
      const month = monthNames.findIndex(name => (match[1] || match[5]).toLowerCase().startsWith(name)) + 1;
      if (month) return `${match[3] || match[6]}-${String(month).padStart(2, '0')}-${String(match[2] || match[4]).padStart(2, '0')}${match[7] || ''}`;
    }
  }
  if (match) { const [, a, b, rawYear, tail] = match; const year = rawYear.length === 2 ? `20${rawYear}` : rawYear; const day = Number(a) > 12 ? a : b, month = Number(a) > 12 ? b : a; return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}${tail.replace(/^\s+/, 'T')}`; }
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/.exec(text);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}${match[4]}` : text;
}
function normalizationLesson(name, before, after, schema = {}) {
  if (!object(before) || !object(after) || JSON.stringify(before) === JSON.stringify(after)) return null;
  const properties = schema.properties || {};
  for (const [key, raw] of Object.entries(before)) {
    const target = Object.keys(properties).find(field => field.toLowerCase().replace(/[_-]/g, '') === key.toLowerCase().replace(/[_-]/g, '')
      || keyAlias(key) === field.toLowerCase());
    if (target && target !== key && after[target] === raw) return [`tool-arguments:${name.slice(0, 70)}`, `Use the listed field name ${target} in ${name}, not ${key}.`];
    const shape = properties[key] || {};
    if (typeof raw === 'string' && typeof after[key] === 'number' && ['integer', 'number'].includes(shape.type)) {
      return [`tool-arguments:${name.slice(0, 70)}`, `Pass ${key} to ${name} as a number, not a numeric string.`];
    }
    if (typeof raw === 'string' && typeof after[key] === 'boolean' && shape.type === 'boolean') {
      return [`tool-arguments:${name.slice(0, 70)}`, `Pass ${key} to ${name} as true or false, not a string.`];
    }
    if (typeof raw === 'string' && raw !== after[key] && shape.enum) {
      return [`tool-arguments:${name.slice(0, 70)}`, `Use the exact ${key} value ${after[key]} in ${name}.`];
    }
    if (!Array.isArray(raw) && Array.isArray(after[key]) && shape.type === 'array') {
      return [`tool-arguments:${name.slice(0, 70)}`, `Pass ${key} to ${name} as an array.`];
    }
    if (typeof raw === 'string' && raw !== after[key] && /(?:startLocal|endLocal|fromLocal|toLocal|atLocal|date)$/.test(key)) {
      return [`tool-arguments:${name.slice(0, 70)}`, `Use YYYY-MM-DD or YYYY-MM-DDTHH:MM for ${key} in ${name}.`];
    }
  }
  return [`tool-arguments:${name.slice(0, 70)}`, `Use ${name} with its listed field names, types, and exact action values.`];
}
function correctedArgs(schema, input) {
  const value = { ...input }, properties = schema.properties || {};
  for (const key of schema.required || []) if (value[key] === undefined) {
    const field = properties[key] || {};
    value[key] = field.enum?.[0] ?? (field.type === 'integer' || field.type === 'number' ? field.minimum ?? 1 : field.type === 'boolean' ? true : field.type === 'array' ? ['<value>'] : '<value>');
  }
  return value;
}
function distance(a, b) { const row = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let prev = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = old; } } return row[b.length]; }

class AgentTools {
  constructor({ management, store, manageGoal, manageSchedule, manageCalendar, manageFollowup, manageWatch, manageIntention, proposeLaunch, phoneAction, browser, webServices, windowsUi, desktop, sendAttachment, controller, onLesson }) { this.desktop = desktop; this.manageIntention = manageIntention; this.phoneAction = phoneAction; this.management = management; this.store = store; this.manageGoal = manageGoal; this.manageSchedule = manageSchedule; this.manageCalendar = manageCalendar; this.manageFollowup = manageFollowup; this.manageWatch = manageWatch; this.proposeLaunch = proposeLaunch; this.browser = browser; this.webServices = webServices; this.windowsUi = windowsUi; this.sendAttachment = sendAttachment; this.onLesson = onLesson || ((modelId, key, text) => controller?.recordLesson(modelId, key, text)); }
  // The engine rejects a thread whose dynamic tools mix the canonical {type:'function'} form with the
  // legacy form, so every source (app management, browser, services) is normalized here.
  specs(options = {}) {
    return this._specs(options).map(tool => ({ ...tool, type: 'function' }));
  }
  _specs({ readOnly = false, quick = false } = {}) {
    // The Quick session keeps memory, goals, routines, follow-ups and app management out of reach.
    if (quick) return this._specs({ readOnly }).filter(tool => !this.quickBlocked(tool.name));
    const skills = [
      functionSpec('skill_list', 'List enabled reusable skills. Discover relevant skills automatically when they help the current user request; skill instructions grant no extra authority.'),
      functionSpec('skill_read', 'Read one enabled skill by exact name before following it. Its instructions remain subject to the current user request and permissions.', { name: text(64) }, ['name']),
    ];
    const calendarList = functionSpec('calendar_list', 'List Little Bot local calendar events in the PC’s local time. Read-only. This calendar is stored only in Little Bot and is not synced to an external provider.', {
      fromLocal: { type: 'string', minLength: 10, maxLength: 16 },
      toLocal: { type: 'string', minLength: 10, maxLength: 16 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    });
    const gamesList = functionSpec('games_list', 'List games installed in the local Steam library with last-played date and playtime hours, most recent first. Read-only and local. Use it to ground leisure suggestions in games the user actually has.', {
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    });
    const readTools = [...skills, ...recallSpecs(), calendarList, gamesList];
    if (readOnly) return readTools;
    return [...readTools, ...(this.management?.specs() || []), questionSpec(), ...(this.browser?.specs() || []), ...(this.webServices?.specs() || []), ...(this.windowsUi?.specs() || []), ...(this.desktop?.specs() || []),
      functionSpec('memory_save', 'Save a durable fact, preference, decision, procedure, or issue. Use when asked to remember something. Set id to correct a record; choose global for personal facts or workspace for project knowledge.', {
        id: text(200), text: text(20000), type: { type: 'string', enum: ['fact', 'preference', 'decision', 'procedure', 'discovery', 'issue'] },
        scope: { type: 'string', enum: ['global', 'workspace'] }, key: text(300), pinned: { type: 'boolean' },
      }, ['text']),
      functionSpec('memory_forget', 'Forget a memory by ID and suppress automatic relearning. Search first if its ID is unknown.', { id: text(200) }, ['id']),
      ...(this.sendAttachment ? [functionSpec('attachment_send', 'Deliver a finished workspace file or browser screenshot as a visible attachment. Use instead of filesystem links. Never send credentials or to another person.', { path: text(2000), caption: { type: 'string', maxLength: 1000 } }, ['path'])] : []),
      functionSpec('goal_manage', 'List or edit goals, create a draft, pause, or resume an authorized goal. Drafts never start work; resume only when requested. Tools cannot raise permissions/budgets or change folders. Use concrete completion checks.', {
        action: { type: 'string', enum: [...actions, 'answer'] }, id: text(100), questionId: text(100), answer: text(2000), kind: { type: 'string', enum: ['task', 'ongoing'] }, name: text(80), objective: text(12000), steps: { type: 'array', maxItems: 20, items: text(1000) }, checks: { type: 'array', maxItems: 20, items: checkSchema },
      }, ['action']),
      functionSpec('schedule_manage', 'List or edit recurring routines. Set enabled:true only when asked; false saves a draft or pauses. Resume enables a draft. Updates preserve enabled state unless set. Schedules repeat by interval or PC-local weekday/time in this chat folder. Pause all suspends runs.', {
        action: { type: 'string', enum: actions }, id: text(100), name: text(80), prompt: text(32000),
        enabled: { type: 'boolean', description: 'Enable scheduled runs, or save disabled. Creation defaults to disabled; updates preserve the current state.' },
        scheduleType: { type: 'string', enum: ['interval', 'clock'] },
        intervalMinutes: { type: 'integer', minimum: 1, maximum: 10080 },
        clockTime: { type: 'string', minLength: 5, maxLength: 5, description: 'PC-local 24-hour time in HH:MM format.' },
        daysOfWeek: { type: 'array', minItems: 1, maxItems: 7, uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Allowed local weekdays: 0=Sunday through 6=Saturday.' },
      }, ['action']),
      ...(this.manageWatch ? [functionSpec('web_watch', 'List, add, or remove public HTTP(S) page watches. Checks run while Little Bot is open; changes appear in chat.', {
        action: { type: 'string', enum: ['list', 'add', 'remove'] }, id: text(100), url: text(2000), label: text(80),
        intervalHours: { type: 'integer', minimum: 6, maximum: 168 },
      }, ['action'])] : []),
      ...(this.proposeLaunch ? [functionSpec('launch_propose', 'Offer to launch an installed Steam game; it starts only if the user clicks. Get appid with games_list.', {
        appid: text(12), note: { type: 'string', maxLength: 600 },
      }, ['appid'])] : []),
      ...(this.phoneAction ? [functionSpec('phone_action', 'Act on the user\'s paired Android phone (Little Bot app): set an alarm at hour:minute phone time, start a timer, ring the phone loudly so they can find it, or show a navigation route. Use only when the user asks for it in this conversation.', {
        action: { type: 'string', enum: ['alarm', 'timer', 'ring', 'navigate'] },
        hour: { type: 'integer', minimum: 0, maximum: 23 }, minute: { type: 'integer', minimum: 0, maximum: 59 },
        minutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Timer length.' },
        label: text(80), destination: text(200),
      }, ['action'])] : []),
      ...(this.manageFollowup ? [functionSpec('followup_manage', 'Create, list, or cancel a one-time Heartbeat check-in. It is for your own follow-up, not a reminder to others; requires Wild initiative.', {
        action: { type: 'string', enum: ['create', 'list', 'cancel'] }, id: text(100), note: text(300),
        inMinutes: { type: 'integer', minimum: 5, maximum: 43200, description: 'Minutes from now. Use this or atLocal.' },
        atLocal: { type: 'string', minLength: 16, maxLength: 16, description: 'PC-local YYYY-MM-DDTHH:MM.' },
      }, ['action'])] : []),
      ...(this.manageIntention ? [functionSpec('intention_manage', 'Create a future follow-up (when asked or useful), list, mark done after raising it, or cancel. Triggers: next chat, 1�4 topic keywords, local date, or moment. Offered at most daily, three times, then expires.', {
        action: { type: 'string', enum: ['list', 'create', 'done', 'cancel'] }, id: text(100), text: text(300), why: text(300),
        trigger: { type: 'string', enum: ['next_chat', 'topic', 'date', 'moment'] }, keywords: { type: 'array', maxItems: 6, items: text(40) },
        date: { type: 'string', minLength: 10, maxLength: 10, description: 'Local YYYY-MM-DD for a date trigger.' }, moment: { type: 'string', enum: ['returned', 'home', 'out'] },
      }, ['action'])] : []),
      functionSpec('calendar_manage', 'Manage Little Bot’s local calendar in the PC’s local time: list events, create an event, update an existing event, or delete one. This calendar is stored only in Little Bot and is not synced to Google, Outlook, or another provider.', {
        action: { type: 'string', enum: calendarActions },
        id: text(100),
        title: text(120),
        startLocal: { type: 'string', minLength: 10, maxLength: 16, description: 'Local YYYY-MM-DD for all-day events or YYYY-MM-DDTHH:MM for timed events.' },
        endLocal: { type: 'string', minLength: 10, maxLength: 16, description: 'Optional local end using the same format as startLocal.' },
        allDay: { type: 'boolean' },
        location: { type: 'string', maxLength: 300 },
        notes: { type: 'string', maxLength: 4000 },
        fromLocal: { type: 'string', minLength: 10, maxLength: 16 },
        toLocal: { type: 'string', minLength: 10, maxLength: 16 },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      }, ['action']),
    ];
  }
  quickBlocked(name) {
    return QUICK_BLOCKED.has(name) || recallSpecs().some(tool => tool.name === name) || Boolean(this.management?.specs().some(tool => tool.name === name));
  }
  _skills() {
    const extensions = this.store.data.extensions || {};
    return (extensions.skills || []).filter(skill => skill.enabled && (!skill.pluginId || (extensions.plugins || []).some(plugin => plugin.id === skill.pluginId && plugin.enabled)));
  }
  async call(name, args, options = {}) {
    const chat = options.chat;
    const specs = this.specs({ quick: Boolean(chat?.private) });
    const spec = specs.find(tool => tool.name === name);
    if (!spec) {
      const suggestion = specs.map(tool => [tool.name, distance(String(name || ''), tool.name)]).sort((a, b) => a[1] - b[1])[0];
      if (suggestion && suggestion[1] <= Math.max(2, String(name || '').length / 3)) throw new Error(`Unknown tool "${name}"; use ${suggestion[0]} instead. Corrected example: ${suggestion[0]}({}).`);
      throw new Error(`Unknown tool "${name}". Corrected example: ${specs[0]?.name || 'skill_list'}({}).`);
    }
    const local = chat?.connection === 'local';
    const rawArgs = args;
    let normalized = local ? normalizeObject(args, spec.inputSchema) : args;
    if (local && object(rawArgs) && object(normalized)) {
      const lesson = normalizationLesson(name, rawArgs, normalized, spec.inputSchema);
      if (lesson) this.onLesson(chat.model, ...lesson);
    }
    if (!object(normalized)) throw new Error(`Arguments for ${name} must be an object; example: ${name}({}).`);
    if (name === 'attachment_send' && typeof normalized.path === 'string') {
      const path = require('node:path');
      normalized.path = path.resolve(chat?.workspace || process.cwd(), normalized.path.replace(/^~(?=$|[\\/])/, require('node:os').homedir()));
    }
    try {
      const required = spec.inputSchema?.required || [];
      const missing = required.filter(key => normalized[key] === undefined);
      if (missing.length) throw new Error(`Missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
      if (spec.inputSchema?.additionalProperties === false && name !== 'memory_save') {
        const extra = Object.keys(normalized).filter(key => !Object.hasOwn(spec.inputSchema.properties || {}, key));
        if (extra.length) { for (const key of extra) delete normalized[key]; throw new Error(`Unsupported argument${extra.length > 1 ? 's' : ''}: ${extra.join(', ')}.`); }
      }
      const value = await this._dispatch(name, normalized, options);
      if (value && Array.isArray(value.results) && !value.results.length && name === 'memory_search') value.message = 'No matching memory records found.';
      const encoded = JSON.stringify(value ?? { ok: true });
      if (encoded.length > 24000) return { truncated: true, content: `${encoded.slice(0, 11500)}\n[... tool output trimmed ...]\n${encoded.slice(-11500)}` };
      return value;
    }
    catch (error) {
      let message = String(error?.message || 'Tool call failed.').split(/[\r\n]/)[0].slice(0, 260);
      const actionSchema = spec.inputSchema?.properties?.action;
      if (local && /unsupported .*action|invalid .*action|unknown app action/i.test(message) && actionSchema?.enum && normalized.action) {
        const closest = actionSchema.enum.map(value => [value, distance(String(normalized.action).toLowerCase(), value.toLowerCase())]).sort((a, b) => a[1] - b[1])[0];
        if (closest && closest[1] <= 3) { message = `Unknown action "${normalized.action}"; use "${closest[0]}".`; normalized.action = closest[0]; }
      }
      const exampleArgs = correctedArgs(spec.inputSchema || {}, normalized);
      if (/name and objective or prompt are required/i.test(message)) { exampleArgs.name ||= '<name>'; if (name === 'schedule_manage') exampleArgs.prompt ||= '<prompt>'; else exampleArgs.objective ||= '<objective>'; }
      if (/title and start time/i.test(message)) { exampleArgs.title ||= '<title>'; exampleArgs.startLocal ||= '2026-01-01'; }
      if (/existing record ID is required|existing calendar event ID is required/i.test(message)) exampleArgs.id ||= '<id>';
      const example = JSON.stringify(exampleArgs).slice(0, 220);
      throw new Error(`${message} Corrected example: ${name}(${example}).`);
    }
  }
  async _dispatch(name, args, { chat } = {}) {
    if (!object(args) || JSON.stringify(args).length > 50000) throw new Error('Tool arguments must be a bounded object.');
    if (chat?.private && this.quickBlocked(name)) throw new Error('This tool is off in the Quick session.');
    if (this.management?.specs().some(tool => tool.name === name)) return this.management.call(name,args,{chat});
    if (name === 'memory_search') {
      await this.store.memoryService?.prepareQuery(args.query || '');
      return recallSearch(this.store, args, { chat });
    }
    if (name === 'session_read') return recallRead(this.store, args, { chat });
    if (name === 'memory_save' || name === 'memory_forget') {
      const service = this.store.memoryService;
      if (!service || this.store.data.memory?.enabled === false) throw new Error('Memory is off.');
      if (!chat) throw new Error('Memory writing needs a conversation or active task.');
      if (name === 'memory_forget') {
        if (Object.keys(args).some(key => key !== 'id')) throw new Error('Forget accepts only a memory ID.');
        const forgotten = service.forget(string(args.id, 'memory ID', 200, true));
        this.store.save(); return { forgotten };
      }
      // Small models add stray fields (an "action" copied from other tools, an empty id). Keep the save; drop the extras.
      const fields = {};
      const ignored = [];
      for (const [key, value] of Object.entries(args)) {
        if (!['id', 'text', 'type', 'scope', 'key', 'pinned'].includes(key)) ignored.push(key);
        else if (value !== null && value !== '' && !(key === 'pinned' && typeof value !== 'boolean')) fields[key] = value;
      }
      const message = [...(chat.messages || [])].reverse().find(item => item.role === 'user');
      const record = service.save({ ...fields, text: string(args.text, 'memory text', 20000, true),
        workspace: chat.workspace, source: { sessionId: chat.id, messageId: message?.id, messageIds: message?.id ? [message.id] : [], origin: 'remember' } });
      this.store.save(); return ignored.length ? { record, ignoredFields: ignored } : { record };
    }
    if (name === 'attachment_send') {
      if (!this.sendAttachment || !chat || chat.internal || chat.automationId || chat.status !== 'running') throw new Error('Attachments can be sent only in an active user conversation.');
      if (Object.keys(args).some(key => !['path', 'caption'].includes(key)) || typeof args.path !== 'string' || !args.path.trim() || args.path.length > 2000 || args.path.includes('\0') || (args.caption !== undefined && (typeof args.caption !== 'string' || args.caption.length > 1000))) throw new Error('Choose a file path and an optional short caption.');
      return this.sendAttachment(args, chat);
    }
    if (name === 'windows_ui') {
      // Other apps' windows are driven only from the user's own running conversation, never from goals, heartbeat or automations.
      if (!this.windowsUi || !chat || chat.internal || chat.automationId || chat.status !== 'running') throw new Error('Controlling Windows apps needs an active user conversation.');
      return this.windowsUi.tool(args, { chat, owner: chat.id, isActive: () => chat.status === 'running' });
    }
    if (this.desktop?.owns(name)) {
      // The screen and clipboard are looked at only for the user's own running conversation, never by background work.
      if (!chat || (this.desktop.observes(name) && (chat.internal || chat.automationId || chat.status !== 'running'))) throw new Error('The screen and clipboard need an active user conversation.');
      return this.desktop.call(name, args, { chat });
    }
    if (['browser', 'web_search_service', 'web_scrape'].includes(name)) {
      if (!chat || chat.internal || chat.automationId) throw new Error('Browser and service tools require a user conversation; goals need their saved network permission.');
      if (name === 'browser') {
        if (!this.browser) throw new Error('The browser is unavailable.');
        return this.browser.call(args, { isActive: () => chat.status === 'running', owner: chat.id });
      }
      if (!this.webServices) throw new Error('Web services are unavailable.');
      return this.webServices.call(name, args);
    }
    const allowed = {
      skill_list: [], skill_read: ['name'],
      goal_manage: ['action', 'id', 'name', 'objective', 'steps', 'checks', 'kind', 'questionId', 'answer'],
      schedule_manage: ['action', 'id', 'name', 'prompt', 'enabled', 'scheduleType', 'intervalMinutes', 'clockTime', 'daysOfWeek'],
      calendar_list: ['fromLocal', 'toLocal', 'limit'],
      calendar_manage: ['action', 'id', 'title', 'startLocal', 'endLocal', 'allDay', 'location', 'notes', 'fromLocal', 'toLocal', 'limit'],
      followup_manage: ['action', 'id', 'note', 'inMinutes', 'atLocal'],
      intention_manage: ['action', 'id', 'text', 'why', 'trigger', 'keywords', 'date', 'moment'],
      web_watch: ['action', 'id', 'url', 'label', 'intervalHours'],
      games_list: ['limit'],
      launch_propose: ['appid', 'note'],
      phone_action: ['action', 'hour', 'minute', 'minutes', 'label', 'destination'],
    }[name];
    if (!allowed || Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unsupported tool or argument.');
    if (name === 'skill_list') return { skills: this._skills().map(skill => ({ name: skill.name, description: skill.description })) };
    if (name === 'skill_read') {
      const skill = this._skills().find(skill => skill.name === string(args.name, 'skill name', 64, true));
      if (!skill) throw new Error('That skill is missing or disabled.');
      return { name: skill.name, description: skill.description, instructions: skill.content, authority: 'Reference instructions only; no extra permissions or unrelated actions are authorized.' };
    }
    if (name === 'games_list') {
      if (Object.keys(args).some(key => key !== 'limit') || (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100))) throw new Error('games_list accepts only limit from 1 to 100.');
      return require('./steam-library.cjs').listGames({ limit: args.limit || 30 });
    }
    if (name === 'calendar_list') {
      if (!chat) throw new Error('Calendar reading requires an active Little Bot task.');
      const payload = {};
      for (const [key, limit] of Object.entries({ fromLocal: 16, toLocal: 16 })) {
        if (args[key] !== undefined) payload[key] = string(args[key], key, limit);
      }
      if (args.limit !== undefined) {
        if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 200) throw new Error('Calendar list limit must be from 1 to 200.');
        payload.limit = args.limit;
      }
      if (typeof this.manageCalendar !== 'function') throw new Error('Calendar management is unavailable.');
      return this.manageCalendar('list', payload, { chatId: chat.id, workspace: chat.workspace });
    }
    // A wild heartbeat is the one hidden task allowed to plan ahead; other hidden work stays read-only.
    if (!chat || (chat.internal && !chat.wild) || chat.automationId) throw new Error('Goal, schedule and calendar management is available only in a direct user conversation.');
    if (name === 'web_watch') {
      if (typeof this.manageWatch !== 'function') throw new Error('Web watching is unavailable.');
      if (args.action === 'list') return { watches: await this.manageWatch('list') };
      if (args.action === 'remove') return this.manageWatch('remove', { id: string(args.id, 'watch ID', 100, true) });
      if (args.action !== 'add') throw new Error('Unsupported web watch action.');
      return this.manageWatch('add', { url: string(args.url, 'url', 2000, true), label: args.label === undefined ? undefined : string(args.label, 'label', 80), intervalHours: args.intervalHours });
    }
    if (name === 'phone_action') {
      // Only the user's own conversation may ring the phone or set its alarms; never a heartbeat or goal.
      if (chat.internal) throw new Error('Phone actions are available only in a direct user conversation.');
      if (typeof this.phoneAction !== 'function') throw new Error('Phone actions are unavailable.');
      return this.phoneAction(args);
    }
    if (name === 'launch_propose') {
      if (typeof this.proposeLaunch !== 'function') throw new Error('Game launch offers are unavailable.');
      return this.proposeLaunch({ appid: string(args.appid, 'appid', 12, true), note: args.note === undefined ? '' : string(args.note, 'note', 600) });
    }
    if (name === 'intention_manage') {
      if (typeof this.manageIntention !== 'function') throw new Error('Intentions are unavailable.');
      if (args.action === 'list') return { intentions: await this.manageIntention('list') };
      if (args.action === 'done' || args.action === 'cancel') return this.manageIntention(args.action, { id: string(args.id, 'intention ID', 100, true) });
      if (args.action !== 'create') throw new Error('Unsupported intention action.');
      if (args.keywords !== undefined && (!Array.isArray(args.keywords) || args.keywords.some(item => typeof item !== 'string'))) throw new Error('keywords must be a list of words.');
      return this.manageIntention('create', { text: string(args.text, 'text', 300, true), why: args.why === undefined ? '' : string(args.why, 'why', 300),
        trigger: { type: args.trigger || 'next_chat', keywords: args.keywords, date: args.date, moment: args.moment }, source: chat.internal ? 'heartbeat' : 'chat' });
    }
    if (name === 'followup_manage') {
      if (typeof this.manageFollowup !== 'function') throw new Error('Follow-ups are unavailable.');
      if (args.action === 'list') return { followups: await this.manageFollowup('list') };
      if (args.action === 'cancel') return this.manageFollowup('cancel', { id: string(args.id, 'follow-up ID', 100, true) });
      if (args.action !== 'create') throw new Error('Unsupported follow-up action.');
      let at;
      if (args.inMinutes !== undefined) {
        if (!Number.isInteger(args.inMinutes) || args.inMinutes < 5 || args.inMinutes > 43200) throw new Error('inMinutes must be from 5 to 43200.');
        at = Date.now() + args.inMinutes * 60000;
      } else {
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(string(args.atLocal, 'atLocal', 16, true));
        if (!match) throw new Error('Use inMinutes, or atLocal as YYYY-MM-DDTHH:MM.');
        at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])).getTime();
      }
      const followup = await this.manageFollowup('create', { at, note: string(args.note, 'note', 300, true) });
      return { followup, localTime: new Date(followup.at).toString() };
    }
    if (name === 'calendar_manage') {
      if (!calendarActions.includes(args.action)) throw new Error('Unsupported calendar action.');
      const payload = {};
      for (const [key, limit] of Object.entries({ id: 100, title: 120, startLocal: 16, fromLocal: 16, toLocal: 16 })) {
        if (args[key] !== undefined) payload[key] = string(args[key], key, limit);
      }
      for (const [key, limit] of Object.entries({ endLocal: 16, location: 300, notes: 4000 })) {
        if (args[key] === undefined) continue;
        if (typeof args[key] !== 'string' || args[key].length > limit || args[key].includes('\0')) throw new Error(`Invalid ${key}.`);
        payload[key] = args[key].trim();
      }
      if (args.allDay !== undefined) {
        if (typeof args.allDay !== 'boolean') throw new Error('allDay must be true or false.');
        payload.allDay = args.allDay;
      }
      if (args.limit !== undefined) {
        if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 200) throw new Error('Calendar list limit must be from 1 to 200.');
        payload.limit = args.limit;
      }
      if (args.action === 'create' && (!payload.title || !payload.startLocal)) throw new Error('Calendar events need a title and start time.');
      if (['update', 'delete'].includes(args.action) && !payload.id) throw new Error('An existing calendar event ID is required.');
      if (args.action === 'delete' && Object.keys(payload).some(key => key !== 'id')) throw new Error('Delete accepts only the calendar event ID.');
      if (args.action === 'list' && Object.keys(payload).some(key => !['fromLocal', 'toLocal', 'limit'].includes(key))) throw new Error('List accepts only a date range and limit.');
      if (typeof this.manageCalendar !== 'function') throw new Error('Calendar management is unavailable.');
      const currentUserRequest = [...(chat.messages || [])].reverse().find(message => message.role === 'user')?.text || '';
      return this.manageCalendar(args.action, payload, { chatId: chat.id, workspace: chat.workspace, currentUserRequest });
    }
    if (!actions.includes(args.action) && !(name === 'goal_manage' && args.action === 'answer')) throw new Error('Unsupported management action.');
    const payload = {};
    const limits = name === 'goal_manage' ? { id: 100, name: 80, objective: 12000, questionId: 100, answer: 2000 } : { id: 100, name: 80, prompt: 32000 };
    for (const [key, limit] of Object.entries(limits)) if (args[key] !== undefined) payload[key] = string(args[key], key, limit);
    if (args.kind !== undefined) { if (name !== 'goal_manage' || !['task', 'ongoing'].includes(args.kind)) throw new Error('Choose Task or Ongoing.'); payload.kind = args.kind; }
    if (['update', 'pause', 'resume', 'answer'].includes(args.action) && !payload.id) throw new Error('An existing record ID is required.');
    if (args.action === 'create' && (!payload.name || !(payload.objective || payload.prompt))) throw new Error('A name and objective or prompt are required.');
    if (args.steps !== undefined) {
      if (!Array.isArray(args.steps) || args.steps.length > 20) throw new Error('Use at most 20 steps.');
      payload.steps = args.steps.map(step => string(step, 'step', 1000, true));
    }
    if (args.checks !== undefined) {
      if (!Array.isArray(args.checks) || args.checks.length > 20) throw new Error('Use at most 20 checks.');
      payload.checks = args.checks.map(check => {
        if (!object(check) || Object.keys(check).some(key => !['type', 'path', 'contains', 'command'].includes(key)) || !['fileExists', 'fileContains', 'command'].includes(check.type)) throw new Error('Invalid completion check.');
        return check.type === 'command' ? { type: check.type, command: string(check.command, 'check command', 4000, true) }
          : { type: check.type, path: string(check.path, 'check path', 500, true), ...(check.type === 'fileContains' ? { contains: string(check.contains, 'check text', 4000, true) } : {}) };
      });
    }
    if (args.enabled !== undefined) {
      if (typeof args.enabled !== 'boolean') throw new Error('Enabled must be true or false.');
      payload.enabled = args.enabled;
    }
    if (args.scheduleType !== undefined) {
      if (!['interval', 'clock'].includes(args.scheduleType)) throw new Error('Invalid schedule type.');
      payload.scheduleType = args.scheduleType;
    }
    if (args.intervalMinutes !== undefined) {
      if (!Number.isInteger(args.intervalMinutes) || args.intervalMinutes < 1 || args.intervalMinutes > 10080) throw new Error('Invalid schedule interval.');
      payload.intervalMinutes = args.intervalMinutes;
      if (payload.scheduleType === undefined) payload.scheduleType = 'interval';
    }
    if (args.clockTime !== undefined) {
      if (typeof args.clockTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(args.clockTime)) throw new Error('Invalid exact schedule time.');
      payload.clockTime = args.clockTime;
      if (payload.scheduleType === undefined) payload.scheduleType = 'clock';
    }
    if (args.daysOfWeek !== undefined) {
      if (!Array.isArray(args.daysOfWeek) || !args.daysOfWeek.length || args.daysOfWeek.length > 7
        || args.daysOfWeek.some(day => !Number.isInteger(day) || day < 0 || day > 6)
        || new Set(args.daysOfWeek).size !== args.daysOfWeek.length) throw new Error('Invalid schedule weekdays.');
      payload.daysOfWeek = [...args.daysOfWeek];
    }
    if (['list', 'pause', 'resume'].includes(args.action) && Object.keys(payload).some(key => key !== 'id')) throw new Error('This action cannot also change record settings.');
    const callback = name === 'goal_manage' ? this.manageGoal : this.manageSchedule;
    if (typeof callback !== 'function') throw new Error('This management feature is unavailable.');
    const currentUserRequest = [...(chat.messages || [])].reverse().find(message => message.role === 'user')?.text || '';
    return callback(args.action, payload, { chatId: chat.id, workspace: chat.workspace, currentUserRequest });
  }
}

module.exports = { AgentTools };
