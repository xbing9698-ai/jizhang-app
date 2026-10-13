import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createManualExpense } from '../js/manual.js';
import { resolveCategory } from '../js/classify.js';
import { summarize } from '../js/aggregate.js';
import { billingPeriodRange } from '../js/period.js';
import {
  saveTransactions, loadAllTransactions, saveMemory, loadMemory, deleteManualTransaction,
  clearAllData, exportBackup, importBackup
} from '../js/storage.js';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { mock.restoreAll(); delete globalThis.document; });
const create = () => createManualExpense({ date:'2026-09-15', amount:'28.50',
  category:'医疗健康', text:'测试美团订阅' });
const range = billingPeriodRange('2026-10');

test('手动记录在现有IndexedDB中保存和重读，数据库仍为版本1且只有原有两表', async () => {
  const t = create();
  await saveTransactions([t]);
  assert.deepEqual(await loadAllTransactions(), [t]);
  const db = await new Promise((resolve,reject) => {
    const req = indexedDB.open('jizhang');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  assert.equal(db.version, 1);
  assert.deepEqual(Array.from(db.objectStoreNames), ['merchantMemory','transactions']);
  db.close();
});

test('实际JSON导出、清空、导入往返完整恢复手动记录与商户记忆', async () => {
  const t = create();
  const imported = { id:'wx-test', source:'微信', datetime:'2026-09-16T12:00:00',
    amount:10, direction:'支出', myCategory:'交通' };
  await saveTransactions([t, imported]);
  await saveMemory(t.counterparty, '餐饮');
  let blob, clicked = false;
  mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:test-backup'; });
  mock.method(URL, 'revokeObjectURL', () => {});
  globalThis.document = { createElement: () => ({ click: () => { clicked = true; } }) };
  await exportBackup();
  assert.equal(clicked, true);
  const json = await blob.text();
  const backup = JSON.parse(json);
  assert.deepEqual(Object.keys(backup).sort(), ['mem','txns']);
  assert.deepEqual(backup.txns.find(row => row.id === t.id), t);
  await clearAllData();
  assert.deepEqual(await loadAllTransactions(), []);
  assert.deepEqual(await loadMemory(), {});
  await importBackup({ text:async () => json });
  const restored = await loadAllTransactions();
  assert.deepEqual(restored.find(row => row.id === t.id), t);
  assert.equal(restored.length, 2);
  const memory = await loadMemory();
  assert.equal(memory[t.counterparty], '餐饮');
  assert.equal(resolveCategory(restored.find(row => row.id === t.id), memory), '医疗健康');
  assert.equal(summarize(restored, range).totalExpense, 38.5);
});

test('删除手动记录持久化生效，统计同步减少，其他记录保留', async () => {
  const t = create();
  const imported = { id:'ali-test', source:'支付宝', datetime:'2026-10-01T00:00:00',
    amount:10, direction:'支出', myCategory:'交通' };
  await saveTransactions([t, imported]);
  assert.equal(summarize(await loadAllTransactions(), range).totalExpense, 38.5);
  await deleteManualTransaction(t.id);
  const remaining = await loadAllTransactions();
  assert.deepEqual(remaining, [imported]);
  const s = summarize(remaining, range);
  assert.equal(s.totalExpense, 10);
  assert.equal(s.byCategory['医疗健康'], undefined);
  assert.ok(!s.topExpenses.some(row => row.id === t.id));
  assert.equal(s.byDay['2026-09-15'], undefined);
});

test('存储层拒绝删除微信支付宝记录，即使ID伪装manual:或已手动分类', async () => {
  for (const source of ['微信','支付宝']) {
    const t = { id:`manual:fake-${source}`, source, manual:true, myCategory:'其他' };
    await saveTransactions([t]);
    await assert.rejects(deleteManualTransaction(t.id), /只能删除手动补录/);
    assert.deepEqual((await loadAllTransactions()).find(row => row.id === t.id), t);
  }
});

test('不存在的ID删除失败，不影响其他交易', async () => {
  const t = create();
  await saveTransactions([t]);
  await assert.rejects(deleteManualTransaction('manual:missing'), /只能删除手动补录/);
  assert.deepEqual(await loadAllTransactions(), [t]);
});
