'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { Store } = require('../src/store.cjs');
const { validateGoal } = require('../src/goals.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-goal-v2-ui-'));
app.setPath('userData', path.join(root, 'electron'));
(async () => {
  const watchdog = setTimeout(() => { console.error('UI test timed out'); app.exit(1); }, 30000);
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  try {
    await window.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    const store = new Store({ filePath: path.join(root, 'state.json'), defaultWorkspace: root });
    const state = store.data;
    state.runtime = { status: 'ready' }; state.account = { status: 'connected' }; state.goalRuntime = { status: 'idle' };
    const goal = validateGoal({ kind: 'ongoing', name: 'Learning', objective: 'Help me learn', workspace: root });
    goal.status = 'blocked'; goal.authorized = true; goal.pendingQuestion = { id: 'q', question: 'Which topic?', options: ['Memory', 'Tools'] };
    goal.review.lastResult = { outcome: 'waiting', summary: 'Choose a topic', at: Date.now(), evidenceRefs: [] };
    state.autonomy.goals = [goal];
    state.chats = [{ id: 'chat', status: 'idle', title: 'Conversation', workspace: root, messages: [{ id: 'goal-message', role: 'assistant', kind: 'goal', goalId: goal.id, goalName: goal.name, goalQuestionId: 'q', text: 'Which topic?', status: 'completed' }] }];
    const result = await window.webContents.executeJavaScript(`
      window.bot = { answerGoal: async payload => { window.__answer = payload; return null; } };
      applyState(${JSON.stringify(state)});
      editGoal(state.autonomy.goals[0]);
      const ongoing = $('goal-kind').value;
      const pathRequired = document.querySelector('.goal-check-path').required;
      closeDialog('goal-dialog');
      const question = document.querySelector('.message .goal-question');
      if (!question) throw new Error('Goal question missing from continuous chat');
      const input = question.querySelector('textarea');
      input.value = 'Memory'; input.dispatchEvent(new Event('input', { bubbles: true }));
      question.requestSubmit();
      new Promise(resolve => setTimeout(() => resolve({ ongoing, pathRequired, answer: window.__answer, chatText: $('messages').textContent }), 10));
    `);
    assert.equal(result.ongoing, 'ongoing'); assert.equal(result.pathRequired, false);
    assert.equal(result.answer.id, goal.id); assert.equal(result.answer.questionId, 'q'); assert.equal(result.answer.answer, 'Memory');
    assert.match(result.chatText, /Goal · Learning/);
    console.log('Goal v2 production renderer: ongoing form and in-chat answer routing passed.');
  } finally { clearTimeout(watchdog); window.destroy(); app.quit(); }
})().catch(error => { console.error(error); app.exit(1); });

