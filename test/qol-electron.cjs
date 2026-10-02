'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const { Store } = require('../src/store.cjs');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-qol-'));
app.setPath('userData', path.join(fixtureRoot, 'electron'));

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({ width: 1240, height: 860, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  try {
    await window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const store = new Store({ filePath: path.join(fixtureRoot, 'state.json'), defaultWorkspace: process.cwd() });
    const state = store.data;
    state.runtime = { status: 'ready' };
    state.heartbeat.history = [
      { id: 'one', at: Date.now(), source: 'heartbeat', status: 'alert', unread: true, summary: 'Your project notes have three unfinished tasks.', workspace: process.cwd(), actions: ['Read notes.md'] },
      { id: 'two', at: Date.now() - 60000, source: 'goal', status: 'error', unread: false, summary: 'The verification command needs attention.', workspace: process.cwd() },
    ];
    state.chats = [{ id: 'chat', title: 'Review project notes', status: 'idle', workspace: process.cwd(), connection: 'local', messages: [
      { id: 'u', role: 'user', text: 'Review my project notes.' },
      { id: 't1', role: 'tool', kind: 'command', text: 'Read notes.md', status: 'completed' },
      { id: 'p', role: 'assistant', phase: 'commentary', text: 'Checking the remaining tasks.' },
      { id: 't2', role: 'tool', kind: 'command', text: 'Inspect project files', status: 'running' },
      { id: 'f', role: 'assistant', text: 'There are three tasks remaining.' },
    ] }];
    await window.webContents.executeJavaScript(`
      window.bot = { readHeartbeat: async ({id}) => {
        state.heartbeat.history.forEach(entry => { if (!id || id === entry.id) entry.unread = false; });
        return state;
      } };
      applyState(${JSON.stringify(state)});
    `);
    const chat = await window.webContents.executeJavaScript(`(async () => {
      const details = document.querySelector('.action-group-details');
      const collapsed = !details.open;
      details.open = true;
      await new Promise(requestAnimationFrame);
      const entryOrder = Array.from(details.querySelectorAll('[data-message-id]'), node => node.dataset.messageId);
      state.chats[0].messages[3].status = 'completed';
      renderStreamedMessages(state.chats[0], [state.chats[0].messages[3]], new Map([['t2', 3]]));
      const complete = details.querySelector('.action-group-status').textContent;
      renderConversation();
      return { collapsed, entryOrder, complete, retained: details === document.querySelector('.action-group-details') && details.open,
        finalOutside: document.querySelector('[data-message-id="f"]').parentNode.id === 'messages' };
    })()`);
    assert.deepEqual(chat, { collapsed: true, entryOrder: ['t1', 'p', 't2'], complete: 'Completed', retained: true, finalOutside: true });
    const regrouped = await window.webContents.executeJavaScript(`(() => {
      state.chats[0].messages[2].phase = 'final_answer';
      renderStreamedMessages(state.chats[0], [state.chats[0].messages[2]], new Map([['p', 2]]));
      const visible = document.querySelector('[data-message-id="p"]').parentNode.id === 'messages';
      state.chats[0].messages[2].phase = 'commentary';
      renderStreamedMessages(state.chats[0], [state.chats[0].messages[2]], new Map([['p', 2]]));
      return visible && document.querySelectorAll('.action-group').length === 1;
    })()`);
    assert.equal(regrouped, true);
    const inbox = await window.webContents.executeJavaScript(`(async () => {
      $('nav-inbox').click();
      const opened = !$('inbox-view').classList.contains('hidden') && $('heartbeat-view').classList.contains('hidden');
      const all = $('heartbeat-inbox').children.length;
      document.querySelector('[data-inbox-filter="unread"]').click();
      const unread = $('heartbeat-inbox').children.length;
      document.querySelector('[data-inbox-filter="errors"]').click();
      const error = $('heartbeat-inbox').firstChild.dataset.entryId;
      $('inbox-source').value = 'heartbeat'; $('inbox-source').dispatchEvent(new Event('change'));
      const empty = $('heartbeat-inbox').textContent.includes('No updates match');
      $('inbox-source').value = 'all'; $('inbox-source').dispatchEvent(new Event('change'));
      document.querySelector('[data-inbox-filter="all"]').click();
      $('heartbeat-read-all').click();
      await new Promise(resolve => setTimeout(resolve, 20));
      const read = $('heartbeat-read-all').disabled && $('heartbeat-unread').classList.contains('hidden');
      $('nav-heartbeat').click();
      const separated = $('inbox-view').classList.contains('hidden') && !$('heartbeat-view').classList.contains('hidden');
      $('nav-inbox').click();
      return { opened, all, unread, error, empty, read, separated };
    })()`);
    assert.deepEqual(inbox, { opened: true, all: 2, unread: 1, error: 'two', empty: true, read: true, separated: true });
    if (process.env.LITTLE_BOT_QOL_SCREENSHOT_DIR) {
      const dir = process.env.LITTLE_BOT_QOL_SCREENSHOT_DIR;
      fs.mkdirSync(dir, { recursive: true });
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(dir, 'inbox.png'), (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript("selectChat('chat'); document.querySelector('.action-group-details').open = false; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      fs.writeFileSync(path.join(dir, 'tool-calls.png'), (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript("document.querySelector('.action-group-details').open = true; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      fs.writeFileSync(path.join(dir, 'tool-calls-expanded.png'), (await window.webContents.capturePage()).toPNG());
    }
    // Model Markdown renders as real lists, headings, quotes and emphasis, built from DOM nodes only.
    const markdown = await window.webContents.executeJavaScript(`(() => {
      const box = document.createElement('div');
      renderMessageText(box, ${JSON.stringify('## Plan\n- **one** item\n- *two*\n\n3. third\n4. fourth\n> quoted\n---\nDone <img src=x onerror=alert(1)>\n```\n- not a list\n```')});
      return { heading: box.querySelector('.md-heading')?.textContent, bullets: [...box.querySelectorAll('ul.md-list li')].map(li => li.textContent),
        strong: box.querySelector('ul strong')?.textContent, em: box.querySelector('ul em')?.textContent, ordered: [...box.querySelectorAll('ol.md-list li')].map(li => li.textContent),
        start: box.querySelector('ol.md-list')?.start, quote: box.querySelector('.md-quote')?.textContent, rule: Boolean(box.querySelector('hr.md-rule')),
        injected: Boolean(box.querySelector('img')), code: box.querySelector('pre code')?.textContent };
    })()`);
    assert.deepEqual(markdown, { heading: 'Plan', bullets: ['one item', 'two'], strong: 'one', em: 'two', ordered: ['third', 'fourth'], start: 3,
      quote: 'quoted', rule: true, injected: false, code: '- not a list' });
    console.log(JSON.stringify({ chat, inbox, markdown: 'ok' }));
  } finally { window.destroy(); app.quit(); }
}
run().catch(error => { console.error(error.stack || error); app.exit(1); });
