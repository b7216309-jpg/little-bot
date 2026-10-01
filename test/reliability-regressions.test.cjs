'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Store } = require('../src/store.cjs');
const { MemoryService, MAX_EXTRACTION_ATTEMPTS } = require('../src/memory-service.cjs');
const { AppManagement } = require('../src/app-management.cjs');
const { Attachments } = require('../src/attachments.cjs');
const { GoalRunner } = require('../src/goals.cjs');
const { EventRuntime } = require('../src/event-runtime.cjs');
const { responsesToChat, StrataStreamAdapter } = require('../src/strata-responses-adapter.cjs');
const contract = require('../src/goal-contract.cjs');
const { installBundledSkills } = require('../src/bundled-skills.cjs');
const { parseSkill } = require('../src/extensions.cjs');
function fixture(t, close = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-reliability-'));
  t.after(() => { close(); fs.rmSync(root, { recursive: true, force: true }); }); return root;
}

test('guide v19 upgrades to the corrected tool instructions without overwriting user edits or deletions', async () => {
  const previous = { ...parseSkill(fs.readFileSync(path.join(__dirname, 'fixtures', 'little-bot-v19.md'), 'utf8')), bundled: true, enabled: false };
  const store = skills => ({ data: { extensions: { starterSkillsVersion: 19, skills } }, save() {} });
  const original = store([previous]); await installBundledSkills(original);
  const guide = original.data.extensions.skills[0];
  assert.equal(guide.id, previous.id); assert.equal(guide.enabled, false);
  assert.match(guide.content, /retry_learning/); assert.match(guide.content, /attachment_manage/);
  assert.equal(original.data.extensions.starterSkillsVersion, 20);
  const edited = { ...previous, content: previous.content + '\nMy personal instructions.' };
  const customized = store([edited]); await installBundledSkills(customized);
  assert.equal(customized.data.extensions.skills[0].content, edited.content);
  const deleted = store([]); await installBundledSkills(deleted); assert.equal(deleted.data.extensions.skills.length, 0);
});

test('encrypted chat above the former reader limit reopens with its entire history', t => {
  let saved, restored;
  const root = fixture(t, () => { saved?.close(); restored?.close(); }), protector = { encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
  const options = { filePath: path.join(root, 'state.json'), defaultWorkspace: root, protector };
  saved = new Store(options);
  saved.data.memory.enabled = false;
  saved.data.chats = [{ id: 'continuous', status: 'idle', messages: Array.from({ length: 1050 }, (_, i) =>
    ({ id: 'm'+i, role: 'assistant', text: String(i).padEnd(40000, 'x'), status: 'completed' })) }];
  saved.save(); saved.close();
  assert(JSON.parse(fs.readFileSync(options.filePath, 'utf8')).protected.data.length > 50 * 1024 * 1024);
  restored = new Store(options);
  assert.equal(restored.locked, false); assert.equal(restored.warning, null);
  assert.equal(restored.data.chats[0].messages.length, 1050);
  assert.equal(restored.data.chats[0].messages.at(-1).text, '1049'.padEnd(40000, 'x'));
  restored.save();
});

test('Strata structured output retains the schema as format and usable prompt instructions', () => {
  const schema = { type: 'object', properties: { memories: { type: 'array', items: { type: 'string' } } }, required: ['memories'], additionalProperties: false };
  const translated = responsesToChat({ model: 'local', instructions: 'Extract memories.', input: 'User prefers brief replies.',
    text: { format: { type: 'json_schema', name: 'memory_result', strict: true, schema } } }).body;
  assert.deepEqual(translated.response_format.json_schema, { name: 'memory_result', strict: true, schema });
  const instruction = translated.messages.find(message => message.content.includes(JSON.stringify(schema)));
  assert.equal(instruction.role, 'developer');
  assert(translated.messages.some(message => message.content === 'Extract memories.'));
  assert(translated.messages.some(message => message.content === 'User prefers brief replies.'));
});

function extraction(service, id = 'u1') {
  return service.enqueueExtraction({ id: 'chat', status: 'idle', messages: [
    { id, role: 'user', text: 'I prefer brief replies.' }, { id: 'a'+id, role: 'assistant', text: 'Understood.' },
  ] });
}
function exhaust(service, id) {
  for (let i = 0; i < MAX_EXTRACTION_ATTEMPTS; i++) service.failExtraction(id, new Error('Invalid result'));
}
test('failed memory jobs stop, remain inspectable, and can retry or discard without resurrection', t => {
  const service = new MemoryService(); t.after(() => service.close());
  const first = extraction(service);
  const now = Date.now(); service.failExtraction(first.id, new Error('Invalid result'));
  const initial = service.db.prepare('SELECT * FROM extraction_jobs WHERE id=?').get(first.id);
  assert(initial.next_attempt >= now + 60000);
  service.failExtraction(first.id, new Error('Invalid result'));
  const second = service.db.prepare('SELECT * FROM extraction_jobs WHERE id=?').get(first.id);
  assert(second.next_attempt >= now + 120000);
  service.failExtraction(first.id, new Error('Invalid result'));
  service.db.exec('UPDATE extraction_jobs SET next_attempt=0');
  assert.equal(service.pendingExtractions().length, 0);
  assert.equal(service.failedExtractions()[0].attempts, MAX_EXTRACTION_ATTEMPTS);
  assert.equal(service.failedExtractions()[0].messages, undefined);
  service.retryExtraction(first.id);
  assert.equal(service.pendingExtractions()[0].attempts, 0);
  service.completeExtraction(first.id, []);
  const discarded = extraction(service, 'u2'); exhaust(service, discarded.id);
  service.discardExtraction(discarded.id); extraction(service, 'u2');
  assert.equal(service.failedExtractions().length, 0);
  assert.equal(service.pendingExtractions().length, 0);
  assert.throws(() => service.retryExtraction(discarded.id), /failed memory/);
});
test('older exhausted pending memory jobs are quarantined on restart while new jobs remain usable', t => {
  let reopened;
  const root = fixture(t, () => reopened?.close()), options = { filename: path.join(root, 'memory.sqlite') };
  const old = new MemoryService(options), job = extraction(old);
  old.db.prepare("UPDATE extraction_jobs SET status='pending',attempts=15 WHERE id=?").run(job.id); old.close();
  reopened = new MemoryService(options);
  assert.equal(reopened.pendingExtractions().length, 0);
  assert.equal(reopened.failedExtractions()[0].attempts, 15);
  extraction(reopened, 'new'); assert.equal(reopened.pendingExtractions()[0].sourceIds[0], 'new');
});

function operations(t) {
  const root = fixture(t), calls = [];
  const controller = { runtime: { status: 'ready' }, store: { data: { chats: [] } }, changed() {} };
  const management = new AppManagement({ controller, filename: path.join(root, 'operations.json'),
    handlers: new Map([['saveSettings', payload => calls.push(payload.model)]]) });
  management.close(); return { management, calls };
}
test('a failed pre-operation save releases the lane and recovers both queued operations', async t => {
  const { management: m, calls } = operations(t);
  await m.call('settings_manage', { action: 'save', payload: { model: 'first' } }, { chat: {} });
  const save = m.save.bind(m); m.save = () => { throw new Error('Disk temporarily unavailable'); };
  await assert.rejects(m.tick(), /Disk temporarily/);
  assert.equal(m.running, false); assert.equal(m.jobs[0].status, 'queued'); assert.deepEqual(calls, []);
  m.save = save; m.retryAfter = 0;
  await m.call('settings_manage', { action: 'save', payload: { model: 'second' } }, { chat: {} });
  await m.tick(); await m.tick();
  assert.deepEqual(calls, ['first', 'second']);
  assert(m.jobs.every(job => job.status === 'completed'));
});
test('a failed final save recovers without replaying the already-applied operation', async t => {
  const { management: m, calls } = operations(t);
  await m.call('settings_manage', { action: 'save', payload: { model: 'first' } }, { chat: {} });
  const save = m.save.bind(m); let writes = 0;
  m.save = () => { if (++writes === 2) throw new Error('File temporarily locked'); save(); };
  await assert.rejects(m.tick(), /temporarily locked/);
  assert.equal(m.running, false); assert.equal(m.jobs[0].status, 'completed');
  m.save = save; m.retryAfter = 0;
  await m.call('settings_manage', { action: 'save', payload: { model: 'second' } }, { chat: {} });
  await m.tick();
  assert.deepEqual(calls, ['first', 'second']);
  assert(JSON.parse(fs.readFileSync(m.filename, 'utf8')).every(job => job.status === 'completed'));
});

async function drain(bus) { await bus.drain(); await new Promise(resolve => setImmediate(resolve)); await bus.drain(); }
test('ongoing standing-intent reviews settle and later events launch fresh reviews without overlap', async t => {
  const root = fixture(t);
  const store = { data: { settings: { workspace: root, connection: 'codex' }, autonomy: { goals: [] },
    standingIntents: { intents: [] }, calendar: { events: [] }, automations: [], chats: [] }, save() {} };
  let runtime;
  const runner = new GoalRunner({ store, backupRoot: root, run: async () => {}, canRun: () => false, publish: event => runtime.publish(event) });
  runtime = new EventRuntime({ store, goals: runner, scheduler: {}, heartbeat: {}, setIntervalFn: () => null, clearIntervalFn() {} });
  t.after(() => runtime.stop());
  const goal = runner.save({ kind: 'ongoing', name: 'Review', objective: 'Help me prepare', workspace: root,
    sources: { chat: false, calendar: false, files: [] }, trigger: { type: 'interval', intervalMinutes: 1440 } });
  goal.authorized = true; goal.status = 'paused';
  const intent = runtime.saveIntent({ name: 'React to calendar', enabled: true, when: { type: 'calendar.updated' }, action: { type: 'goal.run', goalId: goal.id } });
  runtime.start();
  runtime.publish({ type: 'calendar.updated', payload: { version: 1 } }); await drain(runtime.bus);
  assert.equal(runtime.intents.get(intent.id).lastStatus, 'queued');
  const evidence = await contract.collect(goal, store.data);
  runner.forceRuns.delete(goal.id); goal.status = 'running';
  runner.finishReview(goal, evidence, 'no-change', '', [], 'review-one'); await drain(runtime.bus);
  assert.equal(goal.status, 'queued'); assert.equal(runtime.intents.get(intent.id).lastStatus, 'completed');
  assert.equal(runtime.pendingGoals.size, 0);
  runtime.publish({ type: 'calendar.updated', payload: { version: 2 } }); await drain(runtime.bus);
  assert.equal(runtime.intents.get(intent.id).lastStatus, 'queued'); assert(runner.forceRuns.has(goal.id));
  runtime.publish({ type: 'calendar.updated', payload: { version: 3 } }); await drain(runtime.bus);
  assert.equal(runtime.intents.get(intent.id).lastStatus, 'skipped');
  assert.equal(runtime.pendingGoals.get(goal.id).size, 1);
  runner.forceRuns.delete(goal.id); goal.status = 'running'; goal.pendingQuestion = { id: 'question', question: 'Which appointment?' };
  runner.finishReview(goal, evidence, 'waiting', 'Which appointment?', [], 'review-two'); await drain(runtime.bus);
  assert.equal(goal.status, 'blocked'); assert.equal(runtime.pendingGoals.size, 0);
  assert.equal(runtime.intents.get(intent.id).lastStatus, 'completed');
});

test('calendar evidence retains complete dates and timezone within a busy review budget', async t => {
  const root = fixture(t), filename = path.join(root, 'evidence.txt'); fs.writeFileSync(filename, 'Project evidence');
  const runner = new GoalRunner({ store: { data: { settings: { workspace: root }, autonomy: { goals: [] } }, save() {} } });
  const goal = runner.save({ kind: 'ongoing', name: 'Review', objective: 'Prepare appointments', workspace: root,
    sources: { chat: true, calendar: true, files: [filename] } });
  const now = Date.now(), events = Array.from({ length: 8 }, (_, i) => ({ id: randomUUID(), title: 'An appointment '.padEnd(120, 'x'), startAt: now + (i+1)*3600000, endAt: now+(i+2)*3600000 }));
  const evidence = await contract.collect(goal, { memory: { enabled: true }, calendar: { events },
    chats: [{ messages: Array.from({ length: 12 }, (_, i) => ({ id: 'u'+i, role: 'user', text: 'x'.repeat(2000) })) }] }, now);
  const calendar = evidence.items.filter(item => item.kind === 'calendar'); assert.equal(calendar.length, 8);
  for (let i = 0; i < calendar.length; i++) {
    assert.equal(calendar[i].truncated, false); const event = JSON.parse(calendar[i].text);
    assert.equal(event.startAt, events[i].startAt); assert.equal(event.endAt, events[i].endAt);
    assert.equal(Date.parse(event.startIso), events[i].startAt); assert(event.timezone); assert.equal(event.phase, 'upcoming');
  }
  assert(evidence.items.find(item => item.kind === 'file').text.includes('Project evidence'));
  assert(evidence.items.filter(item => item.kind !== 'definition').reduce((sum, item) => sum + item.text.length, 0) <= 9000);
});

test('token cutoffs keep text/usage, report failure, and never execute partial tool arguments', async () => {
  const adapter = new StrataStreamAdapter({ model: 'local' }); let output = '';
  adapter.on('data', chunk => output += chunk.toString());
  adapter.end('data: '+JSON.stringify({ choices: [{ delta: { content: 'Partial answer', tool_calls: [{ index: 0, id: 'call', function: { name: 'delete_file', arguments: '{"path":' } }] }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 20 } })+'\n\ndata: [DONE]\n\n');
  await once(adapter, 'end');
  const events = output.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
  assert.equal(events.filter(event => event.type === 'response.completed').length, 0);
  const failed = events.find(event => event.type === 'response.failed');
  assert.match(failed.response.error.message, /token limit/); assert.equal(failed.response.usage.output_tokens, 20);
  assert.equal(failed.response.output[0].content[0].text, 'Partial answer');
  assert(!events.some(event => event.item?.type === 'function_call'));
});

test('completion dependencies reject ongoing goals and explain legacy impossible tasks', async t => {
  const root = fixture(t), store = { data: { settings: { workspace: root, connection: 'codex' }, autonomy: { goals: [] } }, save() {} };
  const runner = new GoalRunner({ store, run: async () => {}, backupRoot: root });
  const ongoing = runner.save({ kind: 'ongoing', name: 'Review', objective: 'Keep reviewing', workspace: root });
  const taskInput = { kind: 'task', name: 'Report', objective: 'Make report', workspace: root, checks: [{ type: 'fileExists', path: 'report.txt' }] };
  assert.throws(() => runner.save({ ...taskInput, dependsOn: [ongoing.id] }), /cannot be completion dependencies/);
  const task = runner.save(taskInput); task.dependsOn = [ongoing.id]; task.authorized = true; task.status = 'queued'; task.nextRunAt = 0;
  let executions = 0; runner.execute = async () => { executions++; };
  await runner.tick(); assert.equal(task.status, 'blocked'); assert.match(task.nextStep, /ongoing goal/); assert.equal(executions, 0);
  task.dependsOn = []; task.status = 'queued'; await runner.tick(); assert.equal(executions, 1);
});

test('abandoned attachments free space while pending drafts and saved files survive cleanup/restart', async t => {
  const root = fixture(t), references = new Set();
  const options = { root: path.join(root, 'attachments'), references: () => references };
  const attachments = new Attachments(options);
  const discarded = await attachments.importBytes({ name: 'discarded.txt', bytes: Buffer.from('Discard me') });
  const saved = await attachments.importBytes({ name: 'saved.txt', bytes: Buffer.from('Keep me') }); references.add(saved.id);
  const draft = await attachments.importBytes({ name: 'draft.txt', bytes: Buffer.from('Pending draft') });
  await attachments.prune(); assert.equal((await attachments.get(draft.id)).name, 'draft.txt');
  const before = (await attachments.storage()).usedBytes;
  assert.equal((await attachments.release(discarded.id)).removed, true);
  assert((await attachments.storage()).usedBytes < before);
  assert.equal((await attachments.release(saved.id)).referenced, true);
  const restarted = new Attachments(options);
  assert.equal((await restarted.storage()).unusedBytes > 0, true);
  await restarted.prune();
  await assert.rejects(restarted.get(draft.id), /ENOENT/);
  assert.equal((await restarted.read(saved.id)).buffer.toString(), 'Keep me');
  references.delete(saved.id); await restarted.release(saved.id);
  assert.equal((await restarted.storage()).usedBytes, 0);
});
