import json,time,urllib.request,uuid,threading
from pathlib import Path
URL='http://127.0.0.1:8080'; nonce=uuid.uuid4().hex
text='\n'.join(f'Record {i:05d}: A-{(i*7919)%99991:05d} is an archival marker.' for i in range(1700))
messages=[{'role':'system','content':nonce+' Answer from the records. Return just the requested markers.'},{'role':'user','content':text+'\nWhat are the exact markers for records 00600 and 01699?'}]
rows=[]
def call(label,slot,msg=messages):
 body={'model':'qwen3.8-flash-next-iq2_xs','messages':msg,'temperature':0,'top_k':1,'max_tokens':80,'chat_template_kwargs':{'enable_thinking':False},'strata_cache_slot':slot,'stream':False}
 start=time.monotonic()
 with urllib.request.urlopen(urllib.request.Request(URL+'/v1/chat/completions',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'}),timeout=600) as r: out=json.load(r)
 row={'label':label,'seconds':round(time.monotonic()-start,2),'text':out['choices'][0]['message']['content'],'cached':out['usage']['prompt_tokens_details']['cached_tokens']};rows.append(row);print(json.dumps(row),flush=True);Path(__file__).with_suffix('.json').write_text(json.dumps(rows,indent=2));return row
cold=call('needle cold',0)
call('intervening other context',1,[{'role':'user','content':'Reply exactly banana.'}])
warm=call('needle restored',0)
independent=call('needle independent cold',2)
assert cold['cached']==independent['cached']==0
assert warm['cached']>32000
assert cold['text']==warm['text']==independent['text']
for i in (600,1699):assert f'A-{(i*7919)%99991:05d}' in warm['text']
print('PASS needle retrieval, parity, cache isolation',flush=True)
