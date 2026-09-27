'use strict';

// A small history-retrieval fixture; optional live QA uses only the local model.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { buildMemoryContext } = require('./memory.cjs');

const VERIFICATION = 'orchard-lantern-83';
const SECRET_FIXTURE = 'sk-recall_fake_not_a_real_key_726384910';

function session(settings, { title, text, workspace = settings.workspace, connection = settings.connection, localBaseUrl = settings.localBaseUrl, model = settings.model } = {}) {
  const date = Date.now() - 45 * 24 * 60 * 60 * 1000;
  return {
    id: randomUUID(), title, workspace, connection, ...(connection === 'local' ? { localBaseUrl } : {}), model,
    threadId: null, effort: 'low', status: 'idle', createdAt: date, updatedAt: date,
    messages: [
      { id: randomUUID(), role: 'user', text: `Record our decision for ${title}.`, createdAt: date },
      { id: randomUUID(), role: 'assistant', text, createdAt: date + 1000 },
      { id: randomUUID(), role: 'user', text: 'Now update the file index.', createdAt: date + 2000 },
      { id: randomUUID(), role: 'assistant', text: 'The file index is up to date.', createdAt: date + 3000 },
    ],
  };
}

async function run({ window, controller, store, stateDir }) {
  assert.ok(process.env.LITTLE_BOT_DATA_DIR, 'Recall smoke requires an isolated data directory.');
  assert.equal(store.data.chats.some(chat => chat.status !== 'idle'), false, 'Finish other smoke turns first.');
  assert.ok(controller.agentTools, 'The app tool router must be initialized.');
  const saved = { chats: [...store.data.chats], memory: structuredClone(store.data.memory), call: controller.agentTools.call };
  const fixture = session(store.data.settings, {
    title: 'Aurora launch decision',
    text: `Aurora launch decision: the chosen color is ochre. The review day is Thursday. Verification phrase: ${VERIFICATION}.`,
  });
  const wrongWorkspace = session(store.data.settings, { title: 'Aurora private other workspace', text: 'Aurora private boundary marker meadow-only-57.', workspace: path.join(stateDir, 'another-workspace') });
  const wrongProvider = session(store.data.settings, { title: 'Aurora private other provider', text: 'Aurora provider boundary marker quartz-only-92.', connection: store.data.settings.connection === 'local' ? 'codex' : 'local' });
  const deleted = session(store.data.settings, { title: 'Removed cedar planning', text: 'Removed cedar decision pine-only-24.' });
  const secret = session(store.data.settings, { title: 'Credential fixture', text: `Never recall this credential: ${SECRET_FIXTURE}` });
  const context = { id: randomUUID(), workspace: store.data.settings.workspace, connection: store.data.settings.connection,
    localBaseUrl: store.data.settings.localBaseUrl, model: store.data.settings.model, status: 'running', messages: [] };
  let liveChat;
  const toolCalls = [];
  const call = (name, args, chat = context) => controller.agentTools.call(name, args, { chat });
  try {
    store.data.chats = [fixture, wrongWorkspace, wrongProvider, deleted, secret, ...saved.chats];
    store.data.memory = { enabled: true, facts: [], episodes: [{ id: randomUUID(), chatId: fixture.id, workspace: fixture.workspace,
      summary: 'Request: Update the file index. Outcome: The file index is up to date.', createdAt: fixture.createdAt, updatedAt: fixture.updatedAt }] };
    assert.ok(fixture.updatedAt < Date.now() - 30 * 24 * 60 * 60 * 1000, 'The source must outlive recent-work retention.');
    assert.equal(buildMemoryContext(store.data.memory, { workspace: fixture.workspace, query: 'Aurora launch' }).includes(VERIFICATION), false,
      'The answer must require retrieval; recent-memory context cannot contain it.');
    const found = await call('memory_search', { query: 'Aurora launch', source: 'sessions', scope: 'workspace', limit: 10 });
    assert.ok(Array.isArray(found.results));
    const hit = found.results.find(item => item.sessionId === fixture.id);
    assert.ok(hit, 'Search must find the 45-day-old session.');
    assert.equal(found.results.some(item => [wrongWorkspace.id, wrongProvider.id].includes(item.sessionId)), false);
    const opened = await call('session_read', { sessionId: hit.sessionId, offset: hit.offset || 0, limit: 10 });
    assert.match(JSON.stringify(opened), /orchard-lantern-83/);
    assert.equal(opened.session.id, fixture.id);
    await assert.rejects(() => call('session_read', { sessionId: wrongWorkspace.id }), /workspace|folder|scope|available|access|found|permitted/i);
    await assert.rejects(() => call('session_read', { sessionId: wrongProvider.id, scope: 'all' }), /provider|connection|available|access|found|permitted/i);

    const secrets = await call('memory_search', { query: 'credential', source: 'sessions', limit: 10 });
    assert.equal(JSON.stringify(secrets).includes(SECRET_FIXTURE), false, 'Search must not return credential-looking text.');
    const secretSource = await call('session_read', { sessionId: secret.id, limit: 20 });
    assert.equal(JSON.stringify(secretSource).includes(SECRET_FIXTURE), false, 'Session reading must not return credential-looking text.');

    const beforeDeletion = await call('memory_search', { query: 'Removed cedar', source: 'sessions' });
    assert.ok(beforeDeletion.results.some(item => item.sessionId === deleted.id));
    store.data.chats = store.data.chats.filter(item => item.id !== deleted.id);
    const afterDeletion = await call('memory_search', { query: 'Removed cedar', source: 'sessions' });
    assert.equal(afterDeletion.results.some(item => item.sessionId === deleted.id), false, 'Deleted sessions cannot remain searchable.');
    await assert.rejects(() => call('session_read', { sessionId: deleted.id }), /available|found|deleted|exist/i);

    store.data.memory.enabled = false;
    await assert.rejects(() => call('memory_search', { query: 'Aurora' }), /memory|disabled|paused/i);
    await assert.rejects(() => call('session_read', { sessionId: fixture.id }), /memory|disabled|paused/i);
    store.data.memory.enabled = true;
    store.save(); controller.changed();
    const result = { oldSessionSearch: true, sourceRead: true, workspaceBoundary: true, providerBoundary: true,
      secretExclusion: true, deletedSessionExcluded: true, memoryOffRespected: true, live: { skipped: true } };

    if (process.env.LITTLE_BOT_LIVE_LOCAL_QA !== '1') return result;
    assert.equal(store.data.settings.connection, 'local', 'Live recall QA is local-only.');
    assert.equal(controller.connection?.type, 'local');
    assert.equal(controller.connection?.status, 'connected');
    assert.equal(controller.runtime.status, 'ready');
    controller.agentTools.call = async function(name, args, options) {
      if (name === 'memory_search' || name === 'session_read') toolCalls.push({ name, args: structuredClone(args), chatId: options?.chat?.id });
      return saved.call.call(this, name, args, options);
    };
    const prompt = 'Search our saved sessions in this workspace for the Aurora launch decision. Then open the matching source session with session_read before answering. What color did we choose, which day is the review, and what verification phrase did we record? Cite the source session by its title and exact session ID. Keep the answer short. Use memory_search and session_read, not terminal commands or external tools.';
    const started = await controller.send({ text: prompt });
    liveChat = store.data.chats.find(item => item.id === started.chatId);
    assert.ok(liveChat);
    const deadline = Date.now() + 180000;
    while (liveChat.status !== 'idle' && Date.now() < deadline) await delay(200);
    assert.equal(liveChat.status, 'idle', 'The local recall turn exceeded three minutes.');
    assert.equal(liveChat.error, null, liveChat.error || 'The local recall turn failed.');
    const calls = toolCalls.filter(item => item.chatId === liveChat.id);
    const searchIndex = calls.findIndex(item => item.name === 'memory_search');
    const readIndex = calls.findIndex(item => item.name === 'session_read' && item.args.sessionId === fixture.id);
    assert.ok(searchIndex >= 0, 'The real model must invoke memory_search.');
    assert.ok(readIndex > searchIndex, 'The real model must open its matched source after searching.');
    const answer = liveChat.messages.filter(item => item.role === 'assistant' && item.phase !== 'commentary').map(item => item.text).join('\n');
    for (const expected of [/\bochre\b/i, /\bThursday\b/i, /orchard-lantern-83/, /Aurora launch/i]) assert.match(answer, expected);
    assert.ok(answer.includes(fixture.id), 'The answer must identify its source session.');
    assert.equal(answer.includes('meadow-only-57') || answer.includes('quartz-only-92') || answer.includes(SECRET_FIXTURE), false);
    if (window && process.env.LITTLE_BOT_SMOKE_OUTPUT) {
      await fs.mkdir(process.env.LITTLE_BOT_SMOKE_OUTPUT, { recursive: true });
      window.showInactive();
      controller.changed();
      await delay(150);
      await window.webContents.executeJavaScript(`selectChat(${JSON.stringify(liveChat.id)})`);
      await delay(150);
      await fs.writeFile(path.join(process.env.LITTLE_BOT_SMOKE_OUTPUT, 'recall-live-local.png'), (await window.webContents.capturePage()).toPNG());
    }
    result.live = { model: liveChat.model, oldDecisionRecovered: true, realSearchThenSourceRead: true, sourceCited: true, modelTurns: 1, answer };
    return result;
  } finally {
    controller.agentTools.call = saved.call;
    if (liveChat && liveChat.status !== 'idle') {
      await controller.stop({ chatId: liveChat.id }).catch(() => {});
      for (let i = 0; i < 50 && liveChat.status !== 'idle'; i++) await delay(100);
    }
    if (!liveChat || liveChat.status === 'idle') {
      if (liveChat) {
        for (const map of [controller.outcomes, controller.turns, controller.latestTurns, controller.completedTurns]) map.delete(liveChat.id);
        if (liveChat.threadId) { controller.resumed.delete(liveChat.threadId); controller.threadCompactionSettings.delete(liveChat.threadId); }
      }
      store.data.chats = saved.chats; store.data.memory = saved.memory;
      store.save(); controller.changed();
    }
  }
}

module.exports = { run };
