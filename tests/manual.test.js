import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createManualExpense, isManualTransaction, todayDate } from '../js/manual.js';
import { resolveCategory, CATEGORIES } from '../js/classify.js';
import { summarize, matchesSearch, filterTransactionsBySource, buildPeriodTable } from '../js/aggregate.js';
import { billingPeriodLabel, billingPeriodRange, filterTransactionsByRange } from '../js/period.js';
import { mergeTransactions } from '../js/dedup.js';

const input = { date:'2026-09-15', amount:'28.50', category:'学习教育', text:'测试订阅费用' };
const create = overrides => createManualExpense({ ...input, ...overrides });

test('每次手动新增都有不同manual: UUID，相同填写内容也不误去重', () => {
  const records = Array.from({ length:20 }, () => create());
  assert.equal(new Set(records.map(t => t.id)).size, 20);
  assert.ok(records.every(t => /^manual:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(t.id)));
  assert.equal(mergeTransactions([], records).added, 20);
});

test('手动交易结构固定支出、来源及本地日期，不接受收入覆盖', () => {
  const t = create({ direction:'收入', source:'微信' });
  assert.deepEqual({ ...t, id:'忽略随机ID' }, {
    id:'忽略随机ID', externalOrderId:'', source:'手动', datetime:'2026-09-15T00:00:00',
    amount:28.5, direction:'支出', counterparty:'测试订阅费用', description:'测试订阅费用',
    rawCategory:'', myCategory:'学习教育', manual:true, status:'手动补录'
  });
  assert.ok(!Object.hasOwn(t, 'period'));
});

test('manual:true保护所选分类，不受关键词和商户记忆覆盖', () => {
  const t = create({ text:'测试美团午餐', category:'医疗健康' });
  assert.equal(resolveCategory(t, { '测试美团午餐':'餐饮' }), '医疗健康');
});

test('金额小于等于0、空值和空白均拒绝', () => {
  for (const amount of [-10, -0.01, 0, '0', '0.00', '-2', '', ' ', null, undefined])
    assert.throws(() => create({ amount }), /金额/);
});

test('非数字、非有限数及混合字符金额均拒绝', () => {
  for (const amount of ['abc', '12元', '12abc', 'NaN', NaN, Infinity, 'Infinity', true, [], {}, '0x10', '1e3'])
    assert.throws(() => create({ amount }), /金额/);
});

test('人民币金额接受整数及两位小数，拒绝多余精度和不可安全表示的金额', () => {
  assert.equal(create({ amount:' 0.01 ' }).amount, 0.01);
  assert.equal(create({ amount:'.50' }).amount, 0.5);
  assert.equal(create({ amount:10 }).amount, 10);
  for (const amount of ['0.001', '1.234', '999999999999999999999'])
    assert.throws(() => create({ amount }), /金额/);
});

test('日期不能为空，也不能是不存在或带时间的日期', () => {
  for (const date of ['', ' ', null, undefined, '2026-02-29', '2026-04-31', '2026-13-01', '2026-09-15T00:00:00'])
    assert.throws(() => create({ date }), /日期/);
  assert.equal(create({ date:'2024-02-29' }).datetime, '2024-02-29T00:00:00');
});

test('分类必须复用现有合法分类', () => {
  for (const category of ['', null, undefined, '新分类'])
    assert.throws(() => create({ category }), /分类/);
  for (const category of CATEGORIES) assert.equal(create({ category }).myCategory, category);
});

test('商户说明可为空，现有搜索、分类和商户字段不会报错', () => {
  const t = create({ text:'  ' });
  assert.equal(t.counterparty, '');
  assert.equal(t.description, '');
  assert.equal(resolveCategory(t), '学习教育');
  assert.equal(matchesSearch(t, ''), true);
  assert.equal(matchesSearch(t, '不存在'), false);
});

test('今天默认采用本地日期，不通过UTC字符串取日期', () => {
  assert.equal(todayDate(new Date(2026, 9, 14, 0, 5)), '2026-10-14');
  assert.equal(todayDate(new Date(2026, 0, 1, 23, 59)), '2026-01-01');
});

test('手动日期14/15日归入正确账期，跨年正确', () => {
  assert.equal(billingPeriodLabel(create({ date:'2026-09-14' }).datetime), '2026-09');
  assert.equal(billingPeriodLabel(create().datetime), '2026-10');
  assert.equal(billingPeriodLabel(create({ date:'2025-12-15' }).datetime), '2026-01');
});

test('手动记录参与总支出、分类、大额支出、每日趋势和历史账期', () => {
  const manual = create();
  const other = { id:'test-import', source:'支付宝', datetime:'2026-10-01T10:00:00',
    amount:10, direction:'支出', myCategory:'交通' };
  const rows = [manual, other];
  const s = summarize(rows, billingPeriodRange('2026-10'));
  assert.equal(s.totalExpense, 38.5);
  assert.equal(s.totalIncome, 0);
  assert.equal(s.net, -38.5);
  assert.equal(s.count, 2);
  assert.deepEqual(s.byCategory, { '学习教育':28.5, '交通':10 });
  assert.equal(s.topExpenses[0].id, manual.id);
  assert.deepEqual(s.byDay, { '2026-09-15':28.5, '2026-10-01':10 });
  assert.equal(buildPeriodTable(rows)[0].expense, 38.5);
});

test('补录到其他账期不会改变当前范围，全部时间仍可见', () => {
  const range = Object.freeze(billingPeriodRange('2026-09'));
  const t = create();
  assert.equal(filterTransactionsByRange([t], range).length, 0);
  assert.equal(summarize([t], range).totalExpense, 0);
  assert.equal(range.label, '2026-09');
  assert.equal(filterTransactionsByRange([t], null).length, 1);
});

test('来源筛选支持手动，全部来源仍同时包含导入记录', () => {
  const manual = create();
  const rows = [manual, { source:'微信' }, { source:'支付宝' }];
  assert.deepEqual(filterTransactionsBySource(rows, '手动'), [manual]);
  assert.deepEqual(filterTransactionsBySource(rows, ''), rows);
  assert.equal(filterTransactionsBySource(rows, '微信').length, 1);
});

test('手动商户说明及分类进入现有搜索', () => {
  const t = create();
  assert.equal(matchesSearch(t, '订阅费用'), true);
  assert.equal(matchesSearch(t, '学习教育'), true);
  assert.equal(matchesSearch(t, '28.5'), true);
});

test('删除资格仅按来源判断，已手动分类的微信支付宝也不能删除', () => {
  assert.equal(isManualTransaction(create()), true);
  for (const source of ['微信','支付宝',''])
    assert.equal(isManualTransaction({ source, manual:true, id:'manual:fake' }), false);
  assert.equal(isManualTransaction(undefined), false);
});
