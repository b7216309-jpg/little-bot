// One development-only end-to-end goal/verification/undo check. No model calls.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

async function run({ window, controller, store, goals, output }) {
  assert.ok(process.env.LITTLE_BOT_DATA_DIR, 'An isolated smoke profile is required.');
  const workspace = store.data.settings.workspace;
  const probeFile = path.join(workspace, 'goal-smoke-note.md');
  await fs.writeFile(probeFile, 'Original draft\n');
  // Verify the pinned native engine accepts the management tool definitions.
  const native = await controller.client.request('thread/start', { cwd: workspace, ephemeral: true,
    approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: controller.agentTools.specs() });
  await controller.client.request('thread/unsubscribe', { threadId: native.thread.id });
  const context = { chat: { id: 'management-smoke', workspace, messages: [{ role: 'user', text: 'Create a draft goal for these notes.' }] } };
  const draftResult = await controller.agentTools.call('goal_manage', { action: 'create', name: 'Agent-created draft', objective: 'Review the notes.', checks: [{ type: 'fileExists', path: 'review.md' }] }, context);
  assert.equal(draftResult.goal.status, 'draft'); assert.equal(draftResult.goal.authorized, false);
  await controller.agentTools.call('goal_manage', { action: 'update', id: draftResult.goal.id, name: 'Updated draft' }, context);
  assert.equal(goals.goal(draftResult.goal.id).objective, 'Review the notes.');
  await assert.rejects(controller.agentTools.call('goal_manage', { action: 'resume', id: draftResult.goal.id }, context), /authorize/i);
  const skills = await controller.agentTools.call('skill_list', {}, context);
  assert.ok(skills.skills.some(skill => skill.name === 'smoke-review'));
  assert.match((await controller.agentTools.call('skill_read', { name: 'smoke-review' }, context)).instructions, /three concise/);
  const schedule = await controller.agentTools.call('schedule_manage', { action: 'create', name: 'Agent routine draft', prompt: 'Review the notes.', intervalMinutes: 60 }, context);
  assert.equal(schedule.enabled, false); assert.equal(schedule.authorized, false);
  const renamedSchedule = await controller.agentTools.call('schedule_manage', { action: 'update', id: schedule.id, name: 'Updated routine draft' }, context);
  assert.equal(renamedSchedule.prompt, 'Review the notes.'); assert.equal(renamedSchedule.intervalMinutes, 60);
  await goals.remove(draftResult.goal.id);

  const originalAccount = controller.account, originalRun = goals.run;
  let runs = 0;
  goals.run = async (goal, { onProgress }) => {
    assert.equal(goal.permissions.write, true);
    assert.deepEqual(goal.permissions.writePaths, ['.']);
    runs++;
    await fs.writeFile(probeFile, 'Finished and verified\n');
    onProgress({ tokens: 150, actions: 1, elapsedMs: 10 });
    return { status: 'verify', summary: 'Updated the note.', checkpoint: 'The note now contains the requested result.', nextStep: '',
      usage: { tokens: 150, actions: 1, elapsedMs: 10 }, actions: ['Wrote goal-smoke-note.md'] };
  };
  try {
    controller.account = { status: 'connected', type: 'chatgpt' }; controller.changed(); await delay(100);
    await window.webContents.executeJavaScript("document.getElementById('nav-goals').click(); document.getElementById('create-goal').click()");
    await window.webContents.executeJavaScript(`document.getElementById('goal-name').value='Finish the project note';
      document.getElementById('goal-objective').value='Finish the note and verify its content.';
      document.getElementById('goal-check-type').value='fileContains'; document.getElementById('goal-check-type').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('goal-check-path').value='goal-smoke-note.md'; document.getElementById('goal-check-contains').value='Finished and verified';
      document.getElementById('goal-advanced').open=true; document.getElementById('goal-permission-write').checked=true;
      document.getElementById('goal-permission-write').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('goal-write-paths').value='.';
      document.getElementById('goal-max-runs').value='1';`);
    await delay(150);
    await fs.writeFile(path.join(output, 'goal-editor.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("document.getElementById('goal-form').requestSubmit()");
    for (let i = 0; i < 40 && !store.data.autonomy.goals.some(goal => goal.name === 'Finish the project note'); i++) await delay(100);
    const goal = store.data.autonomy.goals.find(goal => goal.name === 'Finish the project note');
    assert.ok(goal, 'Goal form did not persist.'); assert.equal(goal.status, 'draft');
    await delay(150);
    await window.webContents.executeJavaScript("document.querySelector('.goal-card .goal-card-actions .button.primary').click()");
    for (let i = 0; i < 100 && goal.status !== 'completed' && goal.status !== 'blocked'; i++) await delay(100);
    assert.equal(goal.status, 'completed', JSON.stringify(goal.history));
    assert.equal(runs, 1); assert.equal(goal.usage.runs, 1); assert.equal(goal.usage.tokens, 150);
    assert.ok(goal.history.some(entry => entry.verification?.every(check => check.passed)));
    const snapshot = goal.history.findLast(entry => entry.snapshot?.undoAvailable)?.snapshot;
    assert.ok(snapshot, 'The write run needs a usable backup.');
    await delay(150);
    await window.webContents.executeJavaScript("document.querySelector('.goal-details').open=true; document.getElementById('toast').classList.add('hidden')");
    await delay(150);
    await fs.writeFile(path.join(output, 'goals.png'), (await window.webContents.capturePage()).toPNG());
    window.setSize(900, 720); await delay(150);
    assert.equal(await window.webContents.executeJavaScript("document.documentElement.scrollWidth > innerWidth"), false);
    await fs.writeFile(path.join(output, 'goals-compact.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("[...document.querySelectorAll('.goal-history-item button')].find(button=>button.textContent.toLowerCase().includes('undo')).click()");
    for (let i = 0; i < 30; i++) { if (await window.webContents.executeJavaScript("document.getElementById('goal-restore-dialog').open && !document.getElementById('confirm-goal-restore').disabled")) break; await delay(100); }
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('confirm-goal-restore').disabled"), false);
    await fs.writeFile(path.join(output, 'goal-undo.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("document.getElementById('confirm-goal-restore').click()");
    for (let i = 0; i < 30 && await fs.readFile(probeFile, 'utf8') !== 'Original draft\n'; i++) await delay(100);
    assert.equal(await fs.readFile(probeFile, 'utf8'), 'Original draft\n');
    assert.equal(goal.status, 'paused');
    await delay(150);
    await window.webContents.executeJavaScript("document.getElementById('pause-autonomy').click()");
    for (let i = 0; i < 20 && !store.data.autonomy.paused; i++) await delay(100);
    assert.equal(store.data.autonomy.paused, true);
    await delay(100);
    await window.webContents.executeJavaScript("document.getElementById('resume-autonomy').click()");
    for (let i = 0; i < 20 && store.data.autonomy.paused; i++) await delay(100);
    assert.equal(store.data.autonomy.paused, false);
    assert.equal(goal.status, 'paused', 'Global resume must not restart a goal paused by undo.');
    window.setSize(1240, 860);
  } finally {
    if (goals.activeId) await goals.pause(goals.activeId);
    goals.run = originalRun; controller.account = originalAccount; controller.changed();
  }
  return { goalForm: true, verifiedFileCompletion: true, undoThroughIpc: true, managementTools: true, globalPause: true, liveModel: false };
}
module.exports = { run };
