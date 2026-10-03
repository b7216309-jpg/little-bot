'use strict';
const fs=require('node:fs');
const { timeContext } = require('./local-time.cjs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const OPERATIONS={
  service_manage:{get:null,save:'saveServiceKey'},
  browser_manage:{get:null,open:'openAgentBrowser',close:'closeAgentBrowser',install:'installAgentBrowser'},
  heartbeat_manage:{get:null,update:'saveHeartbeat',run:'runHeartbeat',stop:'stopHeartbeat',read:'readHeartbeat',feedback:'heartbeatFeedback'},
  standing_intent_manage:{list:null,save:'saveStandingIntent',delete:'deleteStandingIntent',enable:'toggleStandingIntent'},
  profile_manage:{get:null,save:'saveProfile'},
  settings_manage:{get:null,save:'saveSettings',connection:'saveConnection',check_connection:'refreshConnection',usage:'refreshProviderUsage',workspace:'setWorkspacePath'},
  memory_manage:{status:null,toggle:'saveMemory',configure:'configureMemory',link_project:'linkMemoryProject',source:'getMemorySource',clear_episodes:'clearEpisodes',retry_learning:'retryMemoryLearning',discard_learning:'discardMemoryLearning'},
  attachment_manage:{status:'attachmentStorage',cleanup:'cleanupAttachments',delete:'deleteAttachment'},
  automation_control:{list:null,save:'saveAutomation',run:'runAutomation',delete:'deleteAutomation'},
  goal_control:{list:null,save:'saveGoal',run:'runGoal',pause:'pauseGoal',resume:'resumeGoal',answer:'answerGoal',delete:'deleteGoal',preview_restore:'previewGoalRestore',restore:'restoreGoal',discard_snapshot:'discardGoalSnapshot',pause_all:'pauseAutonomy',resume_all:'resumeAutonomy'},
  extension_manage:{list:null,save_server:'saveMcpServer',delete_server:'deleteMcpServer',toggle_tool:'toggleMcpTool',refresh:'refreshExtensions',login_server:'loginMcpServer',save_skill:'saveSkill',delete_skill:'deleteSkill',import_skill:'importSkillPath',import_plugin:'importPluginPath',toggle_plugin:'togglePlugin',delete_plugin:'deletePlugin'},
};
const DESCRIPTIONS={
 service_manage:'Inspect or configure web services. Save payload:{service:brave or firecrawl,apiKey} or {service,remove:true}. Never echoes stored keys.',
 browser_manage:'Inspect, open, close or install Little Bot’s browser. No payload required. Use browser for navigation and page actions.',
 heartbeat_manage:'Read or configure heartbeat; update payload supports enabled, checklist, intervalMinutes, startHour, endHour, maxRunsPerDay, maxAlertsPerDay, snoozeMinutes, useCurrentWorkspace. Mark an alert read with read:{id}; feedback accepts the existing alert feedback fields.',
 standing_intent_manage:'Manage event-triggered standing intents. Save payload: id (for update), name, enabled, when:{type,source,filters:[{path,operator,value}]}, action:{type:"goal.run",goalId} or {type:"automation.run",automationId}. Enable: {id,enabled}.',
 profile_manage:'Read or update personal profile files. Save payload contains user (USER.md) and/or soul (SOUL.md), at most 4000 characters each. Change only as requested.',
 settings_manage:'Read app/model settings, save settings, select connection, check connection or change workspace. Workspace payload:{path}. Connection payload:{connection,localBaseUrl,localModel}. Changes requiring idle apply after this reply.',
 memory_manage:'Inspect memory, toggle with {enabled}, configure embeddings with {embedding}, link a project with {projectId,workspace}, inspect source with {id}, or clear episodic notes. Failed learning jobs appear in status.learning.failedJobs; retry_learning/discard_learning payload:{id}. Use memory_save/forget for individual facts.',
 attachment_manage:'Inspect attachment storage. Cleanup removes unused imports while keeping saved files and active drafts. Delete payload:{id} removes a saved copy and its chat references, keeping the original source file. Changes queue after this reply.',
 automation_control:'Read full automation settings or save/run/delete a routine. Save accepts the same fields as schedule_manage plus id; run/delete payload:{id}. Runs queue after the current reply.',
 goal_control:'Read full goal settings, save, run, pause, resume, answer, delete, or manage restore snapshots. Save accepts kind (task or ongoing), contractVersion:2, sources:{chat,calendar,files:[absolute text-file paths],feedback (reactions and heartbeat log for self-review)}, maxQuietHours, respectActiveHours, reviewPolicy (changes or always), name, objective, workspace, steps, checks, permissions, limits, trigger and id for updates. Answer payload:{id,questionId,answer}. Run/pause/resume/delete:{id}; restore/preview/discard:{id,runId}. Execution queues after this reply. Never report a queued action as completed.',
 extension_manage:'Inspect and manage installed skills, plugins and MCP connections. Import payload:{path} for an existing local file/folder. login_server:{id} opens the server sign-in page. Server and skill save use their settings objects; removal:{id}; plugin toggle:{id,enabled}; tool toggle:{id,tool,enabled}. Changes apply after this reply.',
};
const DEFERRED=new Set(['loginMcpServer','installAgentBrowser','runHeartbeat','runAutomation','runGoal','resumeGoal','restoreGoal','discardGoalSnapshot','pauseAutonomy','resumeAutonomy','saveSettings','saveConnection','setWorkspacePath','saveMcpServer','deleteMcpServer','toggleMcpTool','refreshExtensions','saveSkill','deleteSkill','importSkillPath','importPluginPath','togglePlugin','deletePlugin','cleanupAttachments','deleteAttachment']);
class AppManagement {
 constructor({controller,handlers,filename}){this.controller=controller;this.handlers=handlers;this.filename=filename;this.jobs=[];try{this.jobs=JSON.parse(fs.readFileSync(filename,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}for(const j of this.jobs)if(j.status==='running'){j.status='interrupted';j.error='App closed during operation; inspect state before retrying.';}this.timer=setInterval(()=>{void this.tick().catch(e=>controller.onError?.('app-operation',e));},500);this.timer.unref();}
 specs(){return [{name:'app_state',description:'Read current Little Bot configuration and pending app operations. Does not expose chat history or service credentials.',inputSchema:{type:'object',properties:{},additionalProperties:false}},...Object.entries(OPERATIONS).map(([name,ops])=>({name,description:DESCRIPTIONS[name],inputSchema:{type:'object',properties:{action:{type:'string',enum:Object.keys(ops)},payload:{type:'object',description:'Fields for this action; use get/list first to inspect the current record.',additionalProperties:true}},required:['action'],additionalProperties:false}}))];}
 state(){const c=this.controller,s=c.store.data;return {settings:s.settings,connection:c.connection,heartbeat:s.heartbeat,automations:s.automations,goals:s.autonomy,standingIntents:s.standingIntents||s.events,profile:c.profileFiles?.getState(),services:c.webServices?.getState(),browser:c.browser?.getState(),extensions:{...s.extensions,skills:(s.extensions?.skills||[]).map(({content,...skill})=>skill)},memory:{enabled:s.memory.enabled,learning:c.memoryConsolidator?.state},attachments:c.attachmentStorage,operations:this.jobs.slice(-20)};}
 overview(){const c=this.controller,s=c.store.data;return {
  localTime:timeContext(),
  operations:this.jobs.slice(-20).map(({payload,...job})=>job),
  connection:{kind:s.settings.connection,model:s.settings.model,status:c.connection?.status},
  workspace:s.settings.workspace,memory:{enabled:s.memory.enabled},
  heartbeat:{enabled:s.heartbeat?.enabled,nextRunAt:s.heartbeat?.nextRunAt,lastStatus:s.heartbeat?.lastStatus},
  goals:{paused:s.autonomy?.paused,items:(s.autonomy?.goals||[]).map(({id,name,status})=>({id,name,status}))},
  automations:(s.automations||[]).map(({id,name,enabled,nextRunAt})=>({id,name,enabled,nextRunAt})),
  details:'Use the corresponding *_manage or *_control tool to read full settings. Operation results above omit submitted payloads.'
 };}
 save(){fs.mkdirSync(path.dirname(this.filename),{recursive:true});const tmp=this.filename+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.jobs.slice(-100)));fs.renameSync(tmp,this.filename);}
 async call(name,args,{chat}={}){if(!chat||(chat.internal&&!(chat.wild&&name==='standing_intent_manage'))||chat.automationId)throw new Error('App management requires a direct conversation.');if(name==='app_state')return this.overview();const ops=OPERATIONS[name];if(!ops||!Object.hasOwn(ops,args.action))throw new Error('Unknown app action.');const p=args.payload??{};if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(args).some(k=>!['action','payload'].includes(k)))throw new Error('Use action and an object payload.');const handler=ops[args.action];if(!handler){const state=this.state();const key={service_manage:'services',browser_manage:'browser',heartbeat_manage:'heartbeat',standing_intent_manage:'standingIntents',profile_manage:'profile',settings_manage:'settings',memory_manage:'memory',automation_control:'automations',goal_control:'goals',extension_manage:'extensions'}[name];return state[key];}if(!this.handlers.has(handler))throw new Error('This app action is unavailable.');if(DEFERRED.has(handler)){const job={id:randomUUID(),handler,payload:p,status:'queued',createdAt:Date.now()};this.jobs.push(job);this.save();return {operationId:job.id,status:'queued',message:'Will apply after the current reply. Check app_state for completion or error.'};}const result=await this.handlers.get(handler)(p);return {status:'completed',result:result?.chats?{saved:true}:result};}
 async tick(){
  const c=this.controller;
  if(this.running||Date.now()<(this.retryAfter||0)||c.runtime.status!=='ready'||c.closing||c.goalChat||c.heartbeatChat||c.extensionsBusy||c.store.data.chats.some(x=>x.status!=='idle'))return;
  // Persist a finished operation again after disk recovery without replaying
  // its handler. Its original running record remains conservative on restart.
  if(this.dirty){try{this.save();this.dirty=false;}catch(e){this.retryAfter=Date.now()+5000;throw e;}}
  const j=this.jobs.find(x=>x.status==='queued');if(!j)return;
  this.running=true;let started=false;
  try{
   j.status='running';this.save();started=true;delete j.error;
   try{await this.handlers.get(j.handler)(j.payload);j.status='completed';}
   catch(e){j.status='failed';j.error=e.message;}
   j.finishedAt=Date.now();this.save();
  }catch(e){
   if(!started){j.status='queued';j.error='Could not save operation; waiting to retry: '+e.message;}
   this.dirty=true;this.retryAfter=Date.now()+5000;throw e;
  }finally{this.running=false;c.changed();}
 }
 close(){clearInterval(this.timer);}
}
module.exports={AppManagement,OPERATIONS};
