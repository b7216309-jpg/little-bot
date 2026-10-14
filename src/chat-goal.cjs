'use strict';
// /goal in a conversation, like Claude Code and Codex: Little Bot keeps working across turns until an
// independent check confirms the user's condition is met, judges it impossible, or a budget runs out.
// Each goal turn is an ordinary chat turn. Between turns an optional check command runs in the working
// folder, then a separate, tool-less model call decides "met / not yet / impossible" and its feedback
// drives the next turn. The worker never grades itself.
const { randomUUID } = require('node:crypto');
const { parseModelJson } = require('./model-json.cjs');

const DEFAULT_TURNS = 20, MAX_TURNS = 100, DEFAULT_MINUTES = 90, MAX_MINUTES = 720;
const EVAL_TIMEOUT_MS = 10 * 60000, CODEX_EVAL_TIMEOUT_MS = 3 * 60000, CHECK_TIMEOUT_MS = 5 * 60000, OUTPUT_LIMIT = 100000;
const STATUSES = ['pursuing', 'paused', 'achieved', 'unmet', 'budget'];
const COMMANDS = { status: 'status', pause: 'pause', stop: 'pause', resume: 'resume', continue: 'resume', clear: 'clear', cancel: 'clear', off: 'clear', reset: 'clear' };

const clean = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const block = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const int = (value, fallback, min, max) => Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
const time = value => Number.isFinite(value) ? value : null;
const minutes = ms => Math.max(1, Math.round(ms / 60000));

const GOAL_CHECK_SCHEMA = {
  type: 'object', properties: { met: { type: 'boolean' }, impossible: { type: 'boolean' }, reason: { type: 'string' }, next: { type: 'string' } },
  required: ['met', 'impossible', 'reason', 'next'], additionalProperties: false,
};
const GOAL_CHECK_INSTRUCTIONS = `You are Little Bot's independent goal checker. Another agent is working toward a goal the user set; you only judge, you never do the work.
Decide whether the goal condition is true now, using only evidence in the material: command and tool output, file changes, check results and what the work actually shows. Be strict and skeptical: the worker's own claims ("done", "all tests pass") are not evidence unless the output shows it. When the condition is verifiable (tests, a build, a file, a value), require that the latest work verified it after the last change. If a required check result is given, a failing check means not met.
impossible is true only when the goal cannot be reached without the user: it needs credentials, a decision, access or information only they have, or it contradicts itself. Never because it is hard, long or not finished yet.
Return JSON: met, impossible, reason (one short sentence the user will read, in the user's language) and next (when not met: the single most useful concrete next step for the worker; empty when met).
This is a review task. Do not use tools.`;

// "/goal ..." arguments: a command word, or a condition with optional --check "cmd", --turns N, --time 90m|2h.
function parseGoalCommand(input) {
  let text = String(input ?? '').trim();
  if (!text) return { action: 'status' };
  const word = COMMANDS[text.toLowerCase()];
  if (word) return { action: word };
  const options = {};
  text = text.replace(/(^|\s)--check\s+(?:"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+))/i, (_, lead, a, b, c, d) => { options.check = (a ?? b ?? c ?? d ?? '').trim(); return lead; });
  text = text.replace(/(^|\s)--turns?\s+(\d{1,3})(?=\s|$)/i, (_, lead, n) => { options.maxTurns = Number(n); return lead; });
  text = text.replace(/(^|\s)--time\s+(\d{1,4})\s*(h|hours?|m|mins?|minutes?)?(?=\s|$)/i, (_, lead, n, unit) => { options.maxMinutes = Number(n) * (/^h/i.test(unit || '') ? 60 : 1); return lead; });
  const condition = text.replace(/\s+/g, ' ').trim();
  if (!condition) throw new Error('Describe the goal: /goal <what must be true when it is done>.');
  if (condition.length > 2000) throw new Error('Keep the goal under 2,000 characters.');
  if (options.check !== undefined && (!options.check || options.check.length > 2000)) throw new Error('--check needs a command, for example --check "npm test".');
  return { action: 'set', condition, options };
}

function createGoal({ condition, options = {} }, now = Date.now()) {
  return { id: randomUUID(), condition, ...(options.check ? { check: options.check } : {}), status: 'pursuing', phase: 'working',
    createdAt: now, resumedAt: now, elapsedMs: 0, turns: 0, history: [],
    maxTurns: int(options.maxTurns, DEFAULT_TURNS, 1, MAX_TURNS), maxMinutes: int(options.maxMinutes, DEFAULT_MINUTES, 5, MAX_MINUTES) };
}

// Saved with the chat. A goal that was running when Little Bot closed comes back paused, never on its own.
function normalizeChatGoal(value, { recovering = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const condition = block(value.condition, 2000);
  if (!condition) return null;
  const goal = { id: clean(value.id, 100) || randomUUID(), condition, status: STATUSES.includes(value.status) ? value.status : 'paused',
    createdAt: time(value.createdAt) ?? Date.now(), elapsedMs: Math.max(0, time(value.elapsedMs) ?? 0), turns: int(value.turns, 0, 0, 100000),
    maxTurns: int(value.maxTurns, DEFAULT_TURNS, 1, 100000), maxMinutes: int(value.maxMinutes, DEFAULT_MINUTES, 5, 1000000),
    history: (Array.isArray(value.history) ? value.history : []).filter(item => item && typeof item === 'object').slice(-8)
      .map(item => ({ turn: int(item.turn, 0, 0, 100000), at: time(item.at) ?? 0, met: item.met === true, reason: clean(item.reason, 300) })) };
  if (block(value.check, 2000)) goal.check = block(value.check, 2000);
  for (const key of ['startMessageId', 'pausedReason', 'endReason']) if (clean(value[key], 500)) goal[key] = clean(value[key], 500);
  if (time(value.endedAt)) goal.endedAt = value.endedAt;
  if (value.lastVerdict && typeof value.lastVerdict === 'object') {
    const verdict = value.lastVerdict;
    goal.lastVerdict = { met: verdict.met === true, impossible: verdict.impossible === true, reason: clean(verdict.reason, 400), next: clean(verdict.next, 500), at: time(verdict.at) ?? 0,
      ...(verdict.check && typeof verdict.check === 'object' ? { check: { passed: verdict.check.passed === true, exitCode: Number.isInteger(verdict.check.exitCode) ? verdict.check.exitCode : null } } : {}) };
  }
  if (goal.status === 'pursuing') {
    if (recovering) Object.assign(goal, { status: 'paused', pausedReason: 'Little Bot was closed during this goal. Use /goal resume to continue.' });
    else goal.resumedAt = time(value.resumedAt) ?? Date.now();
  }
  return goal;
}

// The worker's request for a goal turn.
function turnInstructions(goal, goalTurn) {
  const budget = `This is goal turn ${goal.turns + 1} of at most ${goal.maxTurns} (about ${goal.maxMinutes} minutes in total).`;
  const check = goal.check ? `\nAfter each of your turns Little Bot runs this check in the working folder: \`${goal.check}\`. The goal only counts as met when it exits with code 0.` : '';
  const how = 'Work autonomously: plan briefly, act with your tools and verify the result yourself (run it, test it, open it). Do not stop to ask for permission or confirmation; ask the user (ask_user) only for information or a decision only they can give. Never claim something is done without evidence. End your turn with a short status: what you did, the evidence, and what remains.';
  if (goalTurn.kind === 'start') {
    return `The user set a goal for this conversation with /goal. Keep working until this condition is true:\n${goal.condition}\n\n${budget} An independent checker reviews the evidence after each of your turns, and Little Bot asks you to continue until it confirms the condition.${check}\n\n${how}`;
  }
  const verdict = goalTurn.verdict;
  const feedback = goalTurn.resumed || !verdict ? 'The user resumed this goal.'
    : `Independent check after your last turn: ${verdict.reason}${verdict.check ? ` (check exit code ${verdict.check.exitCode ?? 'unknown'})` : ''}${verdict.next ? `\nSuggested next step: ${verdict.next}` : ''}`;
  return `Goal, not met yet:\n${goal.condition}\n\n${feedback}\n\n${budget}${check}\n\nContinue now. ${how}`;
}
// Added to the user's own messages while a goal is running, so the model keeps the thread.
function activeGoalNote(goal) {
  return `An active /goal is running in this conversation: ${goal.condition} (${goal.turns} of ${goal.maxTurns} turns used). Answer the user's message first; the goal continues afterwards, and this message may change how you pursue it.`;
}

// What the checker sees: the work since the goal was set, newest kept whole within the budget.
function transcript(chat, goal) {
  let start = chat.messages.findIndex(message => message.id === goal.startMessageId);
  if (start < 0) start = Math.max(0, chat.messages.length - 40);
  const items = chat.messages.slice(start).filter(message => typeof message.text === 'string' && message.text.trim()
    && message.kind !== 'reasoning' && message.kind !== 'goal-check' && !['commentary', 'analysis'].includes(message.phase));
  const lines = [];
  let budget = 26000;
  for (const message of [...items].reverse()) {
    const label = message.kind === 'goal-set' ? 'GOAL SET BY THE USER' : message.kind === 'goal-step' ? 'CONTINUE PROMPT'
      : message.role === 'user' ? 'USER' : message.role === 'tool' ? `TOOL (${message.kind || 'action'}${message.status ? `, ${message.status}` : ''})` : 'WORKER';
    const limit = message.role === 'tool' ? 3000 : 4000;
    const text = message.text.length > limit ? `${message.text.slice(0, Math.floor(limit * 0.4))}\n[…]\n${message.text.slice(-Math.floor(limit * 0.6))}` : message.text;
    budget -= text.length + label.length + 4;
    if (budget < 0) { lines.unshift('[earlier work omitted]'); break; }
    lines.unshift(`${label}:\n${text}`);
  }
  return lines.join('\n\n');
}
function checkPrompt(goal, chat, check, { local = false } = {}) {
  const parts = [`Goal condition, set by the user:\n${goal.condition}`];
  if (check) parts.push(`Required check \`${goal.check}\` just ran in the working folder: exit code ${check.exitCode ?? 'unknown'} (${check.passed ? 'passed' : 'FAILED'}).\nOutput (end):\n${check.output || '(no output)'}`);
  parts.push(`Goal turns used: ${goal.turns} of ${goal.maxTurns}.`);
  if (goal.history.length) parts.push(`Your earlier verdicts:\n${goal.history.map(item => `- after turn ${item.turn}: ${item.met ? 'met' : 'not met'}: ${item.reason}`).join('\n')}`);
  parts.push(`Work since the goal was set (oldest first; the end is the latest turn):\n\n${transcript(chat, goal)}`);
  if (local) parts.push(`Return only one JSON object matching this schema, without Markdown: ${JSON.stringify(GOAL_CHECK_SCHEMA)}`);
  return parts.join('\n\n');
}
function parseVerdict(output) {
  const value = parseModelJson(output, 'The goal check did not return readable JSON.');
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('met' in value)) throw new Error('The goal check did not say whether the goal is met.');
  const flag = item => item === true || item === 'true';
  return { met: flag(value.met), impossible: flag(value.impossible),
    reason: clean(value.reason, 400) || (flag(value.met) ? 'The condition is met.' : 'Not met yet.'), next: clean(value.next, 500) };
}
// Three identical "not yet" reasons in a row: the worker is going in circles.
function stuck(goal) {
  const recent = goal.history.slice(-3);
  const key = item => item.reason.toLowerCase().replace(/[^\p{L}]+/gu, ' ').trim();
  return recent.length === 3 && recent.every(item => !item.met && key(item) && key(item) === key(recent[0]));
}

class ChatGoalRunner {
  constructor(controller, { sendTurn = null } = {}) {
    this.controller = controller;
    // Starts a goal turn like a user message would; main.cjs swaps in a version that first stops background work.
    this.sendTurn = sendTurn || ((payload, internal) => controller.send(payload, null, internal));
    this.op = null;
    this.closed = false;
  }
  get chats() { return this.controller.store.data.chats; }
  // Background work (heartbeat, goals, routines, learning, dreaming) waits while a goal is running.
  holding() { return !this.closed && this.chats.some(chat => chat.goal?.status === 'pursuing'); }
  ownsThread(threadId) { return Boolean(threadId && this.op?.threadId === threadId); }
  elapsed(goal, now = Date.now()) { return goal.elapsedMs + (goal.status === 'pursuing' && goal.resumedAt ? now - goal.resumedAt : 0); }
  target(chatId, quick) { return (chatId && this.controller.chat(chatId)) || this.chats.find(chat => quick ? chat.private : !chat.private) || null; }

  async command({ chatId, quick = false, text = '' } = {}) {
    const parsed = parseGoalCommand(text);
    const chat = this.target(chatId, quick === true);
    if (parsed.action === 'set') return this.start(chat, parsed, quick === true);
    const goal = chat?.goal;
    if (!goal) throw new Error(parsed.action === 'status' ? 'No goal in this conversation. Start one with /goal <what must be true when it is done>.' : `There is no goal to ${parsed.action}.`);
    if (parsed.action === 'pause') return this.pause(chat, 'Paused by you. Use /goal resume to continue.');
    if (parsed.action === 'resume') return this.resume(chat);
    if (parsed.action === 'clear') return this.clear(chat);
    return { goal: { ...goal, elapsedMs: this.elapsed(goal) } };
  }
  async start(chat, parsed, quick) {
    if (chat && chat.status !== 'idle') throw new Error('Wait for the current reply to finish (or stop it), then set the goal.');
    await this.stopEvaluation();
    for (const other of this.chats) if (other !== chat && other.goal?.status === 'pursuing') this.setPaused(other, 'Paused because another conversation started a goal.');
    const goal = createGoal(parsed);
    const result = await this.sendTurn({ chatId: chat?.id, quick, text: parsed.condition }, { goalTurn: { kind: 'start', goal } });
    return { goal, chatId: result?.chatId };
  }
  setPaused(chat, reason) {
    const goal = chat.goal;
    if (!goal || goal.status !== 'pursuing') return;
    goal.elapsedMs = this.elapsed(goal); delete goal.resumedAt;
    Object.assign(goal, { status: 'paused', pausedReason: clean(reason, 300), phase: '' });
  }
  async pause(chat, reason) {
    if (chat.goal.status !== 'pursuing') throw new Error('The goal is not running.');
    if (this.op?.chatId === chat.id) await this.stopEvaluation();
    this.setPaused(chat, reason);
    this.controller.changed(true);
    return { goal: chat.goal };
  }
  async resume(chat) {
    const goal = chat.goal;
    if (goal.status === 'pursuing') throw new Error('The goal is already running.');
    if (goal.status === 'achieved') throw new Error('This goal is already reached. Set a new one with /goal.');
    if (chat.status !== 'idle') throw new Error('Wait for the current reply to finish, then resume.');
    await this.stopEvaluation();
    for (const other of this.chats) if (other !== chat && other.goal?.status === 'pursuing') this.setPaused(other, 'Paused because another conversation resumed its goal.');
    // Resuming after the budget ran out grants another round instead of stopping again immediately.
    if (goal.turns >= goal.maxTurns) goal.maxTurns = Math.min(goal.turns + MAX_TURNS, goal.turns + Math.min(DEFAULT_TURNS, Math.max(5, goal.maxTurns)));
    if (this.elapsed(goal) >= goal.maxMinutes * 60000) goal.maxMinutes = minutes(this.elapsed(goal)) + Math.min(DEFAULT_MINUTES, goal.maxMinutes);
    Object.assign(goal, { status: 'pursuing', resumedAt: Date.now(), phase: 'working' });
    for (const key of ['pausedReason', 'endReason', 'endedAt']) delete goal[key];
    this.controller.changed(true);
    try { await this.continueTurn(chat, { resumed: true }); }
    catch (error) { this.setPaused(chat, `Could not resume: ${error.message}`); this.controller.changed(true); throw error; }
    return { goal };
  }
  async clear(chat) {
    if (this.op?.chatId === chat.id) await this.stopEvaluation();
    const condition = chat.goal.condition;
    delete chat.goal;
    this.controller.changed(true);
    return { goal: null, cleared: condition };
  }

  // Called by Controller.finish after every turn of every chat.
  turnFinished(chat, error) {
    const goal = chat?.goal;
    if (this.closed || chat.internal || !goal) return;
    // A goal turn counts against the budget even when the goal was paused while it ran.
    const request = chat.messages.find(message => message.id === chat.lastTurnRequestId);
    if (['goal-set', 'goal-step'].includes(request?.kind) && request.chatGoalId === goal.id) goal.turns += 1;
    if (goal.status !== 'pursuing') return;
    if (error) {
      this.setPaused(chat, /stopp/i.test(error) ? 'Stopped by you. Use /goal resume to continue.' : `The last turn failed: ${clean(error, 200)}. Use /goal resume to try again.`);
      return;
    }
    goal.phase = 'checking';
    setImmediate(() => { this.evaluate(chat.id).catch(failure => this.controller.onError?.('chat-goal', failure)); });
  }
  async evaluate(chatId, attempt = 0) {
    const controller = this.controller, chat = controller.chat(chatId), goal = chat?.goal;
    if (this.closed || !goal || goal.status !== 'pursuing') return;
    // A user message took over; its own finish starts a fresh check.
    if (chat.status !== 'idle' || this.op) return;
    goal.phase = 'checking';
    controller.changed();
    const check = goal.check ? await this.runCheck(chat, goal.check) : null;
    if (chat.goal !== goal || goal.status !== 'pursuing' || chat.status !== 'idle') return;
    let verdict;
    try { verdict = await this.judge(chat, goal, check); }
    catch (error) {
      if (chat.goal !== goal || goal.status !== 'pursuing' || error.cancelled) return;
      if (attempt < 1 && chat.status === 'idle') return this.evaluate(chatId, attempt + 1);
      this.setPaused(chat, `The goal check failed: ${clean(error.message, 200)}. Use /goal resume to try again.`);
      controller.changed(true);
      return;
    }
    if (chat.goal !== goal || goal.status !== 'pursuing' || chat.status !== 'idle') return;
    await this.apply(chat, goal, verdict, check);
  }
  async apply(chat, goal, verdict, check) {
    const controller = this.controller, now = Date.now();
    const failedCheck = Boolean(check && !check.passed);
    const met = verdict.met && !failedCheck;
    const reason = verdict.met && failedCheck ? `The check \`${goal.check}\` still fails (exit code ${check.exitCode ?? 'unknown'}).` : verdict.reason;
    goal.lastVerdict = { met, impossible: verdict.impossible && !met, reason, next: verdict.next, at: now,
      ...(check ? { check: { passed: check.passed, exitCode: check.exitCode } } : {}) };
    goal.history = [...goal.history, { turn: goal.turns, at: now, met, reason: clean(reason, 300) }].slice(-8);
    goal.phase = '';
    if (met) return this.end(chat, 'achieved', reason);
    if (goal.lastVerdict.impossible) return this.end(chat, 'unmet', reason);
    if (goal.turns >= goal.maxTurns) return this.end(chat, 'budget', `All ${goal.maxTurns} turns are used. Last check: ${reason}`);
    if (this.elapsed(goal, now) >= goal.maxMinutes * 60000) return this.end(chat, 'budget', `The ${goal.maxMinutes}-minute budget is used. Last check: ${reason}`);
    if (stuck(goal)) {
      this.setPaused(chat, `Going in circles: the last three checks said the same thing. Give a hint, then /goal resume.`);
      this.note(chat, 'paused', `**Goal paused**: the last three checks gave the same reason: ${reason}\n\nTell me what to try differently, then use /goal resume.`);
      controller.changed(true);
      return;
    }
    goal.phase = 'working';
    controller.changed(true);
    try { await this.continueTurn(chat, { verdict: goal.lastVerdict }); }
    catch (error) { this.setPaused(chat, `Could not start the next turn: ${clean(error.message, 200)}`); controller.changed(true); }
  }
  continueTurn(chat, { verdict = null, resumed = false } = {}) {
    const text = resumed || !verdict ? 'Resume working toward the goal.' : `Not yet: ${verdict.reason}${verdict.next ? `\nNext: ${verdict.next}` : ''}`;
    return this.sendTurn({ chatId: chat.id, quick: chat.private === true, text, mode: chat.mode }, { goalTurn: { kind: 'step', verdict, resumed } });
  }
  end(chat, status, reason) {
    const goal = chat.goal, now = Date.now();
    goal.elapsedMs = this.elapsed(goal, now); delete goal.resumedAt;
    Object.assign(goal, { status, endedAt: now, endReason: clean(reason, 500), phase: '' });
    const head = { achieved: 'Goal reached', unmet: 'Goal can’t be finished', budget: 'Goal budget used' }[status];
    const tail = status === 'achieved' ? '' : status === 'budget' ? '\n\nUse /goal resume for another round, or /goal clear.' : '\n\nUse /goal resume to try anyway, or /goal clear.';
    this.note(chat, status, `**${head}** after ${goal.turns} turn${goal.turns === 1 ? '' : 's'} (${minutes(goal.elapsedMs)} min). ${reason}${tail}`);
    this.controller.changed(true);
  }
  // A visible result line in the timeline; it is not sent to the model.
  note(chat, status, text) {
    chat.messages.push({ id: randomUUID(), role: 'assistant', kind: 'goal-check', goalFinal: true, goalStatus: status, status: 'completed', text, createdAt: Date.now(), workspace: chat.workspace });
  }

  async runCheck(chat, command) {
    try {
      const result = await this.controller.client.request('command/exec', {
        command: ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], cwd: chat.workspace,
        // The same access as the conversation: Plan mode stays read-only.
        sandboxPolicy: chat.mode === 'plan' ? { type: 'readOnly', networkAccess: false } : { type: 'dangerFullAccess' },
        timeoutMs: CHECK_TIMEOUT_MS }, CHECK_TIMEOUT_MS + 15000);
      const output = [result?.stdout, result?.stderr].filter(Boolean).join('\n');
      return { passed: result?.exitCode === 0, exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null, output: output.slice(-6000) };
    } catch (error) {
      return { passed: false, exitCode: null, output: `The check could not run: ${clean(error.message, 500)}` };
    }
  }
  // One tool-less, read-only model turn in its own ephemeral thread.
  judge(chat, goal, check) {
    const controller = this.controller;
    const local = chat.connection === 'local';
    const timeout = local ? EVAL_TIMEOUT_MS : CODEX_EVAL_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const op = { chatId: chat.id, threadId: null, turnId: null, output: '', resolve, reject, done: false };
      op.timer = setTimeout(() => this.settle(op, new Error('The goal check timed out.')), timeout);
      op.timer.unref?.();
      this.op = op;
      void (async () => {
        try {
          const disabled = controller.extensionRuntime ? await controller.extensionRuntime.heartbeatConfig(chat.workspace) : {};
          if (op.done) return;
          const started = await controller.client.request('thread/start', {
            cwd: chat.workspace, model: chat.model || undefined, ephemeral: true, approvalPolicy: 'never', approvalsReviewer: 'user',
            sandbox: 'read-only', developerInstructions: GOAL_CHECK_INSTRUCTIONS,
            config: { ...disabled, ...controller.providerConfig(), 'features.shell_tool': false, 'features.unified_exec': false, 'features.js_repl': false,
              'features.code_mode': false, 'features.multi_agent': false, 'features.skill_mcp_dependency_install': false, web_search: 'disabled', model_reasoning_effort: 'low' },
          }, 60000);
          op.threadId = started?.thread?.id;
          if (!op.threadId) throw new Error('The goal check did not start.');
          if (op.done) return void this.release(op);
          await controller.extensionRuntime?.verifyHeartbeat(op.threadId);
          if (op.done) return void this.release(op);
          const turn = await controller.client.request('turn/start', {
            threadId: op.threadId, input: [{ type: 'text', text: checkPrompt(goal, chat, check, { local }) }], cwd: chat.workspace,
            model: chat.model || undefined, effort: controller.effectiveEffort(chat.model, 'low'), approvalPolicy: 'never', approvalsReviewer: 'user',
            ...(local ? {} : { outputSchema: GOAL_CHECK_SCHEMA }), sandboxPolicy: { type: 'readOnly' },
          }, timeout);
          op.turnId ||= turn?.turn?.id;
        } catch (error) { this.settle(op, error); }
      })();
    });
  }
  notification(method, params = {}) {
    const op = this.op;
    if (!op?.threadId || params.threadId !== op.threadId) return false;
    if (method === 'turn/started') op.turnId ||= params.turn?.id;
    else if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') op.output = (op.output + params.delta).slice(0, OUTPUT_LIMIT);
    else if (method === 'item/completed' && params.item?.type === 'agentMessage' && typeof params.item.text === 'string' && params.item.text.trim()) op.output = params.item.text.slice(0, OUTPUT_LIMIT);
    else if (method === 'error' && !params.willRetry) this.settle(op, new Error(params.error?.message || 'The goal check failed.'));
    else if (method === 'turn/completed') {
      if (['interrupted', 'failed'].includes(params.turn?.status) || params.turn?.error) this.settle(op, new Error(params.turn?.error?.message || 'The goal check was interrupted.'));
      else { try { this.settle(op, null, parseVerdict(op.output)); } catch (error) { this.settle(op, error); } }
    }
    return true;
  }
  settle(op, error, verdict) {
    if (op.done) return;
    op.done = true;
    clearTimeout(op.timer);
    if (this.op === op) this.op = null;
    void this.release(op);
    if (error) op.reject(error); else op.resolve(verdict);
  }
  async release(op) {
    if (!op.threadId || this.controller.closing) return;
    try { await this.controller.client.request('thread/unsubscribe', { threadId: op.threadId }, 10000); } catch { /* Ephemeral checker threads may already be gone. */ }
  }
  // A user message always wins over a pending check; the check runs again after that reply.
  async stopEvaluation() {
    const op = this.op;
    if (!op) return;
    if (op.turnId && op.threadId) {
      try { await this.controller.client.request('turn/interrupt', { threadId: op.threadId, turnId: op.turnId }, 10000); } catch { /* Settled below either way. */ }
    }
    this.settle(op, Object.assign(new Error('The goal check was stopped.'), { cancelled: true }));
  }
  async close() { this.closed = true; await this.stopEvaluation(); }
}

module.exports = { ChatGoalRunner, parseGoalCommand, createGoal, normalizeChatGoal, turnInstructions, activeGoalNote, checkPrompt, parseVerdict,
  GOAL_CHECK_SCHEMA, GOAL_CHECK_INSTRUCTIONS, DEFAULT_TURNS, DEFAULT_MINUTES };
