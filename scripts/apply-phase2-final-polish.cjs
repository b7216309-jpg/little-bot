'use strict';

const fs = require('node:fs');

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); }
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }
function replaceOnce(file, before, after, label) {
  const source = read(file);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  write(file, source.replace(before, after));
}

replaceOnce('src/standing-intents.cjs',
  `      if (recovering && intent.lastStatus === 'queued') {`,
  `      if (recovering && ['matched', 'queued'].includes(intent.lastStatus)) {`,
  'standing-intent interrupted match recovery');

replaceOnce('src/renderer/standing-intents-panel.js',
  `    byId('standing-intent-debounce').value = String(Math.round((intent?.debounceMs || 30000) / 1000));`,
  `    byId('standing-intent-debounce').value = String(Math.round((intent ? intent.debounceMs : 30000) / 1000));`,
  'zero debounce editor');

replaceOnce('src/goals.cjs',
  `    this.forceRuns = new Set(); this.filePending = new Map(); this.stopReason = null;`,
  `    this.forceRuns = new Set(); this.filePending = new Map(); this.fileSessionBaselines = new Set(); this.stopReason = null;`,
  'goal session baseline state');
replaceOnce('src/goals.cjs',
  `    } else this.data.goals.push(goal);\n    this.changed(); return existing || goal;`,
  `    } else this.data.goals.push(goal);\n    this.fileSessionBaselines.delete(goal.id);\n    this.changed(); return existing || goal;`,
  'goal edit baseline reset');
replaceOnce('src/goals.cjs',
  `    this.data.goals = this.data.goals.filter(item => item.id !== id); this.forceRuns.delete(id); this.filePending.delete(id); this.changed(); return { ok: true };`,
  `    this.data.goals = this.data.goals.filter(item => item.id !== id); this.forceRuns.delete(id); this.filePending.delete(id); this.fileSessionBaselines.delete(id); this.changed(); return { ok: true };`,
  'goal removal baseline cleanup');
replaceOnce('src/goals.cjs',
  `  start() { if (this.timer) return; this.closing = false; this.timer = setInterval(() => this.wake(), 5000); this.timer.unref?.(); this.wake(); }`,
  `  start() { if (this.timer) return; this.closing = false; this.fileSessionBaselines.clear(); this.timer = setInterval(() => this.wake(), 5000); this.timer.unref?.(); this.wake(); }`,
  'goal foreground session reset');
replaceOnce('src/goals.cjs',
  `            const fingerprint = await files.fingerprintPaths(goal);\n            if (!goal.triggerFingerprint) { goal.triggerFingerprint = fingerprint; this.changed(); }\n            else if (fingerprint !== goal.triggerFingerprint) {`,
  `            const fingerprint = await files.fingerprintPaths(goal);\n            if (!this.fileSessionBaselines.has(goal.id)) {\n              this.fileSessionBaselines.add(goal.id);\n              goal.triggerFingerprint = fingerprint;\n              this.filePending.delete(goal.id);\n              this.changed();\n              continue;\n            }\n            if (!goal.triggerFingerprint) { goal.triggerFingerprint = fingerprint; this.changed(); }\n            else if (fingerprint !== goal.triggerFingerprint) {`,
  'goal closed-app file baseline');
replaceOnce('src/goals.cjs',
  `                this.emit('file.changed', goal, { paths: goal.trigger.paths, fingerprint, previousFingerprint: goal.triggerFingerprint },`,
  `                this.emit('file.changed', goal, { path: goal.trigger.paths[0] || '', paths: goal.trigger.paths, fingerprint, previousFingerprint: goal.triggerFingerprint },`,
  'file event primary watched path');

replaceOnce('test/standing-intents.test.cjs',
  `test('normalization omits invalid and duplicate persisted records and skips queued work after restart', () => {\n  const first = validateStandingIntent(input(), null, 1000);\n  first.lastStatus = 'queued';\n  const restored = normalizeStandingIntents({ intents: [first, { ...first }, { name: '' }] }, 2000, true);\n  assert.equal(restored.intents.length, 1);\n  assert.equal(restored.intents[0].lastStatus, 'skipped');\n  assert.match(restored.intents[0].lastError, /not replayed/);\n});`,
  `test('normalization omits invalid and duplicate records and skips interrupted matches after restart', () => {\n  for (const status of ['matched', 'queued']) {\n    const first = validateStandingIntent(input(), null, 1000);\n    first.lastStatus = status;\n    const restored = normalizeStandingIntents({ intents: [first, { ...first }, { name: '' }] }, 2000, true);\n    assert.equal(restored.intents.length, 1);\n    assert.equal(restored.intents[0].lastStatus, 'skipped');\n    assert.match(restored.intents[0].lastError, /not replayed/);\n  }\n});`,
  'standing-intent recovery test');

replaceOnce('test/standing-intents-panel.test.cjs',
  `  assert.match(panel, /Foreground only/);\n  assert.doesNotMatch(panel, /fetch\\(|WebSocket|http:\\/\\/|https:\\/\\//);`,
  `  assert.match(panel, /Foreground only/);\n  assert.match(panel, /intent \? intent\\.debounceMs : 30000/);\n  assert.doesNotMatch(panel, /fetch\\(|WebSocket|http:\\/\\/|https:\\/\\//);`,
  'panel zero debounce test');

write('test/goal-file-session.test.cjs', `'use strict';\n\nconst test = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs/promises');\nconst os = require('node:os');\nconst path = require('node:path');\nconst { GoalRunner } = require('../src/goals.cjs');\n\ntest('file-triggered goals baseline each foreground session and emit only later stable changes', async t => {\n  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'little-bot-file-session-'));\n  t.after(() => fs.rm(workspace, { recursive: true, force: true }));\n  await fs.writeFile(path.join(workspace, 'report.txt'), 'before');\n  const events = [];\n  let runs = 0;\n  const goal = {\n    id: 'goal-1', name: 'Watch report', status: 'queued', authorized: true, priority: 3, createdAt: 1,\n    workspace, connection: 'codex', dependsOn: [], pendingQuestion: null,\n    trigger: { type: 'files', intervalMinutes: 30, paths: ['report.txt'] },\n    triggerFingerprint: 'persisted-before-close',\n  };\n  const store = { data: { settings: { connection: 'codex' }, autonomy: { paused: false, goals: [goal] } }, save() {} };\n  const runner = new GoalRunner({\n    store, backupRoot: path.join(workspace, 'backups'), canRun: () => false,\n    run: async () => { runs++; return {}; }, onChange() {}, onAlert() {},\n    publish: event => { events.push(event); return { accepted: true }; },\n  });\n\n  await runner.tick();\n  assert.notEqual(goal.triggerFingerprint, 'persisted-before-close');\n  assert.equal(events.length, 0);\n  assert.equal(runs, 0);\n\n  await fs.writeFile(path.join(workspace, 'report.txt'), 'after with a different size');\n  await runner.tick();\n  const pending = runner.filePending.get(goal.id);\n  assert.ok(pending);\n  pending.at = Date.now() - 2000;\n  await runner.tick();\n\n  assert.equal(events.length, 1);\n  assert.equal(events[0].type, 'file.changed');\n  assert.equal(events[0].payload.path, 'report.txt');\n  assert.deepEqual(events[0].payload.paths, ['report.txt']);\n  assert.equal(runs, 0);\n});\n`);

write('test/standing-intents-fixture.html', `<!doctype html>\n<html><head><meta charset="utf-8"><title>Standing intents fixture</title></head>\n<body>\n  <section id="automations-view"><div id="automations-list"></div></section>\n  <script>\n    const fixtureState = {\n      standingIntents: { intents: [] },\n      eventRuntime: { status: 'running', bus: { queued: 0 }, standingIntentCount: 0, enabledStandingIntentCount: 0 },\n      autonomy: { goals: [{ id: 'goal-1', name: 'Review report', authorized: true }] },\n      automations: [{ id: 'automation-1', name: 'Daily report', authorized: true }],\n    };\n    window.bot = {\n      getState: async () => fixtureState,\n      onEvent: () => () => {},\n      saveStandingIntent: async payload => {\n        window.__savedIntent = payload;\n        fixtureState.standingIntents.intents = [{ ...payload, id: 'intent-1', createdAt: 1, updatedAt: 1, triggerCount: 0, lastStatus: 'never' }];\n        fixtureState.eventRuntime.standingIntentCount = 1;\n        fixtureState.eventRuntime.enabledStandingIntentCount = payload.enabled ? 1 : 0;\n        return fixtureState;\n      },\n      deleteStandingIntent: async () => fixtureState,\n      toggleStandingIntent: async () => fixtureState,\n    };\n  </script>\n  <script src="../src/renderer/standing-intents-ui.js"></script>\n  <script src="../src/renderer/standing-intents-panel.js"></script>\n</body></html>\n`);

write('test/standing-intents-electron.cjs', `'use strict';\n\nconst assert = require('node:assert/strict');\nconst path = require('node:path');\nconst { app, BrowserWindow } = require('electron');\n\nasync function run() {\n  await app.whenReady();\n  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });\n  try {\n    await window.loadFile(path.join(__dirname, 'standing-intents-fixture.html'));\n    const result = await window.webContents.executeJavaScript(\`\n      (async () => {\n        const wait = async predicate => {\n          for (let index = 0; index < 100; index++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }\n          throw new Error('Timed out waiting for Standing Intents UI.');\n        };\n        await wait(() => document.getElementById('create-standing-intent'));\n        const notice = document.getElementById('standing-intents-section').textContent.includes('Foreground only');\n        document.getElementById('create-standing-intent').click();\n        const dialog = document.getElementById('standing-intent-dialog');\n        const dialogOpen = dialog.open;\n        document.getElementById('standing-intent-name').value = 'Review CSV changes';\n        document.getElementById('standing-intent-event').value = 'file.changed';\n        document.getElementById('standing-intent-filter-path').value = 'path';\n        document.getElementById('standing-intent-filter-operator').value = 'glob';\n        document.getElementById('standing-intent-filter-value').value = 'reports/*.csv';\n        document.getElementById('standing-intent-action').value = 'goal.run';\n        document.getElementById('standing-intent-action').dispatchEvent(new Event('change', { bubbles: true }));\n        document.getElementById('standing-intent-target').value = 'goal-1';\n        document.getElementById('standing-intent-debounce').value = '0';\n        document.getElementById('standing-intent-form').requestSubmit();\n        await wait(() => window.__savedIntent && !dialog.open);\n        document.querySelector('.standing-intent-card-actions button').click();\n        return { notice, dialogOpen, saved: window.__savedIntent, editDebounce: document.getElementById('standing-intent-debounce').value, cards: document.querySelectorAll('.standing-intent-card').length };\n      })()\n    \`);\n    assert.equal(result.notice, true);\n    assert.equal(result.dialogOpen, true);\n    assert.equal(result.saved.debounceMs, 0);\n    assert.deepEqual(result.saved.when.filters, [{ path: 'payload.path', operator: 'glob', value: 'reports/*.csv' }]);\n    assert.deepEqual(result.saved.action, { type: 'goal.run', goalId: 'goal-1' });\n    assert.equal(result.editDebounce, '0');\n    assert.equal(result.cards, 1);\n    console.log(JSON.stringify(result));\n  } finally { window.destroy(); app.quit(); }\n}\n\nrun().catch(error => { console.error(error.stack || error); app.exit(1); });\n`);

replaceOnce('package.json',
  `    "test:electron": "electron test/agent-side-panel-electron.cjs && electron test/calendar-electron.cjs && electron test/chat-scroll-electron.cjs && electron test/slash-commands-electron.cjs",`,
  `    "test:electron": "electron test/agent-side-panel-electron.cjs && electron test/calendar-electron.cjs && electron test/chat-scroll-electron.cjs && electron test/slash-commands-electron.cjs && electron test/standing-intents-electron.cjs",`,
  'Electron test command');
