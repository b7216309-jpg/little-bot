'use strict';
// Read-only review of production modules with isolated state and injected failures.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../../..');
const { AppManagement } = require(path.join(repo, 'src/app-management.cjs'));
const { Controller } = require(path.join(repo, 'src/controller.cjs'));
const { Store } = require(path.join(repo, 'src/store.cjs'));
const { GoalRunner } = require(path.join(repo, 'src/goals.cjs'));
const { AgentTools } = require(path.join(repo, 'src/agent-tools.cjs'));
const { EventBus } = require(path.join(repo, 'src/event-bus.cjs'));
const { EventRuntime } = require(path.join(repo, 'src/event-runtime.cjs'));
const { manageSchedule } = require(path.join(repo, 'src/schedule-management.cjs'));
const { Scheduler, validateAutomation } = require(path.join(repo, 'src/scheduler.cjs'));
const { advanceMissedSchedules } = require(path.join(repo, 'src/missed-schedules.cjs'));
const { validateCalendarEvent, MAX_EVENTS } = require(path.join(repo, 'src/calendar.cjs'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-second-review-'));
const results = [];
async function check(id, fn) { results.push({ id, ...(await fn()) }); }
(async () => {
  await check('R1', async () => {
    let executions = 0;
    const c = { runtime: { status: 'ready' }, store: { data: { chats: [] } }, changed() {} };
    const app = new AppManagement({ controller: c, filename: path.join(root, 'operations.json'), handlers: new Map([['saveSettings', async () => { executions++; }]]) });
    app.close();
    const original = app.save.bind(app);
    app.save = () => { throw new Error('Injected disk failure'); };
    await assert.rejects(app.call('settings_manage', { action: 'save', payload: { effort: 'high' } }, { chat: { id: 'direct' } }), /disk failure/);
    const queuedAfterFailure = app.jobs.length;
    app.save = original;
    await app.tick();
    assert.equal(executions, 1);
    return { reproduced: true, queuedAfterFailure, executionsAfterRecovery: executions, finalStatus: app.jobs[0].status };
  });
  await check('R2', async () => {
    const source = fs.readFileSync(path.join(repo, 'src/main.cjs'), 'utf8');
    const start = source.indexOf('  function saveCalendarRecord(payload) {');
    const end = source.indexOf('  controller.appManagement =', start);
    assert.ok(start >= 0 && end > start);
    let persisted, notifications = 0, fail = true;
    const store = { data: { calendar: { events: [] } }, save() { if (fail) throw new Error('Injected disk failure'); persisted = structuredClone(this.data); } };
    const scope = { store, controller: { changed() {} }, eventRuntime: { calendarChanged() { notifications++; } }, validateCalendarEvent, MAX_EVENTS };
    vm.runInNewContext(source.slice(start, end), scope);
    assert.throws(() => scope.saveCalendarRecord({ title: 'Unconfirmed event', startLocal: '2026-10-04T12:00' }), /disk failure/);
    assert.equal(store.data.calendar.events.length, 1);
    fail = false; store.save();
    assert.equal(persisted.calendar.events.length, 1); assert.equal(notifications, 0);
    const id = store.data.calendar.events[0].id;
    fail = true; assert.throws(() => scope.deleteCalendarRecord(id), /disk failure/);
    assert.equal(store.data.calendar.events.length, 0);
    return { reproduced: true, failedCreateRemainedInMemory: true, laterUnrelatedSavePersistedIt: true, calendarNotifications: notifications, failedDeleteAlsoRemovedEvent: true };
  });
  await check('R2-goals', async () => {
    let fail = true;
    const store = { data: { settings: { workspace: root, connection: 'codex', model: 'fixture-model' } }, save() { if (fail) throw new Error('Injected disk failure'); } };
    const runner = new GoalRunner({ store, run: async () => {} });
    assert.throws(() => runner.save({ name: 'Unconfirmed goal', objective: 'Check an isolated fixture', workspace: root }), /disk failure/);
    assert.equal(runner.data.goals.length, 1);
    const id = runner.data.goals[0].id;
    assert.throws(() => runner.runNow(id), /disk failure/);
    assert.equal(runner.goal(id).status, 'queued'); assert.equal(runner.goal(id).authorized, true);
    fail = false;
    return { reproduced: true, failedSaveRetainedGoal: true, failedRunAuthorizedAndQueuedGoal: true, forcedRunRetained: runner.forceRuns.has(id) };
  });
  await check('R3', async () => {
    class Client extends EventEmitter {
      constructor() { super(); this.calls = []; this.engineActive = false; }
      async request(method, params) {
        this.calls.push(method);
        if (method === 'thread/start') return { thread: { id: 'fixture-thread' } };
        if (method === 'turn/start') {
          this.engineActive = true;
          this.emit('notification', 'turn/started', { threadId: params.threadId, turn: { id: 'fixture-turn' } });
          throw new Error('turn/start timed out; server may still be processing');
        }
        if (method === 'turn/interrupt') { this.engineActive = false; return {}; }
        if (method === 'thread/unsubscribe') return {};
        throw new Error('Unexpected fixture request: ' + method);
      }
      async close() {}
    }
    const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
    Object.assign(store.data.settings, { connection: 'codex', model: 'fixture-model', codexModel: 'fixture-model', workspace: root, independentCheckMode: 'off' });
    const client = new Client(); const c = new Controller({ store, client });
    c.runtime.status = 'ready'; c.account.status = 'connected'; c.connection = { type: 'codex', status: 'connected' };
    try {
      await assert.rejects(c.send({ text: 'Reproduce a lost start acknowledgement in an isolated fixture' }), /timed out/);
      const chat = store.data.chats[0];
      assert.equal(chat.status, 'idle'); assert.equal(client.engineActive, true);
      assert.equal(client.calls.includes('turn/interrupt'), false);
      const before = chat.messages.length;
      client.emit('notification', 'item/agentMessage/delta', { threadId: chat.threadId, turnId: 'fixture-turn', itemId: 'late', delta: 'Late output' });
      assert.equal(chat.messages.length, before);
      return { reproduced: true, appStatus: chat.status, engineStillActive: client.engineActive, interruptSent: false, lateTurnOutputSuppressed: true };
    } finally { await c.close(); }
  });
  await check('R2-automations', async () => {
    const store = { data: { settings: { connection: 'codex', model: 'fixture-model' }, automations: [] }, save() { throw new Error('Injected disk failure'); } };
    assert.throws(() => manageSchedule(store, 'create', { name: 'Unconfirmed routine', prompt: 'Check an isolated fixture', enabled: true, intervalMinutes: 60 }, { workspace: root }), /disk failure/);
    assert.equal(store.data.automations.length, 1); assert.equal(store.data.automations[0].enabled, true);
    return { reproduced: true, failedCreateRetainedEnabledRoutine: true };
  });
  await check('R4', async () => {
    const store = { data: { calendar: { events: [] }, automations: [], autonomy: { goals: [] }, standingIntents: { intents: [] } }, save() {} };
    let release, started, handled = 0;
    const running = new Promise(resolve => { release = resolve; });
    const began = new Promise(resolve => { started = resolve; });
    const bus = new EventBus({ dedupeWindowMs: 0 });
    const runtime = new EventRuntime({ store, eventBus: bus, scheduler: { runNow: async () => { started(); await running; } }, goals: {}, heartbeat: {}, setIntervalFn: () => ({ unref() {} }), clearIntervalFn() {} });
    bus.subscribe({ type: 'calendar.created', handler: () => { handled++; } });
    runtime.start(); await bus.drain();
    runtime.publish({ type: 'automation.due', source: 'scheduler', payload: { automationId: 'fixture' } });
    await began;
    runtime.publish({ type: 'calendar.created', source: 'calendar', priority: 10, payload: { eventId: 'one' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(handled, 0); assert.equal(bus.state.dispatching, true);
    const pendingBefore = bus.state.queued;
    for (let i = 0; i < 105; i++) runtime.publish({ type: 'calendar.created', source: 'calendar', payload: { eventId: 'burst-' + i } });
    const droppedDuringRun = bus.state.dropped;
    assert.ok(droppedDuringRun > 0);
    release(); await bus.drain();
    const handledAfterRelease = handled;
    runtime.stop();
    return { reproduced: true, urgentCalendarHandlersDuringAutomation: 0, pendingBeforeBurst: pendingBefore, droppedDuring105EventBurst: droppedDuringRun, handlersAfterAutomationFinished: handledAfterRelease };
  });
  await check('calendar-extra-evidence', async () => {
    const records = Array.from({ length: 9 }, (_, i) => ({ id: String(i), title: 'Event ' + (i + 1) }));
    const tools = new AgentTools({ store: { data: {} }, manageCalendar: async (action) => { assert.equal(action, 'list'); return { events: records }; } });
    assert.ok(tools.specs({ readOnly: true }).some(x => x.name === 'calendar_list'));
    const result = await tools.call('calendar_list', { limit: 200 }, { chat: { id: 'goal', internal: true, workspace: root } });
    assert.equal(result.events[8].title, 'Event 9');
    return { reproduced: false, passed: true, note: 'Read-only task tool can retrieve the ninth event; no missing-tool defect.' };
  });
  await check('R5', async () => {
    const source = fs.readFileSync(path.join(repo, 'src/controller.cjs'), 'utf8');
    const skill = fs.readFileSync(path.join(repo, 'resources/skills/little-bot/SKILL.md'), 'utf8');
    assert.ok(source.toLowerCase().includes('if a scheduled time is missed, run once when available'));
    assert.ok(skill.includes('without running the missed occurrence'));
    const now = new Date(2026, 9, 1, 12).getTime();
    const routine = validateAutomation({ name: 'Missed clock', prompt: 'Fixture', scheduleType: 'clock', clockTime: '11:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], enabled: true }, null, { workspace: root, connection: 'codex' }, now - 86400000);
    routine.nextRunAt = now - 3600000;
    const result = advanceMissedSchedules({ automations: [routine] }, now);
    assert.equal(result.automations.length, 1); assert.ok(routine.nextRunAt > now);
    return { reproduced: true, basePromptPromisesCatchUp: true, bundledGuideSaysSkip: true, implementationAdvancesToFuture: true };
  });
  await check('R6', async () => {
    const store = { data: { settings: { workspace: root, connection: 'codex', model: 'fixture-model' }, automations: [] }, save() {} };
    const old = validateAutomation({ name: 'Original routine', prompt: 'Original task', enabled: true, intervalMinutes: 60 }, null, store.data.settings);
    store.data.automations.push(old);
    let release, began, executedPrompt;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { began = resolve; });
    const events = [];
    const scheduler = new Scheduler({ store, publish: event => events.push(event), run: async record => { executedPrompt = record.prompt; began(); await pending; return true; } });
    const running = scheduler.runNow(old.id); await started;
    const source = fs.readFileSync(path.join(repo, 'src/main.cjs'), 'utf8');
    const start = source.indexOf("  register('saveAutomation', payload => {");
    const end = source.indexOf("  register('deleteAutomation'", start);
    assert.ok(start >= 0 && end > start);
    let saveHandler;
    vm.runInNewContext(source.slice(start, end), { store, validateAutomation, controller: { changed() {}, state() {} }, register: (_, handler) => { saveHandler = handler; } });
    assert.throws(() => manageSchedule(store, 'update', { id: old.id, name: 'Edited routine', prompt: 'Edited task' }, { workspace: root }), /before changing/);
    saveHandler({ ...old, name: 'Edited routine', prompt: 'Edited task' });
    release(); await running;
    assert.equal(old.prompt, 'Edited task'); assert.equal(executedPrompt, 'Original task'); assert.equal(old.lastStatus, 'completed');
    assert.equal(events.at(-1).payload.name, 'Edited routine');
    return { reproduced: true, agentEditRefusedDuringRun: true, uiEditAcceptedDuringRun: true, executedPrompt, savedPrompt: old.prompt, lastStatus: old.lastStatus, completionEventName: events.at(-1).payload.name };
  });
  await check('browser-long-path', async () => {
    const binary = path.join(repo, 'node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
    if (process.platform !== 'win32' || !fs.existsSync(binary)) return { tested: false, reason: 'Requires Windows and installed dependency' };
    const actual = spawnSync(binary, ['--version'], { windowsHide: true, encoding: 'utf8' });
    const extended = spawnSync(path.toNamespacedPath(binary), ['--version'], { windowsHide: true, encoding: 'utf8' });
    return { tested: true, pathLength: binary.length, normalStatus: actual.status, normalError: actual.error?.code || null, extendedStatus: extended.status, extendedError: extended.error?.code || null, reproduced: Boolean(actual.error && !extended.error && extended.status === 0) };
  });
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  // Only remove the newly created, verified temporary fixture directory.
  const resolved = path.resolve(root), parent = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('little-bot-second-review-')) throw new Error('Unsafe fixture cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
