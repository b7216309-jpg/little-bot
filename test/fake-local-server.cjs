'use strict';
// A stand-in for the local model server's discovery endpoints, so controller tests never reach the real Strata.
const http = require('node:http');

async function fakeLocalServer({ model = 'test-model', maxContext = 262144, images = true } = {}) {
  const server = http.createServer((request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.url === '/v1/models') return send(200, { object: 'list', data: [{ id: model, object: 'model' }] });
    if (request.url === '/health') return send(200, { status: 'ok', model, max_context: maxContext, images, api_key: false, service: 'strata' });
    return send(404, { error: 'Not found.' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

module.exports = { fakeLocalServer };
