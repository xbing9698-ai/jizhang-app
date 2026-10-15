import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createXlsxLoader } from '../js/xlsx-loader.js';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const app = readFileSync(new URL('js/app.js', root), 'utf8');
const loader = readFileSync(new URL('js/xlsx-loader.js', root), 'utf8');

// 最小脚本容器，模拟浏览器 <head> 与动态 <script>。
function fakeDom() {
  const appended = [];
  return {
    appended,
    document: {
      createElement: () => ({ set src(value) { this._src = value; }, get src() { return this._src; } }),
      head: { appendChild: script => appended.push(script) }
    }
  };
}

test('首页初始不加载 xlsx.full.min.js', () => {
  assert.ok(!html.includes('js/vendor/xlsx.full.min.js'), 'index.html 不应直接加载 XLSX');
  // 其余两个常驻依赖仍然保留。
  assert.ok(html.includes('js/vendor/papaparse.min.js'));
  assert.ok(html.includes('js/vendor/chart.umd.min.js'));
  // 文件选择框仍然接受 .xlsx（只是解析时才按需加载脚本）。
  assert.match(html, /id="fileInput" accept="\.csv,\.xlsx"/);
  // 静态脚本列表里必须没有 XLSX。
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['js/vendor/papaparse.min.js','js/vendor/chart.umd.min.js','js/app.js']);
});

test('XLSX 不在首次安装预缓存里，改为运行时缓存', () => {
  const assets = sw.slice(sw.indexOf('const ASSETS'), sw.indexOf('];', sw.indexOf('const ASSETS')));
  assert.ok(!assets.includes('xlsx.full.min.js'), 'ASSETS 不应预缓存 XLSX');
  assert.ok(!sw.includes(`'./js/vendor/xlsx.full.min.js'`), '预缓存列表不应包含 XLSX');
  // 普通打开 App 不会请求它：只有 readWechatFile 会触发按需加载。
  assert.match(loader, /xlsx\.full\.min\.js/);
});

test('只有处理 xlsx 时才加载，CSV 路径不加载', async () => {
  const dom = fakeDom();
  const scope = {};
  const ensure = createXlsxLoader({ url: 'https://example.test/js/vendor/xlsx.full.min.js', doc: () => dom.document, scope: () => scope });
  // 未加载前不会插入任何 script。
  assert.equal(dom.appended.length, 0);
  assert.ok(!('XLSX' in scope));
  // 已存在的全局对象直接复用，不插入 script（CSV 与测试环境路径）。
  scope.XLSX = { marker:'already' };
  assert.equal(await ensure(), scope.XLSX);
  assert.equal(dom.appended.length, 0);
});

test('第一次使用 xlsx 时动态加载，成功后可重复复用同一个对象', async () => {
  const dom = fakeDom();
  const scope = {};
  const ensure = createXlsxLoader({ url: 'https://example.test/js/vendor/xlsx.full.min.js', doc: () => dom.document, scope: () => scope });
  const first = ensure();
  assert.equal(dom.appended.length, 1);
  assert.equal(dom.appended[0].src, 'https://example.test/js/vendor/xlsx.full.min.js');
  scope.XLSX = { marker:'loaded' };
  dom.appended[0].onload();
  assert.equal(await first, scope.XLSX);
  assert.equal(await ensure(), scope.XLSX);
  assert.equal(dom.appended.length, 1, '同一页面生命周期只加载一次');
});

test('并发请求共享同一个Promise，不会重复加载', async () => {
  const dom = fakeDom();
  const scope = {};
  const ensure = createXlsxLoader({ url: 'x', doc: () => dom.document, scope: () => scope });
  const calls = [ensure(), ensure(), ensure()];
  assert.equal(dom.appended.length, 1, '并发调用只插入一个 script');
  assert.equal(calls[0], calls[1]);
  assert.equal(calls[1], calls[2]);
  scope.XLSX = { marker:'loaded' };
  dom.appended[0].onload();
  assert.deepEqual(await Promise.all(calls), [scope.XLSX, scope.XLSX, scope.XLSX]);
  assert.equal(dom.appended.length, 1);
});

test('加载失败给出清楚的中文错误，并允许再次重试', async () => {
  const dom = fakeDom();
  const scope = {};
  const ensure = createXlsxLoader({ url: 'x', doc: () => dom.document, scope: () => scope });
  const failing = ensure();
  dom.appended[0].onerror();
  await assert.rejects(failing, /表格解析库加载失败，请检查网络后重试/);
  // 失败后可以重试：会重新插入 script。
  const retry = ensure();
  assert.equal(dom.appended.length, 2);
  scope.XLSX = { marker:'loaded' };
  dom.appended[1].onload();
  assert.equal(await retry, scope.XLSX);

  // 脚本加载成功但全局对象缺失时也要给出中文错误。
  const dom2 = fakeDom(), scope2 = {};
  const ensure2 = createXlsxLoader({ url: 'x', doc: () => dom2.document, scope: () => scope2 });
  const missing = ensure2();
  dom2.appended[0].onload();
  await assert.rejects(missing, /未找到 XLSX 全局对象/);
});

test('微信解析路径在读取文件前先按需加载 XLSX，解析调用与返回结构不变', async () => {
  const calls = { read: 0, sheetToJson: 0 };
  const rows = [['交易时间','交易类型','金额'],['2026-10-01 12:00:00','支出','12.00']];
  const XLSX = {
    read: (buf, options) => {
      calls.read++;
      assert.equal(options.type, 'array');
      assert.equal(options.cellDates, true);
      return { SheetNames:['账单'], Sheets:{ '账单':{} } };
    },
    utils: { sheet_to_json: (sheet, options) => {
      calls.sheetToJson++;
      assert.deepEqual(options, { header:1, raw:true, defval:'' });
      return rows;
    } }
  };
  const { readWechatFile, parseWechatRows } = await import('../js/parse-wechat.js');
  const file = { arrayBuffer: async () => new ArrayBuffer(8) };
  globalThis.XLSX = XLSX;
  try {
    assert.deepEqual(await readWechatFile(file), rows);
    assert.equal(calls.read, 1);
    assert.equal(calls.sheetToJson, 1);
    // readWechatFile 只负责读取二维数组；表头校验仍由 parseWechatRows 负责。
    globalThis.XLSX = { ...XLSX, utils:{ sheet_to_json: () => [['其它列','交易时间']] } };
    const raw = await readWechatFile(file);
    assert.deepEqual(raw, [['其它列','交易时间']]);
    assert.throws(() => parseWechatRows(raw), /未找到微信表头行/);
  } finally { delete globalThis.XLSX; }
});

test('真实 xlsx 导入路径先等到加载完成再读取缓冲区', async () => {
  const events = [];
  const { readWechatFile } = await import('../js/parse-wechat.js');
  const file = { arrayBuffer: async () => { events.push('arrayBuffer'); return new ArrayBuffer(8); } };
  // 模块级加载器看到 globalThis.XLSX 已存在时立即复用，不插入 script。
  globalThis.XLSX = {
    read: () => { events.push('read'); return { SheetNames:['s'], Sheets:{ s:{} } }; },
    utils: { sheet_to_json: () => { events.push('sheet_to_json'); return [['交易时间','交易类型','金额']]; } }
  };
  try {
    assert.deepEqual(await readWechatFile(file), [['交易时间','交易类型','金额']]);
    // 先按需加载 XLSX，再读取文件缓冲区，最后解析。
    assert.deepEqual(events, ['arrayBuffer','read','sheet_to_json']);
  } finally { delete globalThis.XLSX; }
});
