'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { probeLocal } = require('../src/connections.cjs');

async function serverFor(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(data.length) });
  res.end(data);
}

for (const propsAvailable of [false, true]) test(`probeLocal detects Strata with /props ${propsAvailable ? 'available' : 'absent'}`, async t => {
  const model = 'qwen3.8-flash-next-iq2_xs';
  const fixture = await serverFor((req, res) => {
    if (req.url === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: model, object: 'model' }] });
    if (req.url === '/props') return propsAvailable
      ? json(res, 200, { build_info: 'Strata 0.1.27', default_generation_settings: { n_ctx: 262144 }, modalities: { vision: true } })
      : json(res, 404, { error: { message: 'not found' } });
    if (req.url === '/health') return json(res, 200, {
      status: 'ok', model, max_context: 262144, images: true, api_key: false,
    });
    json(res, 404, { error: { message: 'not found' } });
  });
  t.after(fixture.close);

  const result = await probeLocal({ localBaseUrl: fixture.baseUrl, localModel: model });
  assert.equal(result.connection.adapter, 'strata');
  assert.equal(result.connection.contextWindow, 262144);
  assert.equal(result.connection.vision, true);
  assert.equal(result.models[0].vision, true);
});

test('probeLocal leaves the existing llama.cpp props path unchanged', async t => {
  const model = 'existing-qwen';
  let healthHits = 0;
  const fixture = await serverFor((req, res) => {
    if (req.url === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: model, object: 'model' }] });
    if (req.url === '/props') return json(res, 200, {
      default_generation_settings: { n_ctx: 147456 }, modalities: { vision: true },
    });
    if (req.url === '/health') { healthHits += 1; return json(res, 500, { error: 'should not be called' }); }
    json(res, 404, { error: { message: 'not found' } });
  });
  t.after(fixture.close);

  const result = await probeLocal({ localBaseUrl: fixture.baseUrl, localModel: model });
  assert.equal(Object.hasOwn(result.connection, 'adapter'), false);
  assert.equal(result.connection.contextWindow, 147456);
  assert.equal(result.connection.vision, true);
  assert.equal(healthHits, 0);
});
