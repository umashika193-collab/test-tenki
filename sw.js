const CACHE_NAME = 'appare-cache-v2';
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './icon_normal.png',
  './icon_dancing.png',
  './icon_dried.png',
  './icon.png'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // 新しいSWをすぐに待機状態からアクティブにする
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
  // ネットワークファースト (Network First) 戦略
  // 常に最新のファイルを取りに行き、オフライン時のみキャッシュを使う
  event.respondWith(
    fetch(event.request).then(response => {
      // 正常なレスポンス(200)の場合のみキャッシュを更新（エラーキャッシュによる汚染を防ぐ）
      if (response && response.status === 200) {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
      }
      return response;
    }).catch(() => {
      return caches.match(event.request);
    })
  );
});
