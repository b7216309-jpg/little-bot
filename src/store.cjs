'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalizeMemory, attachMemoryService, setPrimaryService, sync: syncMemory } = require('./memory.cjs');
const { MemoryService } = require('./memory-service.cjs');
const { normalizeHeartbeat } = require('./heartbeat.cjs');
const { normalizeExtensions } = require('./extensions.cjs');
const { normalizeAutonomy } = require('./goals.cjs');
const { validAutoCompactPercent } = require('./compaction.cjs');
const { normalizeCalendar } = require('./calendar.cjs');
const { attachmentDescriptors } = require('./attachment-message.cjs');
const { normalizeConnectionSettings, connectionBinding } = require('./connections.cjs');
const { normalizeIndependentCheckMode, normalizeIndependentCheckRecord } = require('./independent-check.cjs');
const { normalizeStandingIntents } = require('./standing-intents.cjs');
const { normalizePending, normalizeActions, normalizeAnswer, normalizeFeedbackLog, normalizeMemories } = require('./proactive-chat.cjs');
const { normalizeWatches } = require('./web-watch.cjs');
const { normalizeSampling } = require('./local-generation.cjs');
const { normalizeCompanion } = require('./companion.cjs');
const { normalizeNightShift } = require('./night-shift.cjs');
const { normalizeChatGoal } = require('./chat-goal.cjs');
const { normalizeLessons } = require('./lessons.cjs');
const { MAX_SESSIONS, TITLE_LIMIT } = require('./chats.cjs');
const { normalizeUsage } = require('./usage-ledger.cjs');
const { normalizeSecurity } = require('./security.cjs');
const { normalizeInjectedPrompts } = require('./injected-prompts.cjs');

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

// The CAD workshop's open part and its check limits.
function normalizeCad(value) {
  if (!isObject(value)) return {};
  const result = {};
  if (typeof value.current === 'string' && value.current.length < 1000) result.current = value.current;
  if (isObject(value.limits)) {
    const limits = {};
    for (const [key, low, high] of [['minWall', 0.1, 20], ['minHole', 0.1, 50], ['overhangAngle', 10, 80], ['minClearance', 0.05, 5]]) {
      if (Number.isFinite(value.limits[key]) && value.limits[key] >= low && value.limits[key] <= high) limits[key] = value.limits[key];
    }
    if (typeof value.limits.overhang === 'boolean') limits.overhang = value.limits.overhang;
    result.limits = limits;
  }
  return result;
}

// Draughts games, one per conversation ("main" or a session id), and the board preferences.
function normalizeDraughts(value) {
  if (!isObject(value)) return {};
  const result = { games: {}, prefs: {} };
  const squares = list => Array.isArray(list) && list.every(n => Number.isInteger(n) && n >= 1 && n <= 50);
  const board = list => Array.isArray(list) && list.length === 51 && list.every(n => Number.isInteger(n) && n >= -2 && n <= 2);
  for (const [key, game] of Object.entries(isObject(value.games) ? value.games : {}).slice(0, 12)) {
    if (!/^(?:main|[\w-]{1,128})$/.test(key) || !isObject(game) || !board(game.board) || ![1, -1].includes(game.turn) || ![1, -1].includes(game.userSide)) continue;
    const moves = (Array.isArray(game.moves) ? game.moves : []).filter(move => isObject(move) && Number.isInteger(move.from) && Number.isInteger(move.to)
      && [1, -1].includes(move.side) && squares(move.path) && squares(move.captures) && typeof move.notation === 'string').slice(-400).map(move => ({
      n: Number.isInteger(move.n) ? move.n : 0, side: move.side, by: ['you', 'bot', 'auto'].includes(move.by) ? move.by : 'you', notation: move.notation.slice(0, 80),
      from: move.from, to: move.to, path: move.path, captures: move.captures, crown: move.crown === true, king: move.king === true,
      ...(board(move.before) ? { before: move.before } : {}), at: Number.isFinite(move.at) ? move.at : 0,
    }));
    const positions = {};
    for (const [position, count] of Object.entries(isObject(game.positions) ? game.positions : {}).slice(0, 400)) if (Number.isInteger(count) && count > 0) positions[position.slice(0, 200)] = count;
    result.games[key] = {
      id: typeof game.id === 'string' ? game.id.slice(0, 64) : key, userSide: game.userSide, level: ['easy', 'medium', 'hard'].includes(game.level) ? game.level : 'medium',
      board: game.board, turn: game.turn, moves, positions,
      quietPlies: Number.isInteger(game.quietPlies) && game.quietPlies >= 0 ? game.quietPlies : 0, endgamePlies: Number.isInteger(game.endgamePlies) && game.endgamePlies >= 0 ? game.endgamePlies : 0,
      status: game.status === 'over' ? 'over' : 'playing', winner: [1, -1, 0].includes(game.winner) ? game.winner : null, reason: typeof game.reason === 'string' ? game.reason.slice(0, 120) : null,
      createdAt: Number.isFinite(game.createdAt) ? game.createdAt : 0, updatedAt: Number.isFinite(game.updatedAt) ? game.updatedAt : 0, note: typeof game.note === 'string' ? game.note.slice(0, 300) : null,
    };
  }
  if (isObject(value.prefs)) {
    if (['easy', 'medium', 'hard'].includes(value.prefs.level)) result.prefs.level = value.prefs.level;
    for (const name of ['sound', 'numbers', 'dots']) if (typeof value.prefs[name] === 'boolean') result.prefs[name] = value.prefs[name];
  }
  return result;
}

// Torrents: transfers, settings and the user's sources (a Torznab key only in its sealed form).
function normalizeTorrents(value) {
  if (!isObject(value)) return {};
  const text = (item, max) => typeof item === 'string' ? item.slice(0, max) : '';
  const items = (Array.isArray(value.items) ? value.items : []).filter(item => isObject(item) && /^[a-f\d]{40}$/i.test(item.key || '') && typeof item.torrentPath === 'string' && typeof item.folder === 'string').slice(0, 200).map(item => ({
    key: item.key.toLowerCase(), name: text(item.name, 300) || 'Torrent', length: Number.isFinite(item.length) ? item.length : 0, totalLength: Number.isFinite(item.totalLength) ? item.totalLength : 0,
    files: (Array.isArray(item.files) ? item.files : []).filter(file => isObject(file) && Number.isInteger(file.index) && typeof file.path === 'string').slice(0, 500).map(file => ({ index: file.index, path: file.path.slice(0, 500), length: Number.isFinite(file.length) ? file.length : 0 })),
    fileCount: Number.isInteger(item.fileCount) ? item.fileCount : 0, select: Array.isArray(item.select) ? item.select.filter(Number.isInteger).slice(0, 10000) : null,
    folder: item.folder.slice(0, 1000), torrentPath: item.torrentPath.slice(0, 1000),
    source: isObject(item.source) ? { name: text(item.source.name, 80), page: text(item.source.page, 500) || null } : { name: '', page: null },
    // A transfer that was running carries on after a restart.
    status: ['queued', 'downloading', 'seeding', 'paused', 'finished', 'error'].includes(item.status) ? (item.status === 'downloading' ? 'queued' : item.status) : 'queued',
    ...(item.resumeTo === 'seeding' || item.resumeTo === 'queued' ? { resumeTo: item.resumeTo } : {}),
    progress: Number.isFinite(item.progress) ? Math.min(1, Math.max(0, item.progress)) : 0, uploaded: Number.isFinite(item.uploaded) ? item.uploaded : 0,
    addedAt: Number.isFinite(item.addedAt) ? item.addedAt : 0, doneAt: Number.isFinite(item.doneAt) ? item.doneAt : null, finishedAt: Number.isFinite(item.finishedAt) ? item.finishedAt : null,
    error: text(item.error, 300) || null, risky: item.risky === true,
  }));
  const settings = {};
  const saved = isObject(value.settings) ? value.settings : {};
  if (typeof saved.folder === 'string' && saved.folder.length < 1000) settings.folder = saved.folder;
  for (const name of ['downloadLimit', 'uploadLimit', 'ratio', 'hours', 'maxActive']) if (Number.isFinite(saved[name]) && saved[name] >= 0) settings[name] = saved[name];
  if (['ratio', 'time', 'never'].includes(saved.stopSharing)) settings.stopSharing = saved.stopSharing;
  for (const name of ['upnp', 'magnetLinks', 'pauseForGames']) if (typeof saved[name] === 'boolean') settings[name] = saved[name];
  const sources = isObject(value.sources) ? value.sources : {};
  const builtIn = {};
  for (const id of ['archive', 'academic', 'linux']) if (typeof sources.builtIn?.[id] === 'boolean') builtIn[id] = sources.builtIn[id];
  const custom = (Array.isArray(sources.custom) ? sources.custom : []).filter(source => isObject(source) && typeof source.id === 'string' && /^https?:\/\//i.test(source.url || '') && ['rss', 'torznab'].includes(source.kind)).slice(0, 30)
    .map(source => ({ id: source.id.slice(0, 64), name: text(source.name, 60) || 'Source', kind: source.kind, url: source.url.slice(0, 2000), enabled: source.enabled !== false, ...(typeof source.apiKeySealed === 'string' ? { apiKeySealed: source.apiKeySealed.slice(0, 4000) } : {}) }));
  return { items, settings, sources: { builtIn, custom } };
}

// The sites the user lets through the built-in browser's ad and tracker blocking.
function normalizeBrowserBlocking(value) {
  if (!isObject(value) || !Array.isArray(value.allowed)) return {};
  const allowed = [...new Set(value.allowed.filter(site => typeof site === 'string' && /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d-]{2,63}$/i.test(site)).map(site => site.toLowerCase()))].slice(-500);
  return allowed.length ? { allowed } : {};
}

const PROTECTED_STATE_VERSION = 1;

function validProtector(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || typeof value.encryptString !== 'function' || typeof value.decryptString !== 'function') {
    throw new TypeError('Store protector must provide encryptString and decryptString.');
  }
  return value;
}

// On Windows an antivirus scan or the search indexer can hold state.json for a moment. A save that lands
// then is retried briefly instead of failing whatever was being saved.
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { return fs.renameSync(from, to); }
    catch (error) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
    }
  }
}

function protectedEnvelope(data, protector) {
  const normalized = data;
  if (!protector) return normalized;
  const payload = JSON.stringify({ chats: normalized.chats, memory: normalized.memory, companion: normalized.companion, lessons: normalized.lessons });
  const encrypted = protector.encryptString(payload);
  if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error('Could not encrypt saved conversations.');
  const disk = { ...normalized };
  delete disk.chats;
  delete disk.memory;
  delete disk.companion;
  delete disk.lessons;
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
  const result = { ...parsed, chats: sensitive.chats, memory: sensitive.memory,
    ...(isObject(sensitive.companion) ? { companion: sensitive.companion } : {}),
    ...(isObject(sensitive.lessons) ? { lessons: sensitive.lessons } : {}) };
  delete result.protected;
  return result;
}

// The continuous conversation first, then the saved sessions. The Quick session is never written to disk.
function savedChats(chats) {
  const kept = chats.filter(isObject).filter(chat => chat.private !== true);
  const main = kept.find(chat => chat.session !== true);
  return [...(main ? [main] : []), ...kept.filter(chat => chat.session === true).slice(0, MAX_SESSIONS)];
}

function persistedData(data, defaultWorkspace, recovering = false) {
  const rawSettings = isObject(data.settings) ? data.settings : {};
  const settings = { ...rawSettings, ...normalizeConnectionSettings(rawSettings) };
  const chats = Array.isArray(data.chats) ? data.chats : [];
  const automations = Array.isArray(data.automations) ? data.automations : [];
  return {
    autonomy: normalizeAutonomy(data.autonomy, { ...settings, workspace: string(settings.workspace, defaultWorkspace) }, recovering),
    nightShift: normalizeNightShift(data.nightShift),
    standingIntents: normalizeStandingIntents(data.standingIntents, Date.now(), recovering),
    extensions: normalizeExtensions(data.extensions),
    memory: normalizeMemory(data.memory),
    companion: normalizeCompanion(data.companion),
    lessons: normalizeLessons(data.lessons),
    calendar: normalizeCalendar(data.calendar),
    feedbackLog: normalizeFeedbackLog(data.feedbackLog),
    webWatches: normalizeWatches(data.webWatches),
    cad: normalizeCad(data.cad),
    draughts: normalizeDraughts(data.draughts),
    torrents: normalizeTorrents(data.torrents),
    browserBlocking: normalizeBrowserBlocking(data.browserBlocking),
    usage: normalizeUsage(data.usage),
    heartbeat: normalizeHeartbeat(data.heartbeat, { ...settings, workspace: string(settings.workspace, defaultWorkspace) }, Date.now(), recovering),
    settings: {
      ...normalizeConnectionSettings(settings),
      workspace: string(settings.workspace, defaultWorkspace),
      model: string(settings.model),
      effort: effort(settings.effort),
      autoCompactPercent: validAutoCompactPercent(settings.autoCompactPercent) ? settings.autoCompactPercent : undefined,
      independentCheckMode: normalizeIndependentCheckMode(settings.independentCheckMode),
      activityAwareness: settings.activityAwareness === true,
      nightShiftEnabled: settings.nightShiftEnabled === true,
      cadEnabled: settings.cadEnabled === true,
      draughtsEnabled: settings.draughtsEnabled === true,
      torrentsEnabled: settings.torrentsEnabled === true,
      // Ad and tracker blocking in the built-in browser is on unless the user turns it off.
      browserBlocking: settings.browserBlocking !== false,
      localSampling: normalizeSampling(settings.localSampling),
      ...(typeof settings.systemPrompt === 'string' ? { systemPrompt: settings.systemPrompt.slice(0, 100000) } : {}),
      security: normalizeSecurity(settings.security),
      injectedPrompts: normalizeInjectedPrompts(settings.injectedPrompts),
    },
    chats: savedChats(chats).map(chat => {
      const result = {
        id: string(chat.id) || randomUUID(),
        title: string(chat.title, 'New chat').slice(0, TITLE_LIMIT) || 'New chat',
        ...(chat.session === true ? { session: true } : {}),
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
        baseKey: string(chat.baseKey),
        status: ['running', 'waiting'].includes(chat.status) ? chat.status : 'idle',
        messages: (Array.isArray(chat.messages) ? chat.messages : []).filter(isObject).map(message => {
          const entry = {
            id: string(message.id) || randomUUID(),
            role: ['user', 'assistant', 'tool'].includes(message.role) ? message.role : 'tool',
            text: string(message.text),
          };
          const attachments = attachmentDescriptors(message.attachments);
          if (attachments.length) entry.attachments = attachments;
          for (const key of ['kind', 'status', 'phase', 'workspace', 'model', 'connection', 'automationId', 'automationName', 'goalId', 'goalName', 'goalRunId', 'goalQuestionId', 'goalStatus', 'chatGoalId', 'heartbeatId', 'heartbeatTopic']) {
            if (typeof message[key] === 'string') entry[key] = message[key];
          }
          if (recovering && ['running', 'waiting', 'inProgress'].includes(entry.status)) {
            entry.status = 'interrupted';
          }
          for (const key of ['createdAt', 'updatedAt']) {
            if (Number.isFinite(message[key])) entry[key] = message[key];
          }
          if (message.modelSeen === false) entry.modelSeen = false;
          const actions = normalizeActions(message.actions);
          if (actions.length) entry.actions = actions;
          const answer = normalizeAnswer(message.answer);
          if (answer) entry.answer = answer;
          const memories = normalizeMemories(message.memories);
          if (memories.length) entry.memories = memories;
          if (typeof message.watchId === 'string') entry.watchId = message.watchId.slice(0, 100);
          // Labels of what the user pointed at in the CAD panel with this message.
          if (Array.isArray(message.cad)) { const cad = message.cad.filter(label => typeof label === 'string').slice(0, 12).map(label => label.slice(0, 80)); if (cad.length) entry.cad = cad; }
          // The move the user played on the draughts board with this message.
          if (typeof message.draughts === 'string' && message.draughts) entry.draughts = message.draughts.slice(0, 80);
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
      if (typeof chat.lessonBlock === 'string') result.lessonBlock = chat.lessonBlock.slice(0, 1000);
      if (Array.isArray(chat.lessonKeys)) result.lessonKeys = [...new Set(chat.lessonKeys.filter(key => typeof key === 'string' && /^[a-z0-9][a-z0-9:_-]{0,100}$/i.test(key)))].slice(0, 12);
      const goal = normalizeChatGoal(chat.goal, { recovering });
      if (goal) result.goal = goal;
      const pendingProactive = normalizePending(chat.pendingProactive);
      if (pendingProactive.length) result.pendingProactive = pendingProactive;
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
    const memoryFile = path.join(path.dirname(this.filePath), 'memory.sqlite');
    // A missing database beside an existing conversation means memory was deleted or reset outside the app.
    this.memoryWasMissing = !fs.existsSync(memoryFile) && this.data.chats.some(chat => chat.messages.length > 0);
    this.memoryService = new MemoryService({ filename: memoryFile });
    attachMemoryService(this.data.memory, this.memoryService);
    setPrimaryService(this.memoryService);
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
      renameWithRetry(temporaryPath, this.filePath);
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch { /* It may already have been renamed. */ }
      throw error;
    }
    return this.data;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    setPrimaryService(null);
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
