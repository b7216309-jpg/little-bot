'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const proactive = require('./proactive-chat.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const clip = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';
const isV2 = goal => goal?.contractVersion === 2;
const ongoing = goal => isV2(goal) && goal.kind === 'ongoing';
const OUTCOMES = ['update', 'progress', 'completed', 'recommendation', 'waiting', 'no-change', 'failed'];
// Match the calendar event runtime's useful horizons without changing the
// evidence version every minute. A deadline approaching is fresh evidence.
const CALENDAR_REVIEW_WINDOWS = [15, 60, 1440];

function approachingWithinMinutes(event, now) {
  if (event.allDay) return null;
  const remaining = event.startAt - now;
  if (remaining <= 0) return 0;
  return CALENDAR_REVIEW_WINDOWS.find(minutes => remaining <= minutes * 60000) ?? null;
}

function definition(input, existing) {
  const version = input.contractVersion ?? existing?.contractVersion ?? (input.kind ? 2 : 1);
  if (![1, 2].includes(version)) throw new Error('Unknown goal contract version.');
  const kind = input.kind ?? existing?.kind ?? 'task';
  if (!['task', 'ongoing'].includes(kind)) throw new Error('Choose Task or Ongoing.');
  const sources = input.sources ?? existing?.sources ?? { chat: true, calendar: true, files: [] };
  if (!sources || typeof sources !== 'object' || !Array.isArray(sources.files || []) || (sources.files || []).length > 12) throw new Error('Choose at most 12 evidence files.');
  const files = [...new Set((sources.files || []).map(file => {
    if (typeof file !== 'string' || file.length > 4000 || file.includes('\0') || !path.isAbsolute(file)) throw new Error('Evidence files need absolute paths.');
    return path.resolve(file);
  }))];
  const maxQuietHours = input.maxQuietHours ?? existing?.maxQuietHours ?? 0;
  if (!Number.isInteger(maxQuietHours) || maxQuietHours < 0 || maxQuietHours > 720) throw new Error('Maximum quiet time must be a whole number of hours from 0 to 720.');
  return { contractVersion: version, kind, sources: { chat: sources.chat !== false, calendar: sources.calendar !== false, files },
    reviewPolicy: (input.reviewPolicy ?? existing?.reviewPolicy) === 'always' ? 'always' : 'changes', maxQuietHours,
    review: existing?.review || { processedMessages: [], sourceVersions: {}, lastResult: null },
    actionItems: existing?.actionItems || [] };
}

function restore(goal, input) {
  const review = input.review || {};
  goal.review = {
    chatCursor: clip(review.chatCursor, 200),
    processedMessages: Array.isArray(review.processedMessages) ? review.processedMessages.filter(x => typeof x === 'string').slice(-2000) : [],
    sourceVersions: review.sourceVersions && typeof review.sourceVersions === 'object' && !Array.isArray(review.sourceVersions) ? { ...review.sourceVersions } : {},
    lastMeaningfulResult: review.lastMeaningfulResult || null,
    lastResult: review.lastResult && OUTCOMES.includes(review.lastResult.outcome) ? {
      outcome: review.lastResult.outcome, summary: clip(review.lastResult.summary), at: Number(review.lastResult.at) || 0,
      evidenceRefs: (review.lastResult.evidenceRefs || []).filter(x => typeof x === 'string').slice(0, 20),
    } : null,
  };
  goal.actionItems = (Array.isArray(input.actionItems) ? input.actionItems : []).filter(x => x && typeof x.id === 'string').slice(-30).map(x => ({
    id: clip(x.id, 100), text: clip(x.text, 1000), owner: x.owner === 'bot' ? 'bot' : 'user',
    status: ['proposed', 'waiting', 'verified', 'superseded'].includes(x.status) ? x.status : 'proposed',
    evidenceRefs: (Array.isArray(x.evidenceRefs) ? x.evidenceRefs : []).filter(r => typeof r === 'string').slice(0, 10),
  }));
}

async function collect(goal, data, now = Date.now()) {
  const items = [{ id: 'objective', kind: 'definition', text: clip(goal.objective, 3000) }], versions = {}, messages = [], coverage = [];
  let contentBudget = 9000;
  const add = (item, maximum = 2000) => {
    const available = Math.max(0, contentBudget);
    const text = clip(item.text, Math.min(maximum, available));
    contentBudget -= text.length;
    items.push({ ...item, text, truncated: text.length < (item.text || '').length });
  };
  versions.definition = hash(JSON.stringify({ objective: goal.objective, kind: goal.kind, sources: goal.sources, steps: goal.steps, reviewPolicy: goal.reviewPolicy }));
  const processed = new Set(goal.review?.processedMessages || []);
  const chat = data.chats?.[0];
  if (goal.sources.chat && data.memory?.enabled !== false) {
    if (!chat) coverage.push('No continuous conversation is available.');
    const user = (chat?.messages || []).filter(m => m.role === 'user' && !m.automationId && !m.goalId && m.kind !== 'automation');
    // First activation seeds a bounded recent history. Later activations consume
    // the oldest unprocessed page, so a busy chat cannot silently lose messages.
    const cursor = goal.review?.chatCursor ? user.findIndex(m => m.id === goal.review.chatCursor) : -1;
    const pending = goal.review?.chatCursor && cursor >= 0 ? user.slice(cursor + 1) : user.filter(m => !processed.has(m.id));
    const selected = goal.review?.lastResult ? pending.slice(0, 12) : pending.slice(-12);
    const reserved = (goal.sources.files.length ? 3000 : 0) + (goal.sources.calendar ? 3600 : 0);
    for (const m of selected) {
      if (contentBudget <= reserved) break;
      messages.push(m.id);
      add({ id: `message:${m.id}`, kind: 'user', at: m.createdAt || null, text: m.text || '' }, Math.min(2000, contentBudget - reserved));
    }
    if (pending.length > messages.length) coverage.push(goal.review?.lastResult ? 'More new messages remain for a later review.' : 'Initial review includes a bounded recent excerpt; older context remains searchable.');
    // What Little Bot itself said since the last review: replies, heartbeat suggestions and goal posts.
    // Reference only: it never marks the review as changed and never counts as user confirmation.
    const since = Number(goal.review?.lastResult?.at) || 0;
    const said = (chat?.messages || []).filter(m => m.role === 'assistant' && !['reasoning', 'plan', 'compaction', 'memory'].includes(m.kind)
      && m.phase !== 'commentary' && typeof m.text === 'string' && m.text.trim() && (Number(m.createdAt) || 0) > since).slice(-6);
    for (const m of said) {
      if (contentBudget <= reserved + 600) { coverage.push('Some recent Little Bot messages were omitted for budget.'); break; }
      const source = m.kind === 'heartbeat' ? 'heartbeat' : m.kind === 'goal' ? (m.goalId === goal.id ? 'this goal' : 'another goal') : m.automationId ? 'automation' : 'reply';
      add({ id: `said:${m.id}`, kind: 'assistant', source, at: m.createdAt || null, text: m.text }, Math.min(1200, contentBudget - reserved));
    }
  } else coverage.push('Recent chat evidence is disabled (source setting or Memory toggle).');
  if (goal.sources.calendar) {
    const events = (data.calendar?.events || []).filter(e => e.startAt <= now + 7 * 86400000 && (e.endAt || e.startAt) >= now);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const value = events.map(e => ({ id: e.id, title: clip(e.title, 120), startAt: e.startAt, endAt: e.endAt || e.startAt,
      startIso: new Date(e.startAt).toISOString(), endIso: new Date(e.endAt || e.startAt).toISOString(), timezone,
      phase: e.startAt <= now ? 'due' : 'upcoming', approachingWithinMinutes: approachingWithinMinutes(e, now) }));
    versions.calendar = hash(JSON.stringify(value));
    for (const e of value.slice(0, 8)) {
      const text = JSON.stringify(e);
      if (text.length > contentBudget - (goal.sources.files.length ? 3000 : 0)) {
        coverage.push('Calendar excerpt limited by evidence budget; retrieve additional events with calendar tools.'); break;
      }
      add({ id: `calendar:${e.id}`, kind: 'calendar', text }, text.length);
    }
    if (value.length > 8) coverage.push('Calendar excerpt limited to eight events.');
  }
  const fileBudget = Math.max(1, Math.floor(contentBudget / Math.max(1, goal.sources.files.length)));
  for (const filename of goal.sources.files) {
    const key = `file:${hash(filename).slice(0, 16)}`;
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('Not a regular text file under 2 MiB.');
      const bytes = await fs.readFile(filename);
      if (bytes.includes(0)) throw new Error('Binary file.');
      versions[key] = hash(bytes);
      add({ id: key, kind: 'file', path: filename, version: versions[key], text: bytes.toString('utf8') }, fileBudget);
    } catch (error) {
      versions[key] = `unavailable:${error.code || error.message}`;
      coverage.push(`Unavailable source ${filename}: ${error.code || error.message}. Absence does not establish user failure.`);
    }
  }
  const changed = messages.some(id => !processed.has(id)) || Object.entries(versions).some(([k, v]) => v !== goal.review?.sourceVersions?.[k]);
  return { items, coverage, messages, versions, changed, capturedAt: now };
}

function consume(goal, evidence, outcome, summary, refs = []) {
  if (evidence.messages.length) goal.review.chatCursor = evidence.messages.at(-1);
  goal.review.processedMessages = [...new Set([...goal.review.processedMessages, ...evidence.messages])].slice(-2000);
  goal.review.sourceVersions = evidence.versions;
  goal.review.lastResult = { outcome, summary: clip(summary), evidenceRefs: refs, at: Date.now() };
  if (outcome !== 'no-change') goal.review.lastMeaningfulResult = { ...goal.review.lastResult };
}

// An ongoing goal that has said nothing meaningful for maxQuietHours must review even without new evidence.
function quietTooLong(goal, now = Date.now()) {
  if (!ongoing(goal) || !(goal.maxQuietHours > 0)) return false;
  const last = Number(goal.review?.lastMeaningfulResult?.at) || 0;
  return now - last >= goal.maxQuietHours * 3600000;
}

function normalizeFinish(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use an object result.');
  const result = { ...value };
  // Qwen sometimes emits action instead of outcome. Normalize only an exact,
  // unambiguous enum value; all evidence and host verification still apply.
  if (result.action !== undefined) {
    if (result.outcome !== undefined && result.outcome !== result.action) throw new Error('Conflicting outcome and action.');
    if (!OUTCOMES.includes(result.action)) throw new Error('Use a supported outcome.');
    result.outcome = result.action; delete result.action;
  }
  return result;
}

function validateResult(goal, result, evidence, { changedFiles = 0, checksPassed = false, preflightPassed = false, provisional = false } = {}) {
  if (!OUTCOMES.includes(result.outcome)) throw new Error('Goal needs an explicit outcome.');
  if (typeof result.summary !== 'string' || result.summary.length > 2000 || (result.outcome !== 'no-change' && !result.summary.trim())) throw new Error('Goal needs a concise result.');
  const known = new Set(evidence.items.map(x => x.id));
  const refs = result.evidenceRefs;
  if (!Array.isArray(refs) || refs.length > 20 || refs.some(x => typeof x !== 'string' || !known.has(x))) throw new Error('Goal cited unavailable evidence. Copy IDs from this run only: ' + [...known].slice(-30).join(', '));
  if (['update', 'completed', 'progress', 'recommendation'].includes(result.outcome) && !refs.length) throw new Error('Useful results need source references.');
  if (result.outcome === 'no-change' && result.summary.trim()) throw new Error('No-change needs an empty summary. Use update for factual corrections or recommendation for useful advice.');
  if (result.outcome === 'update' && !refs.some(ref => ref !== 'objective')) throw new Error('A factual update needs source evidence.');
  if (ongoing(goal) && result.outcome === 'completed') throw new Error('A review cannot complete an ongoing goal.');
  if (!provisional && result.outcome === 'completed' && (!checksPassed || (preflightPassed && !changedFiles))) throw new Error('Task acceptance checks did not pass.');
  if (result.outcome === 'waiting' && !clip(result.nextStep).trim()) throw new Error('Waiting needs a named dependency or next step.');
  const updates = result.actionUpdates || [];
  if (!Array.isArray(updates) || updates.length > 10) throw new Error('Use at most ten action updates.');
  const actions = structuredClone(goal.actionItems);
  let confirmed = false;
  for (const input of updates) {
    if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1000 || !['user', 'bot'].includes(input.owner) || !['proposed', 'waiting', 'verified', 'superseded'].includes(input.status)) throw new Error('Invalid action update.');
    if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.some(ref => !known.has(ref))) throw new Error('Action cited unavailable evidence. Copy IDs from this run only: ' + [...known].slice(-30).join(', '));
    const previous = input.id ? actions.find(a => a.id === input.id) : actions.find(a => a.text === input.text && a.owner === input.owner);
    if (input.id && !previous && input.status === 'verified') throw new Error('Unknown action ID: only a saved action can be verified by ID. Omit id for a new action. Factual corrections belong in the update summary, not a verified bot action.');
    // Some local models name new suggestions. IDs are always assigned by the
    // host; retiring an absent historical suggestion has no state to change.
    if (input.id && !previous && input.status === 'superseded') continue;
    if (input.status === 'verified') {
      const sources = input.evidenceRefs.map(ref => evidence.items.find(item => item.id === ref));
      const supported = input.owner === 'user' ? sources.some(s => s.kind === 'user') : checksPassed && goal.checks.length > 0 && (!preflightPassed || changedFiles > 0);
      if (!supported && !(provisional && input.owner === 'bot' && goal.checks.length > 0)) throw new Error('An action needs user confirmation or passing task checks. This goal cannot verify a bot action without acceptance checks. Put factual corrections in an update summary and leave actionUpdates empty unless there is real pending work.');
      confirmed = true;
    }
    const action = { id: previous?.id || randomUUID(), text: input.text, owner: input.owner, status: input.status, evidenceRefs: input.evidenceRefs };
    if (previous) Object.assign(previous, action); else actions.push(action);
  }
  if (!provisional && result.outcome === 'progress' && !changedFiles && !confirmed && !(checksPassed && !preflightPassed && goal.checks.length)) throw new Error('No observable progress supports this result; use recommendation or no-change.');
  if (result.outcome === 'no-change' && (updates.length || changedFiles)) throw new Error('A no-change review must not change actions or files.');
  return { actions: actions.slice(-30), refs };
}

// A busy conversation queues the result instead of dropping it; see proactive-chat.cjs.
function deliver(goal, data, { runId, summary, question } = {}) {
  if (!goal.sources.chat) return null;
  const key = question ? `question:${question.id}` : runId;
  const body = summary || question?.question || '';
  if (!body.trim()) return null;
  return proactive.post(data, { kind: 'goal', goalId: goal.id, goalName: goal.name, goalRunId: key, text: body,
    ...(question ? { goalQuestionId: question.id } : {}) }, { duplicate: m => m.goalId === goal.id && m.goalRunId === key });
}

function chatContext(data) {
  const goals = (data.autonomy?.goals || []).filter(isV2).filter(g => g.sources?.chat).slice(0, 8).map(g => ({
    id: g.id, name: g.name, kind: g.kind, status: g.status,
    question: g.pendingQuestion || null, result: g.review?.lastResult || null, actions: g.actionItems.filter(a => ['waiting', 'proposed'].includes(a.status)).slice(0, 4),
  }));
  return goals.length ? 'Current goals (saved state; advice is not user follow-through). Discuss or update through goal tools. For a reply to a question use its exact goal and question ID; do not guess an ambiguous target.\n' + JSON.stringify(goals).slice(0, 7000) : '';
}

module.exports = { isV2, ongoing, quietTooLong, OUTCOMES, normalizeFinish, definition, restore, collect, consume, validateResult, deliver, chatContext };
