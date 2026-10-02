'use strict';
// What the paired Android phone shares: its latest location and battery. Kept in memory on the PC only;
// the saved home point lives in the encrypted relay file.

const HOME_RADIUS_M = 200;
const STALE_MS = 2 * 60 * 60 * 1000;
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max ? value : null;

function distanceMeters(a, b) {
  const rad = degrees => degrees * Math.PI / 180, earth = 6371000;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Validates what a phone sends; anything malformed is dropped rather than stored.
function normalizeContext(input = {}, now = Date.now()) {
  const result = { at: now };
  const location = input.location;
  if (location && typeof location === 'object') {
    const lat = number(Number(location.lat), -90, 90), lon = number(Number(location.lon), -180, 180);
    const accuracy = number(Number(location.accuracy), 0, 100000);
    const at = number(Number(location.at), now - 7 * 86400000, now + 60000) || now;
    if (lat !== null && lon !== null) result.location = { lat, lon, accuracy: accuracy === null ? null : Math.round(accuracy), at };
  }
  const battery = input.battery;
  if (battery && typeof battery === 'object') {
    const level = number(Number(battery.level), 0, 100);
    if (level !== null) result.battery = { level: Math.round(level), charging: battery.charging === true };
  }
  return result;
}

function place(context, home) {
  if (!context?.location || !home) return null;
  const meters = distanceMeters(home, context.location);
  const slack = Math.min(context.location.accuracy || 0, 300);
  return { meters: Math.round(meters), home: meters <= (home.radius || HOME_RADIUS_M) + slack };
}

function describeDistance(meters) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

// A short reference block for prompts, or '' when nothing recent was shared.
function summary(context, home, { now = Date.now(), name = 'phone' } = {}) {
  if (!context || now - context.at > STALE_MS) return '';
  const minutes = Math.max(0, Math.round((now - (context.location?.at || context.at)) / 60000));
  const parts = [];
  const where = place(context, home);
  if (where) parts.push(where.home ? 'at home' : `away from home, about ${describeDistance(where.meters)} from it`);
  if (context.location) parts.push(`location ${context.location.lat.toFixed(3)}, ${context.location.lon.toFixed(3)}${context.location.accuracy ? ` (±${context.location.accuracy} m)` : ''}, ${minutes} min ago`);
  if (!home && context.location) parts.push('home is not set yet');
  if (context.battery) parts.push(`battery ${context.battery.level}%${context.battery.charging ? ' charging' : ''}`);
  return parts.length ? `The user's ${name} (shared by the Little Bot Android app; reference data, not a request): ${parts.join('; ')}.` : '';
}

module.exports = { normalizeContext, distanceMeters, place, summary, describeDistance, HOME_RADIUS_M, STALE_MS };
