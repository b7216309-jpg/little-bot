// Explicit developer smoke mode. Uses an isolated LITTLE_BOT_DATA_DIR and no model calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const quote = value => `'${value.replace(/'/g, "''")}'`;

async function run({ window, controller, store, stateDir, extensionFiles, extensionRuntime, goals, heartbeat }) {
  assert.ok(process.env.LITTLE_BOT_DATA_DIR, 'Smoke tests require an isolated data directory.');
  const output = process.env.LITTLE_BOT_SMOKE_OUTPUT || stateDir;
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  window.showInactive();
  window.webContents.on('console-message', (...args) => {
    const details = typeof args[1] === 'object' ? args[1] : { level: args[1], message: args[2] };
    if (details.level === 'error' || details.level === 3) errors.push(details.message);
  });
  for (let i = 0; i < 50; i++) {
    if (await window.webContents.executeJavaScript("!document.getElementById('runtime-status').textContent.toLowerCase().includes('starting')")) break;
    await delay(100);
  }
  await delay(100);
  const dom = await window.webContents.executeJavaScript(`({
    bridge: typeof window.bot?.getState === 'function',
    nodeHidden: typeof window.require === 'undefined' && typeof window.process === 'undefined',
    title: document.title,
    runtimeText: document.getElementById('runtime-status').textContent,
    buttons: document.querySelectorAll('button').length,
    overflow: document.documentElement.scrollWidth > innerWidth
  })`);
  assert.equal(dom.bridge, true); assert.equal(dom.nodeHidden, true);
  assert.equal(dom.title, 'Little Bot'); assert.ok(dom.buttons > 8);
  assert.equal(dom.overflow, false); assert.equal(controller.runtime.status, 'ready');
  assert.match(dom.runtimeText, /Ready/);
  await delay(250);
  fs.writeFileSync(path.join(output, 'welcome.png'), (await window.webContents.capturePage()).toPNG());

  // Exercise the real pinned app-server's native Windows sandbox without an LLM request.
  const workspace = store.data.settings.workspace;
  const inside = path.join(workspace, 'sandbox-probe.txt');
  const outside = path.join(stateDir, 'outside-workspace-probe.txt');
  const policy = { type: 'workspaceWrite', writableRoots: [workspace], networkAccess: false,
    excludeSlashTmp: true, excludeTmpdirEnvVar: true };
  const insideResult = await controller.client.request('command/exec', {
    command: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
      `Set-Content -LiteralPath ${quote(inside)} -Value 'Little Bot sandbox check'; Get-Content -LiteralPath ${quote(inside)}`],
    cwd: workspace, sandboxPolicy: policy, timeoutMs: 20000,
  }, 30000);
  assert.equal(insideResult.exitCode, 0, `Workspace command failed: ${insideResult.stderr}`);
  assert.match(insideResult.stdout, /Little Bot sandbox check/);
  assert.ok(fs.existsSync(inside));
  const outsideResult = await controller.client.request('command/exec', {
    command: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; Set-Content -LiteralPath ${quote(outside)} -Value 'should be blocked'`],
    cwd: workspace, sandboxPolicy: policy, timeoutMs: 20000,
  }, 30000);
  assert.notEqual(outsideResult.exitCode, 0, 'Sandbox unexpectedly allowed writing outside the working folder.');
  assert.equal(fs.existsSync(outside), false);

  const thread = await controller.client.request('thread/start', {
    cwd: workspace, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write', ephemeral: true,
  }, 30000);
  assert.equal(thread.approvalPolicy, 'on-request');
  assert.equal(thread.sandbox.type, 'workspaceWrite');
  const heartbeatThread = await controller.client.request('thread/start', {
    cwd: workspace, approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'workspace-write', ephemeral: true,
    config: { 'sandbox_workspace_write.network_access': false, 'features.multi_agent': false, 'web_search': 'disabled' },
  }, 30000);
  assert.equal(heartbeatThread.approvalPolicy, 'never');
  assert.equal(heartbeatThread.sandbox.type, 'workspaceWrite');
  assert.equal(heartbeatThread.sandbox.networkAccess, false);
  for (const temporary of [thread, heartbeatThread]) {
    const unloaded = await controller.client.request('thread/unsubscribe', { threadId: temporary.thread.id });
    assert.ok(['unsubscribed', 'notLoaded'].includes(unloaded.status));
  }

  await window.webContents.executeJavaScript("document.getElementById('nav-automations').click()");
  await delay(150);
  assert.equal(await window.webContents.executeJavaScript("!document.getElementById('automations-view').classList.contains('hidden')"), true);
  fs.writeFileSync(path.join(output, 'automations.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript("document.getElementById('create-automation').click()");
  await delay(100);
  assert.equal(await window.webContents.executeJavaScript("document.getElementById('automation-dialog').open"), true);
  await window.webContents.executeJavaScript(`document.getElementById('automation-name').value='Smoke test routine';
    document.getElementById('automation-prompt').value='List files in the selected folder.';
    document.getElementById('automation-interval').value='60';
    document.getElementById('automation-enabled').checked=false;
    document.getElementById('automation-form').requestSubmit();`);
  for (let i = 0; i < 30 && !store.data.automations.length; i++) await delay(100);
  assert.equal(store.data.automations.length, 1, 'Automation form did not save through IPC.');
  assert.equal(store.data.automations[0].enabled, false);
  for (let i = 0; i < 30; i++) {
    if (!await window.webContents.executeJavaScript("document.getElementById('automation-dialog').open")) break;
    await delay(100);
  }
  assert.equal(await window.webContents.executeJavaScript("document.getElementById('automation-dialog').open"), false);
  await delay(250);
  fs.writeFileSync(path.join(output, 'routine.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript("document.getElementById('nav-memory').click(); document.getElementById('add-fact').click()");
  await delay(100);
  await window.webContents.executeJavaScript(`document.getElementById('fact-text').value='Use plain language in project notes.';
    document.getElementById('fact-scope').value='workspace'; document.getElementById('fact-form').requestSubmit();`);
  for (let i = 0; i < 30 && !store.data.memory.facts.length; i++) await delay(100);
  assert.equal(store.data.memory.facts.length, 1, 'Memory form did not save through IPC.');
  assert.equal(store.data.memory.facts[0].workspace, workspace);
  await delay(250);
  assert.equal(await window.webContents.executeJavaScript("document.getElementById('fact-dialog').open"), false);
  fs.writeFileSync(path.join(output, 'memory.png'), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript("document.getElementById('nav-heartbeat').click()");
  await delay(100);
  await window.webContents.executeJavaScript(`const checklist=document.getElementById('heartbeat-checklist');
    checklist.value='Check for unfinished Markdown notes in this folder and make one useful edit if needed.';
    checklist.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('heartbeat-enabled').checked=false;
    document.getElementById('heartbeat-use-workspace').click();
    document.getElementById('heartbeat-form').requestSubmit();`);
  for (let i = 0; i < 30 && !store.data.heartbeat.checklist; i++) await delay(100);
  assert.match(store.data.heartbeat.checklist, /unfinished Markdown/);
  assert.equal(store.data.heartbeat.enabled, false);
  assert.equal(store.data.heartbeat.mode, 'act');
  assert.equal(store.data.heartbeat.workspace, workspace);
  await delay(250);
  const heartbeatDraft = await window.webContents.executeJavaScript(`document.getElementById('heartbeat-checklist').value='Unsaved draft survives events';
    document.getElementById('heartbeat-checklist').dispatchEvent(new Event('input',{bubbles:true}));
    true;`);
  controller.changed(); await delay(100);
  assert.equal(await window.webContents.executeJavaScript("document.getElementById('heartbeat-checklist').value"), 'Unsaved draft survives events');
  await window.webContents.executeJavaScript(`document.getElementById('heartbeat-checklist').value=${JSON.stringify('Check for unfinished Markdown notes in this folder and make one useful edit if needed.')};
    document.getElementById('heartbeat-checklist').dispatchEvent(new Event('input',{bubbles:true}));`);
  await delay(250);
  fs.writeFileSync(path.join(output, 'heartbeat.png'), (await window.webContents.capturePage()).toPNG());
  assert.equal(await window.webContents.executeJavaScript("document.documentElement.scrollWidth > innerWidth"), false);
  window.setSize(900, 720); await delay(250);
  fs.writeFileSync(path.join(output, 'heartbeat-compact.png'), (await window.webContents.capturePage()).toPNG());
  assert.equal(await window.webContents.executeJavaScript("document.documentElement.scrollWidth > innerWidth"), false, 'Heartbeat overflows the minimum window size.');
  window.setSize(1240, 860); await delay(150);
  await window.webContents.executeJavaScript("document.getElementById('nav-extensions').click(); document.getElementById('extensions-tab-skills').click(); document.getElementById('add-skill').click()");
  await window.webContents.executeJavaScript(`document.getElementById('skill-name').value='smoke-review';
    document.getElementById('skill-description').value='Review a short project note.';
    document.getElementById('skill-content').value='Summarize the supplied text in three concise bullet points.';
    document.getElementById('skill-enabled').checked=true;
    document.getElementById('skill-form').requestSubmit();`);
  for (let i = 0; i < 30 && !store.data.extensions.skills.some(skill => skill.name === 'smoke-review'); i++) await delay(100);
  assert.ok(store.data.extensions.skills.some(skill => skill.name === 'smoke-review'), 'Skill editor did not save.');
  await delay(250);
  assert.equal(await window.webContents.executeJavaScript("document.getElementById('skill-dialog').open"), false);
  fs.writeFileSync(path.join(output, 'extensions-skills.png'), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript("document.getElementById('extensions-tab-servers').click(); document.getElementById('add-mcp-server').click()");
  await window.webContents.executeJavaScript(`document.getElementById('mcp-server-name').value='disabled-example';
    document.getElementById('mcp-server-transport').value='http';
    document.getElementById('mcp-server-transport').dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('mcp-server-url').value='https://example.invalid/mcp';
    document.getElementById('mcp-server-enabled').checked=false;
    document.getElementById('mcp-server-form').requestSubmit();`);
  for (let i = 0; i < 30 && !store.data.extensions.servers.length; i++) await delay(100);
  assert.equal(store.data.extensions.servers[0]?.enabled, false, 'MCP editor did not save a disabled server.');
  await delay(250);
  assert.equal(await window.webContents.executeJavaScript("document.getElementById('mcp-server-dialog').open"), false);

  // Native file dialogs are not scripted. Exercise the same passive importer against our local example.
  const plugin = await extensionFiles.importPlugin(path.join(__dirname, '..', 'examples', 'writing-tools'));
  assert.equal(plugin.enabled, false);
  store.save(); extensionRuntime.invalidate(); controller.changed(); await delay(100);
  await window.webContents.executeJavaScript("document.getElementById('extensions-tab-plugins').click()");
  await delay(150);
  await window.webContents.executeJavaScript(`document.querySelector('#extensions-plugins input[aria-label="Enable writing-tools"]').click()`);
  for (let i = 0; i < 30 && !store.data.extensions.plugins[0].enabled; i++) await delay(100);
  assert.equal(store.data.extensions.plugins[0].enabled, true, 'Plugin toggle did not enable its bundle.');
  await window.webContents.executeJavaScript("document.getElementById('extensions-refresh').click()");
  for (let i = 0; i < 100; i++) {
    if (extensionRuntime.state.updatedAt && extensionRuntime.state.status !== 'syncing' && !controller.extensionsBusy) break;
    await delay(100);
  }
  const discovered = extensionRuntime.state.servers.find(server => server.name === 'writing-tools');
  assert.equal(discovered?.runtimeStatus, 'connected', JSON.stringify(extensionRuntime.state));
  assert.ok(discovered.tools.text_stats, 'The example MCP tool was not discovered.');
  await delay(150);
  fs.writeFileSync(path.join(output, 'extensions-plugins.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript("document.getElementById('extensions-tab-tools').click()");
  await delay(150);
  fs.writeFileSync(path.join(output, 'extensions-tools.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="Enable text_stats"]').click()`);
  for (let i = 0; i < 30 && !store.data.extensions.servers.find(server => server.name === 'writing-tools').disabledTools.length; i++) await delay(100);
  assert.deepEqual(store.data.extensions.servers.find(server => server.name === 'writing-tools').disabledTools, ['text_stats']);
  await delay(150);
  await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="Enable text_stats"]').click()`);
  for (let i = 0; i < 30 && store.data.extensions.servers.find(server => server.name === 'writing-tools').disabledTools.length; i++) await delay(100);
  assert.deepEqual(store.data.extensions.servers.find(server => server.name === 'writing-tools').disabledTools, []);

  // Development-only direct call to our known read-only fixture; never exposed by the app's IPC.
  const toolThread = await controller.client.request('thread/start', { cwd: workspace, ephemeral: true, approvalPolicy: 'on-request', sandbox: 'workspace-write', config: extensionRuntime.config() });
  try {
    const call = await controller.client.request('mcpServer/tool/call', { threadId: toolThread.thread.id, server: 'writing-tools', tool: 'text_stats', arguments: { text: 'Hello small bot' } });
    assert.deepEqual(JSON.parse(call.content[0].text), { characters: 15, words: 3, lines: 1 });
  } finally { await controller.client.request('thread/unsubscribe', { threadId: toolThread.thread.id }); }
  const isolatedThread = await controller.client.request('thread/start', { cwd: workspace, ephemeral: true, approvalPolicy: 'never', sandbox: 'workspace-write', config: await extensionRuntime.heartbeatConfig(workspace) });
  try { assert.equal(await extensionRuntime.verifyHeartbeat(isolatedThread.thread.id), true); }
  finally { await controller.client.request('thread/unsubscribe', { threadId: isolatedThread.thread.id }); }
  await window.webContents.executeJavaScript("document.getElementById('extensions-tab-servers').click()");
  await delay(150);
  fs.writeFileSync(path.join(output, 'extensions-servers.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(900, 720); await delay(200);
  assert.equal(await window.webContents.executeJavaScript("document.documentElement.scrollWidth > innerWidth"), false, 'Extensions overflow the minimum window size.');
  fs.writeFileSync(path.join(output, 'extensions-compact.png'), (await window.webContents.capturePage()).toPNG());

  // Exercise the actual IPC and renderer with deterministic compaction events.
  // This fixture never reaches the model or compacts a user's real thread.
  const fixture = { id: 'compaction-smoke', threadId: 'compaction-smoke-thread', title: 'Compaction preview',
    connection: store.data.settings.connection, localBaseUrl: store.data.settings.localBaseUrl,
    workspace, model: store.data.settings.model, effort: 'low', status: 'idle', createdAt: Date.now(), updatedAt: Date.now(),
    messages: [{ id: 'fixture-user', role: 'user', text: 'Keep the project requirements available as this conversation grows.' },
      { id: 'fixture-assistant', role: 'assistant', text: 'The visible conversation stays available after compaction.', status: 'completed' }],
    context: { usedTokens: 180000, windowTokens: 200000, updatedAt: Date.now(), stale: false },
    compaction: { status: 'idle', count: 0, lastAt: null, lastError: null } };
  const savedAccount = controller.account;
  const savedRequest = controller.client.request;
  const savedEpisodes = JSON.stringify(store.data.memory.episodes);
  let compactRequests = 0;
  controller.client.request = function(method, params, ...rest) {
    if (method === 'thread/compact/start' && params.threadId === fixture.threadId) { compactRequests += 1; return Promise.resolve({}); }
    return savedRequest.call(this, method, params, ...rest);
  };
  try {
    controller.account = { status: 'connected', type: 'chatgpt' };
    store.data.chats.unshift(fixture); controller.resumed.add(fixture.threadId);
    controller.threadCompactionSettings.set(fixture.threadId, store.data.settings.autoCompactPercent); controller.changed();
    await delay(150);
    await window.webContents.executeJavaScript("document.getElementById('toast').classList.add('hidden'); document.querySelector('.chat-link[title=\"Compaction preview\"]').click()");
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('context-usage-percent').textContent"), '90%');
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('compact-chat').disabled"), false);
    await window.webContents.executeJavaScript("document.getElementById('message-input').value='Draft survives compaction'; document.getElementById('message-input').dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('compact-chat').click()");
    for (let i = 0; i < 30 && !compactRequests; i++) await delay(100);
    assert.equal(compactRequests, 1, 'Compact now did not reach the controller through IPC.');
    assert.equal(fixture.status, 'running', 'RPC acknowledgment must not end compaction.');
    const turnId = 'smoke-compact-turn';
    controller.notification('turn/started', { threadId: fixture.threadId, turn: { id: turnId, status: 'inProgress' } });
    controller.notification('item/started', { threadId: fixture.threadId, turnId, item: { id: 'smoke-compact-item', type: 'contextCompaction' } });
    await delay(150);
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('compact-chat').disabled"), true);
    fs.writeFileSync(path.join(output, 'compaction-running.png'), (await window.webContents.capturePage()).toPNG());
    controller.notification('thread/tokenUsage/updated', { threadId: fixture.threadId, turnId,
      tokenUsage: { last: { totalTokens: 24000 }, total: { totalTokens: 900000 }, modelContextWindow: 200000 } });
    controller.notification('item/completed', { threadId: fixture.threadId, turnId, item: { id: 'smoke-compact-item', type: 'contextCompaction' } });
    controller.notification('turn/completed', { threadId: fixture.threadId, turn: { id: turnId, status: 'completed' } });
    await delay(200);
    assert.equal(fixture.status, 'idle');
    assert.equal(fixture.compaction.count, 1);
    assert.equal(fixture.messages.length, 2);
    assert.equal(JSON.stringify(store.data.memory.episodes), savedEpisodes);
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('context-usage-percent').textContent"), '12%');
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('message-input').value"), 'Draft survives compaction');
    assert.equal(await window.webContents.executeJavaScript("document.documentElement.scrollWidth > innerWidth"), false, 'Compaction panel overflows the minimum window size.');
    fs.writeFileSync(path.join(output, 'compaction-compact.png'), (await window.webContents.capturePage()).toPNG());
    window.setSize(1240, 860); await delay(200);
    fs.writeFileSync(path.join(output, 'compaction.png'), (await window.webContents.capturePage()).toPNG());
    fixture.context.stale = true; fixture.compaction.lastError = 'Example: compaction was interrupted. Try again when ready.';
    controller.changed(); await delay(150);
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('context-usage-meter').classList.contains('hidden')"), true);
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('context-compaction-error').classList.contains('hidden')"), false);
    fs.writeFileSync(path.join(output, 'compaction-stale.png'), (await window.webContents.capturePage()).toPNG());
  } finally {
    controller.client.request = savedRequest; controller.account = savedAccount;
    controller.resumed.delete(fixture.threadId); controller.threadCompactionSettings.delete(fixture.threadId); controller.outcomes.delete(fixture.id);
    store.data.chats = store.data.chats.filter(chat => chat !== fixture); store.save(); controller.changed();
  }
  const autonomy = await require('./goals-smoke.cjs').run({ window, controller, store, goals, output });
  const personal = await require('./personal-smoke.cjs').run({ window, controller, store, heartbeat, output });
  assert.deepEqual(errors, [], `Renderer errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ ok: true, runtime: controller.runtime.status, account: controller.account.status,
    sandboxWorkspaceWrite: true, sandboxOutsideWriteBlocked: true, approvalPolicy: thread.approvalPolicy,
    renderer: dom, automationForm: true, memoryForm: true, heartbeatForm: heartbeatDraft,
    heartbeatApprovalPolicy: heartbeatThread.approvalPolicy, skillForm: true, mcpForm: true, pluginImport: true,
    mcpToolCall: true, toolToggleRoundtrip: true, heartbeatMcpIsolation: true, compactionIpcSimulated: true,
    compactionLiveModel: false, autonomy, personal, startupMs: controller.runtime.startupMs, screenshots: output }));
}
module.exports = { run };
