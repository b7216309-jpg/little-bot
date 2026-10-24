const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, Notification, safeStorage, nativeImage, protocol, powerMonitor, nativeTheme, screen, desktopCapturer, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.cjs');
const { Scheduler, validateAutomation } = require('./scheduler.cjs');
const { Engine } = require('./engine/index.cjs');
const { Controller, cleanError } = require('./controller.cjs');
const { saveFact, deleteFact, clearEpisodes } = require('./memory.cjs');
const { MemoryConsolidator } = require('./memory-consolidator.cjs');
const { Heartbeat, validateHeartbeat, inActiveHours } = require('./heartbeat.cjs');
const { NightShift } = require('./night-shift.cjs');
const backups = require('./backups.cjs');
const { ActivityMonitor } = require('./activity.cjs');
const { WebWatcher } = require('./web-watch.cjs');
const { Relay } = require('./relay.cjs');
const relayView = require('./relay-view.cjs');
const { installedGame } = require('./steam-library.cjs');
const proactiveChat = require('./proactive-chat.cjs');
const { deliverHeartbeat, flush: flushProactive } = require('./proactive-chat.cjs');
const { ExtensionFiles, validateServer, LIMITS } = require('./extensions.cjs');
const { ExtensionRuntime } = require('./extension-runtime.cjs');
const goalContract = require('./goal-contract.cjs');
const { GoalRunner } = require('./goals.cjs');
const { EventRuntime } = require('./event-runtime.cjs');
const { manageSchedule } = require('./schedule-management.cjs');
const { AgentTools } = require('./agent-tools.cjs');
const { AppManagement } = require('./app-management.cjs');
const appHandlers = new Map();
const { ProfileFiles } = require('./profile.cjs');
const { Profiles } = require('./profiles.cjs');
const { loadPreset, presetPrompt } = require('./profile-presets.cjs');
const { installBundledSkills } = require('./bundled-skills.cjs');
const { EmbeddedBrowser } = require('./embedded-browser.cjs');
const { DesktopWindows } = require('./desktop-windows.cjs');
const { WindowsUia } = require('./windows-uia.cjs');
const { DesktopTools } = require('./desktop-tools.cjs');
const { CadKernel } = require('./cad-kernel.cjs');
const { CadWorkshop } = require('./cad-workshop.cjs');
const { DraughtsTable } = require('./draughts-table.cjs');
const { Worker } = require('node:worker_threads');
const { WebServices } = require('./web-services.cjs');
const { electronWeb } = require('./web-electron.cjs');
const { Attachments } = require('./attachments.cjs');
const { attachmentDescriptors } = require('./attachment-message.cjs');
const { ErrorLog } = require('./error-log.cjs');
const { MAX_EVENTS, validateCalendarEvent, listCalendarEvents, calendarEventView } = require('./calendar.cjs');
const { randomUUID } = require('node:crypto');
const companion = require('./companion.cjs');
const { advanceMissedSchedules, missedCount } = require('./missed-schedules.cjs');
const { mainChat, isMain, isSession } = require('./chats.cjs');
const awakeClock = require('./awake-clock.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'little-bot-attachment', privileges: { standard: true, secure: true, supportFetchAPI: false } }, CadKernel.scheme()]);

app.setName('Little Bot');
if (process.env.LITTLE_BOT_DATA_DIR) app.setPath('userData', path.resolve(process.env.LITTLE_BOT_DATA_DIR));
const launchTime = performance.now();
// A second copy only hands over to the first: it must not open the same state, memory and engine files.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.exit(0);
// The lock stays on the base folder, so one profile runs at a time; each profile then gets its own folder.
const profiles = new Profiles({ base: app.getPath('userData') });
app.setPath('userData', profiles.root(profiles.data.active));
let window, desktopWindows, controller, scheduler, heartbeat, goals, nightShift, eventRuntime, errorLog, activity, webWatcher, relay, quitting = false;
const rendererFile = path.join(__dirname, 'renderer', 'index.html');
const appIconFile = path.join(__dirname, '..', 'resources', 'icons', 'little-bot.png');
const rendererUrl = pathToFileURL(rendererFile).href;

function logDiagnostic(source, error, metadata) {
  if (errorLog) return errorLog.capture(source, error, metadata);
  try { console.error(`[${source}]`, cleanError(error)); } catch {}
  return null;
}

process.on('uncaughtExceptionMonitor', error => logDiagnostic('main:uncaught-exception', error));

function safeWebUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol); }
  catch { return false; }
}

function stateProtector() {
  let available = false;
  try {
    available = safeStorage.isEncryptionAvailable() === true
      && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend?.() !== 'basic_text');
  } catch { available = false; }
  if (!available) throw new Error('Windows secure storage is unavailable for the saved conversation state.');
  return {
    encryptString: value => safeStorage.encryptString(value),
    decryptString: value => safeStorage.decryptString(value),
  };
}
// Caption buttons sit on the top bar (70px plus its 1px border), so they match the paper color.
function titleBarColors(dark) {
  return dark ? { color: '#21201a', symbolColor: '#a9b0aa', height: 70 } : { color: '#fcfbf8', symbolColor: '#5f665f', height: 70 };
}
function register(name, handler) {
  appHandlers.set(name, handler);
  ipcMain.handle(`bot:${name}`, async (event, payload) => {
    if (!desktopWindows?.trusted(event)) throw new Error('Untrusted app window.');
    try { return await handler(payload); } catch (error) {
      logDiagnostic(`ipc:${name}`, error);
      throw new Error(cleanError(error));
    }
  });
}
async function runAutomation(automation) {
  controller.ensureReady();
  const result = await controller.send({ text: automation.prompt }, { ...automation, automationId: automation.id });
  const chat = controller.chat(result.chatId);
  if (controller.store.data.autonomy.paused) await controller.stop({ chatId: chat.id });
  const outcome = await controller.waitForChat(result.chatId);
  if (outcome.error) throw new Error(outcome.error);
  return result;
}

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  const stateDir = path.join(app.getPath('userData'), 'data');
  errorLog = new ErrorLog({ root: path.join(stateDir, 'logs'), appVersion: require('../package.json').version });
  const engineHome = path.join(stateDir, 'engine');
  const defaultWorkspace = path.join(app.getPath('userData'), 'Workspace');
  fs.mkdirSync(engineHome, { recursive: true }); fs.mkdirSync(defaultWorkspace, { recursive: true });
  let restoreResult = null;
  try { restoreResult = backups.applyPendingRestore(stateDir); } catch (error) { logDiagnostic('backup-restore', error); }
  const store = new Store({ filePath: path.join(stateDir, 'state.json'), defaultWorkspace, protector: stateProtector() });
  if (store.locked) throw new Error(store.warning || 'Encrypted app state could not be opened.');
  const backupNow = (force = false) => backups.createBackup({ stateDir, memoryService: store.memoryService, force });
  const dailyBackup = () => { try { backupNow(); } catch (error) { logDiagnostic('backup', error); } };
  // Little Bot's own engine; its saved conversations are encrypted like the rest of the state.
  const client = new Engine({ homeDir: engineHome, cwd: defaultWorkspace, protector: stateProtector() });
  controller = new Controller({ store, client, onError: logDiagnostic });
  controller.memoryConsolidator = new MemoryConsolidator(controller);
  controller.systemIdleSeconds = () => powerMonitor.getSystemIdleTime();
  try { controller.memoryConsolidator.retryFormatFailures(); } catch (error) { logDiagnostic('memory-retry', error); }
  controller.browser = new EmbeddedBrowser({ root: path.join(stateDir, 'browser'), getWindow: () => window, onChange: () => controller.changed() });
  controller.webServices = new WebServices(electronWeb(require('electron')));
  const attachmentReferences = () => store.data.chats.flatMap(chat => chat.messages.flatMap(message => (message.attachments || []).map(item => item.id)));
  controller.attachments = new Attachments({ root: path.join(stateDir, 'attachments'), nativeImage, references: attachmentReferences });
  // Drafts are not restored across app launches. Keep every saved timeline file. When the saved state could
  // not be read whole, its chats may come back from the preserved copy: keep every file until then.
  if (!store.warning) await controller.attachments.prune();
  controller.attachmentStorage = await controller.attachments.storage();
  protocol.handle('little-bot-attachment', async request => {
    try {
      const url = new URL(request.url);
      const id = url.pathname.slice(1);
      if (request.method !== 'GET' || url.hostname !== 'file' || url.search || url.hash || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return new Response(null, { status: 400 });
      if ((await controller.attachments.get(id)).kind !== 'image') return new Response(null, { status: 415 });
      const { buffer, mime } = await controller.attachments.read(id);
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) return new Response(null, { status: 415 });
      return new Response(buffer, { headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': "default-src 'none'" } });
    } catch { return new Response(null, { status: 404 }); }
  });
  controller.profileFiles = new ProfileFiles({ root: path.join(stateDir, 'profile') });
  controller.profiles = profiles;
  // Shown once the window is up: a starter skill that could not be installed is otherwise invisible.
  let skillSetupMessage = '';
  try {
    const { skipped } = await installBundledSkills(store);
    if (skipped.length) {
      logDiagnostic('starter-skills', new Error(skipped.map(item => `${item.name}: ${item.reason}`).join('; ')));
      skillSetupMessage = `${skipped.length} starter skill${skipped.length === 1 ? '' : 's'} could not be installed (${skipped.map(item => item.name).join(', ')}): ${skipped[0].reason}`;
    }
  } catch (error) { logDiagnostic('starter-skills', error); skillSetupMessage = `The starter skills could not be installed: ${cleanError(error)}`; }
  const extensionFiles = new ExtensionFiles({ root: path.join(stateDir, 'extensions'), store });
  const extensionRuntime = new ExtensionRuntime({ store, client, onChange: () => controller.changed() });
  controller.extensionRuntime = extensionRuntime;
  const publishEvent = event => {
    if (event?.type === 'user.returned') void nightShift?.ownerReturned('presence').catch(error => logDiagnostic('night-shift:return', error));
    return eventRuntime?.publish(event) || { accepted: false, reason: 'stopped' };
  };
  scheduler = new Scheduler({ store, run: runAutomation, publish: publishEvent, canRun: () => !store.data.autonomy.paused && !controller.userSendPending && !goals?.activeId && !controller.goalChat && !heartbeat?.running && !controller.extensionsBusy && !controller.memoryBusy && !store.data.chats.some(chat => chat.status !== 'idle') && !controller.chatGoal.holding(), onChange: () => controller.changed() });
  heartbeat = new Heartbeat({ store, run: config => controller.runHeartbeat(config),
    canNotify: () => !store.data.autonomy.paused && !desktopWindows?.isFocused() && Notification.isSupported()
      && !store.data.chats.some(chat => chat.status !== 'idle'),
    canRun: () => controller.runtime.status === 'ready' && controller.account.status === 'connected'
      && !store.data.autonomy.paused && !controller.userSendPending && !goals?.activeId && !controller.goalChat && !controller.extensionsBusy && !scheduler.runningId && !controller.heartbeatChat && !store.data.chats.some(chat => chat.status !== 'idle')
      && !controller.chatGoal.holding() && (controller.systemIdleSeconds?.() ?? 0) < 600,
    onChange: () => controller.changed(),
    publish: publishEvent,
    // Activity only tracks; every new heartbeat alert is delivered into the conversation.
    onRecord: item => {
      if (!deliverHeartbeat(store.data, item)) return;
      controller.changed(true);
    },
    onAlert: item => {
      if (!Notification.isSupported() || desktopWindows?.isFocused()) return;
      const notice = new Notification({ title: item.status === 'error' ? 'Little Bot needs attention' : item.source === 'goal' ? 'Little Bot goals' : 'Little Bot heartbeat',
        body: item.summary.slice(0, 240), silent: true, icon: appIconFile });
      notice.on('click', () => {
        if (!window || window.isDestroyed()) return;
        desktopWindows.openFull(item.source === 'goal' ? 'goals' : 'inbox');
      });
      notice.show();
    },
  });
  goals = new GoalRunner({ store, backupRoot: path.join(stateDir, 'goal-backups'),
    run: (goal, options) => controller.runGoal(goal, options), stopRun: reason => controller.stopGoal(reason),
    verifyCommand: (goal, check) => controller.verifyGoalCommand(goal, check),
    canRun: () => controller.runtime.status === 'ready' && controller.account.status === 'connected'
      && !controller.userSendPending && !controller.extensionsBusy && !controller.memoryBusy && !controller.goalChat && !controller.heartbeatChat && !heartbeat.running && !scheduler.runningId
      && !store.data.chats.some(chat => chat.status !== 'idle') && !controller.memoryConsolidator?.hasReadyWork() && !controller.chatGoal.holding(),
    waitReason: () => controller.runtime.status !== 'ready' ? 'The engine is starting'
      : controller.account.status !== 'connected' ? 'Waiting for the model (it is offline or not loaded)'
      : store.data.chats.some(chat => chat.status !== 'idle') ? 'A conversation reply is in progress'
      : controller.chatGoal.holding() ? 'A /goal is running in the conversation'
      : controller.memoryBusy || controller.memoryConsolidator?.hasReadyWork() ? 'Memory is learning from the conversation'
      : controller.goalChat || goals?.activeId ? 'Another goal is running'
      : heartbeat.running || controller.heartbeatChat ? 'The heartbeat check is running'
      : scheduler.runningId ? 'A scheduled task is running'
      : controller.extensionsBusy ? 'Extensions are updating' : '',
    onChange: () => controller.changed(),
    publish: publishEvent,
    deliver: (goal, data, details) => {
      const deferred = nightShift?.deferGoalDelivery(goal, data, details);
      return deferred === undefined ? goalContract.deliver(goal, data, details) : deferred;
    },
    onAlert: item => {
      if (nightShift?.captureGoalAlert(item)) return;
      const goal = store.data.autonomy.goals.find(goal => goal.id === item.goalId);
      if (goalContract.isV2(goal) && goal?.status === 'blocked') goalContract.deliver(goal, store.data, { runId: goal.pendingQuestion ? undefined : 'blocked:' + goal.updatedAt, summary: item.summary || item.message, question: goal.pendingQuestion, actions: false });
      heartbeat.recordActivity({ status: goal?.status === 'blocked' ? 'error' : 'alert',
        summary: `${item.title || 'Goal'}: ${item.summary || item.message || 'A goal needs your attention.'}`,
        topic: item.title || 'Goal runner', source: 'goal', goalId: item.goalId,
        workspace: goal?.workspace || store.data.settings.workspace });
    },
  });
  controller.goalWaiting = () => Object.fromEntries(goals.waiting);
  nightShift = new NightShift({ store, controller, goals, idleSeconds: () => powerMonitor.getSystemIdleTime(),
    canRun: () => goals.canRun() && !scheduler.runningId,
    post: fields => {
      const message = proactiveChat.post(store.data, fields, { duplicate: item => item.kind === 'heartbeat' && item.heartbeatId === fields.heartbeatId });
      if (message) controller.changed(true);
      return message;
    },
    notify: message => {
      if (!Notification.isSupported() || desktopWindows?.isFocused() || !inActiveHours(store.data.heartbeat, Date.now())) return;
      new Notification({ title: 'Little Bot · While you were away', body: message.slice(0, 240), silent: true, icon: appIconFile }).show();
    },
    onChange: () => controller.changed(),
  });
  controller.nightShift = nightShift;
  powerMonitor.on('suspend', () => awakeClock.suspended());
  powerMonitor.on('resume', () => awakeClock.resumed());
  powerMonitor.on('lock-screen', () => nightShift.setLocked(true));
  powerMonitor.on('unlock-screen', () => nightShift.setLocked(false));
  eventRuntime = new EventRuntime({ store, scheduler, heartbeat, goals, controller,
    onChange: ({ persisted }) => controller.changed(persisted === true),
    onError: (error, event) => logDiagnostic('event-runtime', error, { eventType: event?.type }),
  });
  controller.eventRuntime = eventRuntime;
  activity = new ActivityMonitor({ publish: publishEvent, idleSeconds: () => powerMonitor.getSystemIdleTime() });
  controller.activity = activity;
  webWatcher = new WebWatcher({ store, onChange: () => controller.changed(),
    onChanged: change => { if (proactiveChat.deliverWatch(store.data, change)) controller.changed(true); } });
  function saveCalendarRecord(payload) {
    const records = store.data.calendar.events;
    const existing = payload?.id ? records.find(event => event.id === payload.id) : null;
    if (payload?.id && !existing) throw new Error('This calendar event no longer exists.');
    if (!existing && records.length >= MAX_EVENTS) throw new Error('The local calendar has reached its 5,000-event limit.');
    const action = existing ? 'updated' : 'created';
    const event = validateCalendarEvent(payload, existing);
    if (existing) Object.assign(existing, event);
    else records.push(event);
    records.sort((left, right) => left.startAt - right.startAt || left.title.localeCompare(right.title));
    store.save();
    controller.changed();
    eventRuntime?.calendarChanged(action, event);
    return event;
  }
  function deleteCalendarRecord(id) {
    if (typeof id !== 'string' || !id) throw new Error('Choose a calendar event.');
    const records = store.data.calendar.events;
    const index = records.findIndex(event => event.id === id);
    if (index < 0) throw new Error('This calendar event no longer exists.');
    const [removed] = records.splice(index, 1);
    store.save();
    controller.changed();
    eventRuntime?.calendarChanged('deleted', removed);
    return removed;
  }

  controller.appManagement = new AppManagement({controller,handlers:appHandlers,filename:path.join(stateDir,'app-operations.json')});
  controller.windowsUi = new WindowsUia({ root: path.join(stateDir, 'windows-ui') });
  // The optional CAD workshop. Its engine page starts only when the panel opens or the model uses it.
  controller.cad = new CadWorkshop({
    kernel: new CadKernel({ BrowserWindow, session, appRoot: path.join(__dirname, '..'), onCrash: () => logDiagnostic('cad-kernel', new Error('The CAD engine page stopped.')) }),
    store, root: path.join(stateDir, 'cad'), guidePath: path.join(__dirname, '..', 'resources', 'cad', 'GUIDE.md'),
    getWorkspace: () => store.data.settings.workspace, onChange: () => controller.changed(),
    // Meshes go straight to the windows: they are large and the phone relay has no use for them.
    onMesh: payload => desktopWindows?.broadcast({ type: 'cadMesh', ...payload }),
    beforeShow: () => { if (controller.draughts) controller.draughts.panel = false; },
  });
  // Optional draughts against Little Bot: a game per conversation, the search in a worker thread.
  controller.draughts = new DraughtsTable({
    store, Worker, onChange: () => controller.changed(),
    keyOf: chat => isSession(chat) ? chat.id : isMain(chat) ? 'main' : null,
    beforeShow: () => { if (controller.cad) controller.cad.panel = false; },
  });
  controller.agentTools = new AgentTools({ management:controller.appManagement, store, browser: controller.browser, webServices: controller.webServices, windowsUi: controller.windowsUi, cad: controller.cad, draughts: controller.draughts,
    desktop: new DesktopTools({ desktopCapturer, screen, clipboard, nativeImage, BrowserWindow, session, root: path.join(stateDir, 'screenshots') }),
    onLesson: (modelId, key, text) => controller.recordLesson(modelId, key, text),
    phoneAction: async args => relay.phoneAction(args),
    manageWatch: async (action, payload) => action === 'list' ? webWatcher.list() : action === 'remove' ? webWatcher.remove(payload.id) : webWatcher.add(payload),
    proposeLaunch: async ({ appid, note }) => {
      const game = installedGame(appid);
      if (!game) throw new Error('That game is not installed in the local Steam library. Use games_list for valid appids.');
      proactiveChat.deliverOffer(store.data, { appid: game.appid, name: game.name, note });
      controller.changed(true);
      return { offered: true, game: game.name, note: 'A Launch button was posted; the game starts only if the user clicks it.' };
    },
    manageIntention: async (action, payload = {}) => {
      if (action === 'list') return companion.active(store.data.companion).map(({ id, text, why, trigger, fires }) => ({ id, text, why, trigger, offered: fires }));
      const result = action === 'create' ? companion.create(store.data.companion, payload, { source: payload.source })
        : companion.close(store.data.companion, payload.id, action === 'done' ? 'done' : 'cancelled');
      controller.changed(true);
      return { id: result.id, text: result.text, trigger: result.trigger, status: result.status };
    },
    manageFollowup: async (action, payload) => {
      if (action === 'list') return heartbeat.listFollowups();
      if (action === 'cancel') return heartbeat.cancelFollowup(payload.id);
      return heartbeat.scheduleFollowup(payload);
    },
    sendAttachment: async (input, chat) => {
      if (!chat || chat.internal || chat.automationId || chat.status !== 'running') throw new Error('Files can be delivered only in an active user conversation.');
      const descriptor = await controller.attachments.output(input.path, chat.workspace, { extraRoots: [path.join(stateDir, 'browser', 'screenshots'), path.join(stateDir, 'screenshots')] });
      if (chat.status !== 'running') { await controller.attachments.release(descriptor.id); throw new Error('The conversation stopped before the file could be delivered.'); }
      chat.messages.push({ id: randomUUID(), role: 'assistant', text: input.caption || '', attachments: attachmentDescriptors([descriptor]), status: 'completed' });
      controller.changed(true);
      await controller.attachments.release(descriptor.id);
      await refreshAttachmentStorage();
      return { delivered: true, name: descriptor.name, attachmentId: descriptor.id };
    },
    manageGoal: async (action, payload, context) => {
      const owned = () => {
        const goal = store.data.autonomy.goals.find(item => item.id === payload.id);
        if (!goal || path.resolve(goal.workspace).toLowerCase() !== path.resolve(context.workspace).toLowerCase()) throw new Error('Choose a goal belonging to this chat’s working folder.');
        return goal;
      };
      if (action === 'list') return store.data.autonomy.goals.filter(goal => path.resolve(goal.workspace).toLowerCase() === path.resolve(context.workspace).toLowerCase())
        .map(({ id, name, objective, status, nextStep, checkpoint, authorized }) => ({ id, name, objective, status, nextStep, checkpoint, authorized }));
      if (action === 'create') {
        if (payload.id) throw new Error('A new goal cannot reuse an existing goal ID.');
        const goal = await goals.save({ kind: 'task', ...payload, workspace: context.workspace });
        return { goal, message: 'Saved as a draft. Use Goals → Run to authorize its access and start work.' };
      }
      const goal = owned();
      if (action === 'answer') return goals.answer({ id: goal.id, questionId: payload.questionId, answer: payload.answer });
      if (action === 'update') {
        if (goal.status !== 'draft') throw new Error('Only draft goals can be edited by the agent. Change an active goal in Goals.');
        return goals.save({ ...goal, ...payload, id: goal.id });
      }
      if (action === 'pause') { await goals.pause(goal.id); return { id: goal.id, status: goal.status }; }
      if (action === 'resume') {
        if (!goal.authorized) throw new Error('Start this draft once from Goals to authorize its saved scope.');
        if (store.data.autonomy.paused) throw new Error('Background work is switched off. Ask the user to turn the Background switch back on.');
        await goals.resume(goal.id); return { id: goal.id, status: goal.status };
      }
      throw new Error('Unsupported goal action.');
    },
    manageSchedule: async (action, payload, context) => {
      const result = manageSchedule(store, action, payload, context);
      if (action !== 'list') controller.changed();
      return result;
    },
    manageCalendar: async (action, payload) => {
      if (action === 'list') return {
        events: listCalendarEvents(store.data.calendar, payload),
        localTime: new Date().toString(),
      };
      if (action === 'create') {
        if (payload.id) throw new Error('A new calendar event cannot reuse an existing ID.');
        const event = saveCalendarRecord(payload);
        return { event: calendarEventView(event), message: 'Calendar event created.' };
      }
      if (action === 'update') {
        const event = saveCalendarRecord(payload);
        return { event: calendarEventView(event), message: 'Calendar event updated.' };
      }
      if (action === 'delete') {
        const event = deleteCalendarRecord(payload.id);
        return { event: calendarEventView(event), message: 'Calendar event deleted.' };
      }
      throw new Error('Unsupported calendar action.');
    },
  });
  controller.on('event', event => desktopWindows?.broadcast(event));
  // Phones get the same conversation through the relay, using the same handlers as this window.
  // Paired phones belong to the PC, not a profile: they talk to whichever profile is running.
  relay = new Relay({ file: path.join(profiles.base, 'data', 'relay.json'), protector: stateProtector(), onError: logDiagnostic,
    ...(process.env.LITTLE_BOT_RELAY_HOST ? { host: process.env.LITTLE_BOT_RELAY_HOST } : {}),
    // Test instances use their own port so a paired phone never reaches them (and never sees itself unpaired).
    ...(/^\d{4,5}$/.test(process.env.LITTLE_BOT_RELAY_PORT || '') ? { port: Number(process.env.LITTLE_BOT_RELAY_PORT) } : {}),
    getState: () => controller.state(), isDesktopFocused: () => Boolean(desktopWindows?.isFocused()),
    // Only files of messages a phone was shown are read (see Relay fileLink).
    readAttachment: id => controller.attachments.read(id),
    handlers: new Proxy({}, { get: (_target, name) => payload => appHandlers.get(name)(payload) }) });
  const relayChanged = () => desktopWindows?.broadcast({ type: 'relay', relay: relay.publicState() });
  relay.onClients = relayChanged;
  controller.phoneSummary = () => relay.phoneSummary();
  relay.onContext = ({ before, after }) => {
    relayChanged();
    if (before && after && before.home !== after.home) eventRuntime?.publish({ type: after.home ? 'phone.arrived_home' : 'phone.left_home', source: 'phone', payload: { meters: after.meters } });
  };
  relay.onPaired = device => { relayChanged(); controller.emit('event', { type: 'memory', message: `Paired ${device.name} with the phone relay.` }); };
  controller.on('event', event => relay.onEvent(event));
  // Desktop notifications while the window is in the background: replies, questions, approvals, web watches and offers.
  // Heartbeat and goal alerts already notify through onAlert, and learned notes stay quiet.
  let desktopSnapshot = null;
  controller.on('event', event => {
    if (event.type !== 'state') return;
    let notes = [];
    try { const next = relayView.snapshot(event.state); notes = relayView.notifications(desktopSnapshot, next); desktopSnapshot = next; }
    catch (error) { logDiagnostic('desktop-notify', error); return; }
    if (!Notification.isSupported() || !window || window.isDestroyed() || desktopWindows?.isFocused()) return;
    for (const note of notes.filter(item => !['heartbeat', 'goal', 'memory'].includes(item.kind) && !/^Goal ·/.test(item.title)).slice(0, 2)) {
      const notice = new Notification({ title: note.title, body: note.body, silent: !note.tag.startsWith('approval-'), icon: appIconFile });
      notice.on('click', () => {
        if (!window || window.isDestroyed()) return;
        desktopWindows.show().catch(error => logDiagnostic('display-show', error));
      });
      notice.show();
    }
  });

  function ensureExtensionsIdle() {
    if (controller.userSendPending || controller.extensionsBusy || goals.activeId || controller.goalChat || heartbeat.running || scheduler.runningId || controller.heartbeatChat || store.data.chats.some(chat => chat.status !== 'idle')) {
      throw new Error('Finish or stop active tasks before changing extensions.');
    }
  }
  function beginExtensionsUpdate() {
    controller.extensionsBusy = true;
    let settle;
    controller.extensionsIdle = new Promise(resolve => { settle = resolve; });
    return () => {
      controller.extensionsBusy = false;
      settle();
      controller.extensionsIdle = Promise.resolve();
      controller.changed();
    };
  }
  async function updateExtensions(action) {
    await controller.memoryConsolidator.pauseForUser();
    ensureExtensionsIdle();
    const previous = structuredClone(store.data.extensions);
    const finishExtensions = beginExtensionsUpdate();
    try {
      await action();
      // Release every idle engine context so removed tools cannot linger in an old chat.
      for (const threadId of [...controller.resumed]) {
        await client.request('thread/unsubscribe', { threadId }, 10000);
        controller.resumed.delete(threadId);
      }
      store.save(); extensionRuntime.invalidate(); controller.changed(); return controller.state();
    } catch (error) { store.data.extensions = previous; throw error; }
    finally { finishExtensions(); }
  }

  register('setWorkspacePath', ({path:folder}) => controller.setWorkspace(folder));
  register('importSkillPath', ({path:file}) => updateExtensions(() => extensionFiles.importSkill(file)));
  register('importPluginPath', ({path:folder}) => updateExtensions(() => extensionFiles.importPlugin(folder)));
  register('getState', () => controller.state());
  register('getDisplayState', () => desktopWindows.state());
  register('setDisplayMode', async payload => {
    if (payload?.mode === 'widget') controller.browser.showPanel(false);
    const display = await desktopWindows.setMode(payload);
    if (display.mode === 'widget') controller.changed();
    return display;
  });
  register('setWidgetState', payload => desktopWindows.setWidgetState(payload));
  register('getContextUsed', ({ chatId } = {}) => controller.contextUsedFor(chatId));
  register('usageSummary', ({ days } = {}) => controller.usage.summary({ days: [7, 30, 90, 0].includes(days) ? days : 30 }));
  register('reportError', ({ kind, message, stack } = {}) => {
    if (typeof kind !== 'string' || kind.length > 100 || typeof message !== 'string' || message.length > 12000
      || (stack !== undefined && (typeof stack !== 'string' || stack.length > 30000))) throw new Error('Invalid renderer diagnostic.');
    const error = new Error(message || 'Renderer error');
    if (stack) error.stack = stack;
    logDiagnostic(`renderer:${kind || 'error'}`, error);
    return { ok: true };
  });
  register('openLogs', async () => {
    fs.mkdirSync(errorLog.root, { recursive: true });
    const error = await shell.openPath(errorLog.root);
    if (error) throw new Error(error);
    return { ok: true };
  });
  register('saveProfile', payload => { controller.profileFiles.save(payload); controller.changed(); return controller.state(); });
  register('openProfileFolder', async () => {
    const error = await shell.openPath(controller.profileFiles.getState().root);
    if (error) throw new Error(error);
    return { ok: true };
  });
  register('createProfile', ({ name, preset } = {}) => {
    const personality = preset ? loadPreset(preset) : null;
    profiles.create({ name: (typeof name === 'string' && name.trim()) || personality?.name, settings: store.data.settings,
      ...(personality ? { soul: personality.soul, systemPrompt: presetPrompt(personality.intro, controller.defaultSystemPrompt()) } : {}) });
    controller.changed(); return controller.state();
  });
  register('renameProfile', ({ id, name } = {}) => { profiles.rename(id, name); controller.changed(); return controller.state(); });
  register('deleteProfile', ({ id } = {}) => { profiles.remove(id); controller.changed(); return controller.state(); });
  register('switchProfile', ({ id } = {}) => {
    if (id === profiles.data.active) return controller.state();
    profiles.select(id);
    // A restart rebuilds every service from the other folder, so nothing from this profile keeps running.
    setTimeout(() => { app.relaunch(); app.quit(); }, 200);
    return { restarting: true };
  });
  register('saveSettings', payload => controller.saveSettings(payload));
  register('saveConnection', payload => { ensureExtensionsIdle(); return controller.saveConnection(payload); });
  register('refreshConnection', () => controller.refreshConnection());
  register('chooseAttachments', async () => {
    const selected = await dialog.showOpenDialog(desktopWindows.activeWindow(), { title: 'Attach files', properties: ['openFile', 'multiSelections'] });
    return selected.canceled ? [] : importAttachments(() => controller.attachments.importPaths(selected.filePaths));
  });
  async function refreshAttachmentStorage() {
    controller.attachmentStorage = await controller.attachments.storage(); controller.changed();
  }
  async function importAttachments(operation) { const result = await operation(); await refreshAttachmentStorage(); return result; }
  register('attachFiles', paths => importAttachments(() => controller.attachments.importPaths(paths)));
  register('importAttachment', payload => importAttachments(() => controller.attachments.importBytes(payload)));
  register('releaseAttachment', async ({ id } = {}) => {
    const result = await controller.attachments.release(id); await refreshAttachmentStorage(); return result;
  });
  register('attachmentStorage', async () => { await refreshAttachmentStorage(); return controller.attachmentStorage; });
  register('cleanupAttachments', async () => {
    const result = await controller.attachments.prune(); await refreshAttachmentStorage();
    return { ...result, ...controller.state() };
  });
  register('deleteAttachment', async ({ id } = {}) => {
    ensureExtensionsIdle();
    await controller.attachments.get(id);
    const previous = [];
    for (const chat of store.data.chats) for (const message of chat.messages) {
      if (!message.attachments?.some(item => item.id === id)) continue;
      previous.push([message, message.attachments]);
      message.attachments = message.attachments.filter(item => item.id !== id);
    }
    try { store.save(); }
    catch (error) { for (const [message, attachments] of previous) message.attachments = attachments; throw error; }
    await controller.attachments.release(id); await refreshAttachmentStorage(); return controller.state();
  });
  register('openAttachment', async ({ id } = {}) => {
    const item = await controller.attachments.get(id);
    await controller.attachments.read(id);
    if (/\.(?:png|jpe?g|webp|gif|txt|md|csv|json|pdf|docx|xlsx|pptx)$/i.test(item.name)) {
      const error = await shell.openPath(item.path); if (error) throw new Error(error);
    } else shell.showItemInFolder(item.path);
    return { ok: true };
  });
  register('saveAttachment', async ({ id } = {}) => {
    const item = await controller.attachments.get(id);
    const selected = await dialog.showSaveDialog(desktopWindows.activeWindow(), { title: 'Save file', defaultPath: path.join(app.getPath('downloads'), item.name) });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    const { buffer } = await controller.attachments.read(id);
    await fs.promises.writeFile(selected.filePath, buffer);
    return { saved: true };
  });
  register('openAgentBrowser', async () => { await controller.browser.open(); return controller.state(); });
  register('closeAgentBrowser', async () => { await controller.browser.close(); return controller.state(); });
  // The CAD workshop. Opening its panel puts the browser panel away: one side panel at a time.
  register('cadEnable', ({ enabled } = {}) => controller.setCadEnabled(enabled));
  register('cadPanel', async ({ visible } = {}) => {
    if (visible === true) { controller.browser.showPanel(false); controller.draughts.panel = false; }
    await controller.cad.showPanel(visible === true);
    return controller.state();
  });
  register('cadOpen', async ({ name } = {}) => { await controller.cad.open(name); return controller.state(); });
  register('cadWrite', async ({ code } = {}) => ({ summary: await controller.cad.write({ code, note: 'Edited by you', by: 'you' }), state: controller.state() }));
  register('cadSetParams', async ({ params } = {}) => ({ summary: await controller.cad.setParams(params), state: controller.state() }));
  register('cadRevert', async ({ version } = {}) => ({ summary: await controller.cad.revert(version), state: controller.state() }));
  register('cadMesh', ({ version } = {}) => controller.cad.mesh(version));
  register('cadInspect', payload => controller.cad.inspect(payload || {}));
  register('cadMeasure', ({ from, to } = {}) => controller.cad.measure(from, to));
  register('cadLimits', async ({ limits } = {}) => { controller.setCadLimits(limits); if (controller.cad.project?.code) await controller.cad.build(); return controller.state(); });
  register('cadExport', async ({ format } = {}) => {
    const project = controller.cad.project;
    if (!project) throw new Error('There is no part to export yet.');
    const names = { step: 'STEP', stl: 'STL', '3mf': '3MF', svg: 'SVG', dxf: 'DXF' };
    const selected = await dialog.showSaveDialog(desktopWindows.activeWindow(), { title: `Export ${project.name} as ${names[format] || format}`,
      defaultPath: path.join(path.dirname(project.file), `${project.name}.${format}`), filters: [{ name: names[format] || format, extensions: [format] }] });
    if (selected.canceled || !selected.filePath) return null;
    return controller.cad.exportFile({ format, path: selected.filePath });
  });
  register('cadShowFile', ({ file } = {}) => {
    const project = controller.cad.project;
    const target = file === 'folder' || !file ? path.dirname(project?.file || path.join(store.data.settings.workspace, 'cad', 'x')) : String(file);
    if (file && file !== 'folder' && !target.startsWith(store.data.settings.workspace)) throw new Error('Only files in the working folder can be shown.');
    if (file && file !== 'folder') shell.showItemInFolder(target); else { fs.mkdirSync(target, { recursive: true }); shell.openPath(target); }
    return true;
  });
  // Draughts. Its panel, like the CAD one, puts the other side panels away. The user's own moves go through send.
  const idle = () => { if (store.data.chats.some(chat => chat.status !== 'idle')) throw new Error("Wait for Little Bot's reply first."); };
  register('draughtsEnable', ({ enabled } = {}) => controller.setDraughtsEnabled(enabled));
  register('draughtsPanel', ({ visible } = {}) => {
    if (visible === true) controller.browser.showPanel(false);
    controller.draughts.showPanel(visible === true);
    return controller.state();
  });
  register('draughtsNew', ({ key, userColor, level } = {}) => { idle(); controller.draughts.newGame(key, { userColor, level }); return controller.state(); });
  register('draughtsTakeBack', ({ key } = {}) => { idle(); controller.draughts.takeBack(key); return controller.state(); });
  register('draughtsResign', ({ key } = {}) => { idle(); controller.draughts.resign(key); return controller.state(); });
  register('draughtsPrefs', ({ prefs } = {}) => { controller.draughts.setPrefs(prefs); return controller.state(); });
  register('chooseWorkspace', async () => {
    const selected = await dialog.showOpenDialog(desktopWindows.activeWindow(), { title: 'Choose Little Bot’s working folder',
      defaultPath: store.data.settings.workspace, properties: ['openDirectory', 'createDirectory'] });
    if (!selected.canceled) await controller.memoryConsolidator.pauseForUser();
    return selected.canceled ? null : controller.setWorkspace(selected.filePaths[0]);
  });
  register('openWorkspace', async () => {
    const error = await shell.openPath(store.data.settings.workspace);
    if (error) throw new Error(error);
  });
  const sendTurn = async (payload, internal) => {
    if (internal?.goalTurn) return controller.send(payload, null, internal);
    controller.userSendPending++;
    try {
      await nightShift?.ownerReturned('message');
      // The running goal step steps aside for the message and is queued again for when the chat is free.
      if (goals.activeId) await goals.yieldActive('Stepped aside for your message; it continues when the conversation is free.');
      await controller.waitForUserLane();
      await controller.waitForExtensions();
      if (internal?.queueUntilIdle) {
        const chat = controller.chat(payload?.chatId) || mainChat(store.data);
        if (chat && chat.status !== 'idle') await controller.waitForChat(chat.id);
        await controller.waitForUserLane();
      }
      return await controller.send(payload, null, internal);
    } finally { controller.userSendPending = Math.max(0, controller.userSendPending - 1); }
  };
  controller.chatGoal.sendTurn = sendTurn;
  register('send', payload => sendTurn(payload));
  register('chatGoal', async payload => {
    await nightShift?.ownerReturned('message');
    const result = await controller.chatGoal.command({ chatId: typeof payload?.chatId === 'string' ? payload.chatId : undefined,
      quick: payload?.quick === true, session: payload?.session === true, text: typeof payload?.text === 'string' ? payload.text.slice(0, 4000) : '' });
    return { ...result, state: controller.state() };
  });
  register('stop', async payload => {
    const result = await controller.stop(payload);
    if (controller.browser.busy && controller.browser.owner === payload?.chatId) await controller.browser.close();
    return result;
  });
  register('challengeIndependentCheck', payload => controller.challengeIndependentCheck(payload));
  register('compact', payload => controller.compact(payload));
  register('deleteChat', payload => controller.deleteChat(payload));
  register('renameChat', payload => controller.renameChat(payload));
  register('saveQuickSession', payload => controller.saveQuickSession(payload));
  register('respondApproval', payload => controller.respondApproval(payload));
  register('saveGoal', async payload => { await goals.save(payload); return controller.state(); });
  register('runGoal', async ({ id } = {}) => { await nightShift?.ownerReturned('message'); controller.ensureReady(); await goals.runNow(id); return controller.state(); });
  register('pauseGoal', async ({ id } = {}) => { await goals.pause(id); return controller.state(); });
  register('resumeGoal', async ({ id } = {}) => { await goals.resume(id); return controller.state(); });
  register('answerGoal', payload => { goals.answer(payload); return controller.state(); });
  register('deleteGoal', async ({ id } = {}) => { await goals.remove(id); return controller.state(); });
  register('previewGoalRestore', ({ id, runId } = {}) => goals.previewRestore(id, runId));
  register('discardGoalSnapshot', async ({ id, runId } = {}) => { ensureExtensionsIdle(); await goals.discardSnapshot(id, runId); return controller.state(); });
  register('restoreGoal', async ({ id, runId } = {}) => {
    ensureExtensionsIdle();
    await goals.restore(id, runId); return controller.state();
  });
  register('pauseAutonomy', async () => {
    await nightShift?.ownerReturned('pause');
    await goals.pauseAll();
    if (controller.heartbeatChat) { const active = controller.heartbeatChat; await controller.stopHeartbeat(); await active.settled; }
    if (scheduler.runningId) {
      const active = store.data.chats.find(chat => chat.automationId === scheduler.runningId && chat.status !== 'idle');
      if (active && controller.turns.has(active.id)) await controller.stop({ chatId: active.id });
    }
    // Learning and dreaming wait too; their queued work stays and resumes with the switch.
    await controller.memoryConsolidator.pauseForUser();
    controller.changed();
    return controller.state();
  });
  register('resumeAutonomy', async () => {
    // Checks and routines that fell due while paused are skipped, not replayed: turning background work back on
    // must never become a burst of posts. They continue from their next scheduled time.
    if (missedCount(advanceMissedSchedules(store.data, Date.now()))) store.save();
    await goals.resumeAll();
    controller.changed();
    return controller.state();
  });
  register('saveCalendarEvent', payload => {
    saveCalendarRecord(payload);
    return controller.state();
  });
  register('deleteCalendarEvent', ({ id } = {}) => {
    deleteCalendarRecord(id);
    return controller.state();
  });
  register('saveAutomation', payload => {
    const existing = payload?.id ? store.data.automations.find(item => item.id === payload.id) : null;
    const automation = validateAutomation(payload, existing, store.data.settings);
    automation.authorized = automation.enabled || existing?.authorized === true || existing?.enabled === true;
    if (existing) Object.assign(existing, automation); else store.data.automations.push(automation);
    store.save(); controller.changed(); return controller.state();
  });
  register('deleteAutomation', ({ id } = {}) => {
    const existing = store.data.automations.find(item => item.id === id);
    if (existing?.lastStatus === 'running') throw new Error('Wait for this task to finish before deleting it.');
    store.data.automations = store.data.automations.filter(item => item.id !== id);
    store.save(); controller.changed(); return controller.state();
  });
  register('runAutomation', ({ id } = {}) => {
    const automation = store.data.automations.find(item => item.id === id);
    if (automation) { automation.authorized = true; store.save(); }
    return scheduler.runNow(id);
  });
  register('saveStandingIntent', payload => { eventRuntime.saveIntent(payload); return controller.state(); });
  register('deleteStandingIntent', ({ id } = {}) => { eventRuntime.removeIntent(id); return controller.state(); });
  register('toggleStandingIntent', ({ id, enabled } = {}) => { eventRuntime.setIntentEnabled(id, enabled); return controller.state(); });
  register('saveMemory', async ({ enabled } = {}) => {
    if (typeof enabled !== 'boolean') throw new Error('Memory enabled must be true or false.');
    if (!enabled) await controller.memoryConsolidator.pauseForUser();
    store.data.memory.enabled = enabled;
    store.save(); controller.changed(); return controller.state();
  });
  register('deleteLesson', ({ modelId, key } = {}) => {
    return controller.deleteLesson(modelId, key);
  });
  register('saveFact', payload => {
    const existing = payload?.id ? store.memoryService.get(payload.id) : null;
    const settings = existing?.scope === 'workspace' && payload.scope === 'workspace'
      ? { ...store.data.settings, workspace: existing.workspace } : store.data.settings;
    saveFact(store.data.memory, payload, settings);
    store.save(); controller.changed(); return controller.state();
  });
  register('deleteFact', ({ id } = {}) => {
    deleteFact(store.data.memory, id);
    store.save(); controller.changed(); return controller.state();
  });
  register('clearEpisodes', () => {
    clearEpisodes(store.data.memory);
    store.save(); controller.changed(); return controller.state();
  });
  register('searchMemory', async ({ query = '', type, limit = 100, includeSuperseded = false } = {}) => {
    await store.memoryService.prepareQuery(query);
    const found = store.memoryService.search({ query, source: type || 'all', scope: 'all', limit, includeSuperseded });
    return { records: found.results, nextOffset: found.nextOffset };
  });
  register('getMemorySource', ({ id } = {}) => ({ sources: store.memoryService.sources(id) }));
  register('answerProactive', async ({ messageId, choice } = {}) => {
    const { message, action, entry } = proactiveChat.answer(store.data, { messageId, choice });
    if (action.id === 'launch') {
      if (!proactiveChat.LAUNCH_TARGET.test(action.target || '')) throw new Error('This launch target is not allowed.');
      await shell.openExternal(action.target);
    }
    const attention = { do: 'useful', later: 'later', no: 'dismiss' }[choice];
    if (message.heartbeatId && attention) { try { heartbeat.feedback({ id: message.heartbeatId, choice: attention }); } catch { /* The inbox item may have rotated out. */ } }
    if (message.goalId) {
      const goal = store.data.autonomy.goals.find(item => item.id === message.goalId);
      if (goal) goals.record(goal, 'reaction', `You chose "${action.label}" on: ${entry.excerpt.slice(0, 160)}`);
    }
    store.save(); controller.changed(true);
    const chat = mainChat(store.data);
    if (choice === 'do' && chat) {
      try { await sendTurn({ chatId: chat.id, text: `✅ Yes, go ahead with this: "${entry.excerpt.slice(0, 280)}"` }, { queueUntilIdle: true }); }
      catch (error) { logDiagnostic('proactive-answer', error); }
    }
    return controller.state();
  });
  register('setActivityAwareness', ({ enabled } = {}) => {
    if (typeof enabled !== 'boolean') throw new Error('Activity awareness must be true or false.');
    store.data.settings.activityAwareness = enabled;
    store.save();
    if (enabled) activity.start(); else activity.stop();
    controller.changed(); return controller.state();
  });
  register('setNightShiftEnabled', async ({ enabled } = {}) => {
    await nightShift.setEnabled(enabled);
    controller.changed(); return controller.state();
  });
  register('removeWebWatch', ({ id } = {}) => { webWatcher.remove(id); return controller.state(); });
  register('listBackups', () => ({ backups: backups.listBackups(stateDir), keepDays: backups.KEEP_DAYS }));
  register('createBackup', () => { backupNow(true); return { backups: backups.listBackups(stateDir), keepDays: backups.KEEP_DAYS }; });
  register('restoreBackup', ({ id } = {}) => {
    backups.requestRestore(stateDir, id);
    // The files are swapped on the next start, before the Store opens them.
    // The normal quit path flushes the state and checkpoints memory before the files are swapped.
    setTimeout(() => { app.relaunch(); app.quit(); }, 200);
    return { restarting: true };
  });
  register('retryMemoryLearning', ({ id } = {}) => {
    store.memoryService.retryExtraction(id); controller.memoryConsolidator.lastError = null;
    controller.changed(); return controller.state();
  });
  register('discardMemoryLearning', ({ id } = {}) => {
    store.memoryService.discardExtraction(id); controller.memoryConsolidator.lastError = null;
    controller.changed(); return controller.state();
  });
  register('configureMemory', ({ embedding } = {}) => {
    store.memoryService.configureEmbedding(embedding);
    controller.changed(); return controller.state();
  });
  register('linkMemoryProject', ({ projectId, workspace } = {}) => {
    store.memoryService.addProjectAlias(projectId, workspace);
    controller.changed(); return controller.state();
  });
  register('saveHeartbeat', payload => {
    if (heartbeat.running) throw new Error('Stop the heartbeat before changing its settings.');
    const updated = validateHeartbeat(payload, store.data.heartbeat, store.data.settings);
    Object.assign(store.data.heartbeat, updated);
    store.save(); controller.changed(); return controller.state();
  });
  register('runHeartbeat', async () => {
    controller.ensureReady();
    await heartbeat.runNow(); return controller.state();
  });
  register('stopHeartbeat', () => controller.stopHeartbeat());
  register('readHeartbeat', ({ id } = {}) => {
    heartbeat.markRead(id); return controller.state();
  });
  register('heartbeatFeedback', payload => { heartbeat.feedback(payload); return controller.state(); });
  register('saveMcpServer', payload => updateExtensions(() => {
    const existing = payload?.id ? store.data.extensions.servers.find(server => server.id === payload.id) : null;
    if (payload?.id && !existing) throw new Error('This MCP server no longer exists.');
    if (existing?.pluginId || payload?.pluginId) throw new Error('Manage this connection through its plugin.');
    if (!existing && store.data.extensions.servers.length >= LIMITS.servers) throw new Error('The MCP server limit has been reached.');
    const server = validateServer(payload, existing);
    extensionFiles.unique('servers', server, existing?.id);
    if (existing) Object.assign(existing, server); else store.data.extensions.servers.push(server);
  }));
  register('deleteMcpServer', ({ id } = {}) => updateExtensions(() => {
    const existing = store.data.extensions.servers.find(server => server.id === id);
    if (!existing) throw new Error('This MCP server no longer exists.');
    if (existing.pluginId) throw new Error('Remove its plugin to remove this connection.');
    store.data.extensions.servers = store.data.extensions.servers.filter(server => server.id !== id);
  }));
  register('toggleMcpTool', ({ id, tool, enabled } = {}) => updateExtensions(() => {
    const server = store.data.extensions.servers.find(item => item.id === id);
    if (!server || typeof enabled !== 'boolean' || typeof tool !== 'string' || !tool || tool.length > 200) throw new Error('Choose a valid MCP tool.');
    const discovered = extensionRuntime.state.servers.find(item => item.name === server.name)?.tools;
    if ((!discovered || !Object.hasOwn(discovered, tool)) && !server.disabledTools.includes(tool)) throw new Error('Refresh the tool list before changing this tool.');
    const disabled = new Set(server.disabledTools);
    if (enabled) disabled.delete(tool); else disabled.add(tool);
    server.disabledTools = [...disabled];
  }));
  register('refreshExtensions', async () => {
    ensureExtensionsIdle(); const finishExtensions = beginExtensionsUpdate();
    try { await extensionRuntime.refresh(store.data.settings.workspace); return controller.state(); }
    finally { finishExtensions(); }
  });
  register('loginMcpServer', async ({ id } = {}) => {
    ensureExtensionsIdle();
    const result = await extensionRuntime.login(id, store.data.settings.workspace);
    const url = new URL(result.authorizationUrl);
    if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) || url.username || url.password) throw new Error('The MCP server returned an unsupported sign-in URL.');
    await shell.openExternal(url.href);
    return { started: true };
  });
  register('saveSkill', payload => updateExtensions(() => extensionFiles.saveSkill(payload)));
  register('deleteSkill', ({ id } = {}) => updateExtensions(() => extensionFiles.removeSkill(id)));
  register('importSkill', async () => {
    ensureExtensionsIdle();
    const selected = await dialog.showOpenDialog(desktopWindows.activeWindow(), { title: 'Import a SKILL.md instruction file', properties: ['openFile'], filters: [{ name: 'Skill instructions', extensions: ['md'] }] });
    return selected.canceled ? null : updateExtensions(() => extensionFiles.importSkill(selected.filePaths[0]));
  });
  register('importPlugin', async () => {
    ensureExtensionsIdle();
    const selected = await dialog.showOpenDialog(desktopWindows.activeWindow(), { title: 'Import a local plugin folder', properties: ['openDirectory'] });
    return selected.canceled ? null : updateExtensions(() => extensionFiles.importPlugin(selected.filePaths[0]));
  });
  register('togglePlugin', payload => updateExtensions(() => extensionFiles.setPluginEnabled(payload)));
  register('deletePlugin', ({ id } = {}) => updateExtensions(() => extensionFiles.removePlugin(id)));
  register('browserBounds', payload => controller.browser.setBounds(payload));
  register('browserPanel', ({ visible } = {}) => { controller.browser.showPanel(visible === true); return controller.state(); });
  register('browserNavigate', async payload => { await controller.browser.userNavigate(payload); return controller.state(); });
  register('browserClearData', async () => { await controller.browser.clearData(); return controller.state(); });
  register('setTitleBarTheme', ({ dark } = {}) => {
    if (window && !window.isDestroyed()) window.setTitleBarOverlay(titleBarColors(dark === true));
    return true;
  });
  register('dreamNow', () => { controller.memoryConsolidator.requestDream(); controller.changed(); return controller.state(); });
  register('cancelIntention', ({ id } = {}) => { companion.close(store.data.companion, String(id || ''), 'cancelled'); controller.changed(true); return controller.state(); });
  register('relayState', async ({ refresh } = {}) => { if (refresh && relay.server) await relay.refreshTailscale().catch(() => {}); return relay.publicState(); });
  register('relaySetEnabled', ({ enabled } = {}) => relay.setEnabled(enabled === true));
  register('relaySetApprovals', ({ allow } = {}) => relay.setAllowApprovals(allow === true));
  register('relayPair', () => relay.startPairing());
  register('relayCancelPair', () => { relay.pairing = null; return relay.publicState(); });
  register('relayRemoveDevice', ({ id } = {}) => relay.removeDevice(String(id || '')));
  register('relayTailscaleHttps', () => relay.enableTailscaleHttps());

  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // No native title bar: the app's own top bar reaches the window edge and Windows draws only the
  // minimize/maximize/close buttons over it, in the app's colors (updated by setTitleBarTheme).
  window = new BrowserWindow({ width: 1240, height: 860, minWidth: 900, minHeight: 620,
    title: 'Little Bot', backgroundColor: nativeTheme.shouldUseDarkColors ? '#21201a' : '#f7f5f0', show: false, icon: appIconFile,
    titleBarStyle: 'hidden', titleBarOverlay: titleBarColors(nativeTheme.shouldUseDarkColors),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, spellcheck: false, webviewTag: false },
  });
  // The CAD engine's hidden page is a window too: without this, closing Little Bot would leave it running.
  window.on('closed', () => controller.cad?.close());
  window.webContents.on('render-process-gone', (_event, details) => {
    logDiagnostic('renderer:process-gone', new Error(`Renderer process exited: ${details.reason || 'unknown'}`), {
      reason: details.reason, exitCode: details.exitCode,
    });
  });
  window.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame) logDiagnostic('renderer:load-failed', new Error(description || `Load failed with code ${code}`), {
      code, url: validatedURL,
    });
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (safeWebUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  let awaySince = null;
  const returnedAfter = 90 * 60000;
  const onBlur = () => { awaySince ??= Date.now(); };
  const onFocus = () => {
    const away = awaySince === null ? 0 : Date.now() - awaySince;
    awaySince = null;
    if (away >= returnedAfter) eventRuntime?.publish({ type: 'user.returned', source: 'app', payload: { awayMinutes: Math.round(away / 60000) } });
  };
  window.on('blur', onBlur); window.on('focus', onFocus);
  desktopWindows = new DesktopWindows({ fullWindow: window, BrowserWindow, screen, rendererFile,
    preloadFile: path.join(__dirname, 'preload.cjs'), icon: appIconFile,
    file: path.join(stateDir, 'display.json'), onError: logDiagnostic, onFocus, onBlur,
    openLink: url => { if (safeWebUrl(url)) shell.openExternal(url).catch(error => logDiagnostic('widget-link', error)); } });
  window.webContents.on('will-navigate', (event, url) => { if (url !== rendererUrl) event.preventDefault(); });
  window.on('close', event => {
    if (quitting || (!goals.activeId && !heartbeat.running && !controller.heartbeatChat && !controller.chatGoal.holding() && !store.data.chats.some(chat => chat.status !== 'idle'))) return;
    const choice = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['Keep working', 'Quit'],
      defaultId: 0, cancelId: 0, title: 'A task is still running',
      message: 'Quit Little Bot and stop its active tasks?' });
    if (choice === 0) event.preventDefault();
  });
  await window.loadFile(rendererFile);
  await desktopWindows.setMode({ mode: desktopWindows.preferences.mode });
  const startup = controller.start();
  // Background work starts once the engine is ready: after the first start, or after the automatic restart
  // that follows a failed one. One service failing to start does not keep the others off.
  startup.catch(() => controller.waitForEngineReady()).then(() => {
    if (quitting || controller.closing) return;
    controller.runtime.startupMs = Math.round(performance.now() - launchTime);
    const begin = (name, start) => { try { start(); } catch (error) { logDiagnostic(`start:${name}`, error); } };
    const main = mainChat(store.data);
    if (main?.status === 'idle' && flushProactive(main)) controller.changed(true);
    controller.changed();
    begin('events', () => eventRuntime.start()); begin('scheduler', () => scheduler.start()); begin('heartbeat', () => heartbeat.start());
    begin('goals', () => goals.start()); begin('night-shift', () => nightShift.start());
    if (store.data.settings.activityAwareness === true) begin('activity', () => activity.start());
    begin('web-watch', () => webWatcher.start());
    relay.start().then(relayChanged).catch(error => logDiagnostic('relay-start', error));
    setTimeout(dailyBackup, 60000).unref?.();
    setInterval(dailyBackup, 6 * 3600000).unref?.();
    if (skillSetupMessage) controller.emit('event', { type: 'notice', error: true, message: skillSetupMessage });
    if (restoreResult?.restored) controller.emit('event', { type: 'memory', message: `Restored the ${restoreResult.restored} backup. Your previous data was kept as ${restoreResult.safety}.` });
    else if (restoreResult?.error) controller.emit('event', { type: 'memory', error: true, message: restoreResult.error });
    else if (store.memoryWasMissing) {
      logDiagnostic('memory', new Error('The memory database was missing at startup and was recreated.'));
      controller.emit('event', { type: 'memory', error: true, message: 'The memory database was missing and has been recreated, so learned memories are gone. If that was not intended, restore a backup from Memory → Search settings → Backups.' });
    }
  }).catch(error => logDiagnostic('main:services', error));
}).catch(error => {
  logDiagnostic('main:startup', error); console.error(cleanError(error));
  // Without a window the user would see nothing at all: say why before closing.
  try { dialog.showErrorBox('Little Bot could not start', cleanError(error)); } catch { /* Shown only when possible. */ }
  app.exit(1);
});
app.on('second-instance', () => { desktopWindows?.show().catch(error => logDiagnostic('display-show', error)); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true; scheduler?.stop(); heartbeat?.stop(); eventRuntime?.stop(); activity?.stop(); webWatcher?.stop(); relay?.stop().catch(() => {});
  desktopWindows?.close();
  controller?.webServices?.close();
  controller?.cad?.close();
  controller?.draughts?.close();
  // Each step runs even if the one before failed, so the state is always flushed; a hang cannot keep an
  // invisible process holding the single-instance lock.
  const settle = step => Promise.resolve().then(step).catch(error => logDiagnostic('quit', error));
  const shutdown = settle(() => nightShift?.close())
    .then(() => Promise.allSettled([settle(() => goals?.close()), settle(() => controller?.browser?.close({ shutdown: true }))]))
    .then(() => settle(() => controller?.close()));
  const limit = new Promise(resolve => setTimeout(resolve, 20000).unref?.());
  Promise.race([shutdown, limit]).finally(() => app.quit());
});
