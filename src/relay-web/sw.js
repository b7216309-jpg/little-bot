'use strict';
// Shows Little Bot notifications and keeps the app shell available when the PC is unreachable.
const SHELL = 'little-bot-shell-v1';
const FILES = ['/', '/app.js', '/app.css', '/manifest.webmanifest', '/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== SHELL).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(SHELL).then(cache => cache.put(event.request, copy)).catch(() => {}); }
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match('/'))));
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    if (clients.some(client => client.visibilityState === 'visible')) return undefined;
    return self.registration.showNotification(data.title || 'Little Bot', {
      body: data.body || 'New message', tag: data.tag || 'little-bot', renotify: true,
      icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url || '/' },
    });
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const open = clients.find(client => new URL(client.url).origin === location.origin);
    return open ? open.focus() : self.clients.openWindow(event.notification.data?.url || '/');
  }));
});
