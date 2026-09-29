'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GoalExecutor } = require('../src/goal-executor.cjs');

function fixture(call = async () => ({})) {
  const progress = [];
  const controller = { closing: false, changed() {}, client: {}, agentTools: { call } };
  const executor = new GoalExecutor(controller);
  const operation = { threadId: 't', turnId: 'turn', startedAt: Date.now(), tokens: 0,
    remaining: { tokens: 200000, actions: 30 }, actionIds: new Set(), actions: new Map(),
    workspace: '/workspace', goal: { connection: 'local' }, onProgress: value => progress.push(value) };
  executor.active = operation;
  return { executor, operation, progress };
}

test('goal usage keeps repeated input separate from output without summing cumulative events twice', () => {
  const { executor, operation, progress } = fixture();
  for (const total of [
    { totalTokens: 12754, inputTokens: 12650, outputTokens: 104 },
    { totalTokens: 30501, inputTokens: 30236, outputTokens: 265 },
    { totalTokens: 30501, inputTokens: 30236, outputTokens: 265 },
  ]) executor.notification('thread/tokenUsage/updated', { threadId: 't', turnId: 'turn', tokenUsage: { total } });
  assert.equal(operation.tokens, 30501);
  assert.equal(progress.at(-1).inputTokens, 30236);
  assert.equal(progress.at(-1).outputTokens, 265);
});

test('goal recall uses small pages and exposes the actual search in progress and history', async () => {
  const calls = [];
  const { executor, operation, progress } = fixture(async (name, args) => { calls.push({ name, args }); return { results: [] }; });
  await executor.dynamicCall(operation, { turnId: 'turn', callId: '1', tool: 'memory_search', arguments: { query: 'last explicit commitment', limit: 100 } });
  await executor.dynamicCall(operation, { turnId: 'turn', callId: '2', tool: 'session_read', arguments: { sessionId: 's', limit: 20 } });
  assert.equal(calls[0].args.limit, 5);
  assert.equal(calls[1].args.limit, 3);
  assert.match([...operation.actions.values()][0], /memory_search: last explicit commitment/);
  assert.equal(progress.at(-1).currentAction, 'session_read: s');
});

test('failed read actions remain visible instead of leaving empty run history', async () => {
  const { executor, operation, progress } = fixture(async () => { throw new Error('Source not found'); });
  const result = await executor.dynamicCall(operation, { turnId: 'turn', callId: '1', tool: 'session_read', arguments: { sessionId: 's' } });
  assert.equal(result.success, false);
  assert.match(operation.actions.get('dynamic:1'), /failed: Source not found/);
  assert.match(progress.at(-1).currentAction, /failed/);
});

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
test('goal writes state without terminal access and preserves files on rejected writes', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-goal-writer-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  await fs.mkdir(path.join(workspace, 'state'));
  const { executor, operation } = fixture();
  operation.workspace = workspace;
  operation.goal = { workspace, connection: 'local', permissions: { write: true, writePaths: ['state'], shell: false } };
  const call = (id, args) => executor.dynamicCall(operation, { turnId: 'turn', callId: id, tool: 'workspace_write', arguments: args });
  assert.equal((await call('1', { path: 'state/growth.md', content: 'Useful state' })).success, true);
  assert.equal(await fs.readFile(path.join(workspace, 'state/growth.md'), 'utf8'), 'Useful state');
  assert.equal((await call('2', { path: 'outside.md', content: 'No' })).success, false);
  assert.equal((await call('3', { path: 'state/growth.md', content: 'x'.repeat(20001) })).success, false);
  operation.goal.permissions.write = false;
  assert.equal((await call('4', { path: 'state/growth.md', content: 'No' })).success, false);
  assert.equal(await fs.readFile(path.join(workspace, 'state/growth.md'), 'utf8'), 'Useful state');
});
