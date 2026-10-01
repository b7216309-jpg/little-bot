'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalizeMemory, attachMemoryService, sync: syncMemory } = require('./memory.cjs');
const { MemoryService } = require('./memory-service.cjs');
const { normalizeHeartbeat } = require('./heartbeat.cjs');
const { normalizeExtensions } = require('./extensions.cjs');
const { normalizeAutonomy } = require('./goals.cjs');
const { normalizeAutoCompactPercent } = require('./compaction.cjs');
const { normalizeCalendar } = require('./calendar.cjs');
const { attachmentDescriptors } = require('./attachment-message.cjs');
const { normalizeConnectionSettings, connectionBinding } = require('./connections.cjs');
const { normalizeIndependentCheckMode, normalizeIndependentCheckRecord } = require('./independent-check.cjs');
const { normalizeStandingIntents } = require('./standing-intents.cjs');

const INTERRUPTED = 'Interrupted because Little Bot closed before the task finished.';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const timestamp = (value, fallback) => Number.isFinite(value) ? value : fallback;
const effort = value => ['low', 'medium', 'high'].includes(value) ? value : 'low';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const clockTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '09:00';
const scheduleDays = value => {
  if (!Array.isArray(value)) return [0, 1, 2, 3, 4, 5, 6];
  const days = [...new Set(value.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  return days.length ? days : [0, 1, 2, 3, 4, 5, 6];
};

const PROTECTED_STATE_VERSION = 1;

function validProtector(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || typeof value.encryptString !== 'function' || typeof value.decryptString !== 'function') {
    throw new TypeError('Store protector must provide encryptString and decryptString.');
  }
  return value;
}

function protectedEnvelope(data, protector) {
  const normalized = data;
  if (!protector) return normalized;
  const payload = JSON.stringify({ chats: normalized.chats, memory: normalized.memory });
  const encrypted = protector.encryptString(payload);
  if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error('Could not encrypt saved conversations.');
  const disk = { ...normalized };
  delete disk.chats;
  delete disk.memory;
  disk.protected = {
    version: PROTECTED_STATE_VERSION,
    format: 'safeStorage',
    data: encrypted.toString('base64'),
  };
  return disk;
}

function unprotectState(parsed, protector) {
  if (parsed.protected === undefined) return parsed;
  const envelope = parsed.protected;
  if (!protector) throw new Error('Saved conversations are encrypted and secure storage is unavailable.');
  if (!isObject(envelope) || envelope.version !== PROTECTED_STATE_VERSION || envelope.format !== 'safeStorage'
    || typeof envelope.data !== 'string' || !envelope.data
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.data)) throw new Error('Encrypted app state has an invalid format.');
  let sensitive;
  try {
    sensitive = JSON.parse(protector.decryptString(Buffer.from(envelope.data, 'base64')));
  } catch {
    throw new Error('Saved conversations could not be decrypted with this Windows account.');
  }
  if (!isObject(sensitive) || !Array.isArray(sensitive.chats) || !isObject(sensitive.memory)) {
    throw new Error('Decrypted app state has an invalid format.');
  }
  const result = { ...parsed, chats: sensitive.chats, memory: sensitive.memory };
  delete result.protected;
  return result;
}

function persistedData(data, defaultWorkspace, recovering = false) {
  const rawSettings = isObject(data.settings) ? data.settings : {};
  const settings = { ...rawSettings, ...normalizeConnectionSettings(rawSettings) };
  const chats = Array.isArray(data.chats) ? data.chats : [];
  const automations = Array.isArray(data.automations) ? data.automations : [];
  return {
    autonomy: normalizeAutonomy(data.autonomy, { ...settings, workspace: string(settings.workspace, defaultWorkspace) }, recovering),
    standingIntents: normalizeStandingIntents(data.standingIntents, Date.now(), recovering),
    extensions: normalizeExtensions(data.extensions),
    memory: normalizeMemory(data.memory),
    calendar: normalizeCalendar(data.calendar),
    heartbeat: normalizeHeartbeat(data.heartbeat, { ...settings, workspace: string(settings.workspace, defaultWorkspace) }, Date.now(), recovering),
    settings: {
      ...normalizeConnectionSettings(settings),
      workspace: string(settings.workspace, defaultWorkspace),
      model: string(settings.model),
      effort: effort(settings.effort),
      autoCompactPercent: normalizeAutoCompactPercent(settings.autoCompactPercent),
      independentCheckMode: normalizeIndependentCheckMode(settings.independentCheckMode),
      ...(typeof settings.systemPrompt === 'string' ? { systemPrompt: settings.systemPrompt.slice(0, 100000) } : {}),
    },
    chats: chats.filter(isObject).filter(chat => chat.private !== true).slice(0, 1).map(chat => {
      const result = {
        id: string(chat.id) || randomUUID(),
        title: string(chat.title, 'New chat'),
        threadId: string(chat.threadId),
        lastTurnRequestId: string(chat.lastTurnRequestId),
        workspace: string(chat.workspace, defaultWorkspace),
        model: string(chat.model),
        ...connectionBinding(chat),
        createdAt: timestamp(chat.createdAt, Date.now()),
        updatedAt: timestamp(chat.updatedAt, timestamp(chat.createdAt, Date.now())),
        mode: (recovering && chat.automationPreviousMode ? chat.automationPreviousMode : chat.mode) === 'plan' ? 'plan' : 'execute',
        toolMode: chat.toolMode === 'readOnly' ? 'readOnly' : 'full',
        toolSchema: string(chat.toolSchema),
        status: ['running', 'waiting'].includes(chat.status) ? chat.status : 'idle',
        messages: (Array.isArray(chat.messages) ? chat.messages : []).filter(isObject).map(message => {
          const entry = {
            id: string(message.id) || randomUUID(),
            role: ['user', 'assistant', 'tool'].includes(message.role) ? message.role : 'tool',
            text: string(message.text),
          };
          const attachments = attachmentDescriptors(message.attachments);
          if (attachments.length) entry.attachments = attachments;
          for (const key of ['kind', 'status', 'phase', 'workspace', 'model', 'connection', 'automationId', 'automationName', 'goalId', 'goalName', 'goalRunId', 'goalQuestionId', 'heartbeatId', 'heartbeatTopic']) {
            if (typeof message[key] === 'string') entry[key] = message[key];
          }
          if (recovering && ['running', 'waiting', 'inProgress'].includes(entry.status)) {
            entry.status = 'interrupted';
          }
          for (const key of ['createdAt', 'updatedAt']) {
            if (Number.isFinite(message[key])) entry[key] = message[key];
          }
          const independentCheck = normalizeIndependentCheckRecord(message.independentCheck);
          if (independentCheck) {
            if (recovering && independentCheck.status === 'running') {
              independentCheck.status = 'interrupted';
              independentCheck.error = 'Independent Check was interrupted when Little Bot closed.';
              independentCheck.checkedAt = Date.now();
            }
            entry.independentCheck = independentCheck;
          }
          return entry;
        }),
      };
      if (typeof chat.error === 'string') result.error = chat.error;
      if (!recovering && typeof chat.automationId === 'string') {
        result.automationId = chat.automationId;
        if (typeof chat.automationName === 'string') result.automationName = chat.automationName;
        if (['plan', 'execute'].includes(chat.automationPreviousMode)) result.automationPreviousMode = chat.automationPreviousMode;
      }
      if (typeof chat.effort === 'string') result.effort = effort(chat.effort);
      if (isObject(chat.lastTask)) {
        const status = ['completed', 'failed', 'interrupted'].includes(chat.lastTask.status) ? chat.lastTask.status : 'completed';
        result.lastTask = {
          startedAt: timestamp(chat.lastTask.startedAt, null),
          finishedAt: timestamp(chat.lastTask.finishedAt, null),
          durationMs: count(chat.lastTask.durationMs),
          actions: count(chat.lastTask.actions),
          commands: count(chat.lastTask.commands),
          files: count(chat.lastTask.files),
          searches: count(chat.lastTask.searches),
          mcp: count(chat.lastTask.mcp),
          agentTools: count(chat.lastTask.agentTools),
          status,
        };
      }
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
      const scheduleType = automation.scheduleType === 'clock' ? 'clock' : 'interval';
      const intervalMinutes = Number.isInteger(automation.intervalMinutes)
        && automation.intervalMinutes >= 1 && automation.intervalMinutes <= 10080
        ? automation.intervalMinutes : 60;
      const result = {
        id: string(automation.id) || randomUUID(),
        name: string(automation.name, 'Automation'),
        prompt: string(automation.prompt),
        scheduleType,
        ...(scheduleType === 'clock'
          ? { clockTime: clockTime(automation.clockTime), daysOfWeek: scheduleDays(automation.daysOfWeek) }
          : { intervalMinutes }),
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
  constructor({ filePath, defaultWorkspace, protector = null }) {
    if (typeof filePath !== 'string' || !filePath) throw new TypeError('A state file path is required.');
    this.filePath = path.resolve(filePath);
    this.defaultWorkspace = string(defaultWorkspace, process.cwd());
    this.protector = validProtector(protector);
    this.warning = null;
    this.recoveryPath = null;
    this.locked = false;
    this._needsRecoveryCopy = false;
    this.data = persistedData({}, this.defaultWorkspace);
    let encryptedSource = false;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, ''));
      encryptedSource = parsed?.protected !== undefined;
      if (!isObject(parsed)) throw new Error('The state root must be a JSON object.');
      const source = unprotectState(parsed, this.protector);
      this.data = persistedData(source, this.defaultWorkspace, true);
      const invalidShape = (source.settings !== undefined && !isObject(source.settings))
        || (source.autonomy !== undefined && (!isObject(source.autonomy)
          || !Array.isArray(source.autonomy.goals) || source.autonomy.goals.length !== this.data.autonomy.goals.length))
        || (source.standingIntents !== undefined && (!isObject(source.standingIntents) || !Array.isArray(source.standingIntents.intents)))
        || ['chats', 'automations'].some(key => source[key] !== undefined
          && (!Array.isArray(source[key]) || source[key].some(item => !isObject(item))))
        || (Array.isArray(source.chats) && source.chats.some(chat => isObject(chat)
          && chat.messages !== undefined && (!Array.isArray(chat.messages) || chat.messages.some(item => !isObject(item)))));
      if (invalidShape) {
        this._needsRecoveryCopy = true;
        this.warning = 'Some saved app state had an unexpected format. Readable records were recovered; the original file is preserved.';
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.locked = encryptedSource;
        this._needsRecoveryCopy = !encryptedSource;
        this.warning = `Could not read saved app state: ${error.message} The original file is preserved.`;
      }
    }
    this.memoryService = new MemoryService({ filename: path.join(path.dirname(this.filePath), 'memory.sqlite') });
    attachMemoryService(this.data.memory, this.memoryService);
    for (const chat of this.data.chats) this.memoryService.indexChat(chat);
    for (const goal of this.data.autonomy.goals) this.memoryService.indexGoal(goal);
    syncMemory(this.data.memory);
  }

  save() {
    if (this.locked) throw new Error('Encrypted app state is locked. Little Bot will not overwrite it.');
    if (this.memoryService) {
      this.memoryService.enabled = this.data.memory.enabled !== false;
      for (const chat of this.data.chats) this.memoryService.indexChat(chat);
      for (const goal of this.data.autonomy.goals) this.memoryService.indexGoal(goal);
      syncMemory(this.data.memory);
    }
    const normalized = persistedData(this.data, this.defaultWorkspace);
    const serialized = `${JSON.stringify(protectedEnvelope(normalized, this.protector), null, 2)}\n`;
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

  close() {
    if (this.closed) return;
    this.closed = true;
    this.memoryService?.close();
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

module.exports = { Store, PROTECTED_STATE_VERSION };
