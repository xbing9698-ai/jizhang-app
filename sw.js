const CACHE = 'jizhang-v18';
const ASSETS = [
  './', './index.html', './css/style.css',
  './js/app.js','./js/decode.js','./js/parse-alipay.js','./js/parse-wechat.js',
  './js/normalize.js','./js/dedup.js','./js/classify.js','./js/aggregate.js',
  './js/identity.js','./js/import-transactions.js',
  './js/period.js',
  './js/manual.js',
  './js/quick-entry.js',
  './js/review.js',
  './js/storage.js','./js/charts.js','./js/icons.js',
  './js/vendor/papaparse.min.js','./js/vendor/xlsx.full.min.js','./js/vendor/chart.umd.min.js',
  './fonts/fraunces.woff2','./fonts/fraunces-italic.woff2',
  './fonts/noto-serif-sc-400.woff2','./fonts/noto-serif-sc-700.woff2',
  './manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'
];
self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e =>
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
