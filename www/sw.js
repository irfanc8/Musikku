/* Musikku service worker — cache app shell + lagu yang diunduh */
const SHELL_CACHE = 'musikku-shell-v2';
const AUDIO_CACHE = 'musikku-audio-v1';
const SHELL_FILES = [
  './', './index.html', './styles.css', './app.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== SHELL_CACHE && k !== AUDIO_CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // App shell: cache-first (agar aplikasi bisa dibuka offline)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request))
    );
    return;
  }
  // File audio archive.org/download/... : cache-first (lagu yang diunduh tetap bisa diputar offline)
  if (url.hostname.indexOf('archive.org') !== -1 && url.pathname.indexOf('/download/') !== -1) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then((cache) =>
        cache.match(event.request).then((hit) => {
          if (hit) return hit;
          return fetch(event.request).then((res) => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }
  // API archive.org & lainnya: jaringan dulu (jangan simpan hasil pencarian)
  event.respondWith(fetch(event.request));
});
