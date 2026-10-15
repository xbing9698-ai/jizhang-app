// 静态 PWA 更新策略：不引入构建系统、不引入 Workbox、不清任何用户数据。
// 关键点：应用外壳（HTML/JS/CSS）在线时走网络优先，所以忘记改版本号也不会长期卡在旧版；
// 离线时回退已有缓存。按需资源（如 XLSX）走缓存优先并允许运行时缓存。
//
// CACHE 版本号仍然保留，但它只用于预缓存与清理旧缓存，不再是"必须手改否则永不更新"的唯一机制。
const CACHE = 'jizhang-v36';
const RUNTIME_CACHE = 'jizhang-runtime-v36';
// 应用外壳：这些文件必须尽量保持同一版本，避免 HTML 与 JS/CSS 新旧混搭。
const SHELL = [
  './index.html', './css/style.css',
  './js/app.js','./js/decode.js','./js/parse-alipay.js','./js/parse-wechat.js',
  './js/normalize.js','./js/dedup.js','./js/classify.js','./js/aggregate.js',
  './js/identity.js','./js/import-transactions.js',
  './js/period.js',
  './js/manual.js',
  './js/quick-entry.js',
  './js/detail.js','./js/transaction-edit.js',
  './js/generic-csv.js','./js/snapshots.js','./js/reconciliation.js','./js/ledger-tools.js',
  './js/review.js','./js/asset-ledger.js','./js/asset-ledger-ui.js','./js/xlsx-loader.js',
  './js/storage.js','./js/charts.js','./js/icons.js','./js/estimated-assets.js',
  './js/vendor/papaparse.min.js','./js/vendor/chart.umd.min.js',
  './manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png'
];
// 首次安装需要预缓存的资源。XLSX（约 880KB）不在其中：只有真正解析 .xlsx 时
// 才按需下载，并由运行时缓存在之后离线时继续可用。
const ASSETS = ['./', ...SHELL];
const SHELL_PATHS = new Set(ASSETS.map(path => new URL(path, self.location).href));

self.addEventListener('install', e =>
  // 新版本预缓存绕过旧 HTTP 缓存，避免把旧首页或图标带入新缓存。
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(url =>
    new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e =>
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('jizhang-') && k !== CACHE && k !== RUNTIME_CACHE)
      .map(k => caches.delete(k)))).then(() => self.clients.claim())));

function isShellRequest(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (request.mode === 'navigate') return true;
  return SHELL_PATHS.has(url.href);
}

// 外壳：网络优先。在线时总能拿到新版；离线时回退旧缓存，界面仍可用。
async function shellResponse(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

// 其他资源（图标、字体、按需的 XLSX）：缓存优先，成功的在线响应写入运行时缓存。
async function runtimeResponse(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  e.respondWith(isShellRequest(e.request, url) ? shellResponse(e.request) : runtimeResponse(e.request));
});
