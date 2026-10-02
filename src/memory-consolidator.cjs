'use strict';

const { parseModelJson } = require('./model-json.cjs');
const proactive = require('./proactive-chat.cjs');

// Users forgot almost half of automatically learned records; fewer, sturdier memories are worth more.
const MAX_LEARNED_PER_TURN = 3;

const EXTRACTION_SCHEMA = {
  type: 'object', properties: { memories: { type: 'array', items: {
    type: 'object', properties: {
      text: { type: 'string' }, type: { type: 'string', enum: ['preference', 'fact', 'decision', 'procedure', 'issue'] },
      scope: { type: 'string', enum: ['global', 'workspace'] }, key: { type: 'string' },
      supersedesId: { type: ['string', 'null'] }, sourceIds: { type: 'array', items: { type: 'string' } },
    }, required: ['text', 'type', 'scope', 'key', 'supersedesId', 'sourceIds'], additionalProperties: false,
  } } }, required: ['memories'], additionalProperties: false,
};
const INSTRUCTIONS = `Extract useful durable memory from the supplied completed turn. Return JSON matching the schema.
Remember stable user preferences, project facts, actual decisions, successful reusable procedures and unresolved issues. Use the user's language. An empty memories array is correct when nothing durable was learned, and it is the usual result. Save at most three memories, and only what will still matter in future conversations weeks from now. Do not save greetings, routine tool success/failure logs, transient execution status, verbatim replies, one-off reminders, moods, plans for today, or things the user only mentioned in passing. Prefer a concise fact about an existing subject, superseding it, over many overlapping records.
Each memory must cite sourceIds from the supplied messages. Distinguish a user's decision from an assistant suggestion; do not promote a suggestion or an unsupported assistant claim into a fact. Tool observations can establish facts about the observed state. Do not infer personal traits.
Use a short stable key for the subject, for example project.package-manager. If a current record is corrected, set supersedesId to that record's exact ID and reuse its key. Global scope is for user preferences and facts; workspace scope is for the project. Existing records are provided to avoid duplicates.
This is a text processing task. Produce the structured result without using tools.`;

// Small local models drift from the schema: a missing scope or key, a bare array, an extra field.
// Keep every usable memory and drop only the broken ones instead of failing the whole turn.
function normalizeCandidates(output, job = {}) {
  const list = Array.isArray(output) ? output : output && typeof output === 'object' && Array.isArray(output.memories) ? output.memories : null;
  if (!list) throw new Error('Memory extraction did not match the required JSON schema.');
  const schema = EXTRACTION_SCHEMA.properties.memories.items.properties;
  const userIds = (job.messages || []).filter(message => message.role === 'user').map(message => message.id).filter(Boolean);
  const result = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    const type = typeof item.type === 'string' ? item.type.trim().toLowerCase() : '';
    if (!text || !schema.type.enum.includes(type)) continue;
    const scope = schema.scope.enum.includes(item.scope) ? item.scope : type === 'preference' ? 'global' : 'workspace';
    const key = typeof item.key === 'string' && item.key.trim() ? item.key.trim() : text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 48);
    const sourceIds = Array.isArray(item.sourceIds) && item.sourceIds.some(id => typeof id === 'string') ? item.sourceIds.filter(id => typeof id === 'string') : userIds;
    result.push({ text, type, scope, key, supersedesId: typeof item.supersedesId === 'string' && item.supersedesId ? item.supersedesId : null, sourceIds });
  }
  return result;
}

class MemoryConsolidator {
  constructor(controller, { intervalMs = 5000, timeoutMs = 90000, autoStart = true } = {}) {
    this.controller = controller;
    this.timeoutMs = timeoutMs;
    this.active = null;
    this.closed = false;
    this.notBefore = 0;
    this.lastError = null;
    if (autoStart) {
      this.timer = setInterval(() => { void this.tick(); }, intervalMs);
      this.timer.unref?.();
    }
  }
  get service() { return this.controller.store.memoryService; }
  // Jobs that failed only because the local server rejected a structured response format (fixed in 0.13.1) get another chance.
  retryFormatFailures() {
    let count = 0;
    for (const job of this.service?.failedExtractions?.() || []) {
      if (!/response_format/i.test(job.error || '')) continue;
      try { this.service.retryExtraction(job.id); count++; } catch { /* Already retried or discarded. */ }
    }
    return count;
  }
  get state() { return { status: this.active ? 'learning' : 'idle', lastError: this.lastError,
    failedJobs: this.service?.failedExtractions?.() || [] }; }
  enqueue(chat) {
    if (this.closed || this.controller.store.data.memory?.enabled === false) return;
    this.service?.enqueueExtraction(chat);
    this.notBefore = Date.now() + 1500;
  }
  ownsThread(id) { return Boolean(id && this.active?.threadId === id); }
  // Proactive heartbeat and goal runs yield the idle lane while a learning job is ready, so learning cannot starve.
  hasReadyWork() {
    if (this.closed || this.controller.store.data.memory?.enabled === false || Date.now() < this.notBefore) return false;
    try { return (this.service?.pendingExtractions(1) || []).length > 0; } catch { return false; }
  }
  available() {
    const c = this.controller;
    return !this.closed && !this.active && Date.now() >= this.notBefore && this.service
      && c.store.data.memory?.enabled !== false && !c.closing && c.runtime.status === 'ready'
      && c.account.status === 'connected' && !c.extensionsBusy && !c.goalChat && !c.heartbeatChat
      && !c.independentCheck?.active && !c.manualCompactions?.size
      && !c.store.data.chats.some(chat => chat.status !== 'idle');
  }
  async tick() {
    if (!this.available()) return false;
    if (!this.embeddingWork && this.service.embedding?.model) {
      this.embeddingWork = this.service.refreshEmbeddings().then(count => {
        if (count && !this.closed) this.controller.changed(false);
      }).catch(error => {
        this.lastError = `Semantic index: ${error.message}`;
        this.service.embeddingError = error.message;
        if (!this.closed) this.controller.changed(false);
      }).finally(() => { this.embeddingWork = null; });
    }
    const job = this.service.pendingExtractions(1)[0];
    if (!job) return false;
    const op = { job, output: '', threadId: null, turnId: null, cancelled: false };
    op.completion = new Promise(resolve => { op.resolve = resolve; });
    this.active = op;
    this.controller.memoryBusy = true;
    this.controller.changed();
    op.timer = setTimeout(() => { void this.stop('Memory extraction timed out.').catch(error => { this.lastError = error.message; }); }, this.timeoutMs);
    op.timer.unref?.();
    op.starting = this.run(op);
    await op.starting;
    return true;
  }
  async run(op) {
    const c = this.controller, settings = c.store.data.settings;
    try {
      const cwd = op.job.workspace || settings.workspace;
      const disabled = await c.extensionRuntime?.heartbeatConfig(cwd) || {};
      if (op.cancelled || this.closed) return;
      const started = await c.client.request('thread/start', {
        cwd, model: settings.model || undefined, ephemeral: true, approvalPolicy: 'never',
        sandbox: 'read-only', developerInstructions: INSTRUCTIONS,
        config: { ...disabled, ...c.providerConfig(), 'features.shell_tool': false,
          'features.unified_exec': false, 'features.js_repl': false, 'features.code_mode': false,
          'features.multi_agent': false, 'features.skill_mcp_dependency_install': false,
          web_search: 'disabled', model_reasoning_effort: 'low' },
      }, 60000);
      op.threadId = started?.thread?.id;
      if (!op.threadId) throw new Error('No memory extraction thread was returned.');
      if (op.cancelled || this.closed) return;
      await c.extensionRuntime?.verifyHeartbeat(op.threadId);
      if (op.cancelled || this.closed) return;
      const existing = this.service.search({ query: '', source: 'facts', workspace: cwd, scope: 'workspace', limit: 20 });
      const records = (existing.records || existing.results || []).map(({ id, key, text, type }) => ({ id, key, text: text.slice(0, 1500), type }));
      const messages = [];
      let remaining = 48000;
      for (const message of op.job.messages || []) {
        if (remaining <= 0) break;
        const maximum = Math.min(12000, remaining);
        const text = message.text.length > maximum
          ? message.text.slice(0, Math.floor(maximum / 2)) + '\n[excerpt]\n' + message.text.slice(-Math.floor(maximum / 2))
          : message.text;
        messages.push({ ...message, text }); remaining -= text.length;
      }
      const prompt = { workspace: cwd, messages, existing: records };
      // Local servers reject a structured response format while the engine's tools are attached; ask in the prompt instead.
      const local = settings.connection === 'local';
      const text = JSON.stringify(prompt) + (local ? `

Return only one JSON object matching this schema, without Markdown: ${JSON.stringify(EXTRACTION_SCHEMA)}` : '');
      const result = await c.client.request('turn/start', {
        threadId: op.threadId, cwd, model: settings.model || undefined,
        input: [{ type: 'text', text }],
        effort: c.effectiveEffort(settings.model, 'low'), approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly' }, ...(local ? {} : { outputSchema: EXTRACTION_SCHEMA }),
      }, 60000);
      op.turnId ||= result?.turn?.id;
      if (!op.turnId) throw new Error('No memory extraction turn was returned.');
    } catch (error) {
      if (this.active === op && !op.cancelled) this.finish(op, null, error.message);
    }
  }
  notification(method, params = {}) {
    const op = this.active;
    if (!op?.threadId || params.threadId !== op.threadId) return false;
    if (method === 'turn/started') op.turnId ||= params.turn?.id;
    if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') op.output = (op.output + params.delta).slice(0, 100000);
    if (method === 'item/completed' && params.item?.type === 'agentMessage' && params.item.text) op.output = params.item.text.slice(0, 100000);
    if (method === 'error' && !params.willRetry) this.finish(op, null, params.error?.message || 'Memory extraction failed.');
    if (method === 'turn/completed' && op.cancelled) this.finish(op, null, op.stopError || '');
    else if (method === 'turn/completed') {
      try {
        if (['failed', 'interrupted'].includes(params.turn?.status) || params.turn?.error) throw new Error(params.turn?.error?.message || 'Memory extraction interrupted.');
        const output = parseModelJson(op.output, 'Memory extraction did not return readable JSON.');
        this.finish(op, normalizeCandidates(output, op.job));
      } catch (error) { this.finish(op, null, error.message); }
    }
    return true;
  }
  finish(op, candidates, error = '') {
    if (this.active !== op) return;
    op.cancelled = true;
    clearTimeout(op.timer);
    try {
      if (candidates) {
        const learned = this.service.completeExtraction(op.job.id, candidates.slice(0, MAX_LEARNED_PER_TURN));
        if (proactive.deliverLearned(this.controller.store.data, learned)) this.controller.changed(true);
      }
      else if (error) this.service.failExtraction(op.job.id, error);
      this.lastError = error || null;
    } catch (failure) {
      this.lastError = failure.message;
      this.service.failExtraction(op.job.id, failure.message);
    } finally {
      this.active = null;
      this.controller.memoryBusy = false;
      op.resolve?.();
      this.notBefore = Date.now() + (error ? 30000 : 1500);
      void this.release(op);
      this.controller.changed();
    }
  }
  async release(op) {
    if (!op.threadId || this.controller.closing) return;
    try { await this.controller.client.request('thread/unsubscribe', { threadId: op.threadId }, 10000); } catch {}
  }
  async stop(error = '') {
    const op = this.active;
    this.notBefore = Date.now() + 5000;
    if (!op) return;
    if (op.stopping) return op.stopping;
    op.cancelled = true;
    op.stopError = error;
    op.stopping = (async () => {
      await op.starting;
      if (this.active !== op) return;
      if (!op.turnId) { this.finish(op, null, error); return; }
      await this.controller.client.request('turn/interrupt', { threadId: op.threadId, turnId: op.turnId }, 10000);
      let timer;
      try {
        await Promise.race([op.completion, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Memory extraction is still stopping. Try your message again shortly.')), 10000);
        })]);
      } finally { clearTimeout(timer); }
    })();
    try { await op.stopping; } finally { op.stopping = null; }
  }
  async pauseForUser() { await this.stop(); }
  async close() {
    this.closed = true; clearInterval(this.timer);
    try { await this.stop(); } catch (error) { if (this.active) this.finish(this.active, null, error.message); }
    await this.embeddingWork;
  }
}

module.exports = { normalizeCandidates, MemoryConsolidator, EXTRACTION_SCHEMA, INSTRUCTIONS };
