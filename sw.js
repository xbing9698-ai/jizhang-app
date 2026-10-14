const CACHE = 'jizhang-v31';
const ASSETS = [
  './', './index.html', './css/style.css',
  './js/app.js','./js/decode.js','./js/parse-alipay.js','./js/parse-wechat.js',
  './js/normalize.js','./js/dedup.js','./js/classify.js','./js/aggregate.js',
  './js/identity.js','./js/import-transactions.js',
  './js/period.js',
  './js/manual.js',
  './js/quick-entry.js',
  './js/detail.js','./js/transaction-edit.js',
  './js/generic-csv.js','./js/snapshots.js','./js/reconciliation.js','./js/ledger-tools.js',
  './js/review.js',
  './js/storage.js','./js/charts.js','./js/icons.js',
  './js/vendor/papaparse.min.js','./js/vendor/xlsx.full.min.js','./js/vendor/chart.umd.min.js',
  './fonts/fraunces.woff2','./fonts/fraunces-italic.woff2',
  './fonts/noto-serif-sc-400.woff2','./fonts/noto-serif-sc-700.woff2',
  './manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png'
];
self.addEventListener('install', e =>
  // 新版本预缓存绕过旧 HTTP 缓存，避免把旧首页或图标带入新缓存。
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(url =>
    new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e =>
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
