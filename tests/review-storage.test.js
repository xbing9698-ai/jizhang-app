import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { saveTransactions, loadAllTransactions, saveExpenseAdjustment, exportBackup, clearAllData, importBackup } from '../js/storage.js';
import { countedExpenseAmount, needsReview } from '../js/review.js';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { mock.restoreAll(); delete globalThis.document; });
const base = { id:'test-review', source:'微信', direction:'支出', amount:100,
  datetime:'2026-09-15T12:00:00', status:'部分退款', counterparty:'测试商户',
  description:'虚构退款商品', myCategory:'购物', rawCategory:'商户消费', sourceDetail:'测试原始来源' };

test('单笔调整持久化后重新读取，原始字段保留，其他记录不受影响', async () => {
  const other = { ...base, id:'other', amount:50, status:'交易成功' };
  await saveTransactions([base, other]);
  const t = await saveExpenseAdjustment(base.id, 'amount', '70');
  assert.equal(t.amount, 100);
  assert.equal(t.countedAmount, 70);
  assert.equal(t.status, '部分退款');
  assert.equal(t.source, '微信');
  assert.equal(t.sourceDetail, '测试原始来源');
  const stored = await loadAllTransactions();
  assert.deepEqual(stored.find(row => row.id === base.id), t);
  assert.deepEqual(stored.find(row => row.id === other.id), other);
  assert.equal(needsReview(stored.find(row => row.id === base.id)), false);
});

test('原金额以存储中的记录为准，不能通过界面传入更高上限', async () => {
  await saveTransactions([base]);
  await assert.rejects(saveExpenseAdjustment(base.id, 'amount', 101), /不超过原始金额/);
  assert.deepEqual(await loadAllTransactions(), [base]);
});

test('异常值保存失败后不改原始记录，也不标记已处理', async () => {
  await saveTransactions([base]);
  for (const amount of [0, -1, NaN, 'abc', '70.001']) {
    await assert.rejects(saveExpenseAdjustment(base.id, 'amount', amount), /计入金额/);
    assert.deepEqual(await loadAllTransactions(), [base]);
  }
});

test('存储层拒绝手动、收入及不存在的记录调整', async () => {
  for (const t of [{ ...base, source:'手动' }, { ...base, direction:'收入' }]) {
    await saveTransactions([t]);
    await assert.rejects(saveExpenseAdjustment(t.id, 'exclude'), /只能调整/);
    assert.deepEqual(await loadAllTransactions(), [t]);
  }
  await assert.rejects(saveExpenseAdjustment('missing', 'include'), /只能调整/);
});

test('导出清空恢复完整保留三种处理结果及旧记录，备份结构不变', async () => {
  const originals = ['include','exclude','amount'].map((action,i) => ({ ...base, id:`review-${i}` }));
  const legacy = { ...base, id:'legacy', status:'交易成功' };
  await saveTransactions([...originals, legacy]);
  for (const [i,action] of ['include','exclude','amount'].entries())
    await saveExpenseAdjustment(originals[i].id, action, 70);
  const expected = await loadAllTransactions();
  let blob;
  mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:review-backup'; });
  mock.method(URL, 'revokeObjectURL', () => {});
  globalThis.document = { createElement: () => ({ click: () => {} }) };
  await exportBackup();
  const json = await blob.text();
  assert.deepEqual(Object.keys(JSON.parse(json)).sort(), ['mem','txns']);
  await clearAllData();
  assert.deepEqual(await loadAllTransactions(), []);
  await importBackup({ text:async () => json });
  const restored = await loadAllTransactions();
  assert.deepEqual(restored, expected);
  assert.deepEqual(restored.filter(t => t.id !== 'legacy').map(countedExpenseAmount), [100,0,70]);
  assert.equal(countedExpenseAmount(restored.find(t => t.id === 'legacy')), 100);
  assert.ok(restored.every(t => t.amount === 100 && t.source === '微信'));
});

test('不计入和恢复正常两个动作刷新重读后仍保持结果', async () => {
  await saveTransactions([base]);
  await saveExpenseAdjustment(base.id, 'exclude');
  assert.equal(countedExpenseAmount((await loadAllTransactions())[0]), 0);
  await saveExpenseAdjustment(base.id, 'include');
  const [t] = await loadAllTransactions();
  assert.equal(t.countedAmount, null);
  assert.equal(t.excluded, false);
  assert.equal(t.reviewed, true);
  assert.equal(countedExpenseAmount(t), 100);
});
