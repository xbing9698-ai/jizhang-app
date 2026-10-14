import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { newQuickEntry, createQuickExpense } from '../js/quick-entry.js';
import { summarize } from '../js/aggregate.js';
import { billingPeriodRange } from '../js/period.js';
import { saveTransactions, loadAllTransactions, deleteManualTransaction, exportBackup, clearAllData, importBackup } from '../js/storage.js';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { mock.restoreAll(); delete globalThis.document; });
const create = () => createQuickExpense({ ...newQuickEntry(new Date(2026,9,1)), amount:'1.23', category:'其他', text:'快速记账测试' });

test('快速记账持久化刷新重读，删除后统计恢复，导入记录不可删除', async () => {
  const t = create();
  const imported = { id:'wx-test', source:'微信', datetime:'2026-10-01T12:00:00', direction:'支出', amount:10, myCategory:'购物' };
  await saveTransactions([t, imported]);
  const range = billingPeriodRange('2026-10');
  assert.deepEqual((await loadAllTransactions()).find(row => row.id === t.id), t);
  assert.equal(summarize(await loadAllTransactions(), range).totalExpense, 11.23);
  await deleteManualTransaction(t.id);
  assert.deepEqual(await loadAllTransactions(), [imported]);
  assert.equal(summarize(await loadAllTransactions(), range).totalExpense, 10);
  await assert.rejects(deleteManualTransaction(imported.id), /只能删除/);
});

test('快速记账在扩展JSON备份中导出清空恢复后字段完整', async () => {
  const t = create();
  await saveTransactions([t]);
  let blob;
  mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:quick-test'; });
  mock.method(URL, 'revokeObjectURL', () => {});
  globalThis.document = { createElement: () => ({ click() {} }) };
  await exportBackup();
  const json = await blob.text();
  assert.deepEqual(Object.keys(JSON.parse(json)).sort(), ['mem','snapshots','txns']);
  await clearAllData();
  assert.deepEqual(await loadAllTransactions(), []);
  await importBackup({ text:async () => json });
  assert.deepEqual(await loadAllTransactions(), [t]);
});
