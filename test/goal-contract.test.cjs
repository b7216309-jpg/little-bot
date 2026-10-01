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
  await runner.execute(g); assert.equal(g.status, 'blocked'); assert.equal(g.review.lastResult, null); assert.equal(g.review.chatCursor, '');
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

test('failed review blocks rather than resetting the budget and repeating itself', async t => {
  const { runner, g } = await runnerFixture(t, async () => result('failed', { summary: 'Source could not be checked' }));
  await runner.execute(g); assert.equal(g.status, 'blocked'); assert.equal(g.usage.runs, 1);
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
