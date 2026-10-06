'use strict';
// README screenshots: the real app pages and phone page, rendered with fictional demo data.
// Nothing connects to an engine or model and no personal profile is read; all state lives in a temp folder.
//   npx electron scripts/readme-screenshots.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'little-bot-readme-'));
const SHOWN_FOLDER = 'D:\\Projects\\Fieldnotes';
app.setPath('userData', path.join(temp, 'electron'));
// Windows are opened one after another; closing one must not quit the app.
app.on('window-all-closed', () => {});
// English dates and labels in the README, whatever the PC language is.
app.commandLine.appendSwitch('lang', 'en-US');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function demoState() {
  const { Store } = require('../src/store.cjs');
  const { Controller } = require('../src/controller.cjs');
  const { GoalRunner } = require('../src/goals.cjs');
  const workspace = path.join(temp, 'Fieldnotes');
  fs.mkdirSync(workspace, { recursive: true });
  const store = new Store({ filePath: path.join(temp, 'state.json'), defaultWorkspace: workspace });
  const data = store.data, now = Date.now(), min = 60000, hour = 60 * min;
  const at = (hours, minutes = 0) => { const date = new Date(now); date.setHours(hours, minutes, 0, 0); return date.getTime(); };
  const model = 'qwen3.6-35b-a3b';
  Object.assign(data.settings, { workspace, connection: 'local', localModel: model, model, effort: 'medium', localThinking: true });
  const message = (id, role, text, createdAt, extra = {}) => ({ id, role, text, createdAt, workspace, status: 'completed', ...extra });
  data.chats = [{
    id: 'main', title: 'Conversation', workspace, status: 'idle', model, connection: 'local', mode: 'execute', toolMode: 'full', effort: 'medium',
    createdAt: now - 40 * 24 * hour, updatedAt: at(21, 52), context: { usedTokens: 61840, windowTokens: 262144, stale: false },
    messages: [
      message('u1', 'user', 'Is the Hades II patch out yet? I want to know before I start a run tonight.', at(18, 4)),
      message('t1', 'tool', 'web_search "Hades II patch notes"', at(18, 4), { kind: 'agentTool' }),
      message('t2', 'tool', 'browser open supergiantgames.com/news', at(18, 5), { kind: 'agentTool' }),
      message('a1', 'assistant', 'Yes. **Patch 1.2** landed this afternoon:\n\n- new Arcana cards and a reworked Hex system\n- the Chronos fight is easier on lower Fear levels\n- 1.4 GB on Steam\n\nIt is already downloading. Want me to tell you when it finishes?', at(18, 5)),
      message('u2', 'user', 'yes please. and remind me: my driving test is on friday at 9', at(18, 7)),
      message('a2', 'assistant', 'Done: the test is in your calendar for **Friday 09:00**, and I will check in with you the evening before.', at(18, 7)),
      message('m1', 'assistant', 'Prefers a heads-up the evening before important appointments.', at(18, 8), { kind: 'memory' }),
      message('h1', 'assistant', 'It is 21:40 and you have been in VS Code for three hours straight. Hades II finished updating a while ago. One run, then back to the bug with fresh eyes?', at(21, 40),
        { kind: 'heartbeat', heartbeatTopic: 'evening break', modelSeen: true, actions: [{ id: 'launch', label: '🎮 Launch Hades II', target: 'steam://rungameid/1145350' }] }),
      message('u3', 'user', 'haha ok, one run. how did you know the patch finished?', at(21, 46)),
      message('a3', 'assistant', 'I was keeping an eye on it for you. Good luck with Chronos. And before I forget: you said Friday’s test makes you nervous. Do you want a quick theory quiz tomorrow evening?', at(21, 46)),
    ],
  }, {
    id: 'quick', title: 'Quick session', private: true, workspace, status: 'idle', model, connection: 'local', mode: 'execute', toolMode: 'full',
    createdAt: at(17, 30), updatedAt: at(17, 31), messages: [
      message('q1', 'user', 'Rename every .jpeg in the trip photos folder to .jpg and tell me how many.', at(17, 30)),
      message('q2', 'tool', 'shell Get-ChildItem *.jpeg | Rename-Item -NewName { $_.Name -replace \x27\.jpeg$\x27, \x27.jpg\x27 }', at(17, 30), { kind: 'agentTool' }),
      message('q3', 'assistant', 'Done: **14 photos** renamed from `.jpeg` to `.jpg`. Nothing else in the folder was touched, and nothing from this session will be remembered.', at(17, 31)),
    ],
  }];
  data.companion = {
    lastDreamAt: at(3, 12), lastDreamError: null,
    dreams: [
      { id: 'd1', at: now - 25 * hour, day: '', diary: 'Quiet day. He spent the evening on the Fieldnotes importer and only stopped when I mentioned it was late. I like these focused days, but he forgets to eat.', learned: 0, intentions: 1 },
      { id: 'd2', at: at(3, 12), day: '', diary: 'He told me about the driving test today, almost in passing, but he came back to it twice, so it matters more than he says. Third late evening in a row on the same bug. I am glad Hades II pulled him away for a bit; he laughs more after a good run.', learned: 1, intentions: 2 },
    ],
    intentions: [
      { id: 'i1', text: 'Offer a short theory quiz before the driving test', why: 'He mentioned being nervous about it twice', trigger: { type: 'date', date: new Date(now + 2 * 24 * hour).toISOString().slice(0, 10) }, source: 'dream', createdAt: at(3, 12), expiresAt: now + 14 * 24 * hour, fires: 0, status: 'active' },
      { id: 'i2', text: 'Ask how the test went', why: 'Big moment for him', trigger: { type: 'topic', keywords: ['driving', 'test', 'permis'] }, source: 'dream', createdAt: at(3, 12), expiresAt: now + 14 * 24 * hour, fires: 1, lastOfferedAt: at(21, 46), status: 'active' },
      { id: 'i3', text: 'Suggest a proper dinner break when he codes past 21:00', why: 'Three late evenings in a row', trigger: { type: 'moment', moment: 'returned' }, source: 'chat', createdAt: now - 26 * hour, expiresAt: now + 20 * 24 * hour, fires: 0, status: 'active' },
    ],
  };
  data.calendar = { events: [{ id: 'e1', title: 'Driving test', startAt: (() => { const d = new Date(now + 3 * 24 * hour); d.setHours(9, 0, 0, 0); return d.getTime(); })(), allDay: false, createdAt: now, updatedAt: now }] };
  Object.assign(data.heartbeat, { enabled: true, initiative: 'wild', intervalMinutes: 90, startHour: 9, endHour: 23, workspace, model,
    checklist: 'Be a good companion: notice long sessions and late nights, follow up on what I mention, and suggest one fun thing when I need a break. Stay quiet when I am clearly busy.',
    lastRunAt: at(21, 40), lastStatus: 'alert', runsToday: 4,
    history: [
      { id: 'hb1', at: at(21, 40), status: 'alert', topic: 'evening break', summary: 'Three hours in VS Code at 21:40. Suggested one Hades II run now that the patch finished.', workspace, read: true },
      { id: 'hb2', at: at(19, 10), status: 'alert', topic: 'Hades II patch', summary: 'The Hades II 1.2 update finished downloading.', workspace, read: true },
    ],
    pulse: [{ at: at(14, 2), status: 'quiet', note: 'He is in a meeting window on the calendar; nothing worth interrupting.' }, { at: at(19, 10), status: 'alert', note: 'Patch finished downloading.' }, { at: at(21, 40), status: 'alert', note: 'Long coding session, late, and a fun option is ready.' }] });
  const runner = new GoalRunner({ store, backupRoot: path.join(temp, 'goal-backups'), run: async () => { throw new Error('Demo only.'); } });
  const base = { kind: 'ongoing', contractVersion: 2, permissions: { write: true, writePaths: ['state'], shell: false, network: false, mcpTools: [] },
    limits: { maxTokens: 400000, maxMinutes: 60, maxActions: 80, maxRuns: 2, maxRetries: 1 }, respectActiveHours: true, workspace,
    sources: { chat: true, calendar: true, files: [] }, reviewPolicy: 'changes', maxQuietHours: 24 };
  runner.save({ ...base, name: 'Healthy rhythm', priority: 2, trigger: { type: 'interval', intervalMinutes: 180 }, objective: 'Notice very late sessions or long stretches without breaks and say one light, useful thing about it.' });
  runner.save({ ...base, name: 'Driving test ready', priority: 3, trigger: { type: 'interval', intervalMinutes: 720 }, objective: 'Help me feel ready for Friday’s driving test with short, low-pressure practice.' });
  runner.save({ ...base, name: 'English practice', priority: 4, trigger: { type: 'interval', intervalMinutes: 10080 }, objective: 'Once a week, pick one thing from my real English messages and explain it kindly.' });
  const progress = {
    'Healthy rhythm': ['Two late evenings this week. Suggested a dinner break on Tuesday and he took it.', 'Check around 22:00 whether he is still coding.'],
    'Driving test ready': ['Practised roundabouts and priority rules; he is unsure about motorway merges.', 'Offer five merge questions tomorrow evening.'],
    'English practice': ['Explained "I am agree" vs "I agree" from his Discord messages.', 'Pick one phrasal verb from this week.'],
  };
  for (const goal of data.autonomy.goals) Object.assign(goal, { authorized: true, status: 'queued', nextRunAt: now + 2 * hour, lastRunAt: now - 5 * hour,
    checkpoint: progress[goal.name][0], nextStep: progress[goal.name][1] });
  data.automations = [{ id: 'a1', name: 'Friday bathroom reminder', prompt: 'Remind me to clean the bathroom.', workspace, enabled: true, scheduleType: 'clock', clockTime: '18:00', daysOfWeek: [5], intervalMinutes: 60, connection: 'local', model, createdAt: now, updatedAt: now }];

  const controller = new Controller({ store, client: { on() {}, request: async () => ({}) } });
  controller.runtime = { status: 'ready' }; controller.account = { status: 'connected', type: 'local' };
  controller.connection = { type: 'local', status: 'connected', label: 'Local Qwen', adapter: 'strata', model, contextWindow: 262144, vision: false };
  controller.models = [{ id: model, displayName: 'Qwen 3.6 35B · local' }];
  const state = controller.state();
  state.demoRecords = [
    { id: 'r1', type: 'preference', scope: 'global', pinned: true, text: 'Prefers short, direct answers in the morning.', createdAt: now - 9 * 24 * hour, updatedAt: now - 9 * 24 * hour },
    { id: 'r2', type: 'preference', scope: 'global', text: 'Prefers a heads-up the evening before important appointments.', createdAt: at(18, 8), updatedAt: at(18, 8) },
    { id: 'r3', type: 'fact', scope: 'global', text: 'Plays Hades II and Outer Wilds; likes one run as a break from coding.', createdAt: now - 4 * 24 * hour, updatedAt: now - 4 * 24 * hour },
  ];
  store.close();
  // Show a neutral project folder instead of the temp path.
  return JSON.parse(JSON.stringify(state).split(JSON.stringify(workspace).slice(1, -1)).join(JSON.stringify(SHOWN_FOLDER).slice(1, -1)));
}

async function page({ stateFile, theme = 'dark', mode = 'full', width = 1400, height = 880, transparent = false, zoom = 1 }) {
  const window = new BrowserWindow({ show: false, width, height, transparent, frame: !transparent, backgroundColor: transparent ? '#00000000' : undefined,
    webPreferences: { preload: path.join(__dirname, 'readme-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false, zoomFactor: zoom,
      additionalArguments: [`--readme-state=${stateFile}`, `--readme-theme=${theme}`, `--readme-mode=${mode}`] } });
  // A fresh window occasionally reports a failed first load on Windows; one retry is enough.
  for (let attempt = 0; ; attempt++) {
    try { await window.loadFile(path.join(root, 'src', 'renderer', 'index.html')); break; }
    catch (error) { if (attempt) throw error; await wait(500); }
  }
  await wait(900);
  return window;
}
const run = (window, code) => window.webContents.executeJavaScript(code);
async function shot(window, name, setup = '') {
  if (setup) await run(window, `${setup}; true`);
  await wait(600);
  const visible = await run(window, 'document.body.innerText');
  if (/AppData|little-bot-readme-|Users[\\/]|Aezaror/i.test(visible)) throw new Error(`Personal or temporary path visible in ${name}`);
  // A hidden window can hand back its previous frame; the first capture forces a fresh paint.
  await window.webContents.capturePage();
  await wait(250);
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(out, `${name}.png`), image.toPNG());
  return path.join(out, `${name}.png`);
}

async function phoneShot(state) {
  const { Relay } = require('../src/relay.cjs');
  const relay = new Relay({ file: path.join(temp, 'relay.json'), protector: { encryptString: value => Buffer.from(value), decryptString: buffer => buffer.toString() },
    getState: () => state, tailscale: async () => ({ ok: false, stdout: '' }), handlers: {}, host: '127.0.0.1' });
  relay.config.port = 8796;
  await relay.setEnabled(true);
  try {
    const { pairing } = relay.startPairing();
    const code = new URL(pairing.url).hash.replace('#pair=', '');
    const window = new BrowserWindow({ show: false, width: 780, height: 1688, webPreferences: { backgroundThrottling: false, zoomFactor: 2 } });
    await window.loadURL(`http://127.0.0.1:8796/#pair=${code}`);
    await wait(700);
    await run(window, `document.getElementById('pair-name').value = 'Phone'; document.getElementById('pair-form').requestSubmit(); true`);
    await wait(2000);
    return await shot(window, 'phone');
  } finally { await relay.stop().catch(() => {}); }
}

async function hero(files) {
  const url = file => `file:///${file.replace(/\\/g, '/')}`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:1600px;height:900px;overflow:hidden;background:radial-gradient(1200px 600px at 20% 10%,#3a3226 0%,#1b1a16 55%,#121210 100%);font-family:Georgia,serif}
    .desk{position:absolute;left:60px;top:70px;width:1180px;border-radius:14px;box-shadow:0 30px 80px #000a,0 0 0 1px #ffffff14;overflow:hidden}
    .desk img{display:block;width:100%}
    .phone{position:absolute;right:80px;top:120px;width:310px;border-radius:38px;padding:10px;background:#0c0c0b;box-shadow:0 30px 70px #000c,0 0 0 1px #ffffff22}
    .phone img{display:block;width:100%;border-radius:30px}
  </style><div class="desk"><img src="${url(files.desk)}"></div><div class="phone"><img src="${url(files.phone)}"></div>`;
  const file = path.join(temp, 'hero.html');
  fs.writeFileSync(file, html);
  const window = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { backgroundThrottling: false } });
  await window.loadFile(file);
  await wait(800);
  fs.writeFileSync(path.join(out, 'hero.png'), (await window.webContents.capturePage()).toPNG());
}

(async () => {
  await app.whenReady();
  fs.mkdirSync(out, { recursive: true });
  for (const name of fs.readdirSync(out)) if (name.endsWith('.png')) fs.unlinkSync(path.join(out, name));
  const state = demoState();
  const stateFile = path.join(temp, 'demo-state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state));

  const dark = await page({ stateFile });
  const files = {};
  files.desk = await shot(dark, 'conversation', `document.getElementById('nav-conversation').click(); scrollChatToBottom()`);
  await shot(dark, 'night-thoughts', `document.getElementById('nav-memory').click()`);
  await shot(dark, 'goals', `document.getElementById('nav-goals').click()`);
  await shot(dark, 'heartbeat', `document.getElementById('nav-inbox').click()`);
  await shot(dark, 'quick-session', `document.getElementById('nav-quick').click()`);
  dark.destroy();
  const light = await page({ stateFile, theme: 'light' });
  await shot(light, 'conversation-light', `document.getElementById('nav-conversation').click(); scrollChatToBottom()`);
  light.destroy();
  const widget = await page({ stateFile, mode: 'widget', width: 800, height: 1240, transparent: true, zoom: 2 });
  files.widget = await shot(widget, 'widget', `scrollChatToBottom()`);
  widget.destroy();
  files.phone = await phoneShot(state);
  await hero(files);
  console.log(`Wrote ${fs.readdirSync(out).filter(name => name.endsWith('.png')).length} screenshots to docs/screenshots.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* Temp cleanup is best effort. */ }
  app.quit();
});
