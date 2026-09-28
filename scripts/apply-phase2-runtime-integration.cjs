'use strict';

const fs = require('node:fs');

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); }
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }
function replaceOnce(file, before, after, label) {
  const source = read(file);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  write(file, source.replace(before, after));
}

// Persist standing intents as ordinary operational state.
replaceOnce('src/store.cjs',
  `const { normalizeIndependentCheckMode, normalizeIndependentCheckRecord } = require('./independent-check.cjs');`,
  `const { normalizeIndependentCheckMode, normalizeIndependentCheckRecord } = require('./independent-check.cjs');\nconst { normalizeStandingIntents } = require('./standing-intents.cjs');`,
  'store import');
replaceOnce('src/store.cjs',
  `  return {\n    autonomy: normalizeAutonomy(data.autonomy, { ...settings, workspace: string(settings.workspace, defaultWorkspace) }, recovering),`,
  `  return {\n    autonomy: normalizeAutonomy(data.autonomy, { ...settings, workspace: string(settings.workspace, defaultWorkspace) }, recovering),\n    standingIntents: normalizeStandingIntents(data.standingIntents, Date.now(), recovering),`,
  'store state');
replaceOnce('src/store.cjs',
  `        || ['chats', 'automations'].some(key => source[key] !== undefined\n          && (!Array.isArray(source[key]) || source[key].some(item => !isObject(item))))`,
  `        || (source.standingIntents !== undefined && (!isObject(source.standingIntents) || !Array.isArray(source.standingIntents.intents)))\n        || ['chats', 'automations'].some(key => source[key] !== undefined\n          && (!Array.isArray(source[key]) || source[key].some(item => !isObject(item))))`,
  'store shape');

// Route timed automations through the event queue while preserving direct manual execution.
replaceOnce('src/scheduler.cjs',
  `  constructor({ store, run, canRun = () => true, onChange = () => {}, now = Date.now }) {\n    if (!store || typeof store.save !== 'function') throw new TypeError('A store is required.');\n    if (typeof run !== 'function') throw new TypeError('A task runner is required.');\n    this.store = store;\n    this.canRun = canRun;\n    this.run = run;\n    this.onChange = onChange;\n    this.now = now;`,
  `  constructor({ store, run, canRun = () => true, onChange = () => {}, now = Date.now, publish = null }) {\n    if (!store || typeof store.save !== 'function') throw new TypeError('A store is required.');\n    if (typeof run !== 'function') throw new TypeError('A task runner is required.');\n    if (publish !== null && typeof publish !== 'function') throw new TypeError('Scheduler publish must be a function.');\n    this.store = store;\n    this.canRun = canRun;\n    this.run = run;\n    this.onChange = onChange;\n    this.now = now;\n    this.publish = publish;`,
  'scheduler constructor');
replaceOnce('src/scheduler.cjs',
  `    if (!due) return null;\n    try {\n      return await this.runNow(due.id);\n    } catch {\n      // The failure is saved on the record; periodic calls must never reject.\n      return null;\n    }`,
  `    if (!due) return null;\n    if (this.publish) return this.publish({\n      type: 'automation.due', source: 'scheduler', priority: 4,\n      dedupeKey: \`automation:due:\${due.id}:\${due.nextRunAt}\`,\n      expiresAt: nowMs + Math.max(MINUTE_MS, scheduleTypeOf(due) === 'clock' ? 60 * MINUTE_MS : due.intervalMinutes * MINUTE_MS),\n      payload: { automationId: due.id, name: due.name, workspace: due.workspace, dueAt: due.nextRunAt },\n    });\n    try {\n      return await this.runNow(due.id);\n    } catch {\n      // The failure is saved on the record; periodic calls must never reject.\n      return null;\n    }`,
  'scheduler due event');
replaceOnce('src/scheduler.cjs',
  `      this.store.save();\n      this.onChange();\n      // The runner resolves only after its task finishes, including any user-input wait.`,
  `      this.store.save();\n      this.onChange();\n      this.publish?.({ type: 'automation.started', source: 'scheduler',\n        payload: { automationId: automation.id, name: automation.name, workspace: automation.workspace, startedAt } });\n      // The runner resolves only after its task finishes, including any user-input wait.`,
  'scheduler started event');
replaceOnce('src/scheduler.cjs',
  `    this.store.save();\n    this.onChange();\n  }\n}`,
  `    this.store.save();\n    this.onChange();\n    this.publish?.({\n      type: status === 'completed' ? 'automation.completed' : 'automation.error',\n      source: 'scheduler',\n      payload: { automationId: automation.id, name: automation.name, workspace: automation.workspace,\n        finishedAt: nowMs, ...(error ? { error: String(error).slice(0, 2000) } : {}) },\n    });\n  }\n}`,
  'scheduler completion event');

// Heartbeat timing becomes an event source; manual Run now remains direct.
replaceOnce('src/heartbeat.cjs',
  `  constructor({ store, run, canRun = () => true, canNotify = () => true, onChange = () => {}, onAlert = () => {}, now = Date.now }) {\n    if (!store || !object(store.data) || typeof store.save !== 'function') throw new TypeError('A store is required.');\n    if (typeof run !== 'function') throw new TypeError('A heartbeat runner is required.');\n    if (typeof canRun !== 'function' || typeof canNotify !== 'function' || typeof now !== 'function') throw new TypeError('Heartbeat availability and clock must be functions.');`,
  `  constructor({ store, run, canRun = () => true, canNotify = () => true, onChange = () => {}, onAlert = () => {}, now = Date.now, publish = null }) {\n    if (!store || !object(store.data) || typeof store.save !== 'function') throw new TypeError('A store is required.');\n    if (typeof run !== 'function') throw new TypeError('A heartbeat runner is required.');\n    if (typeof canRun !== 'function' || typeof canNotify !== 'function' || typeof now !== 'function') throw new TypeError('Heartbeat availability and clock must be functions.');\n    if (publish !== null && typeof publish !== 'function') throw new TypeError('Heartbeat publish must be a function.');`,
  'heartbeat constructor signature');
replaceOnce('src/heartbeat.cjs',
  `    this.onAlert = onAlert;\n    this.now = now;`,
  `    this.onAlert = onAlert;\n    this.now = now;\n    this.publish = publish;`,
  'heartbeat publish field');
replaceOnce('src/heartbeat.cjs',
  `      if (config.dayKey === localDay(nowMs) && config.runsToday >= config.maxRunsPerDay) return null;\n      return await this.runNow();`,
  `      if (config.dayKey === localDay(nowMs) && config.runsToday >= config.maxRunsPerDay) return null;\n      if (this.publish) return this.publish({\n        type: 'heartbeat.due', source: 'heartbeat', priority: 3,\n        dedupeKey: \`heartbeat:due:\${config.nextRunAt}\`,\n        expiresAt: nowMs + Math.max(MINUTE, config.intervalMinutes * MINUTE),\n        payload: { dueAt: config.nextRunAt, workspace: config.workspace },\n      });\n      return await this.runNow();`,
  'heartbeat due event');
replaceOnce('src/heartbeat.cjs',
  `        });\n      } catch (error) { throw this._storageFailure(error); }\n\n      let result;`,
  `        });\n      } catch (error) { throw this._storageFailure(error); }\n      this.publish?.({ type: 'heartbeat.started', source: 'heartbeat',\n        payload: { startedAt, workspace: config.workspace } });\n\n      let result;`,
  'heartbeat started event');
replaceOnce('src/heartbeat.cjs',
  `    if (alert) this._notify(alert);\n  }\n\n  _notificationsAvailable`,
  `    if (alert) this._notify(alert);\n    this.publish?.({ type: \`heartbeat.\${status}\`, source: 'heartbeat',\n      payload: { status, summary, topic, actions: performedActions, workspace: this.store.data.heartbeat.workspace, finishedAt: nowMs } });\n  }\n\n  _notificationsAvailable`,
  'heartbeat completion event');

// Goals publish lifecycle and stable file-change observations.
replaceOnce('src/goals.cjs',
  `  constructor({ store, run, stopRun, verifyCommand, backupRoot, canRun = () => true, onChange = () => {}, onAlert = () => {} }) {\n    Object.assign(this, { store, run, stopRun, verifyCommand, backupRoot, canRun, onChange, onAlert });`,
  `  constructor({ store, run, stopRun, verifyCommand, backupRoot, canRun = () => true, onChange = () => {}, onAlert = () => {}, publish = null }) {\n    if (publish !== null && typeof publish !== 'function') throw new TypeError('Goal publish must be a function.');\n    Object.assign(this, { store, run, stopRun, verifyCommand, backupRoot, canRun, onChange, onAlert, publish });`,
  'goal constructor');
replaceOnce('src/goals.cjs',
  `  record(goal, kind, summary, extra = {}) { goal.updatedAt = Date.now(); goal.history = historyOf([...goal.history, { id: randomUUID(), at: Date.now(), kind, summary, ...extra }]); }\n  save(input, { authorize = false } = {}) {`,
  `  record(goal, kind, summary, extra = {}) { goal.updatedAt = Date.now(); goal.history = historyOf([...goal.history, { id: randomUUID(), at: Date.now(), kind, summary, ...extra }]); }\n  emit(type, goal, payload = {}, options = {}) {\n    if (!this.publish) return null;\n    try { return this.publish({ type, source: 'goal.runner', ...options, payload: { goalId: goal.id, name: goal.name, workspace: goal.workspace, ...payload } }); }\n    catch { return null; }\n  }\n  save(input, { authorize = false } = {}) {`,
  'goal emit helper');
replaceOnce('src/goals.cjs',
  `    this.forceRuns.add(id); this.record(goal, 'queued', 'Queued by you.'); this.changed(); this.wake(); return goal;`,
  `    this.forceRuns.add(id); this.record(goal, 'queued', 'Queued by you.'); this.changed();\n    this.emit('goal.queued', goal, { queuedAt: Date.now() }, { dedupeKey: \`goal:queued:\${goal.id}:\${goal.updatedAt}\` });\n    this.wake(); return goal;`,
  'goal queued event');
replaceOnce('src/goals.cjs',
  `    this.onChange(); this.wake(); return goal;\n  }\n  async pauseAll()`,
  `    this.onChange();\n    this.emit('goal.question_answered', goal, { questionId, answeredAt: Date.now() });\n    this.wake(); return goal;\n  }\n  async pauseAll()`,
  'goal answer event');
replaceOnce('src/goals.cjs',
  `              if (previous?.fingerprint === fingerprint && Date.now() - previous.at >= 1000) ready = true;\n              else this.filePending.set(goal.id, { fingerprint, at: Date.now() });`,
  `              if (previous?.fingerprint === fingerprint && Date.now() - previous.at >= 1000) {\n                ready = true;\n                this.emit('file.changed', goal, { paths: goal.trigger.paths, fingerprint, previousFingerprint: goal.triggerFingerprint },\n                  { dedupeKey: \`file:\${goal.id}:\${fingerprint}\`, debounceKey: \`file:\${goal.id}\`, debounceMs: 1000 });\n              } else this.filePending.set(goal.id, { fingerprint, at: Date.now() });`,
  'goal file event');
replaceOnce('src/goals.cjs',
  `  block(goal, reason, extra = {}) { goal.status = 'blocked'; goal.nextStep = reason; this.record(goal, 'blocked', reason, { status: 'blocked', ...extra }); this.changed(); this.onAlert({ title: goal.name, message: reason, goalId: goal.id }); }`,
  `  block(goal, reason, extra = {}) {\n    goal.status = 'blocked'; goal.nextStep = reason; this.record(goal, 'blocked', reason, { status: 'blocked', ...extra }); this.changed();\n    this.emit('goal.blocked', goal, { reason, blockedAt: Date.now() });\n    this.onAlert({ title: goal.name, message: reason, goalId: goal.id });\n  }`,
  'goal blocked event');
replaceOnce('src/goals.cjs',
  `    this.record(goal, 'completed', 'Goal completed and verified after the final allowed action.', { runId, status: 'completed' });\n    this.changed(); this.onAlert({ title: goal.name, message: 'Goal completed and verified.', goalId: goal.id });\n    return true;`,
  `    this.record(goal, 'completed', 'Goal completed and verified after the final allowed action.', { runId, status: 'completed' });\n    this.changed();\n    this.emit('goal.completed', goal, { runId, summary: 'Goal completed and verified after the final allowed action.', completedAt: Date.now() });\n    this.onAlert({ title: goal.name, message: 'Goal completed and verified.', goalId: goal.id });\n    return true;`,
  'goal budget completion event');
replaceOnce('src/goals.cjs',
  `        goal.status = 'completed'; goal.nextStep = ''; this.record(goal, 'completed', 'Verified: the completion conditions already pass. No model call was needed.', { runId, status: 'completed', verification: checked.results }); this.changed(); this.onAlert({ title: goal.name, message: 'Goal completed and verified.', goalId: goal.id }); return;`,
  `        goal.status = 'completed'; goal.nextStep = '';\n        const summary = 'Verified: the completion conditions already pass. No model call was needed.';\n        this.record(goal, 'completed', summary, { runId, status: 'completed', verification: checked.results }); this.changed();\n        this.emit('goal.completed', goal, { runId, summary, completedAt: Date.now() });\n        this.onAlert({ title: goal.name, message: 'Goal completed and verified.', goalId: goal.id }); return;`,
  'goal preverified completion event');
replaceOnce('src/goals.cjs',
  `      if (checked.passed) { goal.status = 'completed'; goal.nextStep = ''; this.record(goal, 'completed', 'Goal completed and verified.', { runId, status: 'completed' }); this.onAlert({ title: goal.name, message: 'Goal completed and verified.', goalId: goal.id }); }`,
  `      if (checked.passed) {\n        goal.status = 'completed'; goal.nextStep = ''; const summary = 'Goal completed and verified.';\n        this.record(goal, 'completed', summary, { runId, status: 'completed' });\n        this.emit('goal.completed', goal, { runId, summary, completedAt: Date.now() });\n        this.onAlert({ title: goal.name, message: summary, goalId: goal.id });\n      }`,
  'goal completion event');

// Controller exposes runtime state and completed chat events.
replaceOnce('src/controller.cjs',
  `    this.webServices = null;\n    this.agentToolCalls = new Map();`,
  `    this.webServices = null;\n    this.eventRuntime = null;\n    this.agentToolCalls = new Map();`,
  'controller runtime field');
replaceOnce('src/controller.cjs',
  `      independentCheckRuntime: this.independentCheck.state,\n      profile:`,
  `      independentCheckRuntime: this.independentCheck.state,\n      eventRuntime: this.eventRuntime?.state || { status: 'stopped', bus: { started: false, queued: 0 }, standingIntentCount: 0, enabledStandingIntentCount: 0 },\n      profile:`,
  'controller runtime state');
replaceOnce('src/controller.cjs',
  `    chat.messages = chat.messages.filter(message => message.kind !== 'reasoning' || message.text.trim());\n    this.turns.delete(chat.id);`,
  `    chat.messages = chat.messages.filter(message => message.kind !== 'reasoning' || message.text.trim());\n    if (!chat.internal && !manual) this.eventRuntime?.publish({\n      type: error ? 'chat.failed' : 'chat.completed', source: 'chat',\n      dedupeKey: \`chat:\${chat.id}:\${turnId || finishedAt}\`,\n      payload: { chatId: chat.id, title: chat.title, workspace: chat.workspace, automationId: chat.automationId || null,\n        status: error ? 'failed' : 'completed', finishedAt, ...(error ? { error: cleanError(error) } : {}) },\n    });\n    this.turns.delete(chat.id);`,
  'controller chat event');
replaceOnce('src/controller.cjs',
  `  async close() {\n    this.closing = true;`,
  `  async close() {\n    this.closing = true;\n    this.eventRuntime?.stop();`,
  'controller stop event runtime');

// App wiring: one foreground runtime, no listener or background service.
replaceOnce('src/main.cjs',
  `const { GoalRunner } = require('./goals.cjs');`,
  `const { GoalRunner } = require('./goals.cjs');\nconst { EventRuntime } = require('./event-runtime.cjs');`,
  'main event import');
replaceOnce('src/main.cjs',
  `let window, controller, scheduler, heartbeat, goals, errorLog, quitting = false;`,
  `let window, controller, scheduler, heartbeat, goals, eventRuntime, errorLog, quitting = false;`,
  'main event variable');
replaceOnce('src/main.cjs',
  `  controller.extensionRuntime = extensionRuntime;\n  scheduler = new Scheduler({ store, run: runAutomation, canRun:`,
  `  controller.extensionRuntime = extensionRuntime;\n  const publishEvent = event => eventRuntime?.publish(event) || { accepted: false, reason: 'stopped' };\n  scheduler = new Scheduler({ store, run: runAutomation, publish: publishEvent, canRun:`,
  'main scheduler publish');
replaceOnce('src/main.cjs',
  `    onChange: () => controller.changed(),\n    onAlert: item => {`,
  `    onChange: () => controller.changed(),\n    publish: publishEvent,\n    onAlert: item => {`,
  'main heartbeat publish');
replaceOnce('src/main.cjs',
  `    onChange: () => controller.changed(),\n    onAlert: item => {\n      const goal =`,
  `    onChange: () => controller.changed(),\n    publish: publishEvent,\n    onAlert: item => {\n      const goal =`,
  'main goal publish');
replaceOnce('src/main.cjs',
  `  });\n  function saveCalendarRecord(payload) {`,
  `  });\n  eventRuntime = new EventRuntime({ store, scheduler, heartbeat, goals, controller,\n    onChange: ({ persisted }) => controller.changed(persisted === true),\n    onError: (error, event) => logDiagnostic('event-runtime', error, { eventType: event?.type }),\n  });\n  controller.eventRuntime = eventRuntime;\n  function saveCalendarRecord(payload) {`,
  'main event runtime construction');
replaceOnce('src/main.cjs',
  `    const event = validateCalendarEvent(payload, existing);\n    if (existing) Object.assign(existing, event);`,
  `    const action = existing ? 'updated' : 'created';\n    const event = validateCalendarEvent(payload, existing);\n    if (existing) Object.assign(existing, event);`,
  'calendar action');
replaceOnce('src/main.cjs',
  `    store.save();\n    controller.changed();\n    return event;\n  }\n  function deleteCalendarRecord`,
  `    store.save();\n    controller.changed();\n    eventRuntime?.calendarChanged(action, event);\n    return event;\n  }\n  function deleteCalendarRecord`,
  'calendar save event');
replaceOnce('src/main.cjs',
  `    store.save();\n    controller.changed();\n    return removed;\n  }\n\n  controller.agentTools`,
  `    store.save();\n    controller.changed();\n    eventRuntime?.calendarChanged('deleted', removed);\n    return removed;\n  }\n\n  controller.agentTools`,
  'calendar delete event');
replaceOnce('src/main.cjs',
  `  register('runAutomation', ({ id } = {}) => {\n    const automation = store.data.automations.find(item => item.id === id);\n    if (automation) { automation.authorized = true; store.save(); }\n    return scheduler.runNow(id);\n  });`,
  `  register('runAutomation', ({ id } = {}) => {\n    const automation = store.data.automations.find(item => item.id === id);\n    if (automation) { automation.authorized = true; store.save(); }\n    return scheduler.runNow(id);\n  });\n  register('saveStandingIntent', payload => { eventRuntime.saveIntent(payload); return controller.state(); });\n  register('deleteStandingIntent', ({ id } = {}) => { eventRuntime.removeIntent(id); return controller.state(); });\n  register('toggleStandingIntent', ({ id, enabled } = {}) => { eventRuntime.setIntentEnabled(id, enabled); return controller.state(); });`,
  'standing intent IPC');
replaceOnce('src/main.cjs',
  `    controller.changed(); scheduler.start(); heartbeat.start(); goals.start();`,
  `    controller.changed(); eventRuntime.start(); scheduler.start(); heartbeat.start(); goals.start();`,
  'runtime startup');
replaceOnce('src/main.cjs',
  `      scheduler.stop(); heartbeat.stop(); await goals.close(); await controller.close();`,
  `      scheduler.stop(); heartbeat.stop(); eventRuntime.stop(); await goals.close(); await controller.close();`,
  'smoke success stop');
replaceOnce('src/main.cjs',
  `    } catch (error) { console.error(cleanError(error.stack || error)); scheduler.stop(); heartbeat.stop(); await goals.close();`,
  `    } catch (error) { console.error(cleanError(error.stack || error)); scheduler.stop(); heartbeat.stop(); eventRuntime.stop(); await goals.close();`,
  'smoke failure stop');
replaceOnce('src/main.cjs',
  `  event.preventDefault(); quitting = true; scheduler?.stop(); heartbeat?.stop();`,
  `  event.preventDefault(); quitting = true; scheduler?.stop(); heartbeat?.stop(); eventRuntime?.stop();`,
  'quit stop');

// Store tests know about the new operational state.
replaceOnce('test/store.test.cjs',
  `  assert.deepEqual(store.data.automations, []);\n  assert.deepEqual(store.data.memory, { enabled: true, facts: [], episodes: [] });`,
  `  assert.deepEqual(store.data.automations, []);\n  assert.deepEqual(store.data.standingIntents, { intents: [] });\n  assert.deepEqual(store.data.memory, { enabled: true, facts: [], episodes: [] });`,
  'store default test');
replaceOnce('test/store.test.cjs',
  `  assert.deepEqual(Object.keys(saved).sort(), ['automations', 'autonomy', 'calendar', 'chats', 'extensions', 'heartbeat', 'memory', 'settings']);`,
  `  assert.deepEqual(Object.keys(saved).sort(), ['automations', 'autonomy', 'calendar', 'chats', 'extensions', 'heartbeat', 'memory', 'settings', 'standingIntents']);`,
  'store persisted keys');

const storeTest = read('test/store.test.cjs');
const storeAddition = `\n\ntest('standing intents persist and queued actions are skipped rather than replayed after restart', t => {\n  const f = fixture(t);\n  const store = new Store(f);\n  store.data.standingIntents.intents.push({\n    id: 'intent-1', name: 'Review report', enabled: true, priority: 2, debounceMs: 1000,\n    when: { type: 'file.changed', source: '', filters: [{ path: 'payload.path', operator: 'glob', value: 'reports/*.csv' }] },\n    action: { type: 'goal.run', goalId: 'goal-1' }, createdAt: 100, updatedAt: 100, triggerCount: 1,\n    lastTriggeredAt: 200, lastStatus: 'queued', lastEventId: 'event-1',\n  });\n  store.save();\n  const reloaded = new Store(f);\n  assert.equal(reloaded.data.standingIntents.intents.length, 1);\n  assert.equal(reloaded.data.standingIntents.intents[0].lastStatus, 'skipped');\n  assert.match(reloaded.data.standingIntents.intents[0].lastError, /not replayed/);\n});\n`;
if (!storeTest.includes("test('standing intents persist and queued actions are skipped")) write('test/store.test.cjs', storeTest.trimEnd() + storeAddition);

write('test/event-producers.test.cjs', `'use strict';\n\nconst test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { Scheduler } = require('../src/scheduler.cjs');\nconst { Heartbeat } = require('../src/heartbeat.cjs');\n\ntest('scheduler publishes due and lifecycle events when connected to the event runtime', async () => {\n  let now = 1000;\n  const events = [];\n  const automation = { id: 'a1', name: 'Report', prompt: 'Run', enabled: true, nextRunAt: 900, lastStatus: 'never',\n    workspace: 'C:\\\\Work', model: '', connection: 'codex', effort: 'low', scheduleType: 'interval', intervalMinutes: 60 };\n  const store = { data: { automations: [automation], settings: { connection: 'codex' } }, save() {} };\n  const scheduler = new Scheduler({ store, now: () => now, run: async () => true, publish: event => { events.push(event); return { accepted: true }; } });\n  await scheduler.tick();\n  assert.equal(events[0].type, 'automation.due');\n  events.length = 0;\n  await scheduler.runNow('a1');\n  assert.deepEqual(events.map(event => event.type), ['automation.started', 'automation.completed']);\n});\n\ntest('heartbeat publishes due and lifecycle events while retaining direct manual execution', async () => {\n  let now = Date.now();\n  const events = [];\n  const settings = { workspace: 'C:\\\\Work', model: '', connection: 'codex', effort: 'low' };\n  const store = { data: { settings, heartbeat: { enabled: true, mode: 'act', checklist: 'Check files', intervalMinutes: 30,\n    startHour: 0, endHour: 0, maxRunsPerDay: 12, maxAlertsPerDay: 3, snoozeMinutes: 60, workspace: settings.workspace,\n    model: '', connection: 'codex', effort: 'low', nextRunAt: now - 1, lastRunAt: null, lastStatus: 'never',\n    dayKey: '', runsToday: 0, failureCount: 0, lastFingerprint: '', lastAlertAt: null, lastActions: [], history: [], attention: {} } }, save() {} };\n  const heartbeat = new Heartbeat({ store, now: () => now, run: async () => ({ status: 'quiet', summary: '', actions: [], topic: '' }),\n    publish: event => { events.push(event); return { accepted: true }; } });\n  await heartbeat.tick();\n  assert.equal(events[0].type, 'heartbeat.due');\n  events.length = 0;\n  await heartbeat.runNow();\n  assert.deepEqual(events.map(event => event.type), ['heartbeat.started', 'heartbeat.quiet']);\n});\n`);
