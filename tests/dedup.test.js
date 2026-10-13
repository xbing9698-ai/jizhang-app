import { test } from 'node:test';
import assert from 'node:assert';
const { mergeTransactions, isCountableExpense } = await import('../js/dedup.js');
import { normalizeAlipay, normalizeWechat } from '../js/normalize.js';

const mk = (id, dir='支出', status='交易成功', amount=10) =>
  ({ id, direction:dir, status, amount, source:'支付宝' });

test('按 id 去重，返回新增与跳过计数', () => {
  const existing = [mk('A'), mk('B')];
  const incoming = [mk('B'), mk('C')]; // B 重复
  const { merged, added, skipped } = mergeTransactions(existing, incoming);
  assert.strictEqual(merged.length, 3);
  assert.strictEqual(added, 1);
  assert.strictEqual(skipped, 1);
});

test('计入消费：仅支出且非交易关闭', () => {
  assert.strictEqual(isCountableExpense(mk('X','支出','交易成功')), true);
  assert.strictEqual(isCountableExpense(mk('X','支出','交易关闭')), false);
  assert.strictEqual(isCountableExpense(mk('X','中性','交易成功')), false);
  assert.strictEqual(isCountableExpense(mk('X','收入','交易成功')), false);
});

test('直接合并无ID记录不丢弃，相同行分开保留，重复批次跳过', () => {
  const rows = [mk(''), mk('')];
  const first = mergeTransactions([], rows);
  assert.strictEqual(first.added, 2);
  assert.strictEqual(first.skipped, 0);
  assert.notStrictEqual(first.merged[0].id, first.merged[1].id);
  const second = mergeTransactions(first.merged, rows);
  assert.strictEqual(second.added, 0);
  assert.strictEqual(second.skipped, 2);
});

test('旧原始订单ID按平台兼容去重，旧ID与手动分类不改写', () => {
  const old = { ...mk('SAME001'), manual:true, myCategory:'医疗健康' };
  const snapshot = structuredClone(old);
  const a = normalizeAlipay({ '交易订单号':'SAME001' });
  const w = normalizeWechat({ '交易单号':'SAME001' });
  const result = mergeTransactions([old], [a, w]);
  assert.strictEqual(result.added, 1);
  assert.strictEqual(result.skipped, 1);
  assert.deepStrictEqual(result.merged[0], snapshot);
  assert.strictEqual(result.merged[1].source, '微信');
});

test('旧微信原始订单ID仍能识别再次导入', () => {
  const old = { ...mk('WX001'), source:'微信' };
  const result = mergeTransactions([old], [normalizeWechat({ '交易单号':'WX001' })]);
  assert.strictEqual(result.added, 0);
  assert.strictEqual(result.skipped, 1);
});
