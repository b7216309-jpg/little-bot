'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const contract = require('../src/goal-contract.cjs');
const { validateGoal, GoalRunner, normalizeAutonomy } = require('../src/goals.cjs');

function goal(workspace, extra = {}) {
  return validateGoal({ name: 'Growth', objective: 'Help me act and learn', kind: 'ongoing', workspace,
    permissions: { write: false }, trigger: { type: 'interval', intervalMinutes: 1440 }, ...extra }, null, { workspace });
}
function data(g, messages = []) {
  return { settings: { workspace: g.workspace }, memory: { enabled: true }, calendar: { events: [] },
    chats: [{ id: 'chat', status: 'idle', messages }], autonomy: { paused: false, goals: [g] } };
}
const user = (id, text = 'Laundry is done') => ({ id, role: 'user', text });
const result = (outcome, extra = {}) => ({ outcome, summary: outcome === 'no-change' ? '' : 'Useful result',
  checkpoint: '', nextStep: '', evidenceRefs: outcome === 'no-change' ? [] : ['objective'], actionUpdates: [], ...extra });

test('goal types preserve legacy contract and round-trip v2 evidence/actions', () => {
  const g = goal(process.cwd());
  g.review.chatCursor = 'm'; g.review.lastResult = { outcome: 'no-change', summary: '', at: 1, evidenceRefs: [] };
  g.actionItems = [{ id: 'a', owner: 'user', text: 'Practice English', status: 'waiting', evidenceRefs: ['objective'] }];
  const restored = normalizeAutonomy({ goals: [g] }, { workspace: process.cwd() }).goals[0];
  assert.equal(restored.kind, 'ongoing'); assert.equal(restored.review.chatCursor, 'm'); assert.equal(restored.actionItems[0].id, 'a');
  const legacy = validateGoal({ name: 'Old', objective: 'Old goal', workspace: process.cwd() });
  assert.equal(legacy.contractVersion, 1);
});

test('fresh evidence is chronological user input; automation and own messages cannot self-trigger', async () => {
  const g = goal(process.cwd()), d = data(g, [user('a'), { ...user('auto'), automationId: 'routine' }, { id: 'own', role: 'assistant', kind: 'goal', goalId: g.id, text: 'Advice' }, user('b')]);
  const first = await contract.collect(g, d);
  assert.deepEqual(first.messages, ['a', 'b']);
  contract.consume(g, first, 'recommendation', 'Try this', ['objective']);
  d.chats[0].messages.push({ id: 'own2', role: 'assistant', kind: 'goal', text: 'Result' });
  assert.equal((await contract.collect(g, d)).changed, false);
  d.chats[0].messages.push(user('c', 'I changed my priority'));
  assert.deepEqual((await contract.collect(g, d)).messages, ['c']);
});

test('busy conversations use a cursor and do not reread thousands of processed messages', async () => {
  const g = goal(process.cwd()), d = data(g, Array.from({ length: 2100 }, (_, i) => user('m' + i)));
  const first = await contract.collect(g, d); assert.equal(first.messages.length, 12);
  contract.consume(g, first, 'no-change', '');
  assert.equal((await contract.collect(g, d)).changed, false);
  d.chats[0].messages.push(...Array.from({ length: 20 }, (_, i) => user('new' + i)));
  const second = await contract.collect(g, d); assert.equal(second.messages[0], 'new0'); assert.equal(second.messages.length, 12);
  contract.consume(g, second, 'no-change', '');
  const third = await contract.collect(g, d); assert.equal(third.messages[0], 'new12'); assert.equal(third.messages.length, 8);
});

test('definition changes invalidate a quiet review and Memory off excludes user text', async () => {
  const g = goal(process.cwd()), d = data(g, [user('secret', 'Personal detail')]);
  const first = await contract.collect(g, d); contract.consume(g, first, 'no-change', '');
  g.objective = 'A different priority'; assert.equal((await contract.collect(g, d)).changed, true);
  d.memory.enabled = false;
  const evidence = await contract.collect(g, d);
  assert.equal(evidence.items.some(x => x.kind === 'user'), false);
  assert.ok(evidence.coverage.some(x => x.includes('disabled')));
});

test('timed calendar evidence changes at useful deadlines and stays stable between them', async () => {
  const g = goal(process.cwd()), d = data(g);
  const startAt = Date.parse('2026-10-02T12:00:00Z');
  d.calendar.events.push({ id: 'meeting', title: 'Prepare meeting notes', startAt, endAt: startAt + 3600000 });
  let now = startAt - 2 * 86400000;
  let evidence = await contract.collect(g, d, now);
  contract.consume(g, evidence, 'no-change', '');
  assert.equal((await contract.collect(g, d, now + 60000)).changed, false);
  for (const minutes of [1440, 60, 15, 0]) {
    now = startAt - minutes * 60000;
    assert.equal((await contract.collect(g, d, now - 1)).changed, false, `Before ${minutes} minute boundary`);
    evidence = await contract.collect(g, d, now);
    assert.equal(evidence.changed, true, `At ${minutes} minute boundary`);
    const meeting = JSON.parse(evidence.items.find(item => item.id === 'calendar:meeting').text);
    assert.equal(meeting.approachingWithinMinutes, minutes);
    assert.equal(meeting.phase, minutes === 0 ? 'due' : 'upcoming');
    contract.consume(g, evidence, 'no-change', '');
    assert.equal((await contract.collect(g, d, now + 60000)).changed, false, `After consuming ${minutes} minute boundary`);
  }
  assert.equal((await contract.collect(g, d, startAt + 3600001)).changed, true, 'Ended event leaves the evidence window');
});

test('all-day events do not generate minute-level preparation reviews', async () => {
  const g = goal(process.cwd()), d = data(g);
  const startAt = Date.parse('2026-10-02T00:00:00Z');
  d.calendar.events.push({ id: 'day', title: 'Day off', allDay: true, startAt, endAt: startAt + 86400000 });
  const first = await contract.collect(g, d, startAt - 2 * 86400000);
  contract.consume(g, first, 'no-change', '');
  for (const minutes of [1440, 60, 15]) {
    const evidence = await contract.collect(g, d, startAt - minutes * 60000);
    assert.equal(evidence.changed, false);
    assert.equal(JSON.parse(evidence.items.find(item => item.id === 'calendar:day').text).approachingWithinMinutes, null);
  }
  assert.equal((await contract.collect(g, d, startAt)).changed, true);
});

test('changed selected project files supply evidence outside the writable folder', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-sources-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'model.json'); await fs.writeFile(filename, '{"model":"BGE","license":"MIT"}');
  const g = goal(process.cwd(), { sources: { chat: true, calendar: false, files: [filename] } }), d = data(g);
  const first = await contract.collect(g, d); assert.ok(first.items.some(x => x.kind === 'file' && x.text.includes('MIT')));
  contract.consume(g, first, 'recommendation', 'Licence decision closed', ['objective']);
  assert.equal((await contract.collect(g, d)).changed, false);
  await fs.unlink(filename); const missing = await contract.collect(g, d);
  assert.ok(missing.coverage.some(x => x.includes('Absence does not establish user failure')));
});

test('unsupported evidence, fake progress and ongoing completion are rejected', async () => {
  const g = goal(process.cwd()), evidence = await contract.collect(g, data(g));
  assert.throws(() => contract.validateResult(g, result('recommendation', { evidenceRefs: ['invented'] }), evidence), /unavailable evidence/);
  assert.throws(() => contract.validateResult(g, result('progress'), evidence), /observable progress/);
  assert.throws(() => contract.validateResult(g, result('completed'), evidence, { checksPassed: true }), /ongoing/);
  assert.throws(() => contract.validateResult(g, result('no-change'), evidence, { changedFiles: 1 }), /must not change/);
  assert.throws(() => contract.validateResult(g, result('waiting'), evidence), /dependency/);
});

test('old passing heading cannot prove a newly completed task or bot action', async () => {
  const g = goal(process.cwd(), { kind: 'task', checks: [{ type: 'fileContains', path: 'note.md', contains: 'Next Best Action' }] });
  const evidence = await contract.collect(g, data(g));
  assert.throws(() => contract.validateResult(g, result('completed'), evidence, { checksPassed: true, preflightPassed: true }), /acceptance checks/);
  assert.throws(() => contract.validateResult(g, result('progress', { actionUpdates: [{ text: 'Done', owner: 'bot', status: 'verified', evidenceRefs: ['objective'] }] }), evidence, { checksPassed: true, preflightPassed: true }), /confirmation/);
});

test('user confirmation can close an action; advice cannot prove follow-through', async () => {
  const g = goal(process.cwd()), evidence = await contract.collect(g, data(g, [user('done')]));
  const update = { text: 'Laundry', owner: 'user', status: 'verified', evidenceRefs: ['message:done'] };
  const checked = contract.validateResult(g, result('progress', { actionUpdates: [update], evidenceRefs: ['message:done'] }), evidence);
  assert.equal(checked.actions[0].status, 'verified');
  assert.throws(() => contract.validateResult(g, result('progress', { actionUpdates: [{ ...update, evidenceRefs: ['objective'] }] }), evidence), /confirmation/);
});

test('useful results post once to continuous chat; quiet reviews do not post', async () => {
  const g = goal(process.cwd()), d = data(g);
  contract.deliver(g, d, { runId: 'one', summary: 'Useful' });
  contract.deliver(g, d, { runId: 'one', summary: 'Duplicate' });
  assert.equal(d.chats[0].messages.length, 1); assert.equal(d.chats[0].messages[0].goalId, g.id);
  assert.ok(contract.chatContext(d).includes(g.id));
});

async function runnerFixture(t, run) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-v2-runner-')); t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const g = goal(workspace), d = data(g, [user('first', 'Help me improve English')]);
  g.status = 'queued'; g.authorized = true;
  const store = { data: d, save() {} }, alerts = [];
  const runner = new GoalRunner({ store, backupRoot: path.join(workspace, 'backups'), run, onAlert: x => alerts.push(x) });
  return { runner, g, d, alerts };
}

test('ongoing runner reviews approaching calendar deadlines without new messages or edits', async t => {
  let calls = 0, now = Date.parse('2026-10-01T08:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const { runner, g, d, alerts } = await runnerFixture(t, async () => { calls++; return result('no-change'); });
  const startAt = now + 120 * 60000;
  d.calendar.events.push({ id: 'meeting', title: 'Meeting', startAt, endAt: startAt + 3600000 });
  await runner.execute(g);
  assert.equal(calls, 1);
  now += 60000;
  await runner.execute(g);
  assert.equal(calls, 1, 'Ordinary ticking does not invoke the model');
  now = startAt - 60 * 60000;
  await runner.execute(g);
  assert.equal(calls, 2, 'One-hour horizon invokes a review');
  now = startAt - 15 * 60000;
  await runner.execute(g);
  assert.equal(calls, 3, 'Fifteen-minute horizon invokes a review');
  now += 60000;
  await runner.execute(g);
  assert.equal(calls, 3, 'Consumed horizon stays quiet');
  now = startAt;
  await runner.execute(g);
  assert.equal(calls, 4, 'Start time invokes a review');
  assert.equal(alerts.length, 0, 'A fresh review does not force a notification');
});

test('ongoing recommendation persists actions and posts to chat; unchanged review makes zero calls', async t => {
  let calls = 0;
  const { runner, g, d, alerts } = await runnerFixture(t, async () => {
    calls++; return result('recommendation', { actionUpdates: [{ text: 'Practice in a PR description', owner: 'user', status: 'proposed', evidenceRefs: ['message:first'] }], evidenceRefs: ['message:first'] });
  });
  await runner.execute(g); assert.equal(calls, 1); assert.equal(g.status, 'queued'); assert.equal(g.actionItems.length, 1); assert.equal(alerts.length, 1);
  await runner.execute(g); assert.equal(calls, 1); assert.equal(alerts.length, 1); assert.equal(g.usage.tokens, 0);
  assert.equal(d.chats[0].messages.length, 2); assert.equal(g.review.lastResult.outcome, 'no-change'); assert.equal(g.review.lastMeaningfulResult.outcome, 'recommendation');
});

test('runner rejects forged progress and preserves unconsumed evidence for retry', async t => {
  const { runner, g } = await runnerFixture(t, async () => result('progress'));
  await runner.execute(g); assert.equal(g.status, 'queued'); assert.equal(g.failureStreak, 1);
  assert.equal(g.review.lastResult, null); assert.equal(g.review.chatCursor, '');
  assert.match(g.history.at(-1).summary, /observable progress.*Retrying in 15 minutes/);
});

test('question posts in chat and explicit answer queues precisely that goal', async t => {
  const { runner, g, d } = await runnerFixture(t, async () => ({ status: 'blocked', summary: 'When?', clarification: { question: 'What time works?', options: ['Morning', 'Evening'] }, checkpoint: '', nextStep: 'Wait for the answer' }));
  await runner.execute(g); assert.equal(g.status, 'blocked'); assert.ok(g.pendingQuestion);
  assert.equal(d.chats[0].messages.at(-1).goalQuestionId, g.pendingQuestion.id);
  const questionId = g.pendingQuestion.id;
  assert.throws(() => runner.answer({ id: g.id, questionId: 'wrong', answer: 'Morning' }), /no longer/);
  runner.closing = true; runner.answer({ id: g.id, questionId, answer: 'Morning' });
  assert.equal(g.status, 'queued'); assert.equal(g.clarifications.at(-1).answer, 'Morning');
});

test('a failed ongoing review retries on a widening schedule, then blocks instead of repeating forever', async t => {
  let calls = 0;
  const { runner, g, alerts } = await runnerFixture(t, async () => { calls++; return result('failed', { summary: 'Source could not be checked' }); });
  for (const minutes of [15, 60, 240]) {
    const before = Date.now();
    await runner.execute(g);
    assert.equal(g.status, 'queued');
    assert.ok(g.nextRunAt >= before + minutes * 60000 && g.nextRunAt <= Date.now() + minutes * 60000, `retry after ${minutes} minutes`);
    assert.equal(alerts.length, 0, 'transient failures retry quietly');
  }
  await runner.execute(g);
  assert.equal(calls, 4); assert.equal(g.status, 'blocked'); assert.equal(g.usage.runs, 1); assert.equal(g.failureStreak, undefined);
  assert.equal(alerts.length, 1); assert.match(alerts[0].message, /Source could not be checked/);
});

test('a successful review clears the failure streak, and the streak survives a restart', async t => {
  let fail = true;
  const { runner, g } = await runnerFixture(t, async () => fail ? result('failed', { summary: 'Model offline' }) : result('recommendation', { evidenceRefs: ['message:first'] }));
  await runner.execute(g);
  assert.equal(g.failureStreak, 1);
  const restored = normalizeAutonomy({ goals: [JSON.parse(JSON.stringify(g))] }, { workspace: g.workspace }).goals[0];
  assert.equal(restored.failureStreak, 1);
  fail = false; g.status = 'queued';
  await runner.execute(g);
  assert.equal(g.failureStreak, undefined); assert.equal(g.status, 'queued');
});

test('v2 goal outcomes are recovered from reasoning tags and prose around the JSON', async () => {
  const { GoalExecutor } = require('../src/goal-executor.cjs');
  assert.equal(typeof GoalExecutor, 'function');
  const { parseModelJson } = require('../src/model-json.cjs');
  const outcome = '{"outcome":"recommendation","summary":"Try it","checkpoint":"","nextStep":"","evidenceRefs":[],"actionUpdates":[]}';
  for (const text of [`<think>Let me decide.</think>${outcome}`, `Here is my result:\n${outcome}\nDone.`, `\`\`\`json\n${outcome}\n\`\`\``]) {
    assert.equal(contract.normalizeFinish(parseModelJson(text)).outcome, 'recommendation');
  }
  assert.equal(contract.normalizeFinish(parseModelJson('<think>x</think>{"action":"update"}')).outcome, 'update');
  assert.throws(() => parseModelJson('I could not finish.', 'Goal did not submit a structured outcome.'), /structured outcome/);
});

test('finish aliases remain unambiguous and factual updates cannot disappear as quiet reviews', async () => {
  const g = goal(process.cwd()), evidence = await contract.collect(g, data(g, [user('fact', 'Model licence settled')]));
  assert.equal(contract.normalizeFinish({ action: 'update' }).outcome, 'update');
  assert.throws(() => contract.normalizeFinish({ action: 'update', outcome: 'progress' }), /Conflicting/);
  assert.throws(() => contract.normalizeFinish({ action: 'nonsense' }), /supported/);
  assert.throws(() => contract.validateResult(g, result('no-change', { summary: 'Licence corrected' }), evidence), /empty summary/);
  assert.throws(() => contract.validateResult(g, result('update'), evidence), /source evidence/);
  assert.doesNotThrow(() => contract.validateResult(g, result('update', { evidenceRefs: ['message:fact'] }), evidence));
});

test('new action IDs are host assigned; finish validation rejects impossible bot verification early', async () => {
  const g = goal(process.cwd()), evidence = await contract.collect(g, data(g, [user('fact')]));
  const suggestion = { id: 'invented', text: 'Practice English', owner: 'user', status: 'proposed', evidenceRefs: ['message:fact'] };
  const checked = contract.validateResult(g, result('recommendation', { actionUpdates: [suggestion] }), evidence);
  assert.notEqual(checked.actions[0].id, 'invented');
  assert.throws(() => contract.validateResult(g, result('update', { evidenceRefs: ['message:fact'], actionUpdates: [{ ...suggestion, id: undefined, owner: 'bot', status: 'verified' }] }), evidence, { provisional: true }), /acceptance checks/);
});

test('long chat pages preserve unseen messages and reserve selected-file evidence', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-page-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'model.json'); await fs.writeFile(filename, '{"license":"MIT"}');
  const g = goal(process.cwd(), { sources: { chat: true, calendar: true, files: [filename] } });
  const d = data(g, Array.from({ length: 12 }, (_, i) => user('long' + i, 'x'.repeat(4000))));
  const evidence = await contract.collect(g, d);
  assert.ok(evidence.messages.length < 12); assert.ok(evidence.items.find(x => x.kind === 'file').text.includes('MIT'));
  assert.ok(evidence.messages.every(id => evidence.items.find(x => x.id === 'message:' + id).text.length > 0));
  contract.consume(g, evidence, 'no-change', '');
  const next = await contract.collect(g, d); assert.equal(next.messages[0], 'long' + evidence.messages.length);
});

test('pending bot suggestions cannot create repeated unchanged model calls', async t => {
  let calls = 0;
  const { runner, g } = await runnerFixture(t, async () => {
    calls++; return result('recommendation', { actionUpdates: [{ text: 'Explain the next project change', owner: 'bot', status: 'proposed', evidenceRefs: ['message:first'] }] });
  });
  await runner.execute(g); await runner.execute(g);
  assert.equal(calls, 1); assert.equal(g.actionItems.length, 1); assert.equal(g.review.lastResult.outcome, 'no-change');
});

test('failed review persistence does not consume source cursors or publish a result', async t => {
  const { runner, g, d, alerts } = await runnerFixture(t, async () => result('recommendation'));
  let rejected = false;
  runner.store.save = () => { if (!rejected && g.history.at(-1)?.kind === 'review') { rejected = true; throw new Error('Disk full'); } };
  await runner.execute(g);
  assert.equal(rejected, true); assert.equal(g.status, 'blocked'); assert.equal(g.review.chatCursor, ''); assert.equal(g.review.lastResult, null);
  assert.equal(d.chats[0].messages.length, 1); assert.equal(alerts.length, 1); assert.match(alerts[0].message, /Disk full/);
});

test('an ongoing goal quiet past maxQuietHours reviews without new evidence and is told why', async t => {
  const options = [];
  const { runner, g } = await runnerFixture(t, async (_goal, received) => { options.push(received.quietNudge); return result('no-change'); });
  assert.throws(() => validateGoal({ ...g, maxQuietHours: 721 }, g, { workspace: g.workspace }), /quiet time/);
  await runner.execute(g);
  assert.equal(options.length, 1);
  assert.equal(options[0], 0);
  await runner.execute(g);
  assert.equal(options.length, 1, 'without a quiet limit an unchanged goal skips the model');
  Object.assign(g, validateGoal({ ...g, maxQuietHours: 24 }, g, { workspace: g.workspace }));
  assert.equal(g.maxQuietHours, 24);
  g.review.lastMeaningfulResult = { outcome: 'recommendation', summary: 'x', at: Date.now() - 25 * 3600000, evidenceRefs: [] };
  g.status = 'queued';
  await runner.execute(g);
  assert.deepEqual(options, [0, 24]);
  g.review.lastMeaningfulResult = { outcome: 'recommendation', summary: 'x', at: Date.now() - 3600000, evidenceRefs: [] };
  g.status = 'queued';
  await runner.execute(g);
  assert.deepEqual(options, [0, 24], 'a recent meaningful result keeps the goal quiet');
});

test('scheduled goal reviews wait for Heartbeat active hours; an explicit Run does not', async t => {
  let calls = 0;
  const { runner, g, d } = await runnerFixture(t, async () => { calls++; return result('no-change'); });
  const hour = new Date().getHours();
  d.heartbeat = { startHour: (hour + 2) % 24, endHour: (hour + 3) % 24 };
  g.nextRunAt = Date.now() - 1000;
  await runner.tick();
  assert.equal(calls, 0, 'outside active hours the due review waits');
  assert.match(runner.waiting.get(g.id), /^Outside active hours \(\d\d:00–\d\d:00\)$/, 'the card says why it waits');
  runner.canRun = () => false; runner.waitReason = () => 'Waiting for the model (it is offline or not loaded)';
  await runner.tick();
  assert.equal(runner.waiting.get(g.id), 'Waiting for the model (it is offline or not loaded)');
  runner.canRun = () => true;
  assert.equal(runner.awake({ ...g, respectActiveHours: false }), true);
  Object.assign(g, validateGoal({ ...g, respectActiveHours: false }, g, { workspace: g.workspace }));
  assert.equal(g.respectActiveHours, false);
  await runner.tick();
  assert.equal(calls, 1, 'a goal that opts out runs at any hour');
  Object.assign(g, validateGoal({ ...g, respectActiveHours: true }, g, { workspace: g.workspace }));
  assert.equal(validateGoal({ name: 'x', objective: 'y', kind: 'ongoing', workspace: g.workspace }, null, { workspace: g.workspace }).respectActiveHours, true);
  runner.runNow(g.id);
  for (let index = 0; index < 200 && calls < 2; index++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls, 2, 'an explicit Run is not held back by active hours');
  d.heartbeat = { startHour: hour, endHour: (hour + 1) % 24 };
  assert.equal(runner.awake(g), true);
});

test('a reply to a goal message brings that goal review forward to about ten minutes', async t => {
  const { runner, g, d } = await runnerFixture(t, async () => result('no-change'));
  const later = Date.now() + 20 * 3600000;
  g.nextRunAt = later;
  const chat = d.chats[0];
  chat.messages.push({ id: 'goal-msg', role: 'assistant', kind: 'goal', goalId: g.id, text: 'Try one PR description in English?' });
  chat.messages.push({ id: 'other', role: 'assistant', text: 'Sure.' });
  assert.deepEqual(runner.userReplied(chat), [], 'no new user message yet');
  chat.messages.push({ id: 'reply', role: 'user', text: 'Yes, I will do it tonight' });
  const before = Date.now();
  assert.deepEqual(runner.userReplied(chat), [g.id]);
  assert.ok(g.nextRunAt >= before + 10 * 60000 && g.nextRunAt <= Date.now() + 10 * 60000);
  assert.equal(g.history.at(-1).kind, 'reply');
  chat.messages.push({ id: 'next', role: 'user', text: 'Another topic' });
  g.nextRunAt = later;
  assert.deepEqual(runner.userReplied(chat), [], 'only the first message after the goal post counts as a reply');
  chat.messages.push({ id: 'goal-msg-2', role: 'assistant', kind: 'goal', goalId: g.id, text: 'How did it go?' }, { id: 'reply-2', role: 'user', text: 'Good' });
  g.nextRunAt = Date.now() + 60000;
  assert.deepEqual(runner.userReplied(chat), [], 'an earlier scheduled review is kept');
  g.status = 'paused'; g.nextRunAt = later;
  assert.deepEqual(runner.userReplied(chat), [], 'paused goals are not woken');
});

test('goal evidence includes what Little Bot said since the last review, without self-triggering', async () => {
  const g = goal(process.cwd());
  const d = data(g, [user('first', 'Help me with English')]);
  d.chats[0].messages.push(
    { id: 'r1', role: 'assistant', text: 'Write your next PR in English.', createdAt: 10 },
    { id: 'h1', role: 'assistant', kind: 'heartbeat', text: 'Ace Combat tonight?', createdAt: 11 },
    { id: 'g1', role: 'assistant', kind: 'goal', goalId: g.id, text: 'Practice idea posted.', createdAt: 12 },
    { id: 'c1', role: 'assistant', phase: 'commentary', text: 'thinking...', createdAt: 13 },
    { id: 'k1', role: 'assistant', kind: 'reasoning', text: 'hidden', createdAt: 14 });
  const first = await contract.collect(g, d);
  assert.deepEqual(first.items.filter(item => item.kind === 'assistant').map(item => [item.id, item.source]),
    [['said:r1', 'reply'], ['said:h1', 'heartbeat'], ['said:g1', 'this goal']]);
  contract.consume(g, first, 'recommendation', 'x', ['objective']);
  g.review.lastResult.at = 12;
  d.chats[0].messages.push({ id: 'r2', role: 'assistant', text: 'Another reply', createdAt: 20 });
  const second = await contract.collect(g, d);
  assert.deepEqual(second.items.filter(item => item.kind === 'assistant').map(item => item.id), ['said:r2']);
  assert.equal(second.changed, false, 'the bot talking does not trigger a review by itself');
  assert.throws(() => contract.validateResult(g, result('progress', { actionUpdates: [{ text: 'English PR', owner: 'user', status: 'verified', evidenceRefs: ['said:r2'] }], evidenceRefs: ['said:r2'] }), second), /confirmation|observable progress/);
});

test('a retry after the token budget runs with a fresh budget instead of re-blocking on the old count', async t => {
  let calls = 0;
  const { runner, g } = await runnerFixture(t, async (_goal, { onProgress }) => {
    calls++;
    if (calls === 1) onProgress({ tokens: 5000 });
    return result('no-change');
  });
  g.limits.maxTokens = 1000;
  await runner.execute(g);
  assert.equal(calls, 1);
  assert.equal(g.status, 'queued', 'the over-budget cycle schedules a retry');
  assert.equal(g.usage.tokens, 0, 'the retry starts with a fresh cycle budget');
  await runner.execute(g);
  assert.equal(calls, 2, 'the retry reaches the model instead of blocking on the old count');
  assert.notEqual(g.status, 'blocked');
});

test('blocked notices in the chat carry no Do it / Later / Not interested buttons', () => {
  const g = goal(process.cwd()), d = data(g);
  const notice = contract.deliver(g, d, { runId: 'blocked:1', summary: 'The goal token budget was reached.', actions: false });
  assert.equal(notice.actions, undefined);
  assert.deepEqual(contract.deliver(g, d, { runId: 'r2', summary: 'A real suggestion.' }).actions.map(action => action.id), ['do', 'later', 'no']);
});
