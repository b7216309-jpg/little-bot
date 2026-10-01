'use strict';

// Explicitly target a separate server: these requests replace parked histories.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { LocalModelRelay } = require('../../src/local-model-relay.cjs');

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
  const relay = new LocalModelRelay({ thinking: () => false });
  await relay.start();
  try {
    const endpoint = relay.endpoint(target.href, 'strata');
    const nonce = randomUUID();
    const history = (letter, count = records) => {
      const rows = Array.from({ length: count }, (_, n) => `Record ${n}: value ${letter}${String(n).padStart(4, '0')}.`);
      return [
        { type: 'message', role: 'user', content: `${nonce} Document ${letter}\n${rows.join('\n')}\nReturn only the values for records 1 and ${count - 2}, separated by a space.` },
      ];
    };
    const a = history('A'), b = history('B', backgroundRecords);
    const request = async (label, input) => {
      const started = Date.now();
      const response = await fetch(`${endpoint}/responses`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input, temperature: 0, top_k: 1, max_output_tokens: 48 }),
        signal: AbortSignal.timeout(600000),
      });
      assert.equal(response.status, 200);
      const events = (await response.text()).split(/\r?\n/).filter(line => line.startsWith('data: '))
        .map(line => JSON.parse(line.slice(6)));
      assert.ok(!events.some(event => event.type === 'response.failed'), 'Generation must complete.');
      const completed = events.find(event => event.type === 'response.completed');
      assert.ok(completed, 'Responses completion event required.');
      const text = events.filter(event => event.type === 'response.output_text.delta').map(event => event.delta).join('');
      const usage = completed.response.usage;
      const result = { label, text, prompt: usage.input_tokens,
        cached: usage.input_tokens_details.cached_tokens, milliseconds: Date.now() - started };
      console.log(JSON.stringify(result));
      return result;
    };
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
        const response = await fetch(`${endpoint}/responses`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, input: history('C', backgroundRecords), temperature: 0, top_k: 1, max_output_tokens: 128 }),
          signal: cancellation.signal,
        });
        await response.text();
        assert.fail('The deliberately interrupted request must abort.');
      } catch (error) {
        assert.equal(error.name, 'AbortError');
      } finally { clearTimeout(timer); }
      const afterB = await request('B after cancellation', b);
      const afterA = await request('A after cancellation', a);
      assert.ok(afterB.text.includes('B0001') && afterB.text.includes(`B${String(backgroundLast).padStart(4, '0')}`));
      assert.ok(afterA.text.includes('A0001') && afterA.text.includes(`A${String(last).padStart(4, '0')}`));
      assert.ok(afterB.cached >= other.prompt * 0.95 && afterA.cached >= cold.prompt * 0.95,
        'Both parked conversations must survive interrupted prefill.');
    }
    console.log('PASS: conversation parking through the Little Bot Responses relay.');
  } finally {
    await relay.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
