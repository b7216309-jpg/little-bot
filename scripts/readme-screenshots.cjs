'use strict';
// Real renderer, fictional data, no model/server connection or personal profile.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {app,BrowserWindow}=require('electron');
const {Store}=require('../src/store.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'little-bot-readme-'));
app.setPath('userData',path.join(root,'electron'));
(async()=>{
 await app.whenReady();
 const store=new Store({filePath:path.join(root,'state.json'),defaultWorkspace:'C:/Projects/Fieldnotes'});
 const s=store.data,now=Date.now();
 Object.assign(s.settings,{workspace:'C:/Projects/Fieldnotes',connection:'local',localModel:'qwen3.8-flash-next-iq2_xs',model:'qwen3.8-flash-next-iq2_xs',effort:'low'});
 s.runtime={status:'ready'};s.account={status:'connected'};
 s.connection={type:'local',status:'connected',adapter:'strata',model:s.settings.model,contextWindow:262144};
 s.models=[{id:s.settings.model,model:s.settings.model,displayName:'Qwen · local'}];
 s.chats=[{id:'demo',title:'Conversation',status:'idle',workspace:s.settings.workspace,model:s.settings.model,mode:'execute',effort:'low',contextUsedAt:now,context:{usedTokens:18420,windowTokens:249036,stale:false},messages:[
  {id:'u1',role:'user',text:'Help me turn my research notes into a useful weekly briefing.',status:'completed'},
  {id:'a1',role:'assistant',text:'Let’s keep it practical:\n\n1. Collect the week’s notes and source links.\n2. Group them into findings, decisions, and open questions.\n3. Write a short briefing with a clear next step.\n\nI’ll use your saved preference for concise summaries.',status:'completed'},
  {id:'u2',role:'user',text:'Remember that preference, and what should the recurring task do?',status:'completed'},
  {id:'a2',role:'assistant',text:'A weekly review can read the notes in **Fieldnotes**, draft a briefing, and flag unanswered questions.\n\nYou can inspect the schedule in **Automations**, the saved preference in **Memory**, and the work plan in **Goals**. Scheduled work runs while Little Bot is open.',status:'completed'}]}];
 const records=[{id:'p',type:'preference',text:'Keep weekly briefings concise, with sources and one clear next step.',scope:'global',pinned:true,createdAt:now},{id:'d',type:'decision',text:'Keep original research notes alongside the weekly briefing.',scope:'workspace',workspace:s.settings.workspace,createdAt:now},{id:'f',type:'fact',text:'Fieldnotes is the workspace for the research briefing project.',scope:'workspace',workspace:s.settings.workspace,createdAt:now}];
 s.memory={...s.memory,enabled:true,records,projects:[{id:'project',name:'Fieldnotes'}]};
 s.automations=[{id:'weekly',name:'Weekly research briefing',prompt:'Review this week’s notes. Draft a concise briefing with sources, decisions, and open questions.',workspace:s.settings.workspace,enabled:true,scheduleType:'clock',clockTime:'17:00',daysOfWeek:[5],nextRunAt:now+86400000,lastRunAt:now-86400000,lastStatus:'completed'}, {id:'daily',name:'Daily planning check',prompt:'Review unfinished tasks and suggest one useful next step. Keep the update short.',workspace:s.settings.workspace,enabled:true,intervalMinutes:1440,nextRunAt:now+3600000,lastRunAt:now-3600000,lastStatus:'completed'}];
 const w=new BrowserWindow({show:false,width:1360,height:940,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 try {
  await w.loadFile(path.join(__dirname,'../src/renderer/index.html'));
  await w.webContents.executeJavaScript(`window.bot={searchMemory:async()=>({records:${JSON.stringify(records)}}),getContextUsed:async()=>({memoryStatus:'Relevant saved preferences are included.',inputBlocks:[]}),getMemorySource:async()=>({sources:[]})}; applyState(${JSON.stringify(s)});document.getElementById('sidebar-tools').open=true;document.getElementById('toast').classList.add('hidden');`);
  const out=path.join(__dirname,'../docs/screenshots');fs.mkdirSync(out,{recursive:true});
  for(const view of ['conversation','memory','automations']){
   await w.webContents.executeJavaScript(`document.getElementById('nav-${view}').click();applyState(${JSON.stringify(s)})`);
   await w.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
   await new Promise(r=>setTimeout(r,350));
   await w.webContents.capturePage();
   await new Promise(r=>setTimeout(r,200));
   const visible=await w.webContents.executeJavaScript('document.body.innerText');
   if(/AppData|little-bot-readme-|Users[\\/]/i.test(visible))throw new Error('Unexpected personal or temporary path in screenshot');
   fs.writeFileSync(path.join(out,view+'.png'),(await w.webContents.capturePage()).toPNG());
  }
  console.log('Captured three anonymous renderer screenshots.');
 }finally{store.close();w.destroy();app.quit();}
})().catch(e=>{console.error(e);app.exit(1)});
