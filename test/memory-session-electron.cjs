'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'little-bot-ui-test-')));
async function run() {
  await app.whenReady();
  const errors = [];
  const window = new BrowserWindow({ show: false, width: 1280, height: 980, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const evaluate = source => window.webContents.executeJavaScript(source);
  try {
    await window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const initial = await evaluate(`(async () => {
      window.__calls = [];
      window.__records = [
        { id: 'preference', type: 'preference', text: 'Keep explanations concise and use PowerShell on Windows.', scope: 'global', pinned: true, createdAt: Date.now() },
        { id: 'decision', type: 'decision', text: 'Use SQLite for durable project memory.', scope: 'workspace', workspace: 'C:/Projects/little-bot', createdAt: Date.now() }
      ];
      window.bot = {
        searchMemory: async input => ({ records: window.__records.filter(item => (!input.type || item.type === input.type) && item.text.toLowerCase().includes(input.query.toLowerCase())) }),
        saveFact: async input => { window.__calls.push(['save', input]); const item = window.__records.find(item => item.id === input.id); if (item) Object.assign(item, input); else window.__records.push({id:'new',...input}); },
        deleteFact: async input => { window.__calls.push(['forget', input]); window.__records = window.__records.filter(item => item.id !== input.id); },
        getMemorySource: async () => ({sources:[{label:'User message',text:'Please use SQLite for the memory system.'}]}),
        getContextUsed: async () => ({ memoryStatus:'Relevant memory was injected.', inputBlocks:[{kind:'memory',label:'Memory recall',text:'Keep explanations concise and use PowerShell on Windows.'}] }),
        configureMemory: async input => window.__calls.push(['configure', input]),
        linkMemoryProject: async input => window.__calls.push(['link', input])
      };
      applyState({ settings:{ workspace:'C:/Projects/little-bot', model:'gpt-5', effort:'medium' }, runtime:{status:'ready'}, account:{status:'connected'}, models:[], chats:[{id:'continuous',title:'Conversation',status:'idle',workspace:'C:/Projects/little-bot',contextUsedAt:Date.now(),messages:[]}], memory:{enabled:true,records:window.__records,projects:[{id:'project',name:'Little Bot'}]}, automations:[], approvals:[] });
      document.getElementById('nav-memory').click();
      await new Promise(resolve => setTimeout(resolve, 40));
      return { rows:document.querySelectorAll('.memory-item').length, hasNew:Boolean(document.getElementById('new-chat')), hasPrivate:Boolean(document.getElementById('private-session-toggle')), selected:currentChat().id, context:document.getElementById('memory-used-context').textContent };
    })()`);
    assert.equal(initial.rows, 2); assert.equal(initial.hasNew, false); assert.equal(initial.hasPrivate, false); assert.equal(initial.selected, 'continuous'); assert.match(initial.context, /PowerShell/);
    await evaluate(`(async () => {
      document.querySelector('[data-memory-id="decision"] .memory-item-actions').querySelectorAll('button')[2].click();
      await new Promise(resolve => setTimeout(resolve, 10));
    })()`);
    assert.match(await evaluate(`document.querySelector('.memory-source').textContent`), /Please use SQLite/);
    await evaluate(`(async () => { document.querySelector('[data-memory-id="decision"] .memory-item-actions').querySelectorAll('button')[1].click(); await new Promise(resolve => setTimeout(resolve, 10)); })()`);
    assert.equal(await evaluate(`window.__records.find(item => item.id === 'decision').pinned`), true);
    await evaluate(`document.querySelector('[data-memory-id="decision"] .memory-item-actions button').click(); document.getElementById('fact-text').value = 'Use SQLite with searchable source history.'; document.getElementById('fact-form').requestSubmit();`);
    await evaluate(`new Promise(resolve => setTimeout(resolve, 20))`);
    assert.equal(await evaluate(`window.__records.find(item => item.id === 'decision').text`), 'Use SQLite with searchable source history.');
    await evaluate(`(async () => { document.getElementById('memory-search').value = 'SQLite'; await refreshMemoryResults(); })()`);
    assert.equal(await evaluate(`document.querySelectorAll('.memory-item').length`), 1);
    await evaluate(`document.querySelector('.memory-item-actions').querySelectorAll('button')[3].click(); document.getElementById('confirm-accept').click();`);
    await evaluate(`new Promise(resolve => setTimeout(resolve, 20))`);
    assert.equal(await evaluate(`window.__records.length`), 1);
    await evaluate(`(async () => { document.getElementById('memory-search').value = ''; await refreshMemoryResults(); document.getElementById('memory-advanced').open = true; })()`);
    await evaluate(`document.getElementById('memory-embedding-url').value='http://localhost:1234/v1'; document.getElementById('memory-embedding-model').value='local-embedding'; document.getElementById('memory-embedding-form').requestSubmit(); document.getElementById('memory-project-workspace').value='C:/Moved/little-bot'; document.getElementById('memory-project-form').requestSubmit();`);
    const calls = await evaluate('window.__calls');
    assert.equal(calls.find(item => item[0] === 'configure')[1].embedding.model, 'local-embedding');
    assert.equal(calls.find(item => item[0] === 'link')[1].projectId, 'project');
    await evaluate(`document.getElementById('memory-advanced').open=false; document.getElementById('sidebar-tools').open=true; document.getElementById('toast').classList.add('hidden');`);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    if (process.env.LITTLE_BOT_SCREENSHOT) {
      fs.mkdirSync(path.dirname(process.env.LITTLE_BOT_SCREENSHOT), { recursive:true });
      fs.writeFileSync(process.env.LITTLE_BOT_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await evaluate(`document.getElementById('nav-conversation').click(); selectChat(null);`);
    assert.equal(await evaluate('currentChat().id'), 'continuous');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({initial, actions:calls.length, errors}));
  } finally { window.destroy(); app.quit(); }
}
run().catch(error => { console.error(error.stack || error); app.exit(1); });
