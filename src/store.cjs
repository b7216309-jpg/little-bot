'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalizeMemory } = require('./memory.cjs');
const { normalizeHeartbeat } = require('./heartbeat.cjs');
const { normalizeExtensions } = require('./extensions.cjs');
const { normalizeAutonomy } = require('./goals.cjs');
const { normalizeAutoCompactPercent } = require('./compaction.cjs');
const { attachmentDescriptors } = require('./attachment-message.cjs');
const { normalizeConnectionSettings, connectionBinding } = require('./connections.cjs');

const INTERRUPTED = 'Interrupted because Little Bot closed before the task finished.';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const timestamp = (value, fallback) => Number.isFinite(value) ? value : fallback;
const effort = value => ['low', 'medium', 'high'].includes(value) ? value : 'low';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function persistedData(data, defaultWorkspace, recovering = false) {
  const rawSettings = isObject(data.settings) ? data.settings : {};
  const settings = { ...rawSettings, ...normalizeConnectionSettings(rawSettings) };
  const chats = Array.isArray(data.chats) ? data.chats : [];
  const automations = Array.isArray(data.automations) ? data.automations : [];
  return {
    autonomy: normalizeAutonomy(data.autonomy, { ...settings, workspace: string(settings.workspace, defaultWorkspace) }, recovering),
    extensions: normalizeExtensions(data.extensions),
    memory: normalizeMemory(data.memory),
    heartbeat: normalizeHeartbeat(data.heartbeat, { ...settings, workspace: string(settings.workspace, defaultWorkspace) }, Date.now(), recovering),
    settings: {
      ...normalizeConnectionSettings(settings),
      workspace: string(settings.workspace, defaultWorkspace),
      model: string(settings.model),
      effort: effort(settings.effort),
      autoCompactPercent: normalizeAutoCompactPercent(settings.autoCompactPercent),
      ...(typeof settings.systemPrompt === 'string' ? { systemPrompt: settings.systemPrompt.slice(0, 100000) } : {}),
    },
    chats: chats.filter(isObject).map(chat => {
      const result = {
        id: string(chat.id) || randomUUID(),
        title: string(chat.title, 'New chat'),
        threadId: string(chat.threadId),
        workspace: string(chat.workspace, defaultWorkspace),
        model: string(chat.model),
        ...connectionBinding(chat),
        createdAt: timestamp(chat.createdAt, Date.now()),
        updatedAt: timestamp(chat.updatedAt, timestamp(chat.createdAt, Date.now())),
        status: ['running', 'waiting'].includes(chat.status) ? chat.status : 'idle',
        messages: (Array.isArray(chat.messages) ? chat.messages : []).filter(isObject).map(message => {
          const entry = {
            id: string(message.id) || randomUUID(),
            role: ['user', 'assistant', 'tool'].includes(message.role) ? message.role : 'tool',
            text: string(message.text),
          };
          const attachments = attachmentDescriptors(message.attachments);
          if (attachments.length) entry.attachments = attachments;
          for (const key of ['kind', 'status', 'phase']) {
            if (typeof message[key] === 'string') entry[key] = message[key];
          }
          if (recovering && ['running', 'waiting', 'inProgress'].includes(entry.status)) {
            entry.status = 'interrupted';
          }
          for (const key of ['createdAt', 'updatedAt']) {
            if (Number.isFinite(message[key])) entry[key] = message[key];
          }
          return entry;
        }),
      };
      if (typeof chat.error === 'string') result.error = chat.error;
      if (typeof chat.automationId === 'string') result.automationId = chat.automationId;
      if (typeof chat.effort === 'string') result.effort = effort(chat.effort);
      if (isObject(chat.context)) {
        result.context = {
          usedTokens: count(chat.context.usedTokens),
          windowTokens: count(chat.context.windowTokens) > 0 ? chat.context.windowTokens : null,
          updatedAt: timestamp(chat.context.updatedAt, null),
          stale: chat.context.stale === true,
        };
      }
      if (isObject(chat.compaction)) {
        result.compaction = {
          status: chat.compaction.status === 'running' ? 'running' : 'idle',
          count: count(chat.compaction.count) || 0,
          lastAt: timestamp(chat.compaction.lastAt, null),
          lastError: typeof chat.compaction.lastError === 'string' ? chat.compaction.lastError.slice(0, 2000) : null,
        };
        if (recovering && result.compaction.status === 'running') {
          result.compaction.status = 'idle';
          result.compaction.lastError = 'Compaction was interrupted when Little Bot closed. You can try again.';
          if (result.context) result.context.stale = true;
        }
      }
      if (recovering && ['running', 'waiting'].includes(result.status)) {
        result.status = 'idle';
        result.error = result.error && !result.error.includes(INTERRUPTED)
          ? `${result.error}\n${INTERRUPTED}` : (result.error || INTERRUPTED);
      }
      return result;
    }),
    automations: automations.filter(isObject).map(automation => {
      const result = {
        id: string(automation.id) || randomUUID(),
        name: string(automation.name, 'Automation'),
        prompt: string(automation.prompt),
        intervalMinutes: Number.isInteger(automation.intervalMinutes)
          && automation.intervalMinutes >= 1 && automation.intervalMinutes <= 10080
          ? automation.intervalMinutes : 60,
        enabled: automation.enabled === true,
        nextRunAt: timestamp(automation.nextRunAt, Date.now() + 60 * 60 * 1000),
        lastRunAt: timestamp(automation.lastRunAt, null),
        lastStatus: ['running', 'completed', 'error'].includes(automation.lastStatus)
          ? automation.lastStatus : 'never',
        workspace: string(automation.workspace, defaultWorkspace),
        model: string(automation.model),
        ...connectionBinding(automation),
        effort: effort(automation.effort),
      };
      if (typeof automation.lastError === 'string') result.lastError = automation.lastError;
      if (typeof automation.authorized === 'boolean') result.authorized = automation.authorized;
      if (recovering && result.lastStatus === 'running') {
        result.lastStatus = 'error';
        result.lastError = INTERRUPTED;
      }
      return result;
    }),
  };
}

class Store {
  constructor({ filePath, defaultWorkspace }) {
    if (typeof filePath !== 'string' || !filePath) throw new TypeError('A state file path is required.');
    this.filePath = path.resolve(filePath);
    this.defaultWorkspace = string(defaultWorkspace, process.cwd());
    this.warning = null;
    this.recoveryPath = null;
    this._needsRecoveryCopy = false;
    this.data = persistedData({}, this.defaultWorkspace);
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, ''));
      if (!isObject(parsed)) throw new Error('The state root must be a JSON object.');
      this.data = persistedData(parsed, this.defaultWorkspace, true);
      const invalidShape = (parsed.settings !== undefined && !isObject(parsed.settings))
        || (parsed.autonomy !== undefined && (!isObject(parsed.autonomy)
          || !Array.isArray(parsed.autonomy.goals) || parsed.autonomy.goals.length !== this.data.autonomy.goals.length))
        || ['chats', 'automations'].some(key => parsed[key] !== undefined
          && (!Array.isArray(parsed[key]) || parsed[key].some(item => !isObject(item))))
        || (Array.isArray(parsed.chats) && parsed.chats.some(chat => isObject(chat)
          && chat.messages !== undefined && (!Array.isArray(chat.messages) || chat.messages.some(item => !isObject(item)))));
      if (invalidShape) {
        this._needsRecoveryCopy = true;
        this.warning = 'Some saved app state had an unexpected format. Readable records were recovered; the original file is preserved.';
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this._needsRecoveryCopy = true;
        this.warning = `Could not read saved app state: ${error.message} The original file is preserved.`;
      }
    }
  }

  save() {
    const serialized = `${JSON.stringify(persistedData(this.data, this.defaultWorkspace), null, 2)}\n`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, serialized, 'utf8');
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      if (this._needsRecoveryCopy && fs.existsSync(this.filePath)) {
        const recoveryPath = `${this.filePath}.corrupt-${Date.now()}-${randomUUID()}`;
        fs.copyFileSync(this.filePath, recoveryPath, fs.constants.COPYFILE_EXCL);
        this.recoveryPath = recoveryPath;
        this._needsRecoveryCopy = false;
        this.warning = `Could not read the previous app state. The original is preserved at ${recoveryPath}.`;
      }
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch { /* It may already have been renamed. */ }
      throw error;
    }
    return this.data;
  }

  flush() {
    return this.save();
  }

  update(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('Store.update needs a synchronous function.');
    const result = mutator(this.data);
    if (result && typeof result.then === 'function') throw new TypeError('Store.update must be synchronous.');
    this.save();
    return result === undefined ? this.data : result;
  }
}

module.exports = { Store };
