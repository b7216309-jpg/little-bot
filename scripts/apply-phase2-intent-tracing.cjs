'use strict';

const fs = require('node:fs');

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); }
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }
function replaceOnce(file, before, after, label) {
  const source = read(file);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  write(file, source.replace(before, after));
}

replaceOnce('src/event-bus.cjs',
  `const MAX_LINEAGE_REPEATS = 2;`,
  `const MAX_LINEAGE_REPEATS = 2;\nconst MAX_INTENT_TRACE = 12;`,
  'intent trace limit');
replaceOnce('src/event-bus.cjs',
  `function eventSignature(value) {`,
  `function normalizeIntentTrace(value, parent = null) {\n  if (value !== undefined && !Array.isArray(value)) throw new TypeError('Event intentTrace must be an array.');\n  const trace = [];\n  for (const item of [...(parent?.intentTrace || []), ...(value || [])]) {\n    const id = string(item, 100);\n    if (id && !trace.includes(id)) trace.push(id);\n  }\n  return trace.slice(-MAX_INTENT_TRACE);\n}\n\nfunction eventSignature(value) {`,
  'intent trace normalization');
replaceOnce('src/event-bus.cjs',
  `    causationId: string(input.causationId, 128) || parent?.id || null,\n    depth,`,
  `    causationId: string(input.causationId, 128) || parent?.id || null,\n    intentTrace: normalizeIntentTrace(input.intentTrace, parent),\n    depth,`,
  'event intent trace');
replaceOnce('src/event-bus.cjs',
  `  Object.freeze(value.payload);\n  return value;`,
  `  Object.freeze(value.payload);\n  Object.freeze(value.intentTrace);\n  return value;`,
  'freeze intent trace');
replaceOnce('src/event-bus.cjs',
  `  MAX_EVENT_DEPTH,\n};`,
  `  MAX_EVENT_DEPTH,\n  MAX_INTENT_TRACE,\n};`,
  'export intent trace limit');

replaceOnce('src/event-runtime.cjs',
  `  publish(input, options) { return this.bus.publish(input, options); }`,
  `  publish(input, options) {\n    const intentTrace = this._intentTraceFor(input);\n    return this.bus.publish(intentTrace.length ? { ...input, intentTrace } : input, options);\n  }`,
  'runtime trace enrichment');
replaceOnce('src/event-runtime.cjs',
  `  async _matchIntents(event, context) {\n    for (const intent of this.intents.matches(event).slice(0, 10)) {\n      this.intents.record(intent.id, { status: 'matched', event });\n      context.publish({`,
  `  async _matchIntents(event, context) {\n    const priorTrace = Array.isArray(event.intentTrace) ? event.intentTrace : [];\n    for (const intent of this.intents.matches(event).filter(item => !priorTrace.includes(item.id)).slice(0, 10)) {\n      this.intents.record(intent.id, { status: 'matched', event });\n      const queued = context.publish({`,
  'intent recursion filter');
replaceOnce('src/event-runtime.cjs',
  `        priority: intent.priority,\n        debounceKey: \`standing-intent:\${intent.id}\`,`,
  `        priority: intent.priority,\n        intentTrace: [...priorTrace, intent.id],\n        debounceKey: \`standing-intent:\${intent.id}\`,`,
  'action trace');
replaceOnce('src/event-runtime.cjs',
  `          retryCount: 0,\n        },\n      });\n    }\n  }`,
  `          retryCount: 0,\n        },\n      });\n      if (!queued.accepted) this.intents.record(intent.id, { status: 'skipped', event, error: \`The action was not queued: \${queued.reason}.\` });\n    }\n  }`,
  'dropped action status');
replaceOnce('src/event-runtime.cjs',
  `        this._pending(this.pendingGoals, goal.id).add(id);`,
  `        this._pending(this.pendingGoals, goal.id).set(id, event.intentTrace || [id]);`,
  'goal pending trace');
replaceOnce('src/event-runtime.cjs',
  `        this._pending(this.pendingAutomations, automation.id).add(id);`,
  `        this._pending(this.pendingAutomations, automation.id).set(id, event.intentTrace || [id]);`,
  'automation pending trace');
replaceOnce('src/event-runtime.cjs',
  `          correlationId: event.correlationId,\n          expiresAt: this.now() + 60 * MINUTE,`,
  `          correlationId: event.correlationId,\n          intentTrace: event.intentTrace,\n          expiresAt: this.now() + 60 * MINUTE,`,
  'retry trace');
replaceOnce('src/event-runtime.cjs',
  `    for (const intentId of pending) this.intents.record(intentId, {\n      status: event.type === 'goal.completed' ? 'completed' : 'error', event,`,
  `    for (const [intentId] of pending) this.intents.record(intentId, {\n      status: event.type === 'goal.completed' ? 'completed' : 'error', event,`,
  'goal pending map');
replaceOnce('src/event-runtime.cjs',
  `    for (const intentId of pending) this.intents.record(intentId, {\n      status: event.type === 'automation.completed' ? 'completed' : 'error', event,`,
  `    for (const [intentId] of pending) this.intents.record(intentId, {\n      status: event.type === 'automation.completed' ? 'completed' : 'error', event,`,
  'automation pending map');
replaceOnce('src/event-runtime.cjs',
  `  _pending(map, key) {\n    let pending = map.get(key);\n    if (!pending) { pending = new Set(); map.set(key, pending); }\n    return pending;\n  }`,
  `  _intentTraceFor(input) {\n    const trace = [];\n    const add = values => {\n      for (const value of values || []) {\n        const id = typeof value === 'string' ? value.slice(0, 100) : '';\n        if (id && !trace.includes(id)) trace.push(id);\n      }\n    };\n    const addPending = (map, key) => {\n      if (!key) return;\n      for (const value of map.get(key)?.values() || []) add(value);\n    };\n    add(input?.intentTrace);\n    addPending(this.pendingGoals, input?.payload?.goalId);\n    addPending(this.pendingAutomations, input?.payload?.automationId);\n    addPending(this.pendingGoals, this.goals.activeId);\n    addPending(this.pendingAutomations, this.scheduler.runningId);\n    return trace.slice(-12);\n  }\n\n  _pending(map, key) {\n    let pending = map.get(key);\n    if (!pending) { pending = new Map(); map.set(key, pending); }\n    return pending;\n  }`,
  'pending trace maps');

replaceOnce('test/event-bus.test.cjs',
  `  const parent = normalizeEvent({ id: 'parent', type: 'goal.completed', source: 'goal.runner', payload: { goalId: 'g1' } }, 1000);\n  const child = normalizeEvent({ type: 'artifact.created', source: 'goal.runner', payload: { path: 'report.md' } }, 1001, parent);`,
  `  const parent = normalizeEvent({ id: 'parent', type: 'goal.completed', source: 'goal.runner', payload: { goalId: 'g1' }, intentTrace: ['intent-a'] }, 1000);\n  const child = normalizeEvent({ type: 'artifact.created', source: 'goal.runner', payload: { path: 'report.md' }, intentTrace: ['intent-b'] }, 1001, parent);`,
  'event trace fixture');
replaceOnce('test/event-bus.test.cjs',
  `  assert.equal(child.depth, 1);\n  assert.deepEqual(child.payload, { path: 'report.md' });`,
  `  assert.equal(child.depth, 1);\n  assert.deepEqual(child.intentTrace, ['intent-a', 'intent-b']);\n  assert.deepEqual(child.payload, { path: 'report.md' });`,
  'event trace assertion');
replaceOnce('test/event-bus.test.cjs',
  `  assert.throws(() => normalizeEvent({ type: 'goal.completed', payload: 'text' }, 1000), /payload/);`,
  `  assert.throws(() => normalizeEvent({ type: 'goal.completed', payload: 'text' }, 1000), /payload/);\n  assert.throws(() => normalizeEvent({ type: 'goal.completed', intentTrace: 'intent-a' }, 1000), /intentTrace/);`,
  'invalid event trace test');

const runtimeTestFile = 'test/event-runtime.test.cjs';
const runtimeTest = read(runtimeTestFile);
const addition = `\n\ntest('causal intent tracing prevents an intent from retriggering itself through its automation', async () => {\n  const { runtime, bus, store, scheduler, calls } = fixture();\n  const intent = runtime.saveIntent({\n    name: 'Run after routine', enabled: true,\n    when: { type: 'automation.completed', filters: [{ path: 'payload.automationId', operator: 'equals', value: 'automation-1' }] },\n    action: { type: 'automation.run', automationId: 'automation-1' },\n  });\n  scheduler.runNow = async id => {\n    calls.push(['automation', id]);\n    runtime.publish({ type: 'automation.completed', source: 'scheduler', payload: { automationId: id } });\n    return { id };\n  };\n  runtime.start();\n  runtime.publish({ type: 'automation.completed', source: 'scheduler', payload: { automationId: 'automation-1' } });\n  await drain(bus);\n  assert.deepEqual(calls, [['automation', 'automation-1']]);\n  const saved = store.data.standingIntents.intents.find(item => item.id === intent.id);\n  assert.equal(saved.triggerCount, 1);\n  assert.equal(saved.lastStatus, 'completed');\n  assert.equal(bus.state.queued, 0);\n});\n`;
if (!runtimeTest.includes("test('causal intent tracing prevents")) write(runtimeTestFile, runtimeTest.trimEnd() + addition);
