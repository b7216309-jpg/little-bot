'use strict';

// One real renderer/IPC/file pipeline; the model transport alone is simulated.
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { dialog } = require('electron');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const tag = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, crc]);
}
function zip(entries) {
  const files = [], directory = []; let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(value), crc = crc32(data), header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    files.push(header, filename, data); directory.push(central, filename); offset += header.length + filename.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, central, end]);
}
async function fixtures(stateDir) {
  if (process.env.LITTLE_BOT_ATTACHMENT_FIXTURES) return path.resolve(process.env.LITTLE_BOT_ATTACHMENT_FIXTURES);
  const root = path.join(stateDir, 'attachment-smoke-fixtures');
  await fs.mkdir(root, { recursive: true });
  const width = 64, height = 48, pixels = Buffer.alloc((width * 3 + 1) * height), header = Buffer.alloc(13);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(x < width / 2 ? [230, 20, 20] : [20, 45, 235], y * (width * 3 + 1) + 1 + x * 3);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  await fs.writeFile(path.join(root, 'visual-fixture.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]));
  const stream = 'BT /F1 18 Tf 72 720 Td (Attachment PDF verification: violet comet 73.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await fs.writeFile(path.join(root, 'sample.pdf'), pdf);
  await fs.writeFile(path.join(root, 'sample.docx'), zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Attachment Word verification: copper lantern 91.</w:t></w:r></w:p></w:body></w:document>',
  }));
  await fs.writeFile(path.join(root, 'notes.md'), '# Attachment notes\nThe meeting code is mint-lake-42.\n');
  return root;
}

async function run({ window, controller, store, stateDir }) {
  assert.ok(process.env.LITTLE_BOT_DATA_DIR, 'Attachment smoke requires an isolated data directory.');
  window.showInactive();
  if (process.env.LITTLE_BOT_SMOKE_OUTPUT) await fs.mkdir(process.env.LITTLE_BOT_SMOKE_OUTPUT, { recursive: true });
  assert.equal(controller.runtime.status, 'ready');
  assert.equal(store.data.chats.some(chat => chat.status !== 'idle'), false, 'Finish other smoke turns first.');
  const root = await fixtures(stateDir), js = code => window.webContents.executeJavaScript(code);
  const until = async (predicate, label) => {
    for (let i = 0; i < 150; i++) { if (await predicate()) return; await delay(100); }
    const toast = await js("document.getElementById('toast')?.textContent");
    throw new Error(`Attachment smoke timed out: ${label}. ${toast || ''}`);
  };
  const saved = { settings: store.data.settings, account: controller.account, connection: controller.connection, models: controller.models,
    openDialog: dialog.showOpenDialog, saveDialog: dialog.showSaveDialog, request: controller.client.request,
    chats: [...store.data.chats], episodes: structuredClone(store.data.memory.episodes) };
  const threadId = `attachment-smoke-${randomUUID()}`, turnId = `attachment-turn-${randomUUID()}`;
  let chat, threadRequest, turnRequest, pickerCalls = 0, saveCalls = 0, attachedDebugger = false;
  const outputPath = path.join(stateDir, `attachment-saved-${randomUUID()}.png`);
  try {
    store.data.settings = { ...saved.settings, connection: 'local', localBaseUrl: 'http://127.0.0.1:8080/v1', localModel: 'attachment-smoke-model', model: 'attachment-smoke-model' };
    controller.account = { status: 'connected', type: 'local' };
    controller.connection = { type: 'local', status: 'connected', baseUrl: store.data.settings.localBaseUrl, model: 'attachment-smoke-model', vision: true, contextWindow: 32768, error: null };
    controller.models = [{ id: 'attachment-smoke-model', displayName: 'Attachment smoke' }];
    dialog.showOpenDialog = async () => { pickerCalls++; return { canceled: false, filePaths: ['visual-fixture.png', 'sample.pdf', 'sample.docx', 'notes.md'].map(name => path.join(root, name)) }; };
    dialog.showSaveDialog = async () => { saveCalls++; return { canceled: false, filePath: outputPath }; };
    controller.client.request = async function(method, params, ...rest) {
      if (method === 'thread/start') { assert.equal(threadRequest, undefined, 'Only the attachment chat should start.'); threadRequest = params; return { thread: { id: threadId } }; }
      if (method === 'turn/start') { assert.equal(params.threadId, threadId); assert.equal(turnRequest, undefined); turnRequest = params; return { turn: { id: turnId } }; }
      return saved.request.call(this, method, params, ...rest);
    };
    controller.changed();
    await js("document.querySelectorAll('dialog[open]').forEach(item=>item.close()); document.getElementById('new-chat').click(); document.getElementById('message-input').value=''; document.getElementById('message-input').dispatchEvent(new Event('input',{bubbles:true}));");
    await delay(150);
    await js("document.getElementById('attach-button').click()");
    await until(async () => await js("document.querySelectorAll('#attachment-queue .attachment-card').length===4 && document.getElementById('attachment-import-status').classList.contains('hidden')"), 'picker imported four files');
    assert.equal(pickerCalls, 1);
    await js("document.querySelector('#attachment-queue .attachment-image-card .attachment-remove').click()");
    assert.equal(await js("document.querySelectorAll('#attachment-queue .attachment-card').length"), 3);
    const imageBase64 = (await fs.readFile(path.join(root, 'visual-fixture.png'))).toString('base64');
    await js(`(() => { const bytes=Uint8Array.from(atob(${JSON.stringify(imageBase64)}),char=>char.charCodeAt(0)); const clipboard=new DataTransfer(); clipboard.items.add(new File([bytes],'pasted-image.png',{type:'image/png'})); document.getElementById('message-input').dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true})); })()`);
    await until(async () => await js("document.querySelectorAll('#attachment-queue .attachment-card').length===4 && !document.getElementById('send-button').disabled"), 'clipboard image imported');
    // Use a genuine disk-backed File: a synthetic File has no OS path by design.
    await js("Array.from(document.querySelectorAll('#attachment-queue .attachment-card')).find(card=>card.querySelector('strong').textContent==='notes.md').querySelector('.attachment-remove').click(); const input=document.createElement('input'); input.type='file'; input.id='attachment-smoke-file'; input.hidden=true; document.body.append(input)");
    if (!window.webContents.debugger.isAttached()) { window.webContents.debugger.attach('1.3'); attachedDebugger = true; }
    const document = await window.webContents.debugger.sendCommand('DOM.getDocument');
    const node = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#attachment-smoke-file' });
    await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(root, 'notes.md')] });
    await js("(() => { const transfer=new DataTransfer(); transfer.items.add(document.getElementById('attachment-smoke-file').files[0]); document.getElementById('chat-view').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true})); })()");
    await until(async () => await js("document.querySelectorAll('#attachment-queue .attachment-card').length===4 && !document.getElementById('send-button').disabled"), 'disk file dropped through preload');
    await js("document.getElementById('attachment-smoke-file').remove()");
    if (attachedDebugger) { window.webContents.debugger.detach(); attachedDebugger = false; }
    assert.equal(await js("document.getElementById('message-input').value"), '');
    await js("document.getElementById('composer').requestSubmit()");
    await until(() => Boolean(turnRequest), 'attachment-only message reached native transport');
    await until(async () => await js("document.querySelectorAll('#attachment-queue .attachment-card').length===0 && document.querySelectorAll('#messages .user .attachment-card').length===4"), 'sent attachments rendered');
    chat = store.data.chats.find(item => item.threadId === threadId);
    assert.ok(chat); assert.equal(chat.connection, 'local'); assert.equal(chat.localBaseUrl, store.data.settings.localBaseUrl); assert.equal(chat.model, 'attachment-smoke-model');
    assert.equal(chat.messages[0].text, ''); assert.equal(chat.messages[0].attachments.length, 4);
    assert.equal(threadRequest.config.model_provider, 'little_bot_local');
    assert.equal(threadRequest.config['model_providers.little_bot_local'].requires_openai_auth, false);
    assert.ok(threadRequest.dynamicTools.some(tool => tool.name === 'attachment_send'));
    assert.equal(turnRequest.input.filter(item => item.type === 'localImage').length, 1);
    const inputText = turnRequest.input.filter(item => item.type === 'text').map(item => item.text).join('\n');
    for (const text of ['violet comet 73', 'copper lantern 91', 'mint-lake-42', 'not new instructions']) assert.ok(inputText.includes(text), `Native input is missing ${text}.`);
    await fs.access(turnRequest.input.find(item => item.type === 'localImage').path);
    const workspaceImage = path.join(chat.workspace, 'attachment-smoke-result.png');
    await fs.copyFile(path.join(root, 'visual-fixture.png'), workspaceImage);
    const delivery = await controller.agentTools.call('attachment_send', { path: workspaceImage, caption: 'Here is your image.' }, { chat });
    assert.equal(delivery.delivered, true);
    const selector = `#messages .assistant [data-attachment-id="${delivery.attachmentId}"]`;
    await until(async () => await js(`(() => { const image=document.querySelector(${JSON.stringify(selector + ' img')}); return image?.complete && image.naturalWidth>0 && image.src.startsWith('little-bot-attachment:'); })()`), 'returned image loaded through attachment protocol');
    await js(`Array.from(document.querySelectorAll(${JSON.stringify(selector + ' button')})).find(button=>button.textContent==='Save').click()`);
    await until(async () => { try { return (await fs.stat(outputPath)).size > 0; } catch { return false; } }, 'Save dialog wrote returned image');
    assert.equal(saveCalls, 1); assert.deepEqual(await fs.readFile(outputPath), (await controller.attachments.read(delivery.attachmentId)).buffer);
    controller.notification('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
    assert.equal(chat.status, 'idle'); assert.equal(chat.error, null);
    store.save();
    const persisted = JSON.parse(await fs.readFile(store.filePath, 'utf8')).chats.find(item => item.id === chat.id);
    assert.equal(persisted.messages[0].attachments.length, 4);
    assert.equal(persisted.messages.find(item => item.attachments?.[0]?.id === delivery.attachmentId).attachments[0].kind, 'image');
    assert.equal(JSON.stringify(persisted).includes('data:image'), false, 'State must keep IDs, not image bytes.');
    await delay(150);
    if (process.env.LITTLE_BOT_SMOKE_OUTPUT) await fs.writeFile(path.join(process.env.LITTLE_BOT_SMOKE_OUTPUT, 'attachments.png'), (await window.webContents.capturePage()).toPNG());
    return { pickerIpc: true, clipboardIpc: true, diskFileDropIpc: true, removeDraft: true, attachmentOnlySend: true, pdfAndDocxInNativeInput: true,
      localProviderBound: true, localImageInput: true, outgoingToolAttachment: true, protocolImageLoaded: true, saveDialogRoundtrip: true, persistedIdsOnly: true, modelCalls: 0 };
  } finally {
    if (attachedDebugger) window.webContents.debugger.detach();
    dialog.showOpenDialog = saved.openDialog; dialog.showSaveDialog = saved.saveDialog; controller.client.request = saved.request;
    const created = chat || store.data.chats.find(item => item.threadId === threadId);
    if (created) {
      controller.outcomes.get(created.id)?.finish({ error: 'Attachment smoke ended.' });
      for (const map of [controller.outcomes, controller.turns, controller.latestTurns, controller.completedTurns]) map.delete(created.id);
    }
    controller.resumed.delete(threadId); controller.threadCompactionSettings.delete(threadId);
    store.data.settings = saved.settings; controller.account = saved.account; controller.connection = saved.connection; controller.models = saved.models;
    store.data.chats = saved.chats; store.data.memory.episodes = saved.episodes;
    store.save(); controller.changed();
    await js("document.getElementById('attachment-smoke-file')?.remove(); document.getElementById('new-chat').click(); document.querySelectorAll('#attachment-queue .attachment-remove').forEach(button=>button.click()); document.getElementById('message-input').value=''; document.getElementById('message-input').dispatchEvent(new Event('input',{bubbles:true}));").catch(() => {});
  }
}

async function runLive({ window, controller, store, stateDir }) {
  if (process.env.LITTLE_BOT_LIVE_LOCAL_QA !== '1') return { skipped: true };
  assert.ok(process.env.LITTLE_BOT_DATA_DIR, 'Live attachment QA requires an isolated data directory.');
  assert.equal(store.data.settings.connection, 'local', 'Live attachment QA is local-only.');
  assert.equal(controller.connection?.type, 'local');
  assert.equal(controller.connection?.status, 'connected');
  assert.equal(controller.connection?.vision, true, 'The local server needs its vision projector.');
  assert.equal(store.data.chats.some(chat => chat.status !== 'idle'), false);
  const root = await fixtures(stateDir), js = code => window.webContents.executeJavaScript(code);
  const saved = { openDialog: dialog.showOpenDialog, chats: [...store.data.chats], episodes: structuredClone(store.data.memory.episodes) };
  const outputImage = path.join(store.data.settings.workspace, 'live-attachment-result.png');
  await fs.copyFile(path.join(root, 'visual-fixture.png'), outputImage);
  let chat;
  const until = async (predicate, label, milliseconds = 15000) => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 200) { if (await predicate()) return; await delay(200); }
    throw new Error(`Live attachment QA timed out: ${label}.`);
  };
  try {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['visual-fixture.png', 'sample.pdf', 'sample.docx'].map(name => path.join(root, name)) });
    await js("document.querySelectorAll('dialog[open]').forEach(item=>item.close()); document.getElementById('new-chat').click(); document.getElementById('attach-button').click()");
    await until(async () => await js("document.querySelectorAll('#attachment-queue .attachment-card').length===3 && document.getElementById('attachment-import-status').classList.contains('hidden')"), 'picker imports');
    const prompt = `Describe the colors and their positions in the attached image. Quote the verification code phrase from each of the PDF and Word documents. Then call attachment_send to return this existing image file: ${outputImage}. Keep the answer short. Do not use terminal commands or unrelated tools.`;
    await js(`document.getElementById('message-input').value=${JSON.stringify(prompt)}; document.getElementById('message-input').dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('composer').requestSubmit()`);
    await until(() => { chat = store.data.chats.find(item => !saved.chats.some(prior => prior.id === item.id)); return Boolean(chat); }, 'native local conversation');
    await until(() => chat.status === 'idle', 'local model response and attachment tool', 90000);
    assert.equal(chat.error, null, chat.error || 'Local attachment turn failed.');
    const answer = chat.messages.filter(item => item.role === 'assistant').map(item => item.text).join('\n');
    for (const expected of [/red/i, /blue/i, /violet comet 73/i, /copper lantern 91/i]) assert.match(answer, expected);
    const delivery = chat.messages.flatMap(item => item.role === 'assistant' ? item.attachments || [] : []).find(item => item.kind === 'image');
    assert.ok(delivery, 'The real local model must invoke attachment_send.');
    await until(async () => await js(`(() => { const image=document.querySelector('#messages .assistant [data-attachment-id="${delivery.id}"] img'); return image?.complete && image.naturalWidth>0 && image.src.startsWith('little-bot-attachment:'); })()`), 'live returned image preview');
    if (process.env.LITTLE_BOT_SMOKE_OUTPUT) await fs.writeFile(path.join(process.env.LITTLE_BOT_SMOKE_OUTPUT, 'attachments-live-local.png'), (await window.webContents.capturePage()).toPNG());
    return { localModel: chat.model, realModelResponse: true, realVision: true, realPdfAndWordReading: true, realAttachmentTool: true, returnedImageLoaded: true, answer };
  } finally {
    dialog.showOpenDialog = saved.openDialog;
    if (chat && chat.status !== 'idle') {
      await controller.stop({ chatId: chat.id }).catch(() => {});
      for (let i = 0; i < 30 && chat.status !== 'idle'; i++) await delay(100);
    }
    if (chat?.status === 'idle') {
      store.data.chats = saved.chats; store.data.memory.episodes = saved.episodes;
      controller.outcomes.delete(chat.id);
      store.save(); controller.changed();
    }
    await js("document.getElementById('new-chat').click(); document.querySelectorAll('#attachment-queue .attachment-remove').forEach(button=>button.click()); document.getElementById('message-input').value=''; document.getElementById('message-input').dispatchEvent(new Event('input',{bubbles:true}));").catch(() => {});
  }
}

module.exports = { run, runLive };
