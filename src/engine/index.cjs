'use strict';

// Little Bot's agent engine. The app talks to it with requests (thread/start, turn/start, ...) and hears back through
// notifications (turn/started, item/..., turn/completed) and requests of its own (approve a command, run an app
// tool). The engine streams the model from the local server, runs commands, applies patches and calls MCP servers.
// Every command, file change, app tool and MCP call is offered to the app before it runs.

const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { streamChat, ModelError } = require('./model.cjs');
const { ShellSessions, runOnce } = require('./shell.cjs');
const { applyPatch, previewPatch, patchFromCommand } = require('./patch.cjs');
const { McpManager, filterTools } = require('./mcp.cjs');
const { EXEC_COMMAND, WRITE_STDIN, readOnlyCommand } = require('./tools.cjs');
const { applyQwenGeneration, applySampling } = require('../local-generation.cjs');

const MAX_STEPS = 400;
const CHARS_PER_TOKEN = 4;
const EFFORTS = new Set(['none', 'low', 'medium', 'high']);
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
const COMPACTION_PROMPT = 'Your context is nearly full, so older messages will be removed. Write a summary that lets you continue without them: the user\'s requests and preferences in this conversation, what has been done (files changed, commands run, results), decisions made, what is still open, and the exact next step. Keep names, paths, numbers and quoted text exact. Reply with the summary only.';
// Codex's on-disk state from before Little Bot had its own engine.
const LEGACY_FILES = /^(?:config\.toml|installation_id|version\.json|models_cache\.json|history\.jsonl|auth\.json|\.personality_migration|[\w-]+_\d+\.sqlite(?:-shm|-wal)?)$/;
const LEGACY_DIRS = new Set(['sessions', 'archived_sessions', 'skills', 'thread-writer-locks', 'log', 'shell_snapshots', 'tmp', '.tmp']);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = prefix => `${prefix}_${randomUUID().replace(/-/g, '')}`;
const text = value => typeof value === 'string' ? value : value == null ? '' : String(value);

class TurnStopped extends Error { constructor(reason = 'Stopped.') { super(reason); this.code = 'interrupted'; } }

function threadServers(config = {}) {
  const servers = object(config.mcp_servers) ? { ...config.mcp_servers } : {};
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('mcp_servers.') && object(value)) servers[key.slice('mcp_servers.'.length)] = value;
  }
  return servers;
}

function toolName(server, tool) {
  return `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

function imagePart(file) {
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`Unsupported image type: ${path.basename(file)}`);
  return { type: 'image_url', image_url: { url: `data:${type};base64,${fs.readFileSync(file).toString('base64')}` } };
}

function userContent(input = []) {
  const parts = [];
  for (const item of Array.isArray(input) ? input : []) {
    if (item?.type === 'text' && typeof item.text === 'string') parts.push({ type: 'text', text: item.text });
    else if (item?.type === 'localImage' && typeof item.path === 'string') parts.push(imagePart(item.path));
    else if (item?.type === 'image' && typeof item.url === 'string') parts.push({ type: 'image_url', image_url: { url: item.url } });
  }
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts;
}

function messageChars(messages) {
  let total = 0;
  for (const message of messages) {
    total += text(message.reasoning_content).length;
    if (typeof message.content === 'string') total += message.content.length;
    else for (const part of message.content || []) total += part.type === 'text' ? text(part.text).length : 3000;
    for (const call of message.tool_calls || []) total += text(call.function?.arguments).length + 40;
  }
  return total;
}

function commandOutput(result) {
  const wall = `${(result.wallMs / 1000).toFixed(1)} s`;
  if (result.sessionId) return `Process still running (session_id ${result.sessionId}, ${wall} so far). Use write_stdin with this session_id to read more output or send input.\nOutput so far:\n${result.output}`;
  if (result.stopped) return `The command was stopped.\nOutput:\n${result.output}`;
  return `Exit code: ${result.exitCode}\nWall time: ${wall}\nOutput:\n${result.output}`;
}

class Thread {
  constructor(engine, threadId, options, history = []) {
    this.engine = engine;
    this.id = threadId;
    this.history = history;
    this.shells = new ShellSessions();
    this.turn = null;
    this.usageTotal = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
    this.contextTokens = null;
    this.configure(options);
  }

  configure(options = {}) {
    const previous = this.options || {};
    this.options = { ...previous, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
    this.config = object(this.options.config) ? this.options.config : {};
    this.servers = threadServers(this.config);
    this.mcpTools = null;
  }

  get ephemeral() { return this.options.ephemeral === true; }
  get cwd() { return this.options.cwd || this.engine.cwd; }
  get shellEnabled() { return this.config['features.shell_tool'] !== false && this.config['features.unified_exec'] !== false; }
  get readOnly() { return ['read-only', 'readOnly'].includes(this.turn?.sandbox || this.options.sandbox); }

  system() {
    const environment = `Working folder: ${this.options.cwd || this.engine.cwd}\nShell: ${process.platform === 'win32' ? 'Windows PowerShell 5.1 (run commands with exec_command)' : 'sh'}`;
    return [this.options.baseInstructions, this.options.developerInstructions, this.shellEnabled ? environment : ''].filter(item => text(item).trim()).join('\n\n');
  }

  async tools() {
    const tools = [];
    if (this.shellEnabled) tools.push(EXEC_COMMAND, WRITE_STDIN);
    for (const spec of Array.isArray(this.options.dynamicTools) ? this.options.dynamicTools : []) {
      if (!object(spec) || typeof spec.name !== 'string') continue;
      tools.push({ type: 'function', function: { name: spec.name, description: text(spec.description), parameters: spec.inputSchema || spec.parameters || { type: 'object', properties: {} } } });
    }
    if (!this.mcpTools) {
      this.mcpTools = new Map();
      for (const [server, config] of Object.entries(this.servers)) {
        if (!object(config) || config.enabled === false) continue;
        try {
          const connection = await this.engine.mcp.connect(server, config, this.cwd);
          for (const tool of filterTools(await connection.listTools(), config)) {
            const name = toolName(server, tool.name);
            if (!this.mcpTools.has(name)) this.mcpTools.set(name, { server, tool: tool.name, config, spec: { type: 'function', function: { name, description: text(tool.description).slice(0, 2000), parameters: object(tool.inputSchema) ? tool.inputSchema : { type: 'object', properties: {} } } } });
          }
        } catch (error) { this.engine.diagnose(`MCP server ${server}: ${error.message}`); }
      }
    }
    for (const entry of this.mcpTools.values()) tools.push(entry.spec);
    return tools;
  }

  async save() {
    if (this.ephemeral) return;
    await this.engine.store.save(this.id, { id: this.id, savedAt: Date.now(), history: this.history });
  }

  notify(method, params = {}) { this.engine.notify(method, { threadId: this.id, ...params }); }
}

// Threads that outlive a turn are kept per conversation, encrypted when the app provides a protector.
class ThreadStore {
  constructor({ dir, protector }) { this.dir = dir; this.protector = protector; }
  file(threadId) {
    if (!/^[\w-]{1,100}$/.test(threadId)) throw new Error('Invalid thread ID.');
    return path.join(this.dir, `${threadId}.thread`);
  }
  async save(threadId, data) {
    await fs.promises.mkdir(this.dir, { recursive: true });
    const json = JSON.stringify(data);
    const bytes = this.protector ? this.protector.encryptString(json) : Buffer.from(json, 'utf8');
    const file = this.file(threadId), temporary = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, bytes);
    for (let attempt = 0; ; attempt++) {
      try { await fs.promises.rename(temporary, file); return; }
      catch (error) {
        if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }
  load(threadId) {
    let bytes;
    try { bytes = fs.readFileSync(this.file(threadId)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const json = this.protector ? this.protector.decryptString(bytes) : bytes.toString('utf8');
    const data = JSON.parse(json);
    return object(data) && Array.isArray(data.history) ? data : null;
  }
  remove(threadId) { fs.rmSync(this.file(threadId), { force: true }); }
}

class Engine extends EventEmitter {
  constructor({ homeDir, cwd, protector = null, fetchImpl } = {}) {
    super();
    if (!homeDir || !cwd || !path.isAbsolute(homeDir) || !path.isAbsolute(cwd)) throw new TypeError('Engine homeDir and cwd must be absolute paths.');
    this.homeDir = homeDir;
    this.cwd = cwd;
    this.fetchImpl = fetchImpl;
    this.state = 'idle';
    this.threads = new Map();
    this.serverRequests = new Map();
    this.nextRequestId = 1;
    this._diagnostics = '';
    this.hooks = { thinking: () => true, sampling: () => ({}), classify: () => 'other', onUsage: () => {} };
    this.store = new ThreadStore({ dir: path.join(homeDir, 'threads'), protector });
    this.mcp = new McpManager({ authFile: path.join(homeDir, 'mcp-auth.json'), protector,
      onLoginCompleted: result => this.notify('mcpServer/oauthLogin/completed', result) });
  }

  // The app's settings that shape every model request, and where usage is recorded.
  configure(hooks = {}) { Object.assign(this.hooks, Object.fromEntries(Object.entries(hooks).filter(([, value]) => typeof value === 'function'))); }

  get ready() { return this.state === 'ready'; }
  get diagnostics() { return this._diagnostics; }
  diagnose(message) {
    this._diagnostics = `${this._diagnostics}${String(message).slice(0, 2000)}\n`.slice(-16384);
    this.emit('diagnostics', message);
  }

  async start() {
    if (this.state === 'ready') return {};
    if (this.state === 'closed') throw new Error('The engine is closed.');
    await fs.promises.mkdir(this.homeDir, { recursive: true });
    this.removeLegacyState();
    this.state = 'ready';
    return {};
  }

  removeLegacyState() {
    let names;
    try { names = fs.readdirSync(this.homeDir, { withFileTypes: true }); } catch { return; }
    for (const entry of names) {
      const legacy = entry.isDirectory() ? LEGACY_DIRS.has(entry.name) : LEGACY_FILES.test(entry.name);
      if (!legacy) continue;
      try { fs.rmSync(path.join(this.homeDir, entry.name), { recursive: true, force: true }); }
      catch (error) { this.diagnose(`Could not remove old engine data ${entry.name}: ${error.message}`); }
    }
  }

  async restart() {
    await this.close();
    this.state = 'idle';
    return this.start();
  }

  async close() {
    if (this.state === 'closed') return;
    this.state = 'closing';
    for (const thread of this.threads.values()) thread.turn?.abort.abort(new TurnStopped('The engine closed.'));
    for (const [requestId, pending] of this.serverRequests) { pending.reject(new TurnStopped('The engine closed.')); this.serverRequests.delete(requestId); }
    await Promise.allSettled([...this.threads.values()].map(thread => thread.shells.killAll()));
    this.threads.clear();
    await this.mcp.closeAll();
    this.state = 'closed';
  }

  notify(method, params = {}) {
    try { this.emit('notification', method, params); }
    catch (error) { this.diagnose(`Notification ${method} failed: ${error.message}`); }
  }

  // A request to the app (approve, run an app tool, ask the user). A stopped turn settles it as cancelled.
  ask(method, params, signal) {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (!this.serverRequests.delete(requestId)) return;
        this.notify('serverRequest/resolved', { requestId, threadId: params.threadId });
        reject(signal.reason instanceof Error ? signal.reason : new TurnStopped());
      };
      this.serverRequests.set(requestId, {
        resolve: value => { signal?.removeEventListener('abort', onAbort); resolve(value); },
        reject: error => { signal?.removeEventListener('abort', onAbort); reject(error); },
      });
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.emit('request', { id: requestId, method, params });
    });
  }
  pending(requestId) { return this.serverRequests.has(requestId); }
  async respond(requestId, result) {
    const pending = this.serverRequests.get(requestId);
    if (!pending) throw new Error('This engine request is no longer pending.');
    this.serverRequests.delete(requestId);
    pending.resolve(result);
  }
  async reject(requestId, message) {
    const pending = this.serverRequests.get(requestId);
    if (!pending) throw new Error('This engine request is no longer pending.');
    this.serverRequests.delete(requestId);
    pending.reject(new Error(text(message) || 'The request was refused.'));
  }

  async request(method, params = {}) {
    if (this.state === 'idle') await this.start();
    if (!this.ready) throw new Error('The assistant engine is not running.');
    const handler = {
      'thread/start': () => this.threadStart(params),
      'thread/resume': () => this.threadResume(params),
      'thread/unsubscribe': () => this.threadUnsubscribe(params),
      'turn/start': () => this.turnStart(params),
      'turn/interrupt': () => this.turnInterrupt(params),
      'turn/steer': () => this.turnSteer(params),
      'thread/compact/start': () => this.compactStart(params),
      'command/exec': () => this.commandExec(params),
      'config/read': () => ({ config: { mcp_servers: {} } }),
      'mcpServerStatus/list': () => this.mcpStatus(params),
      'mcpServer/tool/call': () => this.mcpCall(params),
      'mcpServer/oauth/login': () => this.mcpLogin(params),
    }[method];
    if (!handler) throw Object.assign(new Error(`Unsupported engine request: ${method}`), { code: -32601 });
    return handler();
  }

  thread(threadId) {
    const thread = this.threads.get(threadId);
    if (!thread) throw Object.assign(new Error(`Thread not found: ${threadId}`), { code: -32602 });
    return thread;
  }

  threadStart(params) {
    const thread = new Thread(this, id('thread'), params);
    this.threads.set(thread.id, thread);
    return { thread: { id: thread.id } };
  }

  threadResume(params) {
    const existing = this.threads.get(params.threadId);
    if (existing) { existing.configure(params); return { thread: { id: existing.id } }; }
    const saved = this.store.load(params.threadId);
    if (!saved) throw new Error(`no rollout found for thread id ${params.threadId}`);
    const thread = new Thread(this, params.threadId, params, saved.history);
    this.threads.set(thread.id, thread);
    return { thread: { id: thread.id } };
  }

  async threadUnsubscribe({ threadId }) {
    const thread = this.threads.get(threadId);
    if (!thread) return {};
    if (thread.turn) { thread.turn.abort.abort(new TurnStopped('The conversation closed.')); await thread.turn.done; }
    await thread.shells.killAll();
    this.threads.delete(threadId);
    return {};
  }

  deleteThread(threadId) {
    this.threads.delete(threadId);
    this.store.remove(threadId);
  }

  turnStart(params) {
    const thread = this.thread(params.threadId);
    if (thread.turn) throw new Error('A turn is already running in this thread.');
    const turn = this.newTurn(thread, params);
    setImmediate(() => { turn.done = this.runTurn(thread, turn, params).catch(error => this.diagnose(error.stack || error.message)); });
    return { turn: { id: turn.id, status: 'inProgress' } };
  }

  newTurn(thread, params) {
    const turn = { id: id('turn'), abort: new AbortController(), steers: [], sandbox: params.sandboxPolicy?.type || thread.options.sandbox,
      approvalPolicy: params.approvalPolicy || thread.options.approvalPolicy || 'never', done: Promise.resolve() };
    if (params.cwd) thread.options.cwd ||= params.cwd;
    if (params.model) thread.options.model = params.model;
    thread.turn = turn;
    return turn;
  }

  turnInterrupt({ threadId, turnId }) {
    const thread = this.threads.get(threadId);
    if (thread?.turn && (!turnId || thread.turn.id === turnId)) thread.turn.abort.abort(new TurnStopped('Stopped.'));
    return {};
  }

  turnSteer({ threadId, expectedTurnId, input }) {
    const thread = this.thread(threadId);
    if (!thread.turn || (expectedTurnId && thread.turn.id !== expectedTurnId)) throw new Error('No matching turn is running.');
    const content = userContent(input);
    if (content && (typeof content === 'string' ? content.trim() : content.length)) thread.turn.steers.push(content);
    return { turnId: thread.turn.id };
  }

  compactStart({ threadId }) {
    const thread = this.thread(threadId);
    if (thread.turn) throw new Error('Wait for the current turn before compacting.');
    const turn = this.newTurn(thread, {});
    setImmediate(() => { turn.done = this.runCompactionTurn(thread, turn).catch(error => this.diagnose(error.stack || error.message)); });
    return {};
  }

  async commandExec({ command, cwd, timeoutMs }) {
    const result = await runOnce({ argv: command, cwd: cwd || this.cwd, timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 20000 });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  }

  async mcpStatus({ threadId }) {
    const thread = this.thread(threadId);
    return { data: await this.mcp.status(thread.servers, thread.cwd), nextCursor: null };
  }

  async mcpCall({ threadId, server, tool, arguments: args }) {
    const thread = this.thread(threadId);
    const config = thread.servers[server];
    if (!object(config) || config.enabled === false) throw new Error(`The MCP server ${server} is not enabled here.`);
    if (!filterTools([{ name: tool }], config).length) throw new Error(`The MCP tool ${server}/${tool} is not enabled here.`);
    const connection = await this.mcp.connect(server, config, thread.cwd);
    return connection.callTool(tool, args);
  }

  async mcpLogin({ threadId, name, timeoutSecs }) {
    const thread = this.thread(threadId);
    const config = thread.servers[name];
    if (!object(config)) throw new Error(`Unknown MCP server: ${name}`);
    return this.mcp.login({ name, config, cwd: thread.cwd, threadId, timeoutSecs: Number(timeoutSecs) || 120 });
  }

  // ------------------------------------------------------------------------------------------- turns
  async runTurn(thread, turn, params) {
    const signal = turn.abort.signal;
    thread.notify('turn/started', { turn: { id: turn.id, status: 'inProgress' } });
    const startLength = thread.history.length;
    let status = 'completed', error = null;
    try {
      const content = userContent(params.input);
      thread.history.push({ role: 'user', content: content || '' });
      let retriedOverflow = false;
      for (let step = 0; ; step++) {
        if (signal.aborted) throw signal.reason;
        if (step >= MAX_STEPS) throw new Error(`The turn stopped after ${MAX_STEPS} model calls.`);
        while (turn.steers.length) thread.history.push({ role: 'user', content: turn.steers.shift() });
        await this.maybeCompact(thread, turn);
        let answer;
        try { answer = await this.modelStep(thread, turn, params); }
        catch (failure) {
          if (failure.code === 'context_length_exceeded' && !retriedOverflow) { retriedOverflow = true; await this.compact(thread, turn, { force: true }); continue; }
          throw failure;
        }
        if (!answer.toolCalls.length) break;
        await this.runTools(thread, turn, answer.toolCalls);
        await thread.save();
      }
    } catch (failure) {
      if (signal.aborted || failure instanceof TurnStopped) {
        status = 'interrupted';
        this.closeToolCalls(thread, 'Stopped by the user before this finished.');
      } else {
        status = 'failed';
        error = { message: failure.message || 'The model request failed.' };
        this.closeToolCalls(thread, 'The turn failed before this finished.');
        if (thread.history.length === startLength + 1 && thread.history.at(-1).role === 'user') thread.history.pop();
        thread.notify('error', { turnId: turn.id, error, willRetry: false });
      }
    } finally {
      await thread.shells.killAll().catch(() => {});
    }
    await thread.save().catch(saveError => this.diagnose(`Could not save the conversation: ${saveError.message}`));
    thread.turn = null;
    thread.notify('turn/completed', { turn: { id: turn.id, status, ...(error ? { error } : {}) } });
  }

  // Every tool call the model made gets an answer, even after a stop, so the history stays well formed.
  closeToolCalls(thread, message) {
    const last = [...thread.history].reverse().find(item => item.role === 'assistant');
    if (!last?.tool_calls?.length) return;
    const answered = new Set(thread.history.filter(item => item.role === 'tool').map(item => item.tool_call_id));
    for (const call of last.tool_calls) if (!answered.has(call.id)) thread.history.push({ role: 'tool', tool_call_id: call.id, content: message });
  }

  requestBody(thread, turn, params, tools, messages) {
    const thinking = this.hooks.thinking() !== false;
    const effort = text(params.effort || thread.config.model_reasoning_effort || '').toLowerCase();
    const body = { model: thread.options.model || params.model, messages,
      chat_template_kwargs: { enable_thinking: thinking } };
    if (EFFORTS.has(effort) && thinking) body.reasoning_effort = effort;
    if (tools.length) body.tools = tools;
    else if (object(params.outputSchema)) body.response_format = { type: 'json_schema', json_schema: { name: 'result', schema: params.outputSchema } };
    applyQwenGeneration(body, thinking);
    applySampling(body, this.hooks.sampling());
    // Strata fits the answer to the room left in the context; a fixed default would only cut answers short.
    delete body.max_output_tokens;
    return body;
  }

  baseUrl(thread) {
    const url = thread.config.local_base_url || thread.config['model_providers.local']?.base_url;
    if (typeof url !== 'string' || !url) throw new ModelError('The local model server is not configured.');
    return url;
  }

  async modelStep(thread, turn, params, { compaction = false, extraMessages = [] } = {}) {
    const signal = turn.abort.signal;
    const tools = await thread.tools();
    const messages = [{ role: 'system', content: thread.system() }, ...thread.history, ...extraMessages];
    const body = this.requestBody(thread, turn, params, tools, messages);
    const reasoningId = id('rs'), messageId = id('msg');
    let reasoningStarted = false, messageStarted = false;
    const startedAt = Date.now();
    const answer = await streamChat({ baseUrl: this.baseUrl(thread), body, signal, fetchImpl: this.fetchImpl,
      onReasoning: delta => {
        if (compaction) return;
        if (!reasoningStarted) { reasoningStarted = true; thread.notify('item/started', { turnId: turn.id, item: { type: 'reasoning', id: reasoningId, content: [], summary: [] } }); }
        thread.notify('item/reasoning/textDelta', { turnId: turn.id, itemId: reasoningId, delta, contentIndex: 0 });
      },
      onContent: delta => {
        if (compaction) return;
        if (!messageStarted) { messageStarted = true; thread.notify('item/started', { turnId: turn.id, item: { type: 'agentMessage', id: messageId, text: '' } }); }
        thread.notify('item/agentMessage/delta', { turnId: turn.id, itemId: messageId, delta });
      },
    });
    const usage = answer.usage || {};
    const input = Number(usage.prompt_tokens) || 0, output = Number(usage.completion_tokens) || 0;
    const cached = Number(usage.prompt_tokens_details?.cached_tokens) || 0;
    const reasoningTokens = Number(usage.completion_tokens_details?.reasoning_tokens) || 0;
    const last = { inputTokens: input, cachedInputTokens: cached, outputTokens: output, reasoningOutputTokens: reasoningTokens, totalTokens: input + output };
    for (const key of Object.keys(thread.usageTotal)) thread.usageTotal[key] += last[key];
    if (!compaction) thread.contextTokens = last.totalTokens;
    try {
      this.hooks.onUsage({ source: this.hooks.classify({ threadId: thread.id, compaction }), model: body.model, input, cached, output,
        startedAt, firstByteAt: answer.firstByteAt, finishedAt: Date.now() });
    } catch (error) { this.diagnose(`Usage could not be recorded: ${error.message}`); }
    thread.notify('thread/tokenUsage/updated', { turnId: turn.id, tokenUsage: { last, total: { ...thread.usageTotal },
      modelContextWindow: Number(thread.config.model_context_window) || null } });
    if (compaction) return answer;
    if (reasoningStarted) thread.notify('item/completed', { turnId: turn.id, item: { type: 'reasoning', id: reasoningId, content: [answer.reasoning], summary: [] } });
    const calls = answer.toolCalls.map(call => ({ id: call.id || id('call'), type: 'function', function: { name: call.name, arguments: call.arguments || '{}' } }));
    if (messageStarted || (!calls.length && answer.content)) {
      if (!messageStarted) thread.notify('item/started', { turnId: turn.id, item: { type: 'agentMessage', id: messageId, text: '' } });
      thread.notify('item/completed', { turnId: turn.id, item: { type: 'agentMessage', id: messageId, text: answer.content, phase: calls.length ? 'commentary' : 'final_answer' } });
    }
    const message = { role: 'assistant', content: answer.content };
    if (answer.reasoning) message.reasoning_content = answer.reasoning;
    if (calls.length) message.tool_calls = calls;
    thread.history.push(message);
    return { ...answer, toolCalls: calls };
  }

  // ------------------------------------------------------------------------------------------- tools
  async runTools(thread, turn, calls) {
    const images = [];
    for (const call of calls) {
      if (turn.abort.signal.aborted) throw turn.abort.signal.reason;
      let args;
      try {
        args = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
        if (!object(args)) throw new Error('Arguments must be a JSON object.');
      } catch (error) {
        thread.history.push({ role: 'tool', tool_call_id: call.id, content: `Invalid JSON arguments for ${call.function.name}: ${error.message}` });
        continue;
      }
      const result = await this.runTool(thread, turn, call, args);
      thread.history.push({ role: 'tool', tool_call_id: call.id, content: result.text });
      images.push(...(result.images || []));
    }
    // Local servers accept images only from the user; tool images follow the tool results.
    if (images.length) thread.history.push({ role: 'user', content: [{ type: 'text', text: 'Images returned by the tool calls above:' }, ...images.slice(0, 8).map(url => ({ type: 'image_url', image_url: { url } }))] });
  }

  async runTool(thread, turn, call, args) {
    const name = call.function.name;
    const signal = turn.abort.signal;
    if (thread.shellEnabled && name === 'exec_command') return this.execCommand(thread, turn, call, args);
    if (thread.shellEnabled && name === 'write_stdin') return this.writeStdin(thread, turn, call, args);
    const dynamic = (thread.options.dynamicTools || []).find(spec => spec?.name === name);
    if (dynamic) {
      thread.notify('item/started', { turnId: turn.id, item: { type: 'dynamicToolCall', id: call.id, tool: name, arguments: args, status: 'inProgress' } });
      let response;
      try { response = await this.ask('item/tool/call', { threadId: thread.id, turnId: turn.id, callId: call.id, tool: name, arguments: args }, signal); }
      catch (error) {
        if (signal.aborted) throw signal.reason;
        response = { success: false, contentItems: [{ type: 'inputText', text: error.message }] };
      }
      const items = Array.isArray(response?.contentItems) ? response.contentItems : [];
      thread.notify('item/completed', { turnId: turn.id, item: { type: 'dynamicToolCall', id: call.id, tool: name, arguments: args, success: response?.success !== false, status: response?.success === false ? 'failed' : 'completed' } });
      return { text: items.filter(item => item?.type === 'inputText').map(item => text(item.text)).join('\n') || (response?.success === false ? 'The tool failed.' : 'Done.'),
        images: items.filter(item => item?.type === 'inputImage' && typeof item.imageUrl === 'string').map(item => item.imageUrl) };
    }
    const mcp = thread.mcpTools?.get(name);
    if (mcp) return this.mcpTool(thread, turn, call, mcp, args);
    const available = (await thread.tools()).map(tool => tool.function.name).slice(0, 60).join(', ');
    return { text: `Unknown tool "${name}". Available tools: ${available}.` };
  }

  async approve(thread, turn, method, params) {
    if (turn.approvalPolicy !== 'untrusted') return true;
    const response = await this.ask(method, { threadId: thread.id, turnId: turn.id, ...params }, turn.abort.signal);
    const decision = typeof response?.decision === 'string' ? response.decision : 'decline';
    if (decision === 'cancel') { turn.abort.abort(new TurnStopped('Stopped.')); throw new TurnStopped('Stopped.'); }
    return decision === 'accept' || decision === 'acceptForSession';
  }

  async execCommand(thread, turn, call, args) {
    const command = text(args.cmd ?? args.command);
    const cwd = args.workdir ? path.resolve(thread.cwd, text(args.workdir)) : thread.cwd;
    const patch = patchFromCommand(command);
    if (patch !== null) return this.patchFiles(thread, turn, call, patch, cwd);
    const item = { type: 'commandExecution', id: call.id, command, cwd, status: 'inProgress', aggregatedOutput: '' };
    thread.notify('item/started', { turnId: turn.id, item });
    const finish = (status, output, extra = {}) => {
      thread.notify('item/completed', { turnId: turn.id, item: { ...item, status, aggregatedOutput: output, ...extra } });
      return { text: output };
    };
    if (!command.trim()) return finish('failed', 'Give the command to run in cmd.');
    if (thread.readOnly && !readOnlyCommand(command)) return finish('declined', 'Plan mode is read-only: this command could change files or reach the network, so it was not run. Read with Get-Content, Get-ChildItem or rg, and describe the change in the plan instead.');
    if (!(await this.approve(thread, turn, 'item/commandExecution/requestApproval', { itemId: call.id, command, cwd, reason: null }))) {
      return finish('declined', 'The command was declined and did not run.');
    }
    const result = await thread.shells.exec({ command, cwd, yieldMs: Number(args.yield_time_ms), maxChars: (Number(args.max_output_tokens) || 8000) * CHARS_PER_TOKEN, signal: turn.abort.signal });
    if (result.stopped) throw turn.abort.signal.reason || new TurnStopped();
    const output = commandOutput(result);
    return finish(result.sessionId || result.exitCode === 0 ? 'completed' : 'failed', output, { exitCode: result.exitCode, durationMs: result.wallMs });
  }

  async writeStdin(thread, turn, call, args) {
    const sessionId = Number(args.session_id);
    const chars = text(args.chars);
    const item = { type: 'commandExecution', id: call.id, command: chars ? `(typed into session ${sessionId}) ${chars}` : `(read session ${sessionId})`, cwd: thread.cwd, status: 'inProgress', aggregatedOutput: '' };
    thread.notify('item/started', { turnId: turn.id, item });
    const finish = (status, output) => { thread.notify('item/completed', { turnId: turn.id, item: { ...item, status, aggregatedOutput: output } }); return { text: output }; };
    if (chars && thread.readOnly) return finish('declined', 'Plan mode is read-only: input to a running command is not sent.');
    if (chars && !(await this.approve(thread, turn, 'item/commandExecution/requestApproval', { itemId: call.id, command: chars, cwd: thread.cwd, reason: null }))) {
      return finish('declined', 'The input was declined and was not sent.');
    }
    let result;
    try { result = await thread.shells.write({ sessionId, chars, yieldMs: args.yield_time_ms === undefined ? undefined : Number(args.yield_time_ms), maxChars: (Number(args.max_output_tokens) || 8000) * CHARS_PER_TOKEN, signal: turn.abort.signal }); }
    catch (error) { return finish('failed', error.message); }
    if (result.stopped) throw turn.abort.signal.reason || new TurnStopped();
    return finish('completed', commandOutput(result));
  }

  async patchFiles(thread, turn, call, patch, cwd) {
    let changes;
    try { changes = previewPatch(patch, cwd); }
    catch (error) {
      thread.notify('item/started', { turnId: turn.id, item: { type: 'fileChange', id: call.id, changes: [], status: 'inProgress' } });
      thread.notify('item/completed', { turnId: turn.id, item: { type: 'fileChange', id: call.id, changes: [], status: 'failed' } });
      return { text: `The patch is not valid: ${error.message}` };
    }
    const item = { type: 'fileChange', id: call.id, changes, status: 'inProgress' };
    thread.notify('item/started', { turnId: turn.id, item });
    const finish = (status, message, final = changes) => { thread.notify('item/completed', { turnId: turn.id, item: { ...item, changes: final, status } }); return { text: message }; };
    if (thread.readOnly) return finish('declined', 'Plan mode is read-only: the patch was not applied. Describe the change in the plan instead.');
    if (!(await this.approve(thread, turn, 'item/fileChange/requestApproval', { itemId: call.id, reason: null, grantRoot: null }))) {
      return finish('declined', 'The file change was declined and nothing was written.');
    }
    try {
      const applied = applyPatch(patch, cwd);
      return finish('completed', `Done. ${applied.map(change => `${change.kind === 'add' ? 'Added' : change.kind === 'delete' ? 'Deleted' : 'Updated'} ${path.relative(cwd, change.path) || change.path}`).join('; ')}.`, applied);
    } catch (error) { return finish('failed', `The patch did not apply, and no file was changed: ${error.message}`); }
  }

  async mcpTool(thread, turn, call, entry, args) {
    const item = { type: 'mcpToolCall', id: call.id, server: entry.server, tool: entry.tool, arguments: args, status: 'inProgress' };
    thread.notify('item/started', { turnId: turn.id, item });
    const finish = (status, extra, message) => { thread.notify('item/completed', { turnId: turn.id, item: { ...item, status, ...extra } }); return message; };
    if (!(await this.approve(thread, turn, 'item/mcpToolCall/requestApproval', { itemId: call.id, server: entry.server, tool: entry.tool, arguments: args }))) {
      return finish('declined', { error: 'Declined.' }, { text: 'The MCP tool call was declined and did not run.' });
    }
    try {
      const connection = await this.mcp.connect(entry.server, entry.config, thread.cwd);
      const result = await connection.callTool(entry.tool, args, { signal: turn.abort.signal });
      const content = Array.isArray(result?.content) ? result.content : [];
      const output = content.filter(part => part?.type === 'text').map(part => text(part.text)).join('\n')
        || (result?.structuredContent ? JSON.stringify(result.structuredContent) : '');
      const images = content.filter(part => part?.type === 'image' && typeof part.data === 'string').map(part => `data:${part.mimeType || 'image/png'};base64,${part.data}`);
      return finish(result?.isError ? 'failed' : 'completed', { result: { content } }, { text: (result?.isError ? `The tool reported an error: ${output}` : output || 'Done.').slice(0, 100000), images });
    } catch (error) {
      if (turn.abort.signal.aborted) throw turn.abort.signal.reason;
      return finish('failed', { error: error.message }, { text: `The MCP tool failed: ${error.message}` });
    }
  }

  // ------------------------------------------------------------------------------------------- compaction
  autoLimit(thread) {
    const limit = Number(thread.config.model_auto_compact_token_limit);
    return Number.isFinite(limit) && limit > 0 ? limit : null;
  }

  async maybeCompact(thread, turn) {
    const limit = this.autoLimit(thread);
    const estimate = thread.contextTokens ?? Math.round(messageChars(thread.history) / CHARS_PER_TOKEN);
    if (limit && estimate >= limit && thread.history.length > 2) await this.compact(thread, turn);
  }

  async compact(thread, turn, { manual = false } = {}) {
    const itemId = id('compact');
    thread.notify('item/started', { turnId: turn.id, item: { type: 'contextCompaction', id: itemId } });
    const answer = await this.modelStep(thread, turn, {}, { compaction: true, extraMessages: [{ role: 'user', content: COMPACTION_PROMPT }] });
    const summary = answer.content.trim();
    if (!summary) throw new Error('Compaction returned no summary.');
    // The summary replaces everything before the request being worked on, which stays so the turn can continue.
    let current = null;
    if (!manual) for (let index = thread.history.length - 1; index >= 0; index--) if (thread.history[index].role === 'user') { current = thread.history[index]; break; }
    thread.history = [{ role: 'user', content: `Summary of the conversation so far, written by you before older messages were removed:\n${summary}` },
      ...(current ? [{ role: 'assistant', content: 'Understood. Continuing from the summary.' }, current] : [])];
    thread.contextTokens = null;
    await thread.save();
    thread.notify('item/completed', { turnId: turn.id, item: { type: 'contextCompaction', id: itemId } });
  }

  async runCompactionTurn(thread, turn) {
    thread.notify('turn/started', { turn: { id: turn.id, status: 'inProgress' } });
    let status = 'completed', error = null;
    try { await this.compact(thread, turn, { manual: true }); }
    catch (failure) {
      if (turn.abort.signal.aborted || failure instanceof TurnStopped) status = 'interrupted';
      else { status = 'failed'; error = { message: failure.message }; thread.notify('error', { turnId: turn.id, error, willRetry: false }); }
    }
    thread.turn = null;
    thread.notify('turn/completed', { turn: { id: turn.id, status, ...(error ? { error } : {}) } });
  }
}

module.exports = { Engine, TurnStopped, threadServers, userContent };
