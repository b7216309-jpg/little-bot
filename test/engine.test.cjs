'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Engine } = require('../src/engine/index.cjs');
const { readOnlyCommand } = require('../src/engine/tools.cjs');

// A stand-in for Strata's Chat Completions stream. Each request takes the next scripted answer.
async function fakeStrata(t, script) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('end', async () => {
      const body = JSON.parse(raw);
      requests.push(body);
      const next = script.shift();
      const answer = typeof next === 'function' ? await next(body, request, response) : next;
      if (answer === undefined) return;
      if (answer?.status) { response.writeHead(answer.status, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: answer.message } })); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta, finish = null, extra = {}) => response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
      chunk({ role: 'assistant', content: '' });
      if (answer.reasoning) chunk({ reasoning_content: answer.reasoning });
      if (answer.content) for (const part of answer.content.match(/.{1,5}/gs)) chunk({ content: part });
      (answer.calls || []).forEach((call, index) => {
        chunk({ tool_calls: [{ index, id: call.id || `call_${index}`, type: 'function', function: { name: call.name, arguments: '' } }] });
        chunk({ tool_calls: [{ index, function: { arguments: JSON.stringify(call.arguments) } }] });
      });
      chunk({}, answer.calls?.length ? 'tool_calls' : 'stop', { usage: { prompt_tokens: answer.prompt || 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: answer.cached || 0 } } });
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests };
}

async function setup(t, script, { approve = 'accept', tools = {}, elicit } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-engine-'));
  const strata = await fakeStrata(t, script);
  const engine = new Engine({ homeDir: home, cwd: home });
  const events = [], asks = [], usage = [];
  engine.configure({ classify: ({ compaction }) => compaction ? 'compaction' : 'conversation', onUsage: entry => usage.push(entry), sampling: () => ({ temperature: 0.6 }) });
  engine.on('notification', (method, params) => events.push({ method, ...params }));
  engine.on('request', request => {
    asks.push(request);
    if (request.method === 'item/tool/call') {
      const tool = tools[request.params.tool];
      Promise.resolve(tool ? tool(request.params.arguments) : { success: false, contentItems: [{ type: 'inputText', text: 'no such tool' }] })
        .then(result => engine.respond(request.id, result));
    } else if (/requestApproval$/.test(request.method)) {
      const decision = typeof approve === 'function' ? approve(request) : approve;
      if (decision !== 'wait') engine.respond(request.id, { decision });
    } else if (request.method === 'mcpServer/elicitation/request') {
      engine.respond(request.id, elicit ? elicit(request.params) : { action: 'decline' });
    }
  });
  await engine.start();
  t.after(async () => { await engine.close(); fs.rmSync(home, { recursive: true, force: true }); });
  const config = { local_base_url: strata.url, model_context_window: 262144 };
  const thread = async (options = {}) => (await engine.request('thread/start', { cwd: home, model: 'qwen', baseInstructions: 'BASE', developerInstructions: 'DEV', config, approvalPolicy: 'untrusted', ...options })).thread.id;
  const done = threadId => new Promise(resolve => {
    const check = (method, params) => { if (method === 'turn/completed' && params.threadId === threadId) { engine.off('notification', check); resolve(params.turn); } };
    engine.on('notification', check);
  });
  const run = async (threadId, text, extra = {}) => {
    const finished = done(threadId);
    await engine.request('turn/start', { threadId, input: [{ type: 'text', text }], effort: 'low', ...extra });
    return finished;
  };
  return { engine, home, strata, events, asks, usage, config, thread, run, done };
}

test('a turn streams reasoning and the answer, records usage and is saved for the next launch', async t => {
  const { engine, strata, events, usage, thread, run, home, config } = await setup(t, [{ reasoning: 'Think.', content: 'Hello there.', prompt: 500, cached: 400 }]);
  const threadId = await thread();
  const turn = await run(threadId, 'Hi');
  assert.equal(turn.status, 'completed');
  const methods = events.filter(event => event.threadId === threadId).map(event => event.method);
  assert.deepEqual([...new Set(methods)], ['turn/started', 'item/started', 'item/reasoning/textDelta', 'item/agentMessage/delta', 'thread/tokenUsage/updated', 'item/completed', 'turn/completed']);
  const answer = events.find(event => event.method === 'item/completed' && event.item.type === 'agentMessage').item;
  assert.deepEqual([answer.text, answer.phase], ['Hello there.', 'final_answer']);
  const body = strata.requests[0];
  assert.deepEqual(body.messages.map(message => message.role), ['system', 'user']);
  assert.match(body.messages[0].content, /^BASE\n\nDEV\n\nWorking folder: /);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.temperature, 0.6);
  assert.deepEqual(body.tools.map(tool => tool.function.name), ['exec_command', 'write_stdin']);
  assert.deepEqual(usage.map(entry => [entry.source, entry.input, entry.cached, entry.output]), [['conversation', 500, 400, 10]]);
  const tokens = events.find(event => event.method === 'thread/tokenUsage/updated').tokenUsage;
  assert.deepEqual([tokens.last.totalTokens, tokens.modelContextWindow], [510, 262144]);
  await engine.request('thread/unsubscribe', { threadId });
  assert.ok(fs.existsSync(path.join(home, 'threads', `${threadId}.thread`)));
  await engine.request('thread/resume', { threadId, config });
  assert.deepEqual(engine.threads.get(threadId).history.map(message => [message.role, message.content]), [['user', 'Hi'], ['assistant', 'Hello there.']]);
  await assert.rejects(engine.request('thread/resume', { threadId: 'thread_missing', config }), /no rollout found for thread id/);
});

test('commands wait for approval, run in PowerShell, and a declined one never runs', async t => {
  const marker = path.join(os.tmpdir(), `lb-engine-declined-${process.pid}.txt`);
  const { events, asks, thread, run, strata } = await setup(t, [
    // A loaded machine can take over 10 s to start PowerShell; wait for the exit so the result is the same anywhere.
    { content: 'Checking.', calls: [{ name: 'exec_command', arguments: { cmd: 'Write-Output "ran $(1+1)"; exit 3', yield_time_ms: 120000 } }] },
    { calls: [{ name: 'exec_command', arguments: { cmd: `Set-Content -Path '${marker}' -Value x` } }] },
    { content: 'Done.' },
  ], { approve: request => request.params.command.includes('Set-Content') ? 'decline' : 'accept' });
  const threadId = await thread();
  assert.equal((await run(threadId, 'Run it')).status, 'completed');
  assert.deepEqual(asks.map(ask => ask.method), ['item/commandExecution/requestApproval', 'item/commandExecution/requestApproval']);
  const started = events.findIndex(event => event.method === 'item/started' && event.item.type === 'commandExecution');
  assert.ok(started >= 0 && events.findIndex(event => event.method === 'item/completed' && event.item.type === 'commandExecution') > started);
  const toolResults = strata.requests[1].messages.filter(message => message.role === 'tool');
  assert.match(toolResults[0].content, /^Exit code: 3\nWall time: [\d.]+ s\nOutput:\nran 2/);
  assert.ok(events.some(event => event.method === 'item/commandExecution/outputDelta' && event.delta.includes('ran 2')), 'output reaches the timeline while the command runs');
  assert.match(strata.requests[2].messages.filter(message => message.role === 'tool')[1].content, /declined and did not run/);
  assert.equal(fs.existsSync(marker), false);
  const commentary = events.find(event => event.method === 'item/completed' && event.item.type === 'agentMessage').item;
  assert.equal(commentary.phase, 'commentary');
});

test('a patch sent through exec_command is shown, approved and applied', async t => {
  const { home, events, asks, thread, run } = await setup(t, [
    { calls: [{ name: 'exec_command', arguments: { cmd: "apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: notes/todo.md\n+- buy ferns\n*** End Patch\nPATCH" } }] },
    { content: 'Added.' },
  ]);
  const threadId = await thread();
  await run(threadId, 'Write a todo');
  assert.equal(fs.readFileSync(path.join(home, 'notes', 'todo.md'), 'utf8'), '- buy ferns\n');
  assert.deepEqual(asks.map(ask => ask.method), ['item/fileChange/requestApproval']);
  const change = events.find(event => event.method === 'item/started' && event.item.type === 'fileChange').item;
  assert.equal(change.changes[0].kind, 'add');
  assert.equal(events.find(event => event.method === 'item/completed' && event.item.type === 'fileChange').item.status, 'completed');
});

test('app tools go to the app, and their images reach the model as a user message after the tool results', async t => {
  const image = 'data:image/png;base64,AAAA';
  const { strata, thread, run } = await setup(t, [
    { calls: [{ id: 'a', name: 'screen_capture', arguments: {} }, { id: 'b', name: 'memory_search', arguments: { query: 'ferns' } }] },
    { content: 'I see it.' },
  ], { tools: {
    screen_capture: () => ({ success: true, contentItems: [{ type: 'inputText', text: '{"captured":"display 1"}' }, { type: 'inputImage', imageUrl: image }] }),
    memory_search: args => ({ success: true, contentItems: [{ type: 'inputText', text: `found ${args.query}` }] }),
  } });
  const spec = name => ({ type: 'function', name, description: name, inputSchema: { type: 'object', properties: {} } });
  const threadId = await thread({ dynamicTools: [spec('screen_capture'), spec('memory_search')] });
  await run(threadId, 'Look');
  const messages = strata.requests[1].messages;
  assert.deepEqual(messages.map(message => message.role), ['system', 'user', 'assistant', 'tool', 'tool', 'user']);
  assert.deepEqual(messages.slice(3, 5).map(message => message.content), ['{"captured":"display 1"}', 'found ferns']);
  assert.deepEqual(messages[5].content[1], { type: 'image_url', image_url: { url: image } });
  assert.deepEqual(strata.requests[0].tools.map(tool => tool.function.name), ['exec_command', 'write_stdin', 'screen_capture', 'memory_search']);
});

test('Plan mode reads but refuses anything that could change files', async t => {
  const { home, asks, strata, thread, run } = await setup(t, [
    { calls: [{ name: 'exec_command', arguments: { cmd: 'Get-ChildItem -Name', yield_time_ms: 120000 } }, { name: 'exec_command', arguments: { cmd: 'Remove-Item -Recurse .' } }] },
    { content: 'Plan ready.' },
  ]);
  fs.writeFileSync(path.join(home, 'keep.txt'), 'x');
  const threadId = await thread({ sandbox: 'read-only', approvalPolicy: 'never' });
  await run(threadId, 'Plan', { sandboxPolicy: { type: 'readOnly' }, approvalPolicy: 'never' });
  const [listing, removal] = strata.requests[1].messages.filter(message => message.role === 'tool').map(message => message.content);
  assert.match(listing, /keep\.txt/);
  assert.match(removal, /Plan mode is read-only/);
  assert.ok(fs.existsSync(path.join(home, 'keep.txt')));
  assert.equal(asks.length, 0);
  const reads = ['git status; Get-Content a.txt | Select-String x', "Test-Path -LiteralPath 'keep.txt'; (Get-Location).Path; Get-ChildItem -LiteralPath 'C:\\x' -Force",
    "[IO.Directory]::GetFiles('C:\\x')", '[System.IO.File]::ReadAllText("a.txt")', 'cmd /c dir /a "C:\\x"', '$p = (Get-Location).Path; Write-Output $p', 'git log -3'];
  const changes = ['Get-Content a.txt > b.txt', 'python -c "print(1)"', 'Remove-Item keep.txt', '[IO.File]::WriteAllText("a","b")', '[IO.File]::Delete("a")',
    'cmd /c del a.txt', '$x = Remove-Item a', '(Remove-Item a)', 'git push', 'Start-Sleep -Seconds 60', 'Get-ChildItem | ForEach-Object { Remove-Item $_ }'];
  for (const command of reads) assert.equal(readOnlyCommand(command), true, command);
  for (const command of changes) assert.equal(readOnlyCommand(command), false, command);
});

test('Stop ends a running command and the turn, and the history stays well formed', async t => {
  const { engine, strata, thread, run, events } = await setup(t, [
    { calls: [{ name: 'exec_command', arguments: { cmd: 'Start-Sleep 30', yield_time_ms: 60000 } }] },
    { content: 'Next turn.' },
  ]);
  const threadId = await thread();
  const finished = run(threadId, 'Wait');
  await new Promise(resolve => { const check = (method, params) => { if (method === 'item/started' && params.item?.type === 'commandExecution') { engine.off('notification', check); resolve(); } }; engine.on('notification', check); });
  await new Promise(resolve => setTimeout(resolve, 500));
  const started = Date.now();
  await engine.request('turn/interrupt', { threadId });
  assert.equal((await finished).status, 'interrupted');
  assert.ok(Date.now() - started < 10000, 'the command was stopped, not waited for');
  await run(threadId, 'Continue');
  const roles = strata.requests[1].messages.map(message => message.role);
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'tool', 'user']);
  assert.match(strata.requests[1].messages[3].content, /Stopped by the user/);
  assert.ok(events.some(event => event.method === 'turn/completed' && event.turn.status === 'interrupted'));
});

test('a context overflow compacts the conversation and retries; a manual compaction summarizes it', async t => {
  const { engine, strata, events, usage, thread, run } = await setup(t, [
    { content: 'First answer.' },
    { status: 400, message: 'the request exceeds the available context size' },
    { content: 'Summary: the user asked twice.' },
    { content: 'Second answer.' },
    { content: 'Short summary.' },
  ]);
  const threadId = await thread();
  await run(threadId, 'One');
  assert.equal((await run(threadId, 'Two')).status, 'completed');
  assert.equal(strata.requests[2].messages.at(-1).content.startsWith('Your context is nearly full'), true);
  assert.deepEqual(strata.requests[2].tools.map(tool => tool.function.name), ['exec_command', 'write_stdin'], 'the summary request keeps the tool block for the cache');
  assert.deepEqual(strata.requests[3].messages.slice(1).map(message => message.role), ['user', 'assistant', 'user']);
  assert.match(strata.requests[3].messages[1].content, /Summary: the user asked twice/);
  assert.equal(strata.requests[3].messages[3].content, 'Two');
  const done = new Promise(resolve => { const check = (method, params) => { if (method === 'turn/completed' && params.threadId === threadId) { engine.off('notification', check); resolve(params.turn); } }; engine.on('notification', check); });
  await engine.request('thread/compact/start', { threadId });
  assert.equal((await done).status, 'completed');
  assert.deepEqual(engine.threads.get(threadId).history.map(message => message.role), ['user']);
  assert.equal(events.filter(event => event.item?.type === 'contextCompaction').length, 4);
  assert.deepEqual(usage.map(entry => entry.source), ['conversation', 'compaction', 'conversation', 'compaction']);
});

test('a steer message reaches the model before its next step', async t => {
  let release;
  const { engine, strata, thread, run } = await setup(t, [
    { calls: [{ name: 'exec_command', arguments: { cmd: 'Write-Output step', yield_time_ms: 120000 } }] },
    { content: 'Adjusted.' },
  ], { approve: request => { release = () => engine.respond(request.id, { decision: 'accept' }); return 'wait'; } });
  const threadId = await thread();
  const finished = run(threadId, 'Go');
  while (!release) await new Promise(resolve => setTimeout(resolve, 20));
  const turnId = engine.threads.get(threadId).turn.id;
  await engine.request('turn/steer', { threadId, expectedTurnId: turnId, input: [{ type: 'text', text: 'Security note.' }] });
  release();
  await finished;
  assert.deepEqual(strata.requests[1].messages.slice(-2).map(message => [message.role, typeof message.content === 'string' ? message.content.slice(0, 14) : '']), [['tool', 'Exit code: 0\nW'], ['user', 'Security note.']]);
});

test('MCP tools are listed, approved and called over stdio; disabled servers stay off', async t => {
  const server = path.join(os.tmpdir(), `lb-fake-mcp-${process.pid}.cjs`);
  fs.writeFileSync(server, `
const rl = require('readline').createInterface({ input: process.stdin });
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
rl.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } } });
  else if (message.method === 'tools/list') send({ id: message.id, result: { tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }, { name: 'hidden', description: 'x', inputSchema: { type: 'object' } }] } });
  else if (message.method === 'tools/call') send({ id: message.id, result: { content: [{ type: 'text', text: 'echo: ' + message.params.arguments.text }] } });
});`);
  t.after(() => fs.rmSync(server, { force: true }));
  const { engine, strata, asks, events, thread, run, config } = await setup(t, [
    { calls: [{ name: 'mcp__notes__echo', arguments: { text: 'hi' } }] },
    { content: 'It echoed.' },
  ]);
  const servers = { notes: { enabled: true, command: process.execPath, args: [server], disabled_tools: ['hidden'] }, off: { enabled: false, command: 'nothing' } };
  const threadId = await thread({ config: { ...config, mcp_servers: servers } });
  await run(threadId, 'Echo');
  assert.ok(strata.requests[0].tools.some(tool => tool.function.name === 'mcp__notes__echo'));
  assert.ok(!strata.requests[0].tools.some(tool => tool.function.name === 'mcp__notes__hidden'));
  assert.equal(asks[0].method, 'item/mcpToolCall/requestApproval');
  assert.deepEqual([asks[0].params.server, asks[0].params.tool, asks[0].params.arguments], ['notes', 'echo', { text: 'hi' }]);
  assert.equal(strata.requests[1].messages.at(-1).content, 'echo: hi');
  assert.equal(events.find(event => event.method === 'item/completed' && event.item.type === 'mcpToolCall').item.status, 'completed');
  const status = (await engine.request('mcpServerStatus/list', { threadId })).data;
  assert.deepEqual(status.map(row => [row.name, row.runtimeStatus, Object.keys(row.tools)]), [['notes', 'connected', ['echo']], ['off', 'disabled', []]]);
  assert.deepEqual(await engine.request('mcpServer/tool/call', { threadId, server: 'notes', tool: 'echo', arguments: { text: 'direct' } }), { content: [{ type: 'text', text: 'echo: direct' }] });
  await assert.rejects(engine.request('mcpServer/tool/call', { threadId, server: 'notes', tool: 'hidden', arguments: {} }), /not enabled/);
});

test("an MCP server's form during a call reaches the app, and the answer goes back to the server", async t => {
  const server = path.join(os.tmpdir(), `lb-fake-mcp-form-${process.pid}.cjs`);
  fs.writeFileSync(server, `
const rl = require('readline').createInterface({ input: process.stdin });
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
let call = null, canAsk = false;
rl.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') { canAsk = !!message.params.capabilities?.elicitation; send({ id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } } }); }
  else if (message.method === 'tools/list') send({ id: message.id, result: { tools: [{ name: 'ask', description: 'Ask the user', inputSchema: { type: 'object', properties: {} } }] } });
  else if (message.method === 'tools/call') {
    if (!canAsk) return send({ id: message.id, result: { content: [{ type: 'text', text: 'cannot ask' }] } });
    call = message.id;
    send({ id: 'form-1', method: 'elicitation/create', params: { message: 'Pick a color', requestedSchema: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'] } } });
  } else if (message.id === 'form-1') send({ id: call, result: { content: [{ type: 'text', text: 'answer: ' + JSON.stringify(message.result) }] } });
});`);
  t.after(() => fs.rmSync(server, { force: true }));
  const forms = [];
  const { strata, thread, run, config } = await setup(t, [
    { calls: [{ name: 'mcp__survey__ask', arguments: {} }] },
    { content: 'Blue it is.' },
  ], { elicit: params => { forms.push(params); return { action: 'accept', content: { color: 'blue' } }; } });
  const threadId = await thread({ config: { ...config, mcp_servers: { survey: { enabled: true, command: process.execPath, args: [server] } } } });
  await run(threadId, 'Ask me');
  assert.deepEqual([forms[0].threadId, forms[0].serverName, forms[0].mode, forms[0].message], [threadId, 'survey', 'form', 'Pick a color']);
  assert.equal(strata.requests[1].messages.at(-1).content, 'answer: {"action":"accept","content":{"color":"blue"}}');
});

test('a stopped turn cancels the app request it was waiting on', async t => {
  const { engine, events, thread, run } = await setup(t, [{ calls: [{ name: 'ask_user', arguments: { question: 'Which?' } }] }], { tools: { ask_user: () => new Promise(() => {}) } });
  const threadId = await thread({ dynamicTools: [{ name: 'ask_user', description: 'Ask', inputSchema: { type: 'object', properties: {} } }] });
  const finished = run(threadId, 'Ask me');
  while (!engine.serverRequests.size) await new Promise(resolve => setTimeout(resolve, 20));
  const [requestId] = engine.serverRequests.keys();
  await engine.request('turn/interrupt', { threadId });
  assert.equal((await finished).status, 'interrupted');
  assert.ok(events.some(event => event.method === 'serverRequest/resolved' && event.requestId === requestId));
  assert.equal(engine.pending(requestId), false);
});

test('starting the engine removes the old engine\'s files and keeps its own', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-engine-legacy-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const dir of ['sessions/2026', 'skills', 'threads']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  for (const file of ['config.toml', 'installation_id', 'state_5.sqlite', 'state_5.sqlite-wal', 'mcp-auth.json', 'threads/thread_a.thread']) fs.writeFileSync(path.join(home, file), 'x');
  const engine = new Engine({ homeDir: home, cwd: home });
  await engine.start();
  await engine.close();
  assert.deepEqual(fs.readdirSync(home).sort(), ['mcp-auth.json', 'threads']);
  assert.deepEqual(fs.readdirSync(path.join(home, 'threads')), ['thread_a.thread']);
});
