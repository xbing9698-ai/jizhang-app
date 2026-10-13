import { test } from 'node:test';
import assert from 'node:assert';
const { classify, resolveCategory, CATEGORIES } = await import('../js/classify.js');

const base = { counterparty:'', description:'', rawCategory:'', source:'支付宝', direction:'支出' };

test('商户记忆优先级最高', () => {
  const t = { ...base, counterparty:'神秘小店', rawCategory:'餐饮美食' };
  assert.strictEqual(classify(t, { '神秘小店':'学习教育' }), '学习教育');
});

test('支付宝原始分类映射', () => {
  assert.strictEqual(classify({ ...base, rawCategory:'餐饮美食' }, {}), '餐饮');
  assert.strictEqual(classify({ ...base, rawCategory:'交通出行' }, {}), '交通');
});

test('关键词规则（微信无好分类时）', () => {
  const t = { ...base, source:'微信', counterparty:'美团', rawCategory:'商户消费' };
  assert.strictEqual(classify(t, {}), '餐饮');
});

test('地铁关键词 -> 交通', () => {
  const t = { ...base, source:'微信', counterparty:'北京轨道交通', rawCategory:'扫二维码付款' };
  assert.strictEqual(classify(t, {}), '交通');
});

test('都未命中 -> 其他', () => {
  assert.strictEqual(classify({ ...base, counterparty:'xyz', description:'zzz' }, {}), '其他');
});

test('转账与红包都归入"转账"类', () => {
  assert.strictEqual(classify({ ...base, source:'微信', counterparty:'某人', description:'转账备注:微信转账' }, {}), '转账');
  assert.strictEqual(classify({ ...base, source:'微信', counterparty:'某人', description:'微信红包' }, {}), '转账');
});

test('CATEGORIES 含学生版分类，且已无"人情往来"', () => {
  assert.ok(CATEGORIES.includes('学习教育'));
  assert.ok(CATEGORIES.includes('转账'));
  assert.ok(!CATEGORIES.includes('人情往来'));
});

test('塔斯汀等快餐命中餐饮', () => {
  assert.strictEqual(classify({ ...base, source:'微信', counterparty:'塔斯汀', rawCategory:'商户消费' }, {}), '餐饮');
  assert.strictEqual(classify({ ...base, source:'微信', counterparty:'肯德基', rawCategory:'商户消费' }, {}), '餐饮');
});

test('resolveCategory: 手动分类绝对优先，永不被规则覆盖', () => {
  // 塔斯汀按规则=餐饮，但用户手动标了医疗健康，必须保留医疗健康
  const t = { ...base, source:'微信', counterparty:'塔斯汀', myCategory:'医疗健康', manual:true };
  assert.strictEqual(resolveCategory(t, {}), '医疗健康');
});

test('resolveCategory: 空商户名的手动分类也能保住（修复记忆失效）', () => {
  // 对方为"/"无法走商户记忆，但 manual 标记仍保证手动分类不丢
  const t = { ...base, source:'微信', counterparty:'/', description:'/', myCategory:'转账', manual:true };
  assert.strictEqual(resolveCategory(t, {}), '转账');
});

test('resolveCategory: 未手动标记时回退到规则', () => {
  const t = { ...base, source:'微信', counterparty:'塔斯汀', rawCategory:'商户消费' };
  assert.strictEqual(resolveCategory(t, {}), '餐饮');
});

test('记账本已有分类映射到现有体系，优先于备注关键词', () => {
  for (const [rawCategory, expected] of [
    ['餐饮','餐饮'], ['购物','购物'], ['交通','交通'], ['生活日用','购物'],
    ['医疗保健','医疗健康'], ['其他','其他']
  ]) {
    assert.strictEqual(classify({ ...base, rawCategory, description:'地铁午餐' }), expected);
  }
});

test('旧记录缺少新增字段时分类继续安全运行', () => {
  assert.strictEqual(resolveCategory({ source:'支付宝', rawCategory:'餐饮美食' }), '餐饮');
});
