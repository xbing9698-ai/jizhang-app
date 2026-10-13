import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('PWA更新重新获取首页与图标，不把旧HTTP资源带入新缓存，保持子路径', async () => {
  const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listeners = {}, cached = new Map();
  let installation, activated = false;
  class Request {
    constructor(path, options = {}) {
      this.url = new URL(path, 'https://xbing9698-ai.github.io/jizhang-app/sw.js').href;
      this.cache = options.cache || 'default';
    }
  }
  vm.runInNewContext(source, {
    Request,
    self: {
      addEventListener: (type, handler) => { listeners[type] = handler; },
      skipWaiting: () => { activated = true; }
    },
    caches: { open: async () => ({ addAll: async requests => {
      for (const request of requests) {
        const resolved = request instanceof Request ? request : new Request(request);
        // 浏览器已有旧HTTP资源；reload才会拿到部署后的新资源。
        cached.set(resolved.url, resolved.cache === 'reload' ? 'new-version' : 'old-version');
      }
    } }) }
  });
  listeners.install({ waitUntil: promise => { installation = promise; } });
  await installation;
  assert.equal(activated, true);
  for (const path of ['index.html','js/app.js','js/quick-entry.js','icons/icon-192.png','icons/icon-512.png']) {
    assert.equal(cached.get(`https://xbing9698-ai.github.io/jizhang-app/${path}`), 'new-version');
  }
  assert.ok([...cached.keys()].every(url => new URL(url).pathname.startsWith('/jizhang-app/')));
});
