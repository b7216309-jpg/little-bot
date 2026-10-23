'use strict';

// Explicitly target a separate server: these requests replace parked histories.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { streamChat } = require('../../src/engine/model.cjs');

async function main() {
  const target = new URL(process.argv[2] || '');
  const records = Number(process.argv[3] || 1200);
  assert.ok(Number.isInteger(records) && records >= 1200 && records <= 12000, 'Use 1200 to 12000 records.');
  const last = records - 2;
  const backgroundIndex = process.argv.indexOf('--background-records');
  const backgroundRecords = backgroundIndex < 0 ? records : Number(process.argv[backgroundIndex + 1]);
  assert.ok(Number.isInteger(backgroundRecords) && backgroundRecords >= 1200 && backgroundRecords <= 12000,
    'Use 1200 to 12000 background records.');
  const backgroundLast = backgroundRecords - 2;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !target.port || target.port === '8080') {
    throw new Error('Use an explicit separate loopback test server, e.g. http://127.0.0.1:8081/v1.');
  }
  const health = await fetch(new URL('/health', target));
  assert.equal(health.status, 200, 'Test engine must be ready.');
  const models = await (await fetch(new URL('/v1/models', target))).json();
  const model = models.data[0].id;
  const nonce = randomUUID();
  const history = (letter, count = records) => {
    const rows = Array.from({ length: count }, (_, n) => `Record ${n}: value ${letter}${String(n).padStart(4, '0')}.`);
    return [{ role: 'user', content: `${nonce} Document ${letter}\n${rows.join('\n')}\nReturn only the values for records 1 and ${count - 2}, separated by a space.` }];
  };
  const a = history('A'), b = history('B', backgroundRecords);
  const body = messages => ({ model, messages, temperature: 0, top_k: 1, max_completion_tokens: 48, chat_template_kwargs: { enable_thinking: false } });
  const request = async (label, messages) => {
    const started = Date.now();
    const answer = await streamChat({ baseUrl: target.href, body: body(messages), signal: AbortSignal.timeout(600000) });
    const result = { label, text: answer.content, prompt: answer.usage.prompt_tokens,
      cached: answer.usage.prompt_tokens_details?.cached_tokens || 0, milliseconds: Date.now() - started };
    console.log(JSON.stringify(result));
    return result;
  };
  {
    const cold = await request('A cold', a);
    const other = await request('B cold', b);
    const restored = await request('A restored', a);
    for (const result of [cold, restored]) {
      assert.match(result.text, /A0001/);
      assert.ok(result.text.includes(`A${String(last).padStart(4, '0')}`));
    }
    assert.match(other.text, /B0001/);
    assert.ok(other.text.includes(`B${String(backgroundLast).padStart(4, '0')}`));
    assert.ok(cold.cached < cold.prompt * 0.1, 'New A must be cold.');
    assert.ok(other.cached < other.prompt * 0.1, 'Independent B must be cold.');
    assert.ok(restored.cached >= cold.prompt * 0.95, 'Returning to A must reuse its parked history.');
    if (process.argv.includes('--cancel')) {
      const cancellation = new AbortController();
      const timer = setTimeout(() => cancellation.abort(), 2000);
      try {
        await streamChat({ baseUrl: target.href, body: body(history('C', backgroundRecords)), signal: cancellation.signal });
        assert.fail('The deliberately interrupted request must abort.');
      } catch (error) {
        assert.equal(error.code, 'aborted');
      } finally { clearTimeout(timer); }
      const afterB = await request('B after cancellation', b);
      const afterA = await request('A after cancellation', a);
      assert.ok(afterB.text.includes('B0001') && afterB.text.includes(`B${String(backgroundLast).padStart(4, '0')}`));
      assert.ok(afterA.text.includes('A0001') && afterA.text.includes(`A${String(last).padStart(4, '0')}`));
      assert.ok(afterB.cached >= other.prompt * 0.95 && afterA.cached >= cold.prompt * 0.95,
        'Both parked conversations must survive interrupted prefill.');
    }
    console.log('PASS: conversation parking through the Little Bot engine.');
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
