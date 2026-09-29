'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const plugin = require(path.join(__dirname, '..', 'examples', 'github-tools', 'server.cjs'));

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function close(server) { return new Promise(resolve => server.close(resolve)); }
function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

async function withApi(handler, run) {
  const previousUrl = process.env.GITHUB_API_URL;
  const previousToken = process.env.GITHUB_TOKEN;
  const previousGh = process.env.GH_TOKEN;
  const server = await listen(handler);
  const address = server.address();
  process.env.GITHUB_API_URL = `http://127.0.0.1:${address.port}`;
  try { return await run(); }
  finally {
    if (previousUrl === undefined) delete process.env.GITHUB_API_URL; else process.env.GITHUB_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previousToken;
    if (previousGh === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = previousGh;
    await close(server);
  }
}

test('GitHub plugin exposes annotated read and write tools', () => {
  const names = new Set(plugin.TOOLS.map(tool => tool.name));
  assert.ok(names.has('github_read_file'));
  assert.ok(names.has('github_create_issue'));
  assert.equal(plugin.TOOLS.find(tool => tool.name === 'github_read_file').annotations.readOnlyHint, true);
  assert.equal(plugin.TOOLS.find(tool => tool.name === 'github_create_issue').annotations.destructiveHint, true);
});

test('github_get_repository sends a bearer token when configured', async () => {
  await withApi((req, res) => {
    assert.equal(req.url, '/repos/octo/demo');
    assert.equal(req.headers.authorization, 'Bearer secret-test-token');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ full_name: 'octo/demo', private: true, default_branch: 'main', html_url: 'https://github.test/octo/demo', permissions: { push: true } }));
  }, async () => {
    process.env.GITHUB_TOKEN = 'secret-test-token';
    const result = await plugin.callTool('github_get_repository', { owner: 'octo', repo: 'demo' });
    assert.deepEqual(result, {
      full_name: 'octo/demo', private: true, description: undefined, default_branch: 'main', archived: undefined,
      visibility: undefined, html_url: 'https://github.test/octo/demo', updated_at: undefined, permissions: { push: true },
    });
  });
});

test('github_read_file decodes UTF-8 content', async () => {
  await withApi((req, res) => {
    assert.equal(req.url, '/repos/octo/demo/contents/docs/readme.md?ref=feature%2Fone');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ type: 'file', path: 'docs/readme.md', sha: 'abc123', encoding: 'base64', content: Buffer.from('hello GitHub\n', 'utf8').toString('base64') }));
  }, async () => {
    const result = await plugin.callTool('github_read_file', { owner: 'octo', repo: 'demo', path: 'docs/readme.md', ref: 'feature/one' });
    assert.equal(result.content, 'hello GitHub\n');
    assert.equal(result.sha, 'abc123');
  });
});

test('github_create_issue requires a token before making a request', async () => {
  await withApi((_req, res) => {
    res.statusCode = 500;
    res.end('should not be reached');
  }, async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    await assert.rejects(() => plugin.callTool('github_create_issue', { owner: 'octo', repo: 'demo', title: 'Test' }), /requires GITHUB_TOKEN or GH_TOKEN/);
  });
});

test('github_create_issue posts expected JSON', async () => {
  await withApi(async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/repos/octo/demo/issues');
    assert.equal(req.headers.authorization, 'Bearer write-token');
    assert.deepEqual(await body(req), { title: 'A bug', body: 'Details', labels: ['bug'] });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ number: 7, title: 'A bug', state: 'open', html_url: 'https://github.test/octo/demo/issues/7', user: { login: 'octo' }, labels: [{ name: 'bug' }], assignees: [], body: 'Details' }));
  }, async () => {
    process.env.GITHUB_TOKEN = 'write-token';
    const result = await plugin.callTool('github_create_issue', { owner: 'octo', repo: 'demo', title: 'A bug', body: 'Details', labels: ['bug'] });
    assert.equal(result.number, 7);
    assert.deepEqual(result.labels, ['bug']);
  });
});

test('github_create_or_update_file preserves exact UTF-8 content', async () => {
  await withApi(async (req, res) => {
    assert.equal(req.method, 'PUT');
    assert.equal(req.url, '/repos/octo/demo/contents/notes.txt');
    const payload = await body(req);
    assert.equal(Buffer.from(payload.content, 'base64').toString('utf8'), '  keep leading\n\nand trailing  \n');
    assert.equal(payload.message, 'Update notes');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ content: { path: 'notes.txt', sha: 'newsha' }, commit: { sha: 'commitsha', message: 'Update notes' } }));
  }, async () => {
    process.env.GITHUB_TOKEN = 'write-token';
    const result = await plugin.callTool('github_create_or_update_file', {
      owner: 'octo', repo: 'demo', path: 'notes.txt', content: '  keep leading\n\nand trailing  \n', message: 'Update notes',
    });
    assert.equal(result.content.sha, 'newsha');
  });
});

test('github_create_branch resolves the source commit and creates the ref', async () => {
  const calls = [];
  await withApi(async (req, res) => {
    calls.push([req.method, req.url]);
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ sha: 'abc123' }));
    assert.deepEqual(await body(req), { ref: 'refs/heads/feature/github', sha: 'abc123' });
    res.statusCode = 201;
    res.end(JSON.stringify({ ref: 'refs/heads/feature/github', object: { sha: 'abc123' }, url: 'https://api.github.test/ref' }));
  }, async () => {
    process.env.GITHUB_TOKEN = 'write-token';
    const result = await plugin.callTool('github_create_branch', { owner: 'octo', repo: 'demo', branch: 'feature/github', from: 'main' });
    assert.deepEqual(calls, [['GET', '/repos/octo/demo/commits/main'], ['POST', '/repos/octo/demo/git/refs']]);
    assert.equal(result.ref, 'refs/heads/feature/github');
  });
});
