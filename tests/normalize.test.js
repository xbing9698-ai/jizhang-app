import { test } from 'node:test';
import assert from 'node:assert';
const { normalizeAlipay, normalizeWechat } = await import('../js/normalize.js');

test('支付宝归一：方向/金额/来源/ISO时间', () => {
  const t = normalizeAlipay({
    '交易时间':'2026-05-30 20:17:08','交易分类':'餐饮美食','交易对方':'商户A',
    '商品说明':'午餐','收/支':'支出','金额':'21.92','收/付方式':'中国银行',
    '交易状态':'交易成功','交易订单号':'ALI0001','备注':''
  });
  assert.strictEqual(t.source, '支付宝');
  assert.strictEqual(t.amount, 21.92);
  assert.strictEqual(t.direction, '支出');
  assert.strictEqual(t.id, 'order:v1:%E6%94%AF%E4%BB%98%E5%AE%9D:ALI0001');
  assert.strictEqual(t.externalOrderId, 'ALI0001');
  assert.strictEqual(t.datetime, '2026-05-30T20:17:08');
});

test('支付宝不计收支 -> 中性', () => {
  const t = normalizeAlipay({'交易时间':'2026-05-28 12:00:00','收/支':'不计收支',
    '金额':'500.00','交易订单号':'ALI0003','交易分类':'','交易对方':'','商品说明':'',
    '收/付方式':'','交易状态':'交易成功','备注':''});
  assert.strictEqual(t.direction, '中性');
});

test('微信归一：Date转ISO，中性交易->中性', () => {
  const t = normalizeWechat({
    '交易时间':new Date('2026-05-31T12:48:45'),'交易类型':'商户消费','交易对方':'外卖',
    '商品':'订单','收/支':'支出','金额(元)':19.6,'支付方式':'零钱',
    '当前状态':'支付成功','交易单号':'WX0001','备注':'/'
  });
  assert.strictEqual(t.source, '微信');
  assert.strictEqual(t.amount, 19.6);
  assert.strictEqual(t.datetime, '2026-05-31T12:48:45');
});

test('记账本八字段归一化，来源与备注不会伪造商户', () => {
  const t = normalizeAlipay({
    '记录时间':'2026-05-30 20:17:08', '分类':'退款', '收支类型':'收入',
    '金额':'21.92', '备注':'午餐退款', '账户':'余额', '来源':'某餐厅', '标签':'午餐,退款'
  });
  assert.strictEqual(t.datetime, '2026-05-30T20:17:08');
  assert.strictEqual(t.rawCategory, '退款');
  assert.strictEqual(t.direction, '收入');
  assert.strictEqual(t.amount, 21.92);
  assert.strictEqual(t.description, '午餐退款');
  assert.strictEqual(t.payMethod, '余额');
  assert.strictEqual(t.sourceDetail, '某餐厅');
  assert.strictEqual(t.tags, '午餐,退款');
  assert.strictEqual(t.source, '支付宝');
  assert.strictEqual(t.counterparty, '');
  assert.strictEqual(t.externalOrderId, '');
  assert.ok(t.id);
});

test('记账本支出、收入、不计收支分别映射，原始特殊分类不丢失', () => {
  for (const [raw, expected] of [['支出','支出'], ['收入','收入'], ['不计收支','中性']]) {
    for (const rawCategory of ['退款', '借还款', '投资理财', '自定义原始分类']) {
      const t = normalizeAlipay({ '记录时间':'2026-05-30 12:00:00', '分类':rawCategory,
        '收支类型':raw, '金额':'12.50' });
      assert.strictEqual(t.direction, expected);
      assert.strictEqual(t.rawCategory, rawCategory);
    }
  }
});

test('无订单号的两平台记录均有稳定内部ID，键顺序不影响身份', () => {
  for (const normalize of [normalizeAlipay, normalizeWechat]) {
    const a = normalize({ '交易时间':'2026-05-30 12:00:00', '金额':'10' });
    const b = normalize({ '金额':'10', '交易时间':'2026-05-30 12:00:00' });
    assert.ok(a.id);
    assert.strictEqual(a.id, b.id);
    assert.strictEqual(a.externalOrderId, '');
  }
});

test('微信与支付宝同外部订单号不会产生内部ID冲突', () => {
  const a = normalizeAlipay({ '交易订单号':'SAME001' });
  const w = normalizeWechat({ '交易单号':'SAME001' });
  assert.notStrictEqual(a.id, w.id);
  assert.strictEqual(a.externalOrderId, w.externalOrderId);
});
