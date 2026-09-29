import json,time,urllib.request,uuid
from pathlib import Path
URL='http://127.0.0.1:8080/v1/chat/completions'
body={'model':'qwen3.8-flash-next-iq2_xs','messages':[{'role':'system','content':uuid.uuid4().hex+' Follow the request.'},{'role':'user','content':'List numbers from 1 to 2000 separated by commas. No introduction.'}],'temperature':0,'top_k':1,'max_tokens':8192,'chat_template_kwargs':{'enable_thinking':False},'strata_cache_slot':0,'stream':True}
def request(b):return urllib.request.urlopen(urllib.request.Request(URL,data=json.dumps(b).encode(),headers={'Content-Type':'application/json'}),timeout=120)
with request(body) as r:
 for line in r:
  if b'"content"' in line and b'1' in line:break
# Closing the streaming consumer must cancel decode and leave recoverable checkpoints.
time.sleep(1)
other=dict(body,messages=[{'role':'user','content':'Reply only banana.'}],strata_cache_slot=1,stream=False,max_tokens=32)
with request(other) as r:json.load(r)
body.update(stream=False,max_tokens=32)
with request(body) as r:restored=json.load(r)
body['strata_cache_slot']=3
with request(body) as r:cold=json.load(r)
assert restored['choices'][0]['message']['content']==cold['choices'][0]['message']['content']
assert cold['usage']['prompt_tokens_details']['cached_tokens']==0
assert restored['usage']['prompt_tokens_details']['cached_tokens']>0
out={'restored':restored['choices'][0]['message']['content'],'cached':restored['usage']['prompt_tokens_details']['cached_tokens'],'cold_cached':cold['usage']['prompt_tokens_details']['cached_tokens']}
Path(__file__).with_suffix('.json').write_text(json.dumps(out,indent=2));print('PASS cancelled stream, rotation and cold output parity: '+json.dumps(out))
