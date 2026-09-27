'use strict';

const { randomUUID } = require('node:crypto');

const MAX_EVENTS = 5000;
const MAX_DURATION_MS = 366 * 24 * 60 * 60 * 1000;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, max) => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max)
  : '';

function localParts(timestamp) {
  const date = new Date(timestamp);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

function localDateTime(timestamp, allDay = false) {
  if (!Number.isFinite(timestamp)) return '';
  const { year, month, day, hour, minute } = localParts(timestamp);
  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return allDay ? date : `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseLocalDateTime(value, { allDay = false, label = 'time' } = {}) {
  if (Number.isFinite(value)) return value;
  if (typeof value !== 'string') throw new Error(`Choose a valid local ${label}.`);
  const match = allDay
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(allDay ? `Use YYYY-MM-DD for the local ${label}.` : `Use YYYY-MM-DDTHH:MM for the local ${label}.`);
  const [year, month, day, hour = 0, minute = 0] = match.slice(1).map(Number);
  if (year < 1970 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error(`Choose a valid local ${label}.`);
  }
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute) {
    throw new Error(`Choose a valid local ${label}.`);
  }
  return date.getTime();
}

function nextLocalDay(timestamp) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime();
}

function normalizeEvent(value, now = Date.now()) {
  if (!object(value)) return null;
  const title = clean(value.title, 120);
  const startAt = Number.isFinite(value.startAt) ? value.startAt : null;
  if (!title || startAt === null) return null;
  const allDay = value.allDay === true;
  let endAt = Number.isFinite(value.endAt) ? value.endAt : (allDay ? nextLocalDay(startAt) : startAt + 60 * 60 * 1000);
  if (endAt <= startAt || endAt - startAt > MAX_DURATION_MS) endAt = allDay ? nextLocalDay(startAt) : startAt + 60 * 60 * 1000;
  return {
    id: typeof value.id === 'string' && value.id ? value.id.slice(0, 100) : randomUUID(),
    title,
    startAt,
    endAt,
    allDay,
    location: clean(value.location, 300),
    notes: clean(value.notes, 4000),
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : now,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : now,
  };
}

function normalizeCalendar(value, now = Date.now()) {
  const events = Array.isArray(value?.events) ? value.events.map(item => normalizeEvent(item, now)).filter(Boolean).slice(0, MAX_EVENTS) : [];
  events.sort((left, right) => left.startAt - right.startAt || left.title.localeCompare(right.title));
  return { events };
}

function validateCalendarEvent(input, existing = null, now = Date.now()) {
  if (!object(input)) throw new Error('A calendar event is required.');
  if (!Number.isFinite(now)) throw new Error('A valid current time is required.');
  if (input.id !== undefined && (!existing || input.id !== existing.id)) throw new Error('This calendar event no longer exists.');

  const allDay = input.allDay === undefined ? existing?.allDay === true : input.allDay;
  if (typeof allDay !== 'boolean') throw new Error('All-day must be true or false.');

  const title = input.title === undefined ? clean(existing?.title, 120) : clean(input.title, 120);
  if (!title) throw new Error('Give the calendar event a title.');
  if (typeof input.title === 'string' && input.title.trim().length > 120) throw new Error('Calendar event titles can use up to 120 characters.');

  let startAt;
  if (input.startAt !== undefined) startAt = parseLocalDateTime(input.startAt, { allDay, label: 'start' });
  else if (input.startLocal !== undefined) startAt = parseLocalDateTime(input.startLocal, { allDay, label: 'start' });
  else if (existing) startAt = existing.startAt;
  else throw new Error('Choose when the calendar event starts.');

  const scheduleChanged = !existing || startAt !== existing.startAt || allDay !== existing.allDay;
  let endAt;
  if (input.endAt !== undefined) endAt = parseLocalDateTime(input.endAt, { allDay, label: 'end' });
  else if (input.endLocal !== undefined && input.endLocal !== '') endAt = parseLocalDateTime(input.endLocal, { allDay, label: 'end' });
  else if (existing && !scheduleChanged) endAt = existing.endAt;
  else endAt = allDay ? nextLocalDay(startAt) : startAt + 60 * 60 * 1000;

  if (!(endAt > startAt)) throw new Error('The calendar event must end after it starts.');
  if (endAt - startAt > MAX_DURATION_MS) throw new Error('Calendar events cannot span more than 366 days.');

  if (input.location !== undefined && typeof input.location !== 'string') throw new Error('Calendar location must be text.');
  if (input.notes !== undefined && typeof input.notes !== 'string') throw new Error('Calendar notes must be text.');
  if (typeof input.location === 'string' && input.location.length > 300) throw new Error('Calendar location can use up to 300 characters.');
  if (typeof input.notes === 'string' && input.notes.length > 4000) throw new Error('Calendar notes can use up to 4,000 characters.');

  return {
    id: existing?.id || randomUUID(),
    title,
    startAt,
    endAt,
    allDay,
    location: input.location === undefined ? clean(existing?.location, 300) : clean(input.location, 300),
    notes: input.notes === undefined ? clean(existing?.notes, 4000) : clean(input.notes, 4000),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

function calendarEventView(event) {
  return {
    ...event,
    startLocal: localDateTime(event.startAt, event.allDay),
    endLocal: localDateTime(event.endAt, event.allDay),
  };
}

function listCalendarEvents(calendar, input = {}, now = Date.now()) {
  if (!object(input)) throw new Error('Calendar list options must be an object.');
  const startOfToday = (() => {
    const date = new Date(now);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
  })();
  const fromAt = input.fromLocal === undefined || input.fromLocal === '' ? startOfToday
    : parseLocalDateTime(input.fromLocal, { allDay: /^\d{4}-\d{2}-\d{2}$/.test(input.fromLocal), label: 'range start' });
  const toAt = input.toLocal === undefined || input.toLocal === '' ? new Date(new Date(fromAt).getFullYear(), new Date(fromAt).getMonth() + 3, new Date(fromAt).getDate()).getTime()
    : parseLocalDateTime(input.toLocal, { allDay: /^\d{4}-\d{2}-\d{2}$/.test(input.toLocal), label: 'range end' });
  if (toAt <= fromAt) throw new Error('Calendar range end must be after its start.');
  const limit = input.limit === undefined ? 50 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Calendar list limit must be from 1 to 200.');
  return (calendar?.events || [])
    .filter(event => event.endAt > fromAt && event.startAt < toAt)
    .sort((left, right) => left.startAt - right.startAt || left.title.localeCompare(right.title))
    .slice(0, limit)
    .map(calendarEventView);
}

module.exports = {
  MAX_EVENTS,
  normalizeCalendar,
  validateCalendarEvent,
  listCalendarEvents,
  parseLocalDateTime,
  localDateTime,
  calendarEventView,
};
