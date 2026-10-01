'use strict';

const { randomUUID } = require('node:crypto');
const {
  INDEPENDENT_CHECK_SCHEMA,
  INDEPENDENT_CHECK_INSTRUCTIONS,
  normalizeIndependentCheckMode,
  independentCheckDecision,
  collectIndependentCheckContext,
  independentCheckPrompt,
  parseIndependentCheckResult,
  normalizeIndependentCheckRecord,
  answerHash,
} = require('./independent-check.cjs');

const REVIEW_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_LIMIT = 220000;
const clean = value => String(value?.message || value || 'Independent Check failed.')
  .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
  .replace(/(access_token|refresh_token|api_key)(["\s:=]+)[^\s,}]+/gi, '$1$2[redacted]')
  .slice(0, 2000);

class IndependentCheckRunner {
  constructor(controller) {
    this.controller = controller;
    this.active = null;
  }

  get state() {
    const operation = this.active;
    return operation ? {
      status: 'running',
      chatId: operation.chatId,
      messageId: operation.targetMessageId,
      mode: operation.mode,
      startedAt: operation.startedAt,
    } : { status: 'idle' };
  }

  belongsTo(chatId) {
    return Boolean(this.active && this.active.chatId === chatId);
  }

  ownsThread(threadId) {
    return Boolean(this.active?.threadId && this.active.threadId === threadId);
  }

  startForTurn(chat, { turnId } = {}) {
    if (this.active) {
      return this.active.chatId === chat?.id && this.active.originalTurnId === turnId;
    }
    return this.start(chat, {
      originalTurnId: turnId,
      messageStart: chat?.taskRun?.messageStart,
      mode: chat?.taskRun?.independentCheckMode,
    });
  }

  start(chat, { targetMessageId, originalTurnId = null, messageStart, mode, force = false } = {}) {
    if (this.active || !chat || chat.internal || chat.automationId) return false;
    const context = collectIndependentCheckContext(chat, { targetMessageId, messageStart });
    if (!context) return false;
    const selectedMode = normalizeIndependentCheckMode(mode ?? this.controller.store.data.settings.independentCheckMode);
    const decision = independentCheckDecision({ mode: selectedMode, request: context.request, answer: context.proposedAnswer, force });
    if (!decision.run) return false;
    const target = chat.messages.find(message => message.id === context.targetMessageId);
    if (!target) return false;

    const startedAt = Date.now();
    const operation = {
      id: randomUUID(),
      chatId: chat.id,
      targetMessageId: target.id,
      originalTurnId,
      context,
      mode: force ? 'forced' : selectedMode,
      startedAt,
      threadId: null,
      turnId: null,
      output: '',
      cancelReason: null,
      timer: null,
    };
    target.independentCheck = normalizeIndependentCheckRecord({
      status: 'running', mode: operation.mode, startedAt, checkedAt: startedAt,
      answerHash: answerHash(context.proposedAnswer),
    });
    this.active = operation;
    operation.timer = setTimeout(() => {
      this.stop('Independent Check reached its five-minute time limit.').catch(() => {});
    }, REVIEW_TIMEOUT_MS);
    operation.timer.unref?.();
    this.controller.changed(true);
    void this.run(operation);
    return true;
  }

  async challenge({ chatId, messageId } = {}) {
    const controller = this.controller;
    controller.ensureReady();
    if (this.active) throw new Error('Wait for the current Independent Check to finish.');
    if (controller.extensionsBusy || controller.goalChat || controller.heartbeatChat || controller.manualCompactions.size
      || controller.store.data.chats.some(chat => chat.status !== 'idle')) {
      throw new Error('Wait for the current task to finish before challenging an answer.');
    }
    const chat = controller.chat(chatId);
    if (!chat) throw new Error('This conversation no longer exists.');
    controller.ensureReady(chat);
    if (chat.status !== 'idle') throw new Error('Wait for this conversation to finish.');

    let finish;
    const completion = new Promise(resolve => { finish = resolve; });
    controller.outcomes.set(chat.id, { completion, finish });
    chat.status = 'running';
    chat.error = null;
    chat.updatedAt = Date.now();
    if (!this.start(chat, { targetMessageId: messageId, force: true })) {
      chat.status = 'idle';
      controller.outcomes.delete(chat.id);
      throw new Error('Choose a completed Little Bot answer to challenge.');
    }
    controller.persistNow();
    controller.changed();
    return controller.state();
  }

  current(operation) {
    return this.active === operation && !this.controller.closing;
  }

  async run(operation) {
    const controller = this.controller;
    const chat = controller.chat(operation.chatId);
    if (!chat) return this.complete(operation, { status: 'failed', error: 'The conversation was removed.' });
    try {
      const disabled = controller.extensionRuntime
        ? await controller.extensionRuntime.heartbeatConfig(chat.workspace) : {};
      if (!this.current(operation)) return;
      const started = await controller.client.request('thread/start', {
        cwd: chat.workspace,
        model: chat.model || undefined,
        ephemeral: true,
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: 'read-only',
        developerInstructions: INDEPENDENT_CHECK_INSTRUCTIONS,
        config: {
          ...disabled,
          ...controller.providerConfig(),
          'features.shell_tool': false,
          'features.unified_exec': false,
          'features.js_repl': false,
          'features.code_mode': false,
          'features.multi_agent': false,
          'features.skill_mcp_dependency_install': false,
          web_search: 'disabled',
          model_reasoning_effort: 'low',
        },
      }, 60000);
      operation.threadId = started?.thread?.id;
      if (!operation.threadId) throw new Error('Independent Check did not receive a review thread.');
      if (!this.current(operation)) return this.releaseThread(operation);
      await controller.extensionRuntime?.verifyHeartbeat(operation.threadId);
      if (!this.current(operation)) return this.releaseThread(operation);
      const turn = await controller.client.request('turn/start', {
        threadId: operation.threadId,
        input: [{ type: 'text', text: independentCheckPrompt(operation.context, { local: chat.connection === 'local' }) }],
        cwd: chat.workspace,
        model: chat.model || undefined,
        effort: controller.effectiveEffort(chat.model, 'low'),
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        outputSchema: INDEPENDENT_CHECK_SCHEMA,
        sandboxPolicy: { type: 'readOnly' },
      }, 60000);
      operation.turnId ||= turn?.turn?.id;
      if (!operation.turnId) throw new Error('Independent Check did not receive a review turn.');
      if (operation.cancelReason && this.current(operation)) await this.stop(operation.cancelReason);
    } catch (error) {
      if (this.active === operation) this.complete(operation, { status: 'failed', error: clean(error) });
    }
  }

  notification(method, params = {}) {
    const operation = this.active;
    if (!operation?.threadId || params.threadId !== operation.threadId) return false;
    const turnId = params.turnId || params.turn?.id;
    if (operation.turnId && turnId && turnId !== operation.turnId) return true;

    if (method === 'turn/started') {
      operation.turnId ||= params.turn?.id;
    } else if (method === 'item/agentMessage/delta') {
      if (typeof params.delta === 'string') operation.output = (operation.output + params.delta).slice(0, OUTPUT_LIMIT);
    } else if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      if (typeof params.item.text === 'string' && params.item.text.trim()) operation.output = params.item.text.slice(0, OUTPUT_LIMIT);
    } else if (method === 'error' && !params.willRetry) {
      this.complete(operation, { status: 'failed', error: clean(params.error?.message || 'Independent Check failed.') });
    } else if (method === 'turn/completed') {
      const status = params.turn?.status;
      if (operation.cancelReason || status === 'interrupted') {
        this.complete(operation, { status: 'interrupted', error: operation.cancelReason || 'Independent Check was interrupted.' });
      } else if (status === 'failed' || params.turn?.error) {
        this.complete(operation, { status: 'failed', error: clean(params.turn?.error?.message || 'Independent Check failed.') });
      } else {
        try {
          const result = parseIndependentCheckResult(operation.output, operation.context.proposedAnswer);
          this.complete(operation, { status: 'completed', result });
        } catch (error) {
          this.complete(operation, { status: 'failed', error: clean(error) });
        }
      }
    }
    return true;
  }

  async stop(reason = 'Stopped by you.') {
    const operation = this.active;
    if (!operation) return { ok: true };
    operation.cancelReason ||= reason;
    if (operation.turnId && operation.threadId) {
      try {
        await this.controller.client.request('turn/interrupt', {
          threadId: operation.threadId,
          turnId: operation.turnId,
        }, 10000);
      } catch { /* The original answer remains usable even if interruption acknowledgement is lost. */ }
    }
    this.complete(operation, { status: 'interrupted', error: operation.cancelReason });
    return { ok: true };
  }

  abort(status, error) {
    const operation = this.active;
    if (!operation) return false;
    this.complete(operation, { status, error });
    return true;
  }

  complete(operation, { status, error = '', result = null } = {}) {
    if (this.active !== operation) return false;
    this.active = null;
    clearTimeout(operation.timer);
    const controller = this.controller;
    const chat = controller.chat(operation.chatId);
    const target = chat?.messages.find(message => message.id === operation.targetMessageId);
    if (target) {
      if (status === 'completed' && result) {
        const originalAnswer = operation.context.proposedAnswer;
        const revisionApplied = result.conclusionStable === false && Boolean(result.revisedAnswer);
        if (revisionApplied) target.text = result.revisedAnswer;
        target.independentCheck = normalizeIndependentCheckRecord({
          status: 'completed',
          mode: operation.mode,
          startedAt: operation.startedAt,
          checkedAt: Date.now(),
          ...result,
          revisionApplied,
          answerHash: answerHash(target.text),
          ...(revisionApplied ? { originalAnswer } : {}),
        });
      } else {
        target.independentCheck = normalizeIndependentCheckRecord({
          status: status === 'interrupted' ? 'interrupted' : 'failed',
          mode: operation.mode,
          startedAt: operation.startedAt,
          checkedAt: Date.now(),
          answerHash: answerHash(target.text),
          error: clean(error),
        });
      }
      target.updatedAt = Date.now();
    }
    void this.releaseThread(operation);
    if (chat && chat.status !== 'idle') controller.finish(chat, null);
    else {
      controller.persistNow();
      controller.changed();
    }
    return true;
  }

  async releaseThread(operation) {
    if (!operation.threadId || this.controller.closing || this.controller.runtime.status !== 'ready') return;
    try {
      await this.controller.client.request('thread/unsubscribe', { threadId: operation.threadId }, 10000);
    } catch { /* Ephemeral review threads may already be unloaded. */ }
  }
}

module.exports = { IndependentCheckRunner, REVIEW_TIMEOUT_MS };
