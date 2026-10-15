import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { setupAssetLedgerUI } from '../js/asset-ledger-ui.js';
import { loadAssetLedger, saveAssetLedger, loadSnapshots, saveSnapshot } from '../js/storage.js';
import { addAccount, emptyLedger } from '../js/asset-ledger.js';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { delete globalThis.document; });

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

// 只记录 id、文本与监听器的最小 DOM 桩，用于验证真实处理器行为。
const STUB_IDS = ['assetCurrent','assetCurrentEmpty','assetCurrentBody','assetNet','assetTotal',
  'assetLiability','assetUpdated','assetLedgerOpen','assetLedgerOpenEmpty','assetLedgerDialog',
  'assetLedgerClose','ledgerTotal','ledgerLiability','ledgerNet','accountList','accountAdd',
  'snapshotFromLedger','snapshotFromLedgerClose','snapshotFromLedgerSave',
  'accountEditDialog','accountEditTitle','accountEditClose','accountForm','accountName','accountType',
  'accountBalance','accountNote','accountEditMsg','accountSave','accountCancel',
  'accountDeletePrompt','accountDeleteLabel','accountDeleteConfirm','accountDeleteCancel','accountMsg',
  'ledgerSnapshotDialog','ledgerSnapshotForm','ledgerSnapshotDate','ledgerSnapshotTotal',
  'ledgerSnapshotLiability','ledgerSnapshotNet','ledgerSnapshotMsg'];
function stubDom() {
  const elements = new Map();
  const create = id => ({ id, hidden:false, disabled:false, value:'', textContent:'',
    innerHTML:'', open:false, handlers:{}, setAttribute(){},
    addEventListener(type, handler){ this.handlers[type] = handler; },
    showModal(){ this.open = true; }, close(){ this.open = false; }, scrollIntoView(){} });
  for (const id of STUB_IDS) elements.set(id, create(id));
  globalThis.document = { getElementById: id => {
    if (!elements.has(id)) { console.error('UNEXPECTED ID', id); elements.set(id, create(id)); }
    return elements.get(id);
  } };
  return elements;
}
const noop = { refreshApp(){}, refreshSnapshots:async () => {} };

test('资产总账UI基本结构存在，且不新增底部导航项', () => {
  for (const id of ['assetCurrent','assetCurrentEmpty','assetCurrentBody','assetNet','assetTotal',
    'assetLiability','assetUpdated','assetLedgerOpen','assetLedgerOpenEmpty','assetLedgerDialog',
    'ledgerTotal','ledgerLiability','ledgerNet','accountList','accountAdd','snapshotFromLedger',
    'accountEditDialog','accountName','accountType','accountBalance','accountNote',
    'accountDeletePrompt','accountDeleteConfirm','accountDeleteCancel',
    'ledgerSnapshotDialog','ledgerSnapshotDate','ledgerSnapshotTotal','ledgerSnapshotLiability','ledgerSnapshotNet'])
    assert.ok(html.includes('id="' + id + '"'), '缺少 ' + id);
  const nav = html.match(/<nav[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]), ['overview','detail','import']);
  // 首页当前资产区域位于资产快照入口之前，仍然只有三项导航。
  const page = html.slice(html.indexOf('id="view-overview"'), html.indexOf('id="view-detail"'));
  assert.ok(page.indexOf('id="assetCurrent"') < page.indexOf('id="snapshotsOpen"'));
  assert.ok(page.indexOf('id="sumNet"') < page.indexOf('id="assetCurrent"'));
});

test('首次打开显示还没有建立资产总账，不显示¥0.00冒充当前资产', async () => {
  const el = stubDom();
  const ui = setupAssetLedgerUI(noop);
  await ui.load();
  assert.equal(el.get('assetCurrentEmpty').hidden, false);
  assert.equal(el.get('assetCurrentBody').hidden, true);
  assert.equal(el.get('accountList').innerHTML.includes('还没有建立资产总账'), true);
  assert.equal(el.get('snapshotFromLedger').disabled, true);
  assert.deepEqual(await loadAssetLedger(), emptyLedger());
});

test('有总账时首页显示当前净资产、总资产、总负债与更新日期', async () => {
  const el = stubDom();
  const ui = setupAssetLedgerUI(noop);
  let ledger = addAccount(emptyLedger(), { name:'招商银行卡', type:'asset', balance:5000 });
  ledger = addAccount(ledger, { name:'微信', type:'asset', balance:'120.30' });
  ledger = addAccount(ledger, { name:'房贷', type:'liability', balance:1000.5 });
  await saveAssetLedger(ledger);
  await ui.load();
  assert.equal(el.get('assetCurrentEmpty').hidden, true);
  assert.equal(el.get('assetCurrentBody').hidden, false);
  assert.equal(el.get('assetNet').textContent, '¥4,119.80');
  assert.equal(el.get('assetTotal').textContent, '¥5,120.30');
  assert.equal(el.get('assetLiability').textContent, '¥1,000.50');
  assert.match(el.get('assetUpdated').textContent, /^更新于 \d{4}-\d{2}-\d{2} · 3 个账户$/);
  assert.equal(el.get('ledgerNet').textContent, '¥4,119.80');
  assert.equal(el.get('snapshotFromLedger').disabled, false);
});

test('通过UI表单添加、编辑、删除账户并持久化，非法输入不落库', async () => {
  const el = stubDom();
  const ui = setupAssetLedgerUI(noop);
  await ui.load();
  const form = el.get('accountForm');
  el.get('accountName').value = '现金'; el.get('accountType').value = 'asset'; el.get('accountBalance').value = '300';
  el.get('accountNote').value = '';
  await form.handlers.submit({ preventDefault(){} });
  let ledger = await loadAssetLedger();
  assert.deepEqual(ledger.accounts.map(a => [a.name, a.type, a.balance]), [['现金','asset',300]]);

  const cashId = ledger.accounts[0].id;
  el.get('accountList').handlers.click({ target:{ closest: selector => selector === '[data-edit]' ? { dataset:{ edit:cashId } } : null } });
  assert.equal(el.get('accountEditTitle').textContent, '编辑账户');
  el.get('accountBalance').value = '250.5'; el.get('accountType').value = 'liability';
  await form.handlers.submit({ preventDefault(){} });
  ledger = await loadAssetLedger();
  assert.deepEqual(ledger.accounts.map(a => [a.id, a.name, a.type, a.balance]), [[cashId,'现金','liability',250.5]]);

  el.get('accountList').handlers.click({ target:{ closest: selector => selector === '[data-delete]' ? { dataset:{ delete:cashId } } : null } });
  assert.equal(el.get('accountDeletePrompt').hidden, false);
  el.get('accountDeleteCancel').handlers.click();
  assert.equal((await loadAssetLedger()).accounts.length, 1);
  el.get('accountList').handlers.click({ target:{ closest: selector => selector === '[data-delete]' ? { dataset:{ delete:cashId } } : null } });
  await el.get('accountDeleteConfirm').handlers.click();
  assert.deepEqual((await loadAssetLedger()).accounts, []);

  el.get('accountAdd').handlers.click();
  assert.equal(el.get('accountEditTitle').textContent, '添加账户');
  el.get('accountName').value = ''; el.get('accountBalance').value = '10';
  await form.handlers.submit({ preventDefault(){} });
  assert.match(el.get('accountEditMsg').textContent, /名称/);
  assert.deepEqual((await loadAssetLedger()).accounts, []);
});

test('资产总账生成资产快照：只用总账自动合计，用户只需日期', async () => {
  const el = stubDom();
  const ui = setupAssetLedgerUI(noop);
  let ledger = addAccount(emptyLedger(), { name:'招商银行卡', type:'asset', balance:5000 });
  ledger = addAccount(ledger, { name:'微信', type:'asset', balance:'120.30' });
  ledger = addAccount(ledger, { name:'房贷', type:'liability', balance:1000.5 });
  await saveAssetLedger(ledger);
  await ui.load();

  el.get('snapshotFromLedger').handlers.click();
  assert.equal(el.get('ledgerSnapshotDialog').open, true);
  assert.equal(el.get('ledgerSnapshotTotal').textContent, '¥5,120.30');
  assert.equal(el.get('ledgerSnapshotLiability').textContent, '¥1,000.50');
  assert.equal(el.get('ledgerSnapshotNet').textContent, '¥4,119.80');
  assert.match(el.get('ledgerSnapshotDate').value, /^\d{4}-\d{2}-\d{2}$/);

  el.get('ledgerSnapshotDate').value = '2026-10-14';
  await el.get('ledgerSnapshotForm').handlers.submit({ preventDefault(){} });
  const snapshots = await loadSnapshots();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].date, '2026-10-14');
  assert.equal(snapshots[0].totalAssets, 5120.3);
  assert.equal(snapshots[0].totalLiabilities, 1000.5);
  assert.equal(snapshots[0].netAssets, 4119.8);
  assert.equal(snapshots[0].id.startsWith('snapshot:'), true);
  // 生成快照不改动总账本身。
  assert.deepEqual(await loadAssetLedger(), ledger);
});

test('修改余额不生成快照；记录快照是独立动作', async () => {
  const el = stubDom();
  const ui = setupAssetLedgerUI(noop);
  await saveSnapshot({ date:'2026-09-15', totalAssets:1, totalLiabilities:0, note:'手工沿用' });
  await ui.load();
  el.get('accountName').value = '现金'; el.get('accountType').value = 'asset'; el.get('accountBalance').value = '100';
  await el.get('accountForm').handlers.submit({ preventDefault(){} });
  const afterAdd = await loadSnapshots();
  assert.equal(afterAdd.length, 1); // 只有原有手工快照
  const cashId = (await loadAssetLedger()).accounts[0].id;
  el.get('accountList').handlers.click({ target:{ closest: s => s === '[data-edit]' ? { dataset:{ edit:cashId } } : null } });
  el.get('accountBalance').value = '777';
  await el.get('accountForm').handlers.submit({ preventDefault(){} });
  assert.equal((await loadAssetLedger()).accounts[0].balance, 777);
  assert.deepEqual(await loadSnapshots(), afterAdd); // 改余额没有产生新快照
  // 手工快照仍然可以独立新增与编辑。
  const manual = await saveSnapshot({ date:'2026-10-14', totalAssets:777, totalLiabilities:0 });
  assert.equal((await loadSnapshots()).length, 2);
  assert.equal(manual.netAssets, 777);
});

test('没有账户时拒绝从空总账生成快照', async () => {
  const el = stubDom();
  const ui = setupAssetLedgerUI(noop);
  await ui.load();
  await assert.rejects(ui.recordLedgerSnapshot('2026-10-14'), /还没有建立资产总账/);
  assert.deepEqual(await loadSnapshots(), []);
});

test('首页结余文案按范围区分：本账期/自定义为收支结余，使用以来为收支差额与预计净资产', () => {
  assert.ok(html.includes('id="sumNetLabel"'));
  assert.match(app, /document\.getElementById\('sumNetLabel'\)\.textContent = '收支结余'/);
  assert.match(app, /document\.getElementById\('sumNetLabel'\)\.textContent = '使用以来收支差额'/);
  // 收支差额不得写成当前资产、账户余额或净资产。
  assert.ok(!/sumNetLabel'\)\.textContent = '(当前资产|账户余额|净资产)'/.test(app));
  assert.ok(html.includes('id="assetNet"'));
});
