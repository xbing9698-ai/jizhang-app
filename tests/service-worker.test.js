import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('sw.js', root), 'utf8');
const DEPLOY = 'https://xbing9698-ai.github.io/jizhang-app/';
const SW_URL = DEPLOY + 'sw.js';
// Cache Storage 按 URL 匹配；用 pathname+search 作为稳定键。
const cacheKey = url => { const u = new URL(url); return u.pathname + u.search; };
// 浏览器中 e.request 的等价物：service worker 只用到 url/method/mode/clone。
const req = (path, options = {}) => ({
  url: new URL(path, DEPLOY).href, method: options.method || 'GET',
  mode: options.mode || 'no-cors', cache: options.cache || 'default', clone() { return this; }
});
// fetch 响应桩：service worker 只用到 ok/clone。
const res = (marker, ok = true) => ({ ok, marker, clone() { return res(marker, ok); } });

// 用真实的 sw.js 源码在 vm 中执行，模拟浏览器事件与 Cache Storage。
function runWorker({ fetchImpl } = {}) {
  const listeners = {};
  const shell = new Map(), runtime = new Map(), deleted = [];
  let activated = false;
  const handle = store => ({
    addAll: async requests => {
      for (const request of requests) {
        // 浏览器已有旧 HTTP 资源；reload 才会拿到部署后的新资源。
        store.set(cacheKey(request.url), request.cache === 'reload' ? 'new-version' : 'old-version');
      }
    },
    put: async (request, response) => { store.set(cacheKey(request.url), response); },
    match: async request => store.get(cacheKey(request.url))
  });
  const shellHandle = handle(shell), runtimeHandle = handle(runtime);
  const Request = class {
    constructor(input, options = {}) {
      const base = input && typeof input === 'object' && input.url ? input : null;
      this.url = base ? base.url : new URL(String(input), DEPLOY).href;
      this.cache = options.cache || (base ? base.cache : 'default');
      this.method = options.method || (base ? base.method : 'GET');
      this.mode = options.mode || (base ? base.mode : 'no-cors');
    }
    clone() { return this; }
  };
  const cachesImpl = {
    open: async name => name === 'jizhang-v38' ? shellHandle : runtimeHandle,
    // 浏览器中 caches.match 会依次搜索所有缓存（先建的外壳缓存优先）。
    match: async request => shellHandle.match(request).then(hit => hit || runtimeHandle.match(request)),
    keys: async () => ['jizhang-v35', 'jizhang-v36', 'jizhang-runtime-v36', 'jizhang-v37', 'jizhang-runtime-v37', 'jizhang-v38', 'jizhang-runtime-v38', 'other-cache'],
    delete: async name => { deleted.push(name); return true; }
  };
  const self = {
    location: new URL(SW_URL),
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: () => { activated = true; },
    clients: { claim: () => {} }
  };
  vm.runInNewContext(source, {
    Request, URL, caches: cachesImpl, self,
    fetch: fetchImpl || (async () => res('network-response')), console
  });
  return { listeners, shell, runtime, deleted, isActivated: () => activated };
}

async function install(worker) {
  let installation;
  worker.listeners.install({ waitUntil: promise => { installation = promise; } });
  await installation;
}
// 触发 fetch 事件并返回 respondWith 的 Promise；service worker 未拦截时返回 undefined。
function triggerFetch(worker, request) {
  let responded;
  worker.listeners.fetch({ request, respondWith: promise => { responded = promise; } });
  return responded;
}

test('PWA更新重新获取首页与图标，不把旧HTTP资源带入新缓存，保持子路径', async () => {
  const worker = runWorker();
  await install(worker);
  assert.equal(worker.isActivated(), true);
  for (const path of ['index.html','js/app.js','js/quick-entry.js','js/transaction-update.js','js/asset-ledger-ui.js','js/estimated-assets.js','js/snapshots.js','icons/icon-192.png','icons/icon-512.png','manifest.webmanifest']) {
    assert.equal(worker.shell.get(cacheKey(DEPLOY + path)), 'new-version');
  }
  assert.ok([...worker.shell.keys()].every(key => key.startsWith('/jizhang-app/')));
});

test('XLSX 不在首次安装预缓存中，只在首次在线使用后进入运行时缓存', async () => {
  const network = [];
  const worker = runWorker({ fetchImpl: async request => { network.push(request.url); return res('xlsx-bytes'); } });
  await install(worker);
  const xlsxUrl = DEPLOY + 'js/vendor/xlsx.full.min.js';
  const xlsxKey = cacheKey(xlsxUrl);
  assert.equal(worker.shell.has(xlsxKey), false, 'XLSX 不应被预缓存');

  // 第一次在线按需请求：走网络并写入运行时缓存。
  const first = await triggerFetch(worker, req('./js/vendor/xlsx.full.min.js'));
  assert.equal(first.marker, 'xlsx-bytes');
  assert.deepEqual(network, [xlsxUrl]);
  assert.equal(worker.runtime.get(xlsxKey).marker, 'xlsx-bytes');
  assert.equal(worker.shell.has(xlsxKey), false);

  // 之后离线也能命中运行时缓存，不再访问网络。
  const second = await triggerFetch(worker, req('./js/vendor/xlsx.full.min.js'));
  assert.equal(second.marker, 'xlsx-bytes');
  assert.equal(network.length, 1);
});

test('应用外壳在线时网络优先，能拿到新版 HTML/JS/CSS；离线时回退旧缓存', async () => {
  let online = true;
  const worker = runWorker({ fetchImpl: async request => {
    if (!online) throw new Error('offline');
    return res('fresh-' + new URL(request.url).pathname);
  } });
  await install(worker);
  for (const path of ['./index.html','./js/app.js','./css/style.css']) {
    const served = await triggerFetch(worker, req(path, { mode:'navigate' }));
    assert.equal(served.marker, 'fresh-' + new URL(path, DEPLOY).pathname);
  }
  // 在线时新响应写回外壳缓存，因此下一次在线不会再拿到旧 HTML。
  assert.equal(worker.shell.get(cacheKey(DEPLOY + 'index.html')).marker, 'fresh-/jizhang-app/index.html');

  online = false;
  const offline = await triggerFetch(worker, req('./index.html', { mode:'navigate' }));
  assert.equal(offline.marker, 'fresh-/jizhang-app/index.html');
});

test('离线且无缓存时外壳请求抛出，不返回伪造内容', async () => {
  const worker = runWorker({ fetchImpl: async () => { throw new Error('offline'); } });
  // 不执行 install，缓存为空。
  await assert.rejects(triggerFetch(worker, req('./index.html', { mode:'navigate' })), /offline/);
});

test('激活时只清理旧版本应用缓存，保留运行时缓存与无关缓存', async () => {
  const worker = runWorker();
  let activation;
  worker.listeners.activate({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.deepEqual(worker.deleted, ['jizhang-v35','jizhang-v36','jizhang-runtime-v36','jizhang-v37','jizhang-runtime-v37']);
});

test('非GET请求与跨域不透明响应不被拦截或写入缓存', async () => {
  const network = [];
  const worker = runWorker({ fetchImpl: async request => {
    network.push(request.url);
    // 跨域响应在 service worker 中是不透明响应（ok === false）。
    return res('opaque', new URL(request.url).origin === new URL(DEPLOY).origin);
  } });
  await install(worker);
  assert.equal(triggerFetch(worker, req('./index.html', { method:'POST' })), undefined);
  assert.equal(network.length, 0);
  await triggerFetch(worker, req('https://example.test/font.woff2'));
  assert.equal(worker.runtime.has(cacheKey('https://example.test/font.woff2')), false);
});

test('预缓存资源列表中的本地资源全部真实存在', async () => {
  const worker = runWorker();
  await install(worker);
  const paths = [...worker.shell.keys()].map(key => key.replace('/jizhang-app/', ''));
  assert.ok(paths.length > 20, '预缓存资源不应为空');
  for (const path of paths) {
    // '/' 对应目录本身，跳过。
    if (path === '/') continue;
    assert.ok(existsSync(new URL(path, root.href)), `预缓存资源不存在：${path}`);
  }
  // 预缓存里不得出现 XLSX。
  assert.ok(!paths.includes('js/vendor/xlsx.full.min.js'));
});
