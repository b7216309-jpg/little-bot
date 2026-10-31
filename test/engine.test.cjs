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

test('a tool call can hand the thread a new tool list, offered from the next step of the same turn', async t => {
  const spec = name => ({ type: 'function', name, description: name, inputSchema: { type: 'object', properties: {} } });
  const { strata, thread, run } = await setup(t, [
    { calls: [{ name: 'plugin_load', arguments: { name: 'cad' } }] },
    { calls: [{ name: 'cad', arguments: {} }] },
    { content: 'Built.' },
  ], { tools: {
    plugin_load: () => ({ success: true, contentItems: [{ type: 'inputText', text: 'loaded' }], dynamicTools: [spec('cad')] }),
    cad: () => ({ success: true, contentItems: [{ type: 'inputText', text: 'a box' }] }),
  } });
  const threadId = await thread({ dynamicTools: [spec('plugin_load')] });
  assert.equal((await run(threadId, 'Design a box')).status, 'completed');
  const names = request => request.tools.map(tool => tool.function.name).filter(name => !['exec_command', 'write_stdin'].includes(name));
  assert.deepEqual(strata.requests.map(names), [['plugin_load'], ['cad'], ['cad']]);
  assert.equal(strata.requests[2].messages.filter(message => message.role === 'tool').at(-1).content, 'a box');
});

test('a tool call the server left as text is run as a call, and never shown as the answer', async t => {
  const spec = name => ({ type: 'function', name, description: name, inputSchema: { type: 'object', properties: {} } });
  const leaked = 'Let me look.\n<tool_call>\n<function=web_search_service>\n<parameter=queries>\n["WoW: Forever news", "WoW Forever realm status"]\n</parameter>\n<parameter=limit>\n6\n</parameter>\n</function>\n</tool_call>';
  let asked = null;
  const { strata, events, thread, run } = await setup(t, [
    { content: leaked },
    { content: '<tool_call>\n{"name": "calendar_list", "arguments": {"limit": 3}}\n</tool_call>' },
    { content: '<tool_call>\n<function=nope>\n</function>\n</tool_call>' },
    { content: 'Here is the digest.' },
  ], { tools: {
    web_search_service: args => { asked = args; return { success: true, contentItems: [{ type: 'inputText', text: 'two results' }] }; },
    calendar_list: args => ({ success: true, contentItems: [{ type: 'inputText', text: `limit ${args.limit}` }] }),
  } });
  const threadId = await thread({ dynamicTools: [spec('web_search_service'), spec('calendar_list')] });
  assert.equal((await run(threadId, 'News?')).status, 'completed');
  assert.deepEqual(asked, { queries: ['WoW: Forever news', 'WoW Forever realm status'], limit: 6 });
  const results = strata.requests[3].messages.filter(message => message.role === 'tool').map(message => message.content);
  assert.equal(results[0], 'two results');
  assert.equal(results[1], 'limit 3');
  assert.match(results[2], /nope/, 'a tool that was not offered gets an error the model can read');
  const answers = events.filter(event => event.method === 'item/completed' && event.item.type === 'agentMessage').map(event => [event.item.text, event.item.phase]);
  assert.deepEqual(answers.at(0), ['Let me look.', 'commentary']);
  assert.deepEqual(answers.at(-1), ['Here is the digest.', 'final_answer']);
  assert.ok(!answers.some(([text]) => text.includes('<tool_call>')));
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
  // A manual compaction keeps the newest exchange word for word, and always ends up smaller.
  assert.deepEqual(engine.threads.get(threadId).history.map(message => message.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(engine.threads.get(threadId).history[3].content, 'Second answer.');
  assert.equal(events.filter(event => event.item?.type === 'contextCompaction').length, 4);
  assert.deepEqual(usage.map(entry => entry.source), ['conversation', 'compaction', 'conversation', 'compaction']);
});

// A thread that compacts early, with room to spare in its window.
const lowLimit = (config, tokens = 1000) => ({ config: { ...config, model_auto_compact_token_limit: tokens } });

test('a compaction keeps the newest messages word for word and asks for the summary with no reasoning', async t => {
  const { strata, thread, run, config, engine } = await setup(t, [
    { content: 'Old answer.', reasoning: 'A long thought.', prompt: 5000 },
    { content: '## Next\nAnswer the recent question.' },
    { content: 'Recent answer.' },
  ]);
  const threadId = await thread(lowLimit(config));
  await run(threadId, 'A'.repeat(40000));
  assert.equal((await run(threadId, 'Recent question')).status, 'completed');
  const summary = strata.requests[1];
  assert.match(summary.messages.at(-1).content, /## Next: the exact next step/);
  assert.equal(summary.chat_template_kwargs.enable_thinking, false);
  assert.equal(summary.reasoning_effort, undefined);
  assert.equal(summary.temperature, 0.3);
  assert.equal(summary.presence_penalty, 0);
  assert.equal(summary.max_completion_tokens, 4096);
  assert.equal(summary.messages[1].content.length, 40000, 'the whole history goes, so the cache still matches');
  const after = strata.requests[2].messages.slice(1);
  assert.deepEqual(after.map(message => message.role), ['user', 'assistant', 'user']);
  assert.match(after[0].content, /Summary of the conversation so far[^]*Answer the recent question/);
  assert.equal(after[1].content, 'Old answer.');
  assert.equal(after[1].reasoning_content, undefined, 'stored reasoning goes');
  assert.equal(after[2].content, 'Recent question');
  assert.equal(engine.threads.get(threadId).contextTokens, 110);
});

test('a compaction in the middle of a turn keeps the request and whole tool steps', async t => {
  const big = 'r'.repeat(7000);
  const { strata, thread, run, config } = await setup(t, [
    { calls: [{ id: 'one', name: 'read', arguments: { n: 1 } }], prompt: 300 },
    { calls: [{ id: 'two', name: 'read', arguments: { n: 2 } }], prompt: 300 },
    { calls: [{ id: 'three', name: 'read', arguments: { n: 3 } }], prompt: 2000 },
    { content: 'The notes.' },
    { content: 'Finished.' },
  ], { tools: { read: () => ({ success: true, contentItems: [{ type: 'inputText', text: big }] }) } });
  const threadId = await thread({ ...lowLimit(config), approvalPolicy: 'never', dynamicTools: [{ name: 'read', description: 'Read.', inputSchema: { type: 'object', properties: {} } }] });
  assert.equal((await run(threadId, 'Do the long job')).status, 'completed');
  const after = strata.requests.at(-1).messages.slice(1);
  assert.match(after[0].content, /The notes/);
  assert.deepEqual(after.slice(1, 3).map(message => message.role), ['assistant', 'user']);
  assert.equal(after[2].content, 'Do the long job', 'the request stays even when the newest messages do not reach it');
  for (const [index, message] of after.entries()) {
    if (message.role !== 'tool') continue;
    assert.ok(after.slice(0, index).some(earlier => earlier.tool_calls?.some(call => call.id === message.tool_call_id)), 'every tool result follows its call');
  }
});

test('a request too big for the context still gets its summary, from less', async t => {
  const overflow = { status: 400, message: 'the request exceeds the available context size' };
  const { strata, thread, run, config, engine } = await setup(t, [
    { calls: [{ id: 'one', name: 'read', arguments: {} }] },
    { content: 'Done reading.' },
    overflow, overflow,
    { content: 'Notes from what fitted.' },
    { content: 'Second answer.' },
  ], { tools: { read: () => ({ success: true, contentItems: [{ type: 'inputText', text: 'long'.repeat(2000) }] }) } });
  const threadId = await thread({ config, approvalPolicy: 'never', dynamicTools: [{ name: 'read', description: 'Read.', inputSchema: { type: 'object', properties: {} } }] });
  await run(threadId, 'Read it');
  assert.equal((await run(threadId, 'Two')).status, 'completed');
  const tool = message => message.role === 'tool';
  assert.equal(strata.requests[3].messages.find(tool).content.length, 8000, 'the first summary request sends everything');
  assert.ok(strata.requests[4].messages.find(tool).content.length < 1100, 'the second cuts the old tool result short');
  assert.match(strata.requests[5].messages[1].content, /Notes from what fitted/);
  assert.equal(strata.requests[5].messages.at(-1).content, 'Two');
  assert.equal(engine.threads.get(threadId).history.at(-1).content, 'Second answer.');
});

test('when nothing fits, the conversation goes on from its newest messages', async t => {
  const overflow = { status: 400, message: 'the request exceeds the available context size' };
  const { strata, thread, run, config } = await setup(t, [{ content: 'First answer.' }, overflow, overflow, overflow, overflow, { content: 'Still here.' }]);
  const threadId = await thread({ config, dynamicTools: [{ name: 'memory_search', description: 'Search.', inputSchema: { type: 'object', properties: {} } }] });
  await run(threadId, 'One');
  assert.equal((await run(threadId, 'Two')).status, 'completed');
  const first = strata.requests.at(-1).messages[1].content;
  assert.match(first, /removed without a summary/);
  assert.match(first, /memory_search and session_read find anything missing/);
  assert.equal(strata.requests.at(-1).messages.at(-1).content, 'Two');
});

test('compaction runs when an answer is finished, so the next message starts at once', async t => {
  const { strata, events, thread, run, config } = await setup(t, [
    { content: 'First answer.', prompt: 5000 },
    { content: 'The notes.' },
    { content: 'Second answer.' },
  ]);
  const threadId = await thread(lowLimit(config));
  const finished = await run(threadId, 'v'.repeat(8000));
  assert.equal(finished.status, 'completed');
  assert.equal(strata.requests.length, 2, 'the summary came straight after the answer');
  assert.equal(strata.requests[1].messages.at(-1).content.startsWith('Your context is nearly full'), true);
  const order = events.map(event => event.item?.type === 'contextCompaction' ? 'compaction' : event.method).filter(name => ['compaction', 'turn/completed'].includes(name));
  assert.deepEqual(order, ['compaction', 'compaction', 'turn/completed']);
  await run(threadId, 'Two');
  assert.equal(strata.requests.length, 3, 'no second summary for the next message');
  assert.equal(strata.requests[2].messages.at(-1).content, 'Two');
  assert.equal(strata.requests[2].messages.some(message => message.content === 'v'.repeat(8000)), false, 'nothing is held for a turn that is over');
});

test('a thread nobody keeps does not summarize itself after its answer', async t => {
  const { strata, thread, run, config } = await setup(t, [{ content: 'Done.', prompt: 5000 }]);
  const threadId = await thread({ ...lowLimit(config), ephemeral: true });
  assert.equal((await run(threadId, 'v'.repeat(8000))).status, 'completed');
  assert.equal(strata.requests.length, 1);
});

test('stopping a summary after the answer leaves the answer standing', async t => {
  let stop;
  const { engine, thread, run, config, events } = await setup(t, [
    { content: 'First answer.', prompt: 5000 },
    (_body, _request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(': waiting\n\n'); stop(); },
    { content: 'Second answer.' },
  ]);
  const threadId = await thread(lowLimit(config));
  const summaryStarted = new Promise(resolve => { stop = resolve; });
  const finished = run(threadId, 'u'.repeat(8000));
  await summaryStarted;
  await engine.request('turn/interrupt', { threadId });
  assert.equal((await finished).status, 'completed');
  assert.equal(engine.threads.get(threadId).history.at(-1).content, 'First answer.');
  const failed = events.find(event => event.method === 'item/completed' && event.item?.type === 'contextCompaction');
  assert.equal(failed.item.error, 'Compaction was stopped.');
});

test('a compaction that fails does not end the turn, and tries again a little later', async t => {
  const { strata, events, thread, run, config } = await setup(t, [
    { content: 'First answer.', prompt: 2000 },
    { status: 500, message: 'The summary request failed.' },
    { content: 'Second answer.', prompt: 2000 },
    { content: 'Third answer.', prompt: 2200 },
    { content: 'The notes.' },
    { content: 'Fourth answer.' },
  ]);
  const threadId = await thread(lowLimit(config));
  await run(threadId, 'x'.repeat(8000));
  assert.equal((await run(threadId, 'Two')).status, 'completed');
  const failed = events.find(event => event.method === 'item/completed' && event.item?.type === 'contextCompaction');
  assert.match(failed.item.error, /summary request failed/);
  await run(threadId, 'Three');
  assert.equal(strata.requests[3].messages.at(-1).content, 'Three', 'not again right away');
  await run(threadId, 'Four');
  assert.match(strata.requests.at(-1).messages[1].content, /The notes/);
});

test('a server that reports no usage is measured from the text, so compaction still runs', async t => {
  const silent = content => (_body, _request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  };
  const { engine, strata, events, thread, run, config } = await setup(t, [silent('First answer.'), silent('The notes.'), silent('Second answer.')]);
  const threadId = await thread(lowLimit(config));
  await run(threadId, 'w'.repeat(8000));
  assert.equal(engine.threads.get(threadId).contextTokens, null);
  assert.equal(events.filter(event => event.method === 'thread/tokenUsage/updated').length, 0, 'no misleading zero on the meter');
  await run(threadId, 'Two');
  assert.match(strata.requests.at(-1).messages[1].content, /The notes/);
});

test('with compaction turned off the limit is still just below the window', async t => {
  const { strata, thread, run, config } = await setup(t, [
    { content: 'First answer.', prompt: 950 },
    { content: 'The notes.' },
    { content: 'Second answer.' },
  ]);
  const threadId = await thread({ config: { ...config, model_context_window: 1000 } });
  await run(threadId, 'y'.repeat(8000));
  await run(threadId, 'Two');
  assert.match(strata.requests.at(-1).messages[1].content, /The notes/);
});

test('standing context comes back after a compaction and survives a restart', async t => {
  const { engine, strata, thread, run, config } = await setup(t, [
    { content: 'First answer.', prompt: 5000 },
    { content: 'The notes.' },
    { content: 'Second answer.' },
  ]);
  const threadId = await thread(lowLimit(config));
  await run(threadId, 'z'.repeat(8000), { standing: 'PROFILE: be brief.' });
  await run(threadId, 'Two', { standing: 'PROFILE: be very brief.' });
  assert.match(strata.requests.at(-1).messages[1].content, /^PROFILE: be brief\.\n\nSummary of the conversation/);
  assert.equal(engine.store.load(threadId).standing, 'PROFILE: be very brief.');
  await engine.request('thread/unsubscribe', { threadId });
  await engine.request('thread/resume', { threadId, cwd: engine.cwd, config });
  assert.equal(engine.threads.get(threadId).standing, 'PROFILE: be very brief.');
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
