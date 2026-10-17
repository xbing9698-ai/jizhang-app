import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { createSnapshot, snapshotTimeNow, relationToSnapshot, referenceFromSnapshot, reconcileBalance } from '../js/snapshots.js';
import { saveSnapshot, loadSnapshots, saveAssetLedger } from '../js/storage.js';
import { setupLedgerTools } from '../js/ledger-tools.js';
import { setupAssetLedgerUI } from '../js/asset-ledger-ui.js';
import { emptyLedger, addAccount } from '../js/asset-ledger.js';
import { customDateRange } from '../js/period.js';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { delete globalThis.document; });
const now = new Date(2026,9,17,20);
const input = (extra = {}) => ({ date:'2026-10-17', time:'12:00:45', totalAssets:5000, totalLiabilities:0, ...extra });
const row = (id, time = '00:00:00', source = '手动') =>
  ({ id, datetime:`2026-10-17T${time}`, source, direction:'支出', amount:100, myCategory:'餐饮' });
const range = customDateRange('2026-10-17','2026-10-18');
function dom() {
  const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id]) => [id, {
    value:'', textContent:'', innerHTML:'', hidden:false, disabled:false, open:false, handlers:{},
    addEventListener(type,fn) { this.handlers[type] = fn; },
    showModal() { this.open = true; }, close() { this.open = false; }, scrollIntoView() {}
  }]));
  globalThis.document = { getElementById(id) { assert.ok(elements.has(id),id); return elements.get(id); } };
  return id => elements.get(id);
}
const toolsOptions = rows => ({ getTransactions:() => rows, getRange:() => range, updateTransaction() {}, refreshApp() {} });

test('秒级默认时间及同一分钟内(opening,closing]边界保持准确', () => {
  assert.equal(snapshotTimeNow(new Date(2026,9,17,12,0,45)),'12:00:45');
  const s = createSnapshot(input({ transactionIdsAtCapture:['before'] }));
  const rows = [row('before','12:00:30','微信'),row('equal','12:00:45','微信'),row('after','12:00:46','微信')];
  assert.equal(s.capturedAt,'2026-10-17T12:00:45');
  assert.equal(referenceFromSnapshot(s,rows,now).referenceNetAssets,4900);
  const close = createSnapshot(input({ time:'12:00:46', totalAssets:4900 }));
  const r = reconcileBalance(s,close,rows,range);
  assert.equal(r.expense,100); assert.equal(r.difference,0); assert.equal(r.uncertainCount,0);
});

test('实际快照编辑处理器回显并保存秒数，备注编辑保留水印和余额推算', async () => {
  const s = await saveSnapshot(input({ transactionIdsAtCapture:['known'] }));
  const el = dom(), tools = setupLedgerTools(toolsOptions([row('known')]));
  await tools.newSnapshot(s.date);
  assert.equal(el('snapshotTime').value,'12:00:45');
  el('snapshotNote').value = '只改备注';
  await el('snapshotForm').handlers.submit({ preventDefault() {} });
  const [saved] = await loadSnapshots();
  assert.equal(saved.capturedAt,s.capturedAt); assert.deepEqual(saved.transactionIdsAtCapture,['known']);
  assert.equal(saved.note,'只改备注'); assert.equal(referenceFromSnapshot(saved,[row('known')],now).referenceNetAssets,5000);
});

test('旧快照真实编辑处理器只改备注或金额不新增capturedAt，继续按日末计算', async () => {
  const s = await saveSnapshot(input({ time:undefined }));
  const el = dom(), tools = setupLedgerTools(toolsOptions([]));
  await tools.newSnapshot(s.date);
  assert.equal(el('snapshotTime').value,''); assert.equal(el('snapshotTime').disabled,true);
  assert.equal(el('snapshotTime').required,false);
  el('snapshotNote').value = '旧快照备注'; el('snapshotAssets').value = '5100';
  await el('snapshotForm').handlers.submit({ preventDefault() {} });
  const [saved] = await loadSnapshots();
  assert.equal(saved.capturedAt,undefined); assert.equal(saved.note,'旧快照备注');
  assert.equal(referenceFromSnapshot(saved,[row('evening','23:59:59','微信')],now).referenceNetAssets,5100);
});

test('新快照及总账盘点入口默认时刻保留秒数，实际保存处理器不截断', async () => {
  const el = dom(), tools = setupLedgerTools(toolsOptions([]));
  await tools.newSnapshot('2026-10-17');
  assert.match(el('snapshotTime').value,/^\d{2}:\d{2}:\d{2}$/); assert.equal(el('snapshotTime').disabled,false);
  el('snapshotTime').value = '12:00:45'; el('snapshotAssets').value = '5000';
  await el('snapshotForm').handlers.submit({ preventDefault() {} });
  assert.equal((await loadSnapshots())[0].capturedAt,'2026-10-17T12:00:45');
  await saveAssetLedger(addAccount(emptyLedger(),{ name:'合成现金', type:'asset', balance:5000 }));
  const ui = setupAssetLedgerUI({ refreshApp() {}, refreshSnapshots:async () => {}, getTransactions:() => [] });
  await ui.load(); el('snapshotFromLedger').handlers.click();
  assert.match(el('ledgerSnapshotTime').value,/^\d{2}:\d{2}:\d{2}$/);
  el('ledgerSnapshotDate').value = '2026-10-18'; el('ledgerSnapshotTime').value = '12:00:45';
  await el('ledgerSnapshotForm').handlers.submit({ preventDefault() {} });
  assert.equal((await loadSnapshots()).find(s => s.date === '2026-10-18').capturedAt,'2026-10-18T12:00:45');
});

test('无水印历史时点快照的同日无时间流水即便暂不计入也明确不确定', () => {
  const s = createSnapshot(input());
  assert.deepEqual(relationToSnapshot(s,row('late')),{ relation:-1, uncertain:true });
  const r = referenceFromSnapshot(s,[row('late')],now);
  assert.equal(r.expense,0); assert.equal(r.uncertainCount,1);
});

test('有水印时已有记录视为包含，新出现的同日无时间记录保留不确定提示', () => {
  const s = createSnapshot(input({ transactionIdsAtCapture:['known'] }));
  const r = referenceFromSnapshot(s,[row('known'),row('late')],now);
  assert.equal(r.expense,100); assert.equal(r.uncertainCount,1);
});

test('修改快照时点后水印失效，即使调用者附带旧水印也不能继续使用', async () => {
  const s = await saveSnapshot(input({ transactionIdsAtCapture:['known'] }));
  const changed = await saveSnapshot(input({ time:'13:00:30', transactionIdsAtCapture:s.transactionIdsAtCapture }),s.id);
  assert.equal(changed.transactionIdsAtCapture,undefined);
  assert.equal(referenceFromSnapshot(changed,[row('known')],now).uncertainCount,1);
});

test('修改快照日期也使水印失效，省略时间时保留原秒数并使用新日期', () => {
  const s = createSnapshot(input({ transactionIdsAtCapture:['known'] }));
  const changed = createSnapshot(input({ date:'2026-10-18', time:undefined }),s);
  assert.equal(changed.capturedAt,'2026-10-18T12:00:45'); assert.equal(changed.transactionIdsAtCapture,undefined);
});

test('账期核对传递期初和期末被临时排除流水的不确定数量，每笔只计一次', () => {
  const opening = createSnapshot(input());
  const closing = createSnapshot(input({ time:'18:00:00' }));
  const r = reconcileBalance(opening,closing,[row('unknown')],range);
  assert.equal(r.uncertainCount,1); assert.equal(r.expense,0);
  const knownOpening = createSnapshot(input({ date:'2026-10-16', time:'12:00:00' }));
  const uncertainClosing = createSnapshot(input({ transactionIdsAtCapture:[] }));
  assert.equal(reconcileBalance(knownOpening,uncertainClosing,[row('unknown')],range).uncertainCount,1);
  assert.equal(reconcileBalance(opening,closing,[row('unknown')],customDateRange('2026-10-18','2026-10-18')).uncertainCount,0);
});

test('真实账期核对处理器显示不确定警告，不能只展示确定的金额结果', async () => {
  const opening = await saveSnapshot(input());
  const closing = await saveSnapshot(input({ time:'18:00:00' }));
  const el = dom(), tools = setupLedgerTools(toolsOptions([row('unknown')]));
  await tools.load(); await el('balanceOpen').handlers.click();
  el('balanceOpening').value = opening.id; el('balanceClosing').value = closing.id;
  el('balanceMode').value = 'custom'; el('balanceStart').value = range.start; el('balanceEnd').value = range.end;
  el('balanceForm').handlers.submit({ preventDefault() {} });
  assert.match(el('balanceMsg').textContent,/1 笔.*无法确认/); assert.match(el('balanceResult').innerHTML,/理论期末净资产/);
});
