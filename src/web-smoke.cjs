'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

async function run({ window, controller, store, stateDir }) {
  assert.ok(process.env.LITTLE_BOT_DATA_DIR, 'Browser smoke must use an isolated profile.');
  const output = process.env.LITTLE_BOT_SMOKE_OUTPUT || path.join(stateDir, 'smoke');
  fs.mkdirSync(output, { recursive: true });
  const settings = await require('./web-settings-smoke.cjs').run({ window, controller, store, output });
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><html><head><title>Little Bot browser fixture</title></head><body><h1>Agent browser ready</h1><label>Name <input id="name"></label><button onclick="document.querySelector(\'output\').textContent=\'Hello \'+document.querySelector(\'input\').value">Greet</button><output>Waiting</output></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = controller.browser;
  const chat = { id: 'web-smoke', status: 'running' };
  const call = args => controller.agentTools.call('browser', args, { chat });
  try {
    assert.equal(browser.getState().available, true, 'An installed Chromium browser must be available for this smoke.');
    await call({ action: 'navigate', url: `http://127.0.0.1:${server.address().port}/` });
    const snapshot = await call({ action: 'snapshot' });
    const data = JSON.parse(snapshot.content);
    const inputRef = Object.keys(data.refs).find(key => data.refs[key].role === 'textbox');
    const buttonRef = Object.keys(data.refs).find(key => data.refs[key].name === 'Greet');
    assert.ok(inputRef && buttonRef, 'Browser must return real accessibility refs.');
    await call({ action: 'fill', ref: inputRef, text: 'Little Bot' });
    await call({ action: 'click', ref: buttonRef });
    const read = await call({ action: 'read' });
    assert.match(read.content, /Hello Little Bot/);
    const shot = await call({ action: 'screenshot' });
    assert.ok(fs.statSync(shot.screenshotPath).size > 100);
    fs.copyFileSync(shot.screenshotPath, path.join(output, 'agent-browser.png'));
    await assert.rejects(call({ action: 'navigate', url: 'file:///C:/Windows/win.ini' }), /http/);
    await assert.rejects(call({ action: 'eval', text: '1+1' }), /Invalid/);
    await assert.rejects(controller.agentTools.call('browser', { action: 'snapshot' }, { chat: { internal: true } }), /user conversation/);
    await assert.rejects(controller.agentTools.call('web_search_service', { query: 'fixture' }, { chat: { internal: true } }), /user conversation/);
    const specThread = await controller.client.request('thread/start', { cwd: store.data.settings.workspace, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: controller.agentTools.specs() });
    assert.ok(specThread.thread?.id, 'The pinned engine must accept the browser/service schemas.');
    await controller.client.request('thread/unsubscribe', { threadId: specThread.thread.id });
    console.log(JSON.stringify({ web: true, settings, browser: 'agent-browser 0.38.1', navigateSnapshotFillClickReadScreenshot: true, dynamicSchemasAccepted: true, livePaidServices: false }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { run };
