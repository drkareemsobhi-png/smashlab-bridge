/* SmashLab app service worker — يخدم ملفات التطبيق بس، باقي صفحات الموقع (لاندينج الإعلانات) مش بيلمسها */
var CACHE = 'smashlab-app-v2';
var ASSETS = [
  'app.html',
  'manifest.webmanifest',
  'app-icon-192.png',
  'app-icon-512.png',
  'img/hero_mushroom.jpg',
  'img/burger.jpg',
  'img/bbq.jpg',
  'img/bacon.jpg',
  'img/mushroom.jpg',
  'img/sweetchili.jpg',
  'img/chicken.jpg',
  'img/chicken_bbq.jpg',
  'img/chicken_ranch.jpg',
  'img/chicken_sweetchili.jpg',
  'img/chicken_turkey.jpg',
  'img/strips.jpg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  var inScope = /\/(app\.html|manifest\.webmanifest|app-icon-\d+\.png|img\/[^\/]+)$/.test(url.pathname);
  if (!inScope) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true });
    })
  );
});
