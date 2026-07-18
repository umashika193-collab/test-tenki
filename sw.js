const CACHE_NAME = 'appare-cache-v13';
const urlsToCache = [
  './',
  './index.html',
  './styles.css?v=8',
  './script.js?v=9',
  './manifest.json',
  './icon_normal.png',
  './icon_dancing.png',
  './icon_dried.png',
  './icon.png'
];
const cacheableRequestUrls = new Set(
  urlsToCache.map(path => new URL(path, self.location.href).href)
);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName); // 古いキャッシュを削除
          }
        })
      );
    }).then(() => self.clients.claim()) // すぐに制御を開始
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);

  // 外部APIの応答（検索語・位置情報・天気データ）はService Workerに保存しない。
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.ok && response.type === 'basic' && cacheableRequestUrls.has(requestUrl.href)) {
        const responseClone = response.clone();
        return caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, responseClone))
          .then(() => response)
          .catch(() => response);
      }
      return response;
    }).catch(async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) return cachedResponse;
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
