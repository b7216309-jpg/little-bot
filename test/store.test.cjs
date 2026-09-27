'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-store-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, filePath: path.join(directory, 'nested', 'state.json'), defaultWorkspace: directory };
}

function write(f, text) {
  fs.mkdirSync(path.dirname(f.filePath), { recursive: true });
  fs.writeFileSync(f.filePath, text);
}

test('new state is minimal and save preserves live references without persisting credentials', t => {
  const f = fixture(t);
  const store = new Store(f);
  assert.equal(store.data.settings.connection, 'local');
  assert.equal(store.data.settings.workspace, f.directory);
  assert.equal(store.data.settings.model, store.data.settings.localModel);
  assert.equal(store.data.settings.effort, 'low');
  assert.equal(store.data.settings.autoCompactPercent, 80);
  assert.deepEqual(store.data.chats, []);
  assert.deepEqual(store.data.automations, []);
  assert.deepEqual(store.data.memory, { enabled: true, facts: [], episodes: [] });
  assert.equal(store.data.heartbeat.enabled, false);
  assert.equal(store.data.heartbeat.mode, 'act');
  store.data.auth = { apiKey: 'sensitive-test-value' };
  store.data.settings.apiKey = 'sensitive-test-value';
  const chat = { id: 'one', status: 'running', createdAt: 100, updatedAt: 200, messages: [] };
  store.data.chats.push(chat);
  store.save();
  assert.equal(store.data.chats[0], chat);
  const saved = JSON.parse(fs.readFileSync(f.filePath, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['automations', 'autonomy', 'chats', 'extensions', 'heartbeat', 'memory', 'settings']);
  assert.equal(saved.chats[0].status, 'running');
  assert.equal(fs.readFileSync(f.filePath, 'utf8').includes('sensitive-test-value'), false);
  assert.equal(fs.readdirSync(path.dirname(f.filePath)).length, 1);
});

test('update and flush persist every chat without an arbitrary history limit', t => {
  const f = fixture(t);
  const store = new Store(f);
  store.update(data => {
    Object.assign(data.settings, { connection: 'codex', model: 'test-model', codexModel: 'test-model' });
    data.chats = Array.from({ length: 105 }, (_, index) => ({
      id: `chat-${index}`, title: `Chat ${index}`, status: 'idle', messages: [], createdAt: index, updatedAt: index,
    }));
  });
  store.flush();
  const reloaded = new Store(f);
  assert.equal(reloaded.data.settings.connection, 'codex');
  assert.equal(reloaded.data.settings.model, 'test-model');
  assert.equal(reloaded.data.settings.codexModel, 'test-model');
  assert.equal(reloaded.data.chats.length, 105);
  assert.equal(reloaded.data.chats[0].createdAt, 0);
});

test('recovered tasks become idle with one interruption note and unchanged timestamps', t => {
  const f = fixture(t);
  write(f, JSON.stringify({
    chats: [{ id: 'one', status: 'waiting', error: 'Earlier note', createdAt: 123, updatedAt: 456, messages: [
      { id: 'assistant', role: 'assistant', text: 'Partial reply', status: 'running' },
      { id: 'command', role: 'tool', text: 'Partial output', status: 'inProgress' },
      { id: 'waiting', role: 'tool', text: 'Waiting', status: 'waiting' },
      { id: 'done', role: 'tool', text: 'Earlier result', status: 'completed' },
    ] }],
    automations: [{ id: 'job', enabled: true, lastStatus: 'running', lastRunAt: 20, nextRunAt: 100000 }],
  }));
  const store = new Store(f);
  assert.equal(store.data.chats[0].status, 'idle');
  assert.equal(store.data.chats[0].updatedAt, 456);
  assert.match(store.data.chats[0].error, /^Earlier note\nInterrupted/);
  assert.deepEqual(store.data.chats[0].messages.map(message => message.status), ['interrupted', 'interrupted', 'interrupted', 'completed']);
  assert.equal(store.data.chats[0].messages[0].text, 'Partial reply');
  assert.equal(store.data.automations[0].lastStatus, 'error');
  assert.equal(store.data.automations[0].lastRunAt, 20);
  store.save();
  const reloaded = new Store(f);
  assert.equal(reloaded.data.chats[0].error, store.data.chats[0].error);
  assert.equal(reloaded.data.chats[0].createdAt, 123);
  assert.deepEqual(reloaded.data.chats[0].messages, store.data.chats[0].messages);
});

test('corrupt state remains untouched until saved and is then retained in a recovery file', t => {
  const f = fixture(t);
  const broken = '{"settings": { unfinished';
  write(f, broken);
  const store = new Store(f);
  assert.match(store.warning, /original file is preserved/);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), broken);
  store.update(data => { Object.assign(data.settings, { connection: 'codex', model: 'new-model', codexModel: 'new-model' }); });
  assert.equal(fs.readFileSync(store.recoveryPath, 'utf8'), broken);
  const recovered = new Store(f);
  assert.equal(recovered.data.settings.connection, 'codex');
  assert.equal(recovered.data.settings.model, 'new-model');
  const recoveryPath = store.recoveryPath;
  store.save();
  assert.equal(store.recoveryPath, recoveryPath);
  assert.equal(fs.readdirSync(path.dirname(f.filePath)).length, 2);
});

test('failed atomic replacement leaves the prior saved state intact and cleans its temporary file', t => {
  const f = fixture(t);
  const store = new Store(f);
  store.save();
  const original = fs.readFileSync(f.filePath, 'utf8');
  const renameSync = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === f.filePath) throw new Error('simulated file lock');
    return renameSync(from, to);
  };
  try {
    store.data.settings.model = 'unsaved';
    assert.throws(() => store.save(), /simulated file lock/);
  } finally {
    fs.renameSync = renameSync;
  }
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(path.dirname(f.filePath)), ['state.json']);
});

test('invalid record shapes are reported and the original is retained while valid records are recovered', t => {
  const f = fixture(t);
  const original = JSON.stringify({ chats: [null, { id: 'valid', messages: [{ id: 'm', role: 'user', text: 'Keep me' }, null] }] });
  write(f, original);
  const store = new Store(f);
  assert.match(store.warning, /unexpected format/);
  assert.equal(store.data.chats[0].messages[0].text, 'Keep me');
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), original);
  store.save();
  assert.equal(fs.readFileSync(store.recoveryPath, 'utf8'), original);
});

test('v0.1 state migrates onto the current schema without losing saved content', t => {
  const f = fixture(t);
  const legacy = {
    settings: { workspace: f.directory, model: 'existing-model', effort: 'medium' },
    chats: [{ id: 'legacy-chat', title: 'Existing work', threadId: 'existing-thread', workspace: f.directory,
      model: 'existing-model', effort: 'medium', createdAt: 100, updatedAt: 200, status: 'idle', messages: [
        { id: 'request', role: 'user', text: 'Keep my original request.' },
        { id: 'reply', role: 'assistant', text: 'Keep my original answer.', status: 'completed' },
      ] }],
    automations: [{ id: 'legacy-task', name: 'Daily check', prompt: 'Check the existing project.', intervalMinutes: 1440,
      enabled: true, nextRunAt: 5000, lastRunAt: 3000, lastStatus: 'completed', workspace: f.directory,
      model: 'existing-model', effort: 'low' }],
  };
  write(f, JSON.stringify(legacy));
  const store = new Store(f);
  assert.equal(store.warning, null);

  assert.equal(store.data.settings.workspace, f.directory);
  assert.equal(store.data.settings.effort, 'medium');
  assert.equal(store.data.settings.codexModel, 'existing-model');

  const chat = store.data.chats[0];
  assert.equal(chat.id, 'legacy-chat');
  assert.equal(chat.connection, 'codex');
  assert.equal(chat.model, 'existing-model');
  assert.deepEqual(chat.messages.map(message => message.text), ['Keep my original request.', 'Keep my original answer.']);

  const automation = store.data.automations[0];
  assert.equal(automation.id, 'legacy-task');
  assert.equal(automation.connection, 'codex');
  assert.equal(automation.model, 'existing-model');
  assert.equal(automation.scheduleType, 'interval');
  assert.equal(automation.intervalMinutes, 1440);
  assert.equal(automation.prompt, 'Check the existing project.');

  assert.deepEqual(store.data.memory, { enabled: true, facts: [], episodes: [] });
  assert.equal(store.data.heartbeat.enabled, false);
  assert.equal(store.data.heartbeat.checklist, '');
  assert.equal(store.data.heartbeat.workspace, f.directory);
  assert.equal(store.data.heartbeat.runsToday, 0);
  assert.deepEqual(store.data.heartbeat.history, []);

  const normalized = structuredClone({
    settings: store.data.settings,
    chats: store.data.chats,
    automations: store.data.automations,
    memory: store.data.memory,
    heartbeat: store.data.heartbeat,
  });
  store.save();
  const reloaded = new Store(f);
  assert.deepEqual({
    settings: reloaded.data.settings,
    chats: reloaded.data.chats,
    automations: reloaded.data.automations,
    memory: reloaded.data.memory,
    heartbeat: reloaded.data.heartbeat,
  }, normalized);
});

test('memory scopes and heartbeat counters round-trip with bounded, redacted action history', t => {
  const f = fixture(t);
  const store = new Store(f);
  const recordedAt = Date.now() - 1000;
  store.data.memory = {
    enabled: false,
    facts: [
      { id: 'global-fact', text: 'Prefer concise replies.', scope: 'global', workspace: '', source: 'manual', createdAt: recordedAt, updatedAt: recordedAt },
      { id: 'folder-fact', text: 'This project uses TypeScript.', scope: 'workspace', workspace: f.directory, source: 'remember',
        sourceChatId: 'source-chat', createdAt: recordedAt, updatedAt: recordedAt },
    ],
    episodes: [
      { id: 'recent', chatId: 'source-chat', workspace: f.directory, summary: 'Request: Fix login.\nOutcome: Login repaired.', createdAt: recordedAt, updatedAt: recordedAt },
      { id: 'expired', chatId: 'old-chat', workspace: f.directory, summary: 'Expired work.', createdAt: recordedAt - 31 * 86400000, updatedAt: recordedAt - 31 * 86400000 },
    ],
  };
  const performedActions = Array.from({ length: 25 }, (_, index) => `Action ${index}: ${'read a source file '.repeat(40)}`);
  performedActions[0] = 'Command returned api_key=private-test-value';
  Object.assign(store.data.heartbeat, {
    enabled: true, checklist: 'Review outstanding work.', intervalMinutes: 45, maxRunsPerDay: 20,
    runsToday: 7, failureCount: 2, dayKey: '2026-09-26', lastStatus: 'alert', lastRunAt: recordedAt,
    nextRunAt: recordedAt + 45 * 60000, lastAlertAt: recordedAt, lastFingerprint: 'a'.repeat(64), lastActions: performedActions,
    history: Array.from({ length: 65 }, (_, index) => ({ id: `audit-${index}`, at: recordedAt - 65 + index,
      status: 'alert', summary: `Finished check ${index}.`, actions: performedActions, unread: index % 2 === 0 })),
  });
  store.save();
  const serialized = fs.readFileSync(f.filePath, 'utf8');
  assert.doesNotMatch(serialized, /private-test-value/);
  const reloaded = new Store(f);
  assert.equal(reloaded.data.memory.enabled, false);
  assert.deepEqual(reloaded.data.memory.facts, store.data.memory.facts);
  assert.equal(reloaded.data.memory.episodes.length, 1);
  assert.equal(reloaded.data.memory.episodes[0].id, 'recent');
  assert.equal(reloaded.data.memory.facts[1].workspace, f.directory);
  assert.equal(reloaded.data.memory.facts[1].sourceChatId, 'source-chat');
  const heartbeat = reloaded.data.heartbeat;
  assert.equal(heartbeat.enabled, true);
  assert.equal(heartbeat.runsToday, 7);
  assert.equal(heartbeat.failureCount, 2);
  assert.equal(heartbeat.dayKey, '2026-09-26');
  assert.equal(heartbeat.lastFingerprint, 'a'.repeat(64));
  assert.equal(heartbeat.nextRunAt, recordedAt + 45 * 60000);
  assert.equal(heartbeat.lastActions.length, 20);
  assert.match(heartbeat.lastActions[0], /\[redacted\]/);
  assert.ok(heartbeat.lastActions.every(action => action.length <= 500));
  assert.equal(heartbeat.history.length, 50);
  assert.equal(heartbeat.history[0].id, 'audit-15');
  assert.equal(heartbeat.history.at(-1).id, 'audit-64');
  assert.equal(heartbeat.history[0].unread, false);
  assert.equal(heartbeat.history.at(-1).unread, true);
  assert.ok(heartbeat.history.every(entry => entry.actions.length === 20 && entry.actions.every(action => action.length <= 500)));
  reloaded.save();
  const restored = new Store(f);
  assert.deepEqual(restored.data.memory, reloaded.data.memory);
  assert.deepEqual(restored.data.heartbeat, heartbeat);
});

test('interrupted heartbeat recovers once with retained run count and a deferred retry', t => {
  const f = fixture(t);
  const store = new Store(f);
  const startedAt = Date.now() - 1000;
  Object.assign(store.data.heartbeat, {
    enabled: true, checklist: 'Check unfinished work.', intervalMinutes: 30,
    lastStatus: 'running', lastRunAt: startedAt, nextRunAt: startedAt,
    runsToday: 4, failureCount: 1,
  });
  store.save();
  const recoveryStarted = Date.now();
  const reloaded = new Store(f);
  assert.equal(reloaded.data.heartbeat.enabled, true);
  assert.equal(reloaded.data.heartbeat.lastStatus, 'error');
  assert.match(reloaded.data.heartbeat.lastError, /interrupted.*closed/i);
  assert.equal(reloaded.data.heartbeat.lastRunAt, startedAt);
  assert.equal(reloaded.data.heartbeat.runsToday, 4);
  assert.equal(reloaded.data.heartbeat.failureCount, 2);
  assert.ok(reloaded.data.heartbeat.nextRunAt >= recoveryStarted + 60 * 60000);
  assert.deepEqual(reloaded.data.heartbeat.history, []);
  reloaded.save();
  const reopened = new Store(f);
  assert.deepEqual(reopened.data.heartbeat, reloaded.data.heartbeat);
});

test('context usage and compaction history persist without storing transient engine details', t => {
  const f = fixture(t);
  const store = new Store(f);
  store.data.chats.push({ id: 'compact', status: 'idle', messages: [{ id: 'u', role: 'user', text: 'Keep the original request.' }],
    context: { usedTokens: 84000, windowTokens: 200000, updatedAt: 100, stale: true, opaqueProviderData: 'excluded' },
    compaction: { status: 'idle', count: 2, lastAt: 90, lastError: null, timer: 'excluded' } });
  store.save();
  const restored = new Store(f).data.chats[0];
  assert.deepEqual(restored.context, { usedTokens: 84000, windowTokens: 200000, updatedAt: 100, stale: true });
  assert.deepEqual(restored.compaction, { status: 'idle', count: 2, lastAt: 90, lastError: null });
  assert.equal(restored.messages[0].text, 'Keep the original request.');
  assert.doesNotMatch(fs.readFileSync(f.filePath, 'utf8'), /excluded/);
});

test('interrupted compaction recovers without a false success or deleting visible history', t => {
  const f = fixture(t);
  write(f, JSON.stringify({ chats: [{ id: 'compact', status: 'running',
    messages: [{ id: 'u', role: 'user', text: 'Still here.' }],
    context: { usedTokens: 175000, windowTokens: 200000, updatedAt: 100, stale: false },
    compaction: { status: 'running', count: 3, lastAt: 80, lastError: null },
  }] }));
  const store = new Store(f);
  const chat = store.data.chats[0];
  assert.equal(chat.status, 'idle');
  assert.equal(chat.compaction.status, 'idle');
  assert.equal(chat.compaction.count, 3);
  assert.equal(chat.compaction.lastAt, 80);
  assert.match(chat.compaction.lastError, /interrupted/i);
  assert.equal(chat.context.stale, true);
  assert.equal(chat.context.usedTokens, 175000);
  assert.equal(chat.messages[0].text, 'Still here.');
  store.save();
  assert.deepEqual(new Store(f).data.chats[0].compaction, chat.compaction);
});

test('malformed context counts are unknown rather than misleading usage', t => {
  const f = fixture(t);
  write(f, JSON.stringify({ chats: [{ id: 'bad-context', context: { usedTokens: -20, windowTokens: 0 },
    compaction: { count: -3, lastAt: 'yesterday', status: 'complete' } }] }));
  const chat = new Store(f).data.chats[0];
  assert.equal(chat.context.usedTokens, null);
  assert.equal(chat.context.windowTokens, null);
  assert.deepEqual(chat.compaction, { status: 'idle', count: 0, lastAt: null, lastError: null });
});
