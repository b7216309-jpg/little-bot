'use strict';

// Times shown to the model, in the PC's local time and spelled out. The engine only supplies the date and time zone,
// and raw UTC ISO stamps ("...T22:40:00.000Z") get misread as local time by small models.
const pad = value => String(value).padStart(2, '0');

function utcOffset(ms = Date.now()) {
  const minutes = -new Date(ms).getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  return `UTC${sign}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

function timeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}

// A compact local timestamp for lists and logs: "Sat 2026-10-03 00:40".
function localStamp(ms) {
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const day = date.toLocaleDateString('en-GB', { weekday: 'short' });
  return `${day} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The line every model turn gets: "Current local time: Saturday 3 October 2026, 00:40 (Europe/Paris, UTC+02:00)."
function timeContext(ms = Date.now()) {
  const date = new Date(ms);
  const day = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const zone = [timeZone(), utcOffset(ms)].filter(Boolean).join(', ');
  return `Current local time: ${day}, ${pad(date.getHours())}:${pad(date.getMinutes())} (${zone}). Use this clock for anything about now, today, tonight or tomorrow; timestamps given to you are local time too.`;
}

module.exports = { localStamp, timeContext, utcOffset };
