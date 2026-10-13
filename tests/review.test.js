import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countedExpenseAmount, adjustTransaction, canAdjustTransaction, needsReview, reviewReason, filterNeedsReview } from '../js/review.js';
import { mergeTransactions, isCountableExpense } from '../js/dedup.js';

const base = { id:'test-order', source:'微信', datetime:'2026-09-15T12:00:00', amount:100,
  direction:'支出', status:'部分退款', rawCategory:'商户消费', myCategory:'购物',
  counterparty:'测试商户', description:'虚构商品', externalOrderId:'test-order', note:'原备注' };

test('普通旧支出默认使用原始金额，null覆盖也回退原金额', () => {
  assert.equal(countedExpenseAmount(base), 100);
  assert.equal(countedExpenseAmount({ ...base, countedAmount:null }), 100);
});

test('excluded=true实际计入0，优先于countedAmount', () => {
  assert.equal(countedExpenseAmount({ ...base, excluded:true, countedAmount:70 }), 0);
  assert.equal(isCountableExpense({ ...base, excluded:true }), false);
});

test('合法countedAmount替代原金额', () => {
  assert.equal(countedExpenseAmount({ ...base, countedAmount:70 }), 70);
  assert.equal(countedExpenseAmount({ ...base, countedAmount:99.99 }), 99.99);
});

test('非支出或交易关闭始终计0，正常计入也不能覆盖关闭规则', () => {
  for (const direction of ['收入','中性']) assert.equal(countedExpenseAmount({ ...base, direction }), 0);
  const closed = { ...base, status:'交易关闭', countedAmount:50 };
  assert.equal(countedExpenseAmount(closed), 0);
  assert.equal(countedExpenseAmount(adjustTransaction(closed, 'include')), 0);
});

test('修改计入金额拒绝负数', () => {
  for (const amount of [-1, '-0.01']) assert.throws(() => adjustTransaction(base, 'amount', amount), /计入金额/);
});

test('修改计入金额拒绝0，要求改用不计入', () => {
  for (const amount of [0, '0', '0.00']) assert.throws(() => adjustTransaction(base, 'amount', amount), /0元请选择不计入统计/);
});

test('修改计入金额不得大于原始金额', () => {
  assert.throws(() => adjustTransaction(base, 'amount', 100.01), /不超过原始金额/);
  assert.equal(adjustTransaction(base, 'amount', 100).countedAmount, 100);
});

test('修改计入金额拒绝超过两位小数', () => {
  for (const amount of [70.001, '70.001', '1.230']) assert.throws(() => adjustTransaction(base, 'amount', amount), /最多两位小数/);
  assert.equal(adjustTransaction(base, 'amount', '70.01').countedAmount, 70.01);
});

test('修改计入金额拒绝非数字、空值、非有限数、布尔和混合字符', () => {
  for (const amount of ['', ' ', undefined, null, NaN, Infinity, 'NaN', '70元', true, [], '1e1'])
    assert.throws(() => adjustTransaction(base, 'amount', amount), /计入金额/);
});

test('金额输入支持普通人民币格式', () => {
  assert.equal(adjustTransaction(base, 'amount', ' 70.50 ').countedAmount, 70.5);
  assert.equal(adjustTransaction(base, 'amount', '.50').countedAmount, 0.5);
});

test('非法备份覆盖值安全回退原始金额', () => {
  for (const countedAmount of [-1, 0, 101, 70.001, NaN, Infinity, '70', true, {}])
    assert.equal(countedExpenseAmount({ ...base, countedAmount }), 100);
});

test('三个动作均只改统计字段，原始金额、状态、来源及所有其他字段不变', () => {
  const frozen = Object.freeze({ ...base, sourceDetail:'原始来源', tags:'原标签' });
  for (const action of ['include','exclude','amount']) {
    const updated = adjustTransaction(frozen, action, 70);
    assert.notEqual(updated, frozen);
    for (const [key,value] of Object.entries(frozen)) assert.deepEqual(updated[key], value);
    assert.equal(updated.reviewed, true);
  }
});

for (const status of ['已退款','退款成功','部分退款','已部分退款','退款处理中']) {
  test(`${status}支出自动进入需处理并保留原始原因`, () => {
    const t = { ...base, status };
    assert.equal(needsReview(t), true);
    assert.equal(reviewReason(t), status);
  });
}

test('支付宝不计收支退款、收入退款、交易关闭及普通消费不强制处理', () => {
  for (const t of [
    { ...base, source:'支付宝', direction:'中性', status:'退款成功', rawCategory:'退款' },
    { ...base, direction:'收入', status:'已退款' },
    { ...base, status:'交易关闭' }, { ...base, status:'交易成功' },
    { ...base, source:'手动' }
  ]) assert.equal(needsReview(t), false);
});

test('reviewed=true后不在只看需处理中，缺失或false仍待处理', () => {
  const done = { ...base, reviewed:true };
  assert.equal(needsReview(done), false);
  assert.deepEqual(filterNeedsReview([base, done, { ...base, reviewed:false }]), [base, { ...base, reviewed:false }]);
});

test('正常计入清除排除和金额覆盖，保留已处理标记', () => {
  const t = adjustTransaction({ ...base, excluded:true, countedAmount:70 }, 'include');
  assert.equal(t.excluded, false);
  assert.equal(t.countedAmount, null);
  assert.equal(t.reviewed, true);
  assert.equal(countedExpenseAmount(t), 100);
});

test('不计入动作清除覆盖并移出待处理，修改金额动作解除排除', () => {
  const excluded = adjustTransaction({ ...base, countedAmount:70 }, 'exclude');
  assert.equal(excluded.excluded, true);
  assert.equal(excluded.countedAmount, null);
  assert.equal(needsReview(excluded), false);
  const counted = adjustTransaction(excluded, 'amount', 70);
  assert.equal(counted.excluded, false);
  assert.equal(counted.countedAmount, 70);
  assert.equal(countedExpenseAmount(counted), 70);
});

test('普通微信支付宝支出允许主动调整，手动及收入不使用此入口', () => {
  for (const source of ['微信','支付宝']) {
    assert.equal(canAdjustTransaction({ ...base, source, status:'交易成功' }), true);
    assert.equal(adjustTransaction({ ...base, source, status:'交易成功' }, 'amount', 70).countedAmount, 70);
  }
  for (const t of [{ ...base, source:'手动' }, { ...base, direction:'收入' }, undefined]) {
    assert.equal(canAdjustTransaction(t), false);
    assert.throws(() => adjustTransaction(t, 'include'), /只能调整/);
  }
  assert.throws(() => adjustTransaction(base, 'other'), /未知处理动作/);
});

test('相同时间金额不提示疑似重复，重复导入也保留已处理结果', () => {
  const t = adjustTransaction(base, 'amount', 70);
  assert.equal(needsReview({ ...base, id:'another', status:'交易成功' }), false);
  const result = mergeTransactions([t], [{ ...base }]);
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.merged, [t]);
});
