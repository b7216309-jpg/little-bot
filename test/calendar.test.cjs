'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../src/store.cjs');
const { AgentTools } = require('../src/agent-tools.cjs');
const {
  normalizeCalendar, validateCalendarEvent, listCalendarEvents,
  parseLocalDateTime, localDateTime,
} = require('../src/calendar.cjs');

test('local calendar validates timed and all-day events using the PC local calendar', () => {
  const now = new Date(2026, 8, 27, 12, 0, 0, 0).getTime();
  const timed = validateCalendarEvent({
    title: 'Project review',
    startLocal: '2026-09-28T09:30',
    endLocal: '2026-09-28T10:45',
    location: 'Desk',
    notes: 'Bring notes.',
  }, null, now);
  assert.equal(localDateTime(timed.startAt), '2026-09-28T09:30');
  assert.equal(localDateTime(timed.endAt), '2026-09-28T10:45');
  assert.equal(timed.allDay, false);

  const allDay = validateCalendarEvent({ title: 'Release day', startLocal: '2026-10-02', allDay: true }, null, now);
  assert.equal(localDateTime(allDay.startAt, true), '2026-10-02');
  assert.equal(allDay.endAt, new Date(2026, 9, 3, 0, 0, 0, 0).getTime());

  for (const value of ['2026-02-30T10:00', '2026-13-01T10:00', '2026-01-01T25:00', 'not-a-date']) {
    assert.throws(() => parseLocalDateTime(value), /valid local|YYYY-MM-DDTHH:MM/);
  }
  assert.throws(() => validateCalendarEvent({ title: 'Bad', startLocal: '2026-09-28T10:00', endLocal: '2026-09-28T09:00' }, null, now), /end after/);
});

test('calendar list returns overlapping events in chronological order and a bounded range', () => {
  const calendar = normalizeCalendar({ events: [
    { id: 'later', title: 'Later', startAt: new Date(2026, 8, 29, 12).getTime(), endAt: new Date(2026, 8, 29, 13).getTime() },
    { id: 'first', title: 'First', startAt: new Date(2026, 8, 28, 8).getTime(), endAt: new Date(2026, 8, 28, 9).getTime() },
  ] });
  const listed = listCalendarEvents(calendar, { fromLocal: '2026-09-28', toLocal: '2026-09-30', limit: 10 });
  assert.deepEqual(listed.map(item => item.id), ['first', 'later']);
  assert.equal(listed[0].startLocal, '2026-09-28T08:00');
});

test('calendar survives Store persistence', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'little-bot-calendar-'));
  t.after(() => { store.close(); restored.close(); return rm(root, { recursive: true, force: true }); });
  const filePath = path.join(root, 'state.json');
  const store = new Store({ filePath, defaultWorkspace: root });
  store.data.calendar.events.push(validateCalendarEvent({
    title: 'Persisted event',
    startLocal: '2026-09-28T14:00',
    endLocal: '2026-09-28T15:00',
  }));
  store.flush();
  const restored = new Store({ filePath, defaultWorkspace: root });
  assert.equal(restored.data.calendar.events.length, 1);
  assert.equal(restored.data.calendar.events[0].title, 'Persisted event');
  assert.equal(localDateTime(restored.data.calendar.events[0].startAt), '2026-09-28T14:00');
});

test('agent exposes read-only calendar listing in Plan and full calendar management in Execute', async () => {
  const calls = [];
  const store = { data: { extensions: { skills: [], plugins: [] } } };
  const tools = new AgentTools({
    store,
    manageCalendar: async (action, payload, context) => {
      calls.push({ action, payload, context });
      return action === 'list' ? { events: [] } : { event: { id: 'event-1', ...payload } };
    },
  });
  const readOnlyNames = tools.specs({ readOnly: true }).map(item => item.name);
  assert.ok(readOnlyNames.includes('calendar_list'));
  assert.equal(readOnlyNames.includes('calendar_manage'), false);
  const fullNames = tools.specs().map(item => item.name);
  assert.ok(fullNames.includes('calendar_list'));
  assert.ok(fullNames.includes('calendar_manage'));

  const chat = { id: 'chat-1', internal: false, status: 'running', workspace: 'C:\\work', messages: [{ role: 'user', text: 'What is on my calendar?' }] };
  assert.deepEqual(await tools.call('calendar_list', { fromLocal: '2026-09-28', limit: 10 }, { chat }), { events: [] });
  await tools.call('calendar_manage', { action: 'create', title: 'Call', startLocal: '2026-09-28T16:00' }, { chat });
  assert.deepEqual(calls.map(call => call.action), ['list', 'create']);
  assert.equal(calls[1].payload.title, 'Call');
});

test('renderer and slash commands expose the local calendar', () => {
  const root = path.join(__dirname, '..');
  const html = readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const app = readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const css = readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
  const slash = readFileSync(path.join(root, 'src', 'renderer', 'slash-commands.js'), 'utf8');
  assert.match(html, /id="nav-calendar"/);
  assert.match(html, /id="calendar-view"/);
  assert.match(html, /id="calendar-dialog"/);
  assert.match(app, /function renderCalendar\(\)/);
  assert.match(app, /saveCalendarEvent/);
  assert.match(css, /\.calendar-event-card/);
  assert.match(slash, /name: 'calendar'/);
});
