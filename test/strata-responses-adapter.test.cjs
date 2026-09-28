'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { once }=require('node:events');
const { StrataStreamAdapter, estimateResponsesInputTokens, responsesToChat }=require('../src/strata-responses-adapter.cjs');

test('responsesToChat maps messages and tools',()=>{
 const source={model:'qwen3.8-flash-next-iq2_xs',instructions:'sys',max_output_tokens:512,reasoning:{effort:'low'},input:[
  {type:'message',role:'user',content:[{type:'input_text',text:'hi'},{type:'input_image',image_url:'data:image/png;base64,abc'}]},
  {type:'reasoning',content:[{type:'reasoning_text',text:'thought'}],summary:[]},
  {type:'function_call',call_id:'call1',name:'plain',arguments:'{"x":1}'},
  {type:'function_call_output',call_id:'call1',output:'ok'},
 ],tools:[
  {type:'function',name:'plain',description:'Plain',parameters:{type:'object',properties:{x:{type:'number'}}}},
  {type:'custom',name:'apply_patch',description:'Patch'},
  {type:'tool_search',execution:'client',description:'search',parameters:{type:'object',properties:{query:{type:'string'}}}},
 ]};
 const out=responsesToChat(source,false);
 assert.equal(out.body.model,source.model);
 assert.equal(out.body.stream,true);
 assert.equal(out.body.max_completion_tokens,512);
 assert.equal(out.body.chat_template_kwargs.enable_thinking,false);
 assert.equal(out.body.messages[0].role,'developer');
 assert.equal(out.body.messages[1].content[1].type,'image_url');
 assert.equal(out.body.messages[2].reasoning_content,'thought');
 assert.equal(out.body.messages[2].tool_calls[0].function.name,'plain');
 assert.equal(out.body.messages[3].role,'tool');
 assert.equal(out.toolKinds.get('apply_patch').type,'custom');
 assert.equal(out.toolKinds.get('tool_search').type,'tool_search');
 assert.equal(out.body.tools.length,3);
 assert.ok(estimateResponsesInputTokens(source)>0);
});

test('responsesToChat preserves Strata effort while the local toggle controls thinking',()=>{
 const source={model:'qwen3.8-flash-next-iq2_xs',reasoning:{effort:'high'},input:'hello'};
 const enabled=responsesToChat(source,true);
 assert.deepEqual(enabled.body.reasoning,{effort:'high'});
 assert.equal(enabled.body.chat_template_kwargs.enable_thinking,true);
 const disabled=responsesToChat(source,false);
 assert.deepEqual(disabled.body.reasoning,{effort:'high'});
 assert.equal(disabled.body.chat_template_kwargs.enable_thinking,false);
});

test('stream adapter emits codex responses events', async()=>{
 const adapter=new StrataStreamAdapter({model:'qwen3.8-flash-next-iq2_xs',toolKinds:new Map([
  ['apply_patch',{type:'custom'}],['plain',{type:'function'}]
 ])});
 let text=''; adapter.on('data',c=>text+=c.toString());
 adapter.write('data: '+JSON.stringify({id:'chat1',model:'qwen3.8-flash-next-iq2_xs',choices:[{index:0,delta:{role:'assistant',content:''},finish_reason:null}]})+'\n\n');
 adapter.write('data: '+JSON.stringify({id:'chat1',model:'qwen3.8-flash-next-iq2_xs',choices:[{index:0,delta:{reasoning_content:'thinking'},finish_reason:null}]})+'\n\n');
 adapter.write('data: '+JSON.stringify({id:'chat1',model:'qwen3.8-flash-next-iq2_xs',choices:[{index:0,delta:{content:'answer'},finish_reason:null}]})+'\n\n');
 adapter.write('data: '+JSON.stringify({id:'chat1',model:'qwen3.8-flash-next-iq2_xs',choices:[{index:0,delta:{tool_calls:[{index:0,id:'call1',type:'function',function:{name:'apply_patch',arguments:''}}]},finish_reason:null}]})+'\n\n');
 adapter.write('data: '+JSON.stringify({id:'chat1',model:'qwen3.8-flash-next-iq2_xs',choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:'{"input":"*** Begin Patch"}'}}]},finish_reason:null}]})+'\n\n');
 adapter.end('data: '+JSON.stringify({id:'chat1',model:'qwen3.8-flash-next-iq2_xs',choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}})+'\n\ndata: [DONE]\n\n');
 await once(adapter,'end');
 const events=text.split(/\r?\n/).filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
 assert.ok(events.some(e=>e.type==='response.created'));
 const reason=events.find(e=>e.type==='response.reasoning_text.delta');
 assert.equal(reason.delta,'thinking'); assert.equal(reason.content_index,0);
 assert.equal(events.find(e=>e.type==='response.output_text.delta').delta,'answer');
 const call=events.find(e=>e.type==='response.output_item.done'&&e.item?.type==='custom_tool_call');
 assert.equal(call.item.name,'apply_patch'); assert.equal(call.item.input,'*** Begin Patch');
 const completed=events.find(e=>e.type==='response.completed');
 assert.equal(completed.response.usage.input_tokens,10);
 assert.equal(completed.response.usage.output_tokens,20);
});
