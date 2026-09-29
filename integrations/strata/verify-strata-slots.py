import json,time,urllib.request,sys,uuid
NONCE=uuid.uuid4().hex
LINES=int(sys.argv[1]) if len(sys.argv)>1 else 150
from pathlib import Path
BASE='http://127.0.0.1:8080'
def get(p):
 with urllib.request.urlopen(BASE+p,timeout=10) as r:return json.load(r)
for _ in range(90):
 try:
  get('/health');break
 except Exception:time.sleep(1)
else:raise RuntimeError('Server never became ready')
results=[]
def call(label,slot,letter,lines=LINES):
 text='\n'.join(f'Record {i:05d}: {letter}-{(i*7919)%99991:05d} is an archival marker.' for i in range(lines))
 body={'model':'qwen3.8-flash-next-iq2_xs','messages':[{'role':'system','content':NONCE+' '+letter+' Return only the exact answer requested.'},{'role':'user','content':text+'\nReturn exactly: '+letter+' finished.'}],'temperature':0,'top_k':1,'max_tokens':32,'chat_template_kwargs':{'enable_thinking':False},'strata_cache_slot':slot,'stream':False}
 t=time.monotonic();req=urllib.request.Request(BASE+'/v1/chat/completions',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=600) as r:out=json.load(r)
 stat=get('/metrics')['requests'][0];row={'label':label,'slot':slot,'wall_s':round(time.monotonic()-t,2),'text':out['choices'][0]['message']['content'],'prompt':stat['prompt_tokens'],'reused':out['usage']['prompt_tokens_details']['cached_tokens'],'prefill_ms':stat['prompt_ms']};results.append(row);print(json.dumps(row),flush=True);Path(__file__).with_suffix('.json').write_text(json.dumps(results,indent=2));return row
A=call('A cold',0,'A');B=call('B cold',1,'B');Ar=call('A restored',0,'A');Br=call('B restored',1,'B');Ac=call('A independent cold',3,'A')
assert A['reused']==B['reused']==Ac['reused']==0, 'Cold run unexpectedly reused cache'
assert A['text']==Ar['text']==Ac['text'], 'A output changed after restoration'
assert B['text']==Br['text'],'B output changed after restoration'
assert Ar['reused']>0 and Br['reused']>0,'No tokens reused after rotation'
print('PASS cold/restored parity and real token reuse',flush=True)
