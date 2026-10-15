'use strict';

const { parseModelJson, normalizeModelOutput } = require('./model-json.cjs');
const proactive = require('./proactive-chat.cjs');
const dreaming = require('./dreaming.cjs');

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
function candidateList(output) {
  if (Array.isArray(output)) return output;
  if (!output || typeof output !== 'object') return null;
  if (Array.isArray(output.memories)) return output.memories;
  // One memory returned bare, or the list under another name ({"memory": [...]}, {"items": [...]}).
  if (typeof output.text === 'string') return [output];
  const arrays = Object.values(output).filter(Array.isArray);
  if (arrays.length === 1) return arrays[0];
  if (output.memories && typeof output.memories === 'object') return [output.memories];
  // {} or {"memories": null}: nothing durable was learned.
  return arrays.length === 0 ? [] : null;
}
function normalizeCandidates(output, job = {}) {
  const list = candidateList(output);
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
  constructor(controller, { intervalMs = 5000, timeoutMs = null, stopTimeoutMs = 10000, autoStart = true } = {}) {
    this.controller = controller;
    this.timeoutMs = timeoutMs;
    this.stopTimeoutMs = stopTimeoutMs;
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
  // Jobs that failed on output format (a rejected response_format before 0.13.1, or JSON shapes accepted since 0.17.1) get another chance.
  // Unreadable JSON is not retried here, so a truly broken job cannot repeat on every start.
  retryFormatFailures() {
    let count = 0;
    for (const job of this.service?.failedExtractions?.() || []) {
      if (!/response_format|did not match the required JSON schema/i.test(job.error || '')) continue;
      try { this.service.retryExtraction(job.id); count++; } catch { /* Already retried or discarded. */ }
    }
    return count;
  }
  get state() { return { status: this.active ? (this.active.kind === 'dream' ? 'dreaming' : 'learning') : 'idle', lastError: this.lastError,
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
      && c.store.data.memory?.enabled !== false && !c.closing && !c.userSendPending && c.runtime.status === 'ready'
      && c.account.status === 'connected' && !c.extensionsBusy && !c.goalChat && !c.heartbeatChat
      && !c.independentCheck?.active && !c.manualCompactions?.size && !c.chatGoal?.holding()
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
    if (!job) return this.maybeDream();
    const op = { kind: 'extract', job, local: this.controller.store.data.settings.connection === 'local', output: '', threadId: null, turnId: null, turnStartAttempted: false, cancelled: false };
    op.completion = new Promise(resolve => { op.resolve = resolve; });
    this.active = op;
    this.controller.memoryBusy = true;
    this.controller.changed();
    const timeoutMs = this.timeoutMs ?? (this.controller.store.data.settings.connection === 'local' ? 10 * 60000 : 90000);
    op.timer = setTimeout(() => { void this.stop('Memory extraction timed out.').catch(error => { this.lastError = error.message; }); }, timeoutMs);
    op.timer.unref?.();
    op.starting = this.run(op);
    await op.starting;
    return true;
  }
  // "Dream now" from the Memory page; it still waits for the idle lane.
  requestDream() { this.dreamRequested = true; this.dreamNotBefore = 0; }
  async maybeDream() {
    const c = this.controller, state = c.store.data.companion, now = Date.now();
    if (!state || now < (this.dreamNotBefore || 0)) return false;
    const fresh = dreaming.newUserMessages(c.store.data, Number.isFinite(state.lastDreamAt) ? state.lastDreamAt : now - 36 * 3600000);
    let idleSeconds;
    try { idleSeconds = c.systemIdleSeconds?.(); } catch { /* Unknown idle time counts as idle. */ }
    if (!dreaming.isDreamDue({ now, lastDreamAt: state.lastDreamAt, idleSeconds, requested: this.dreamRequested, fresh })) return false;
    const material = dreaming.dreamMaterial(c, now);
    if (!material.messages.length) {
      this.dreamRequested = false; this.dreamNotBefore = now + 3600000;
      state.lastDreamError = 'Nothing new to reflect on yet.'; c.changed(true);
      return false;
    }
    const op = { kind: 'dream', material, local: c.store.data.settings.connection === 'local', output: '', threadId: null, turnId: null, turnStartAttempted: false, cancelled: false };
    op.completion = new Promise(resolve => { op.resolve = resolve; });
    this.active = op;
    c.memoryBusy = true;
    c.changed();
    const timeoutMs = this.timeoutMs ?? (this.controller.store.data.settings.connection === 'local' ? 10 * 60000 : 5 * 60000);
    op.timer = setTimeout(() => { void this.stop('The dream took too long.').catch(error => { this.lastError = error.message; }); }, timeoutMs);
    op.timer.unref?.();
    op.starting = this.run(op);
    await op.starting;
    return true;
  }
  async run(op) {
    const c = this.controller, settings = c.store.data.settings, local = op.local;
    if (op.kind === 'dream') return this.runDream(op);
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
      if (op.cancelled || this.closed) return this.release(op);
      await c.extensionRuntime?.verifyHeartbeat(op.threadId);
      if (op.cancelled || this.closed) return this.release(op);
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
      const text = JSON.stringify(prompt) + (local ? `\n\nReturn only one JSON object matching this schema, without Markdown: ${JSON.stringify(EXTRACTION_SCHEMA)}` : '');
      op.turnStartAttempted = true;
      const result = await c.client.request('turn/start', {
        threadId: op.threadId, cwd, model: settings.model || undefined,
        input: [{ type: 'text', text }],
        effort: c.effectiveEffort(settings.model, 'low'), approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' },
        ...(local ? {} : { outputSchema: EXTRACTION_SCHEMA }),
      }, local ? 10 * 60 * 1000 : 60000);
      op.turnId ||= result?.turn?.id;
      if (!op.turnId) throw new Error('No memory extraction turn was returned.');
      op.turnStartAttempted = false;
    } catch (error) {
      if (this.active === op && op.turnStartAttempted && !Number.isInteger(error?.code)) {
        await c.recoverUncertainTurnStart({ threadId: op.threadId, turnId: op.turnId, completion: op.completion, owner: op,
          reason: 'The engine did not stop after the memory extraction start acknowledgement was lost.' });
      }
      if (this.active === op && !op.cancelled) this.finish(op, null, error.message);
    }
  }
  async runDream(op) {
    const c = this.controller, settings = c.store.data.settings, local = op.local;
    try {
      const cwd = settings.workspace;
      const disabled = await c.extensionRuntime?.heartbeatConfig(cwd) || {};
      if (op.cancelled || this.closed) return;
      const started = await c.client.request('thread/start', {
        cwd, model: settings.model || undefined, ephemeral: true, approvalPolicy: 'never',
        sandbox: 'read-only', developerInstructions: dreaming.DREAM_INSTRUCTIONS,
        config: { ...disabled, ...c.providerConfig(), 'features.shell_tool': false,
          'features.unified_exec': false, 'features.js_repl': false, 'features.code_mode': false,
          'features.multi_agent': false, 'features.skill_mcp_dependency_install': false,
          web_search: 'disabled', model_reasoning_effort: 'low' },
      }, local ? 10 * 60 * 1000 : 60000);
      op.threadId = started?.thread?.id;
      if (!op.threadId) throw new Error('No dream thread was returned.');
      if (op.cancelled || this.closed) return this.release(op);
      await c.extensionRuntime?.verifyHeartbeat(op.threadId);
      if (op.cancelled || this.closed) return this.release(op);
      const profile = c.profileContext?.() || '';
      const text = [profile, `Material for tonight (reference data):\n${JSON.stringify(op.material)}`,
        local ? `Return only one JSON object matching this schema, without Markdown: ${JSON.stringify(dreaming.DREAM_SCHEMA)}` : ''].filter(Boolean).join('\n\n');
      op.turnStartAttempted = true;
      const result = await c.client.request('turn/start', {
        threadId: op.threadId, cwd, model: settings.model || undefined, input: [{ type: 'text', text }],
        effort: c.effectiveEffort(settings.model, 'low'), approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' },
        ...(local ? {} : { outputSchema: dreaming.DREAM_SCHEMA }),
      }, local ? 10 * 60 * 1000 : 60000);
      op.turnId ||= result?.turn?.id;
      if (!op.turnId) throw new Error('No dream turn was returned.');
      op.turnStartAttempted = false;
    } catch (error) {
      if (this.active === op && op.turnStartAttempted && !Number.isInteger(error?.code)) {
        await c.recoverUncertainTurnStart({ threadId: op.threadId, turnId: op.turnId, completion: op.completion, owner: op,
          reason: 'The engine did not stop after the dream start acknowledgement was lost.' });
      }
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
        const schema = op.kind === 'dream' ? dreaming.DREAM_SCHEMA : EXTRACTION_SCHEMA;
        const parsed = parseModelJson(op.output, op.kind === 'dream' ? 'The dream did not return readable JSON.' : 'Memory extraction did not return readable JSON.', { local: op.local });
        const output = op.local ? normalizeModelOutput(parsed, schema) : parsed;
        this.finish(op, op.kind === 'dream' ? (op.local ? dreaming.normalizeDream(output) : output) : normalizeCandidates(output, op.job));
      } catch (error) {
        if (op.local && !op.retryCount && !op.cancelled) { op.retryStarting = this.retryMalformed(op, error); return true; }
        this.finish(op, null, error.message);
      }
    }
    return true;
  }
  async retryMalformed(op, error) {
    if (op.cancelled || this.active !== op) return;
    op.retryCount = 1;
    op.output = '';
    op.turnId = null;
    try {
      const schema = op.kind === 'dream' ? dreaming.DREAM_SCHEMA : EXTRACTION_SCHEMA;
      op.turnStartAttempted = true;
      const result = await this.controller.client.request('turn/start', { threadId: op.threadId,
        input: [{ type: 'text', text: `Your previous answer could not be used: ${error.message}. Correct only the JSON shape and return one valid object matching this schema. Preserve the useful content; use empty arrays for optional lists.\n${JSON.stringify(schema)}` }],
        model: this.controller.store.data.settings.model || undefined, effort: 'low', approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' },
        ...(op.local ? {} : { outputSchema: schema }),
      }, op.local ? 10 * 60 * 1000 : 60000);
      op.turnId ||= result?.turn?.id;
      if (!op.turnId) throw new Error('No repair turn was returned.');
      op.turnStartAttempted = false;
    } catch (failure) {
      if (this.active === op && op.turnStartAttempted && !Number.isInteger(failure?.code)) {
        await this.controller.recoverUncertainTurnStart({ threadId: op.threadId, turnId: op.turnId, completion: op.completion, owner: op,
          reason: 'The engine did not stop after the memory repair acknowledgement was lost.' });
      }
      if (this.active === op) this.finish(op, null, failure.message);
    }
  }
  finish(op, candidates, error = '') {
    if (this.active !== op) return;
    op.cancelled = true;
    clearTimeout(op.timer);
    try {
      if (op.kind === 'dream') this.settleDream(op, candidates, error);
      else if (candidates) {
        const learned = this.service.completeExtraction(op.job.id, candidates.slice(0, MAX_LEARNED_PER_TURN));
        if (proactive.deliverLearned(this.controller.store.data, learned)) this.controller.changed(true);
      }
      else if (error) this.service.failExtraction(op.job.id, error);
      this.lastError = error || null;
    } catch (failure) {
      this.lastError = failure.message;
      if (op.kind === 'dream') { this.controller.store.data.companion.lastDreamError = failure.message; this.dreamNotBefore = Date.now() + 30 * 60000; }
      else this.service.failExtraction(op.job.id, failure.message);
    } finally {
      this.active = null;
      this.controller.memoryBusy = false;
      op.resolve?.();
      this.notBefore = Date.now() + (error ? 30000 : 1500);
      void this.release(op);
      this.controller.changed();
    }
  }
  // A finished dream is saved; a failed one waits half an hour; one interrupted by the user simply runs again later.
  settleDream(op, output, error) {
    const state = this.controller.store.data.companion;
    if (output) {
      const { learned } = dreaming.applyDream(this.controller, output, op.material);
      this.dreamRequested = false;
      proactive.deliverLearned(this.controller.store.data, learned);
    } else if (error) {
      state.lastDreamError = error.slice(0, 300);
      this.dreamNotBefore = Date.now() + 30 * 60000;
    } else this.dreamNotBefore = Date.now() + 10 * 60000;
    this.controller.changed(true);
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
      if (this.active !== op) return;
      if (op.turnId || op.turnStartAttempted) {
        await this.controller.recoverUncertainTurnStart({ threadId: op.threadId, turnId: op.turnId, completion: op.completion, timeoutMs: this.stopTimeoutMs, owner: op,
          reason: 'The engine did not stop after memory maintenance was interrupted.' });
      }
      if (this.active === op) this.finish(op, null, error);
    })();
    try { await op.stopping; }
    catch (error) {
      if (this.active !== op) return;
      if (this.controller.closing) { this.finish(op, null, error.message); return; }
      this.controller.crashed(new Error(`The engine did not stop memory maintenance: ${error.message}`));
      if (this.controller.client.close) await this.controller.client.close().catch(() => {});
      await op.completion;
    } finally { op.stopping = null; }
  }
  async pauseForUser() { await this.stop(); }
  async close() {
    this.closed = true; clearInterval(this.timer);
    try { await this.stop(); } catch (error) { if (this.active) this.finish(this.active, null, error.message); }
    await this.embeddingWork;
  }
}

module.exports = { normalizeCandidates, MemoryConsolidator, EXTRACTION_SCHEMA, INSTRUCTIONS };
