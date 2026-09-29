// Focused profile/feedback UI smoke, isolated profile only, no model requests.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { installBundledSkills } = require('./bundled-skills.cjs');

async function run({ window, controller, store, heartbeat, output }) {
  assert.ok(process.env.LITTLE_BOT_DATA_DIR);
  const js = code => window.webContents.executeJavaScript(code);
  const until = async predicate => { for (let i = 0; i < 40; i++) { if (await predicate()) return; await delay(100); } throw new Error('Personal assistant smoke timed out.'); };
  const profile = controller.profileFiles.getState();
  assert.equal(profile.error, null);
  for (const name of ['little-bot', 'research-brief', 'meeting-prep']) assert.ok(store.data.extensions.skills.some(skill => skill.name === name && skill.enabled));
  const count = store.data.extensions.skills.length;
  await installBundledSkills(store);
  assert.equal(store.data.extensions.skills.length, count);
  await js("document.getElementById('nav-profile').click()");
  await delay(150);
  await js("document.getElementById('profile-user').value='# Smoke profile\\nPrefer a short conclusion followed by evidence.'; document.getElementById('profile-user').dispatchEvent(new Event('input',{bubbles:true}))");
  controller.changed(); await delay(150);
  assert.match(await js("document.getElementById('profile-user').value"), /Prefer a short conclusion/);
  await js("document.getElementById('profile-form').requestSubmit()");
  await until(() => controller.profileFiles.getState().user.includes('Prefer a short conclusion'));
  assert.equal(controller.profileFiles.getState().soul, profile.soul, 'Saving one profile must preserve the other.');
  assert.match(await fs.readFile(profile.files.user, 'utf8'), /Prefer a short conclusion/);
  assert.match(controller.profileFiles.buildContext(), /Prefer a short conclusion/);
  await fs.writeFile(profile.files.soul, '# Smoke style\nLead with the result.');
  assert.match(controller.profileFiles.buildContext(), /Lead with the result/);
  controller.changed(); await delay(150);
  await fs.writeFile(path.join(output, 'profile.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(900, 720); await delay(150);
  assert.equal(await js('document.documentElement.scrollWidth > innerWidth'), false);
  await fs.writeFile(path.join(output, 'profile-compact.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(1240, 860);

  await js("document.getElementById('nav-heartbeat').click(); document.querySelector('.heartbeat-attention-settings').open=true; document.getElementById('heartbeat-max-alerts').value='1'; document.getElementById('heartbeat-snooze-minutes').value='5'; document.getElementById('heartbeat-max-alerts').dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('heartbeat-snooze-minutes').dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('heartbeat-form').requestSubmit()");
  await until(() => store.data.heartbeat.maxAlertsPerDay === 1 && store.data.heartbeat.snoozeMinutes === 5);
  const config = store.data.heartbeat;
  const originalCanNotify = heartbeat.canNotify;
  heartbeat.canNotify = () => true;
  config.startHour = 0; config.endHour = 0; config.attention.dayKey = ''; config.attention.pending = [];
  heartbeat.recordActivity({ status: 'alert', topic: 'Project preparation', summary: 'Your preparation brief is ready.', workspace: config.workspace, source: 'heartbeat' });
  const first = config.history.findLast(item => item.topic === 'Project preparation');
  heartbeat.recordActivity({ status: 'alert', topic: 'Research draft', summary: 'The research draft has fresh sources.', workspace: config.workspace, source: 'goal', goalId: 'smoke-feedback-goal' });
  const second = config.history.findLast(item => item.topic === 'Research draft');
  assert.equal(first.delivery, 'notified'); assert.equal(second.delivery, 'quiet');
  await js("document.getElementById('nav-inbox').click()");
  await delay(150);
  const clickFeedback = async (id, label) => {
    await js(`Array.from(document.querySelectorAll('.heartbeat-entry[data-entry-id="${id}"] .feedback-button')).find(button=>button.textContent===${JSON.stringify(label)}).click()`);
    await delay(150);
  };
  await clickFeedback(first.id, 'Useful');
  assert.equal(config.attention.topics.find(topic => topic.key === first.subjectKey).usefulCount, 1);
  await clickFeedback(second.id, 'Later');
  assert.ok(config.attention.topics.find(topic => topic.key === second.subjectKey).snoozedUntil > Date.now());
  await clickFeedback(first.id, "Don't suggest this");
  assert.equal(config.attention.topics.find(topic => topic.key === first.subjectKey).muted, true);
  heartbeat.recordActivity({ status: 'alert', topic: 'Project preparation', summary: 'The preparation brief now includes the revised agenda.', workspace: config.workspace, source: 'heartbeat' });
  assert.equal(config.history.findLast(item => item.topic === 'Project preparation').delivery, 'muted');
  await delay(150);
  await js("document.getElementById('toast').classList.add('hidden')");
  await fs.writeFile(path.join(output, 'attention.png'), (await window.webContents.capturePage()).toPNG());
  await js("document.getElementById('heartbeat-muted-topics').scrollIntoView({block:'end'})");
  await delay(150);
  await fs.writeFile(path.join(output, 'attention-controls.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(900, 720); await delay(150);
  assert.equal(await js('document.documentElement.scrollWidth > innerWidth'), false);
  await fs.writeFile(path.join(output, 'attention-compact.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(1240, 860);
  await js("document.querySelector('#heartbeat-muted-topics button').click()");
  await until(() => !config.attention.topics.find(topic => topic.key === first.subjectKey).muted);
  const originalNow = heartbeat.now;
  try {
    config.maxAlertsPerDay = 2;
    heartbeat.now = () => Date.now() + 6 * 60000;
    heartbeat.flushAttention();
    assert.equal(second.delivery, 'notified', 'A snoozed alert must become deliverable without a model call.');
  } finally { heartbeat.now = originalNow; heartbeat.canNotify = originalCanNotify; }
  store.save();
  const saved = JSON.parse(await fs.readFile(store.filePath, 'utf8'));
  assert.equal(saved.heartbeat.attention.topics.find(topic => topic.key === first.subjectKey).usefulCount, 1);
  await js("document.getElementById('nav-extensions').click(); document.querySelector('[data-tab=skills]')?.click()");
  return { profileFiles: true, profileEditThroughIpc: true, draftsPreserved: true, starterSkills: true, feedbackThroughIpc: true, snoozeWithoutModel: true, notificationBudget: true };
}
module.exports = { run };
