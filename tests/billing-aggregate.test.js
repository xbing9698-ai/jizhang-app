import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, groupByCounterparty, buildPeriodTable } from '../js/aggregate.js';
import { billingPeriodRange, prevPeriodRange, filterTransactionsByRange } from '../js/period.js';

const mk = (id, datetime, amount, direction = '支出', myCategory = '餐饮', counterparty = '测试商户') =>
  Object.freeze({ id, datetime, amount, direction, myCategory, counterparty, status:'交易成功' });
const rows = Object.freeze([
  mk('before', '2026-09-14T23:59:59', 900),
  mk('start', '2026-09-15T00:00:00', 20),
  mk('september', '2026-09-30T12:00:00', 30, '支出', '交通', '测试交通'),
  mk('october', '2026-10-01T12:00:00', 40),
  mk('income', '2026-10-10T12:00:00', 200, '收入', '其他'),
  mk('end', '2026-10-14T23:59:59', 10),
  mk('neutral', '2026-10-14T23:59:59', 500, '中性', '其他'),
  Object.freeze({ ...mk('closed', '2026-10-12T12:00:00', 700), status:'交易关闭' }),
  mk('after', '2026-10-15T00:00:00', 800),
]);
const range = billingPeriodRange('2026-10');

test('概览总支出、总收入、结余与笔数按完整账期过滤', () => {
  const s = summarize(rows, range);
  assert.equal(s.totalExpense, 100);
  assert.equal(s.totalIncome, 200);
  assert.equal(s.net, 100);
  assert.equal(s.count, 4);
});

test('分类金额和占比只使用账期内可计入支出', () => {
  const s = summarize(rows, range);
  assert.deepEqual(s.byCategory, { '餐饮':70, '交通':30 });
  assert.equal(s.byCategory['餐饮'] / s.totalExpense, 0.7);
  assert.equal(s.byCategory['交通'] / s.totalExpense, 0.3);
});

test('商户汇总按同一账期过滤收入支出、中性及笔数', () => {
  const groups = groupByCounterparty(rows, range);
  const merchant = groups.find(g => g.counterparty === '测试商户');
  assert.equal(merchant.expense, 70);
  assert.equal(merchant.income, 200);
  assert.equal(merchant.net, 130);
  assert.equal(merchant.expenseCount, 3);
  assert.equal(merchant.incomeCount, 1);
  assert.equal(merchant.count, 6);
  assert.ok(!groups.flatMap(g => g.items).some(t => ['before','after'].includes(t.id)));
});

test('大额支出跨自然月排序，排除账期外、废单及中性记录', () => {
  const s = summarize(rows, range);
  assert.deepEqual(s.topExpenses.map(t => t.id), ['october','september','start','end']);
});

test('每日趋势同时包含9月和10月，只汇总账期内支出', () => {
  const s = summarize(rows, range);
  assert.deepEqual(s.byDay, {
    '2026-09-15':20, '2026-09-30':30, '2026-10-01':40, '2026-10-14':10
  });
});

test('明细与分类下钻复用同一范围，商户汇总与概览分类金额一致', () => {
  const detail = filterTransactionsByRange(rows, range);
  const category = detail.filter(t => t.myCategory === '餐饮');
  const groups = groupByCounterparty(category);
  assert.equal(detail.length, 7);
  assert.equal(groups.reduce((total, g) => total + g.expense, 0), summarize(rows, range).byCategory['餐饮']);
  assert.ok(category.every(t => !['before','after'].includes(t.id)));
});

test('上一账期环比数据来自8月15日至9月14日，而非9月自然月', () => {
  const list = [
    mk('tooEarly', '2026-08-14T23:59:59', 1000),
    mk('lastStart', '2026-08-15T00:00:00', 40),
    mk('lastEnd', '2026-09-14T23:59:59', 60),
    mk('currentStart', '2026-09-15T00:00:00', 200)
  ];
  const current = summarize(list, range);
  const previous = summarize(list, prevPeriodRange(range));
  assert.equal(current.totalExpense, 200);
  assert.equal(previous.totalExpense, 100);
  assert.equal((current.totalExpense - previous.totalExpense) / previous.totalExpense, 1);
});

test('历史账期表按结束月分组，金额、结余和各类笔数与概览一致', () => {
  const table = buildPeriodTable(rows);
  assert.deepEqual(table.map(r => r.period), ['2026-11','2026-10','2026-09']);
  const current = table.find(r => r.period === '2026-10');
  assert.deepEqual(current, {
    period:'2026-10', expense:100, income:200, net:100,
    expenseCount:4, incomeCount:1, count:7
  });
  for (const r of table) {
    const s = summarize(rows, billingPeriodRange(r.period));
    assert.equal(r.expense, s.totalExpense);
    assert.equal(r.income, s.totalIncome);
    assert.equal(r.net, s.net);
    assert.equal(r.expenseCount, s.count);
    assert.equal(r.count, filterTransactionsByRange(rows, billingPeriodRange(r.period)).length);
  }
});

test('全部时间保留所有账期，概览与商户汇总一致', () => {
  const all = { start:null, end:null, label:'全部' };
  const s = summarize(rows, all);
  assert.equal(s.totalExpense, 1800);
  assert.equal(s.totalIncome, 200);
  assert.equal(s.net, -1600);
  assert.equal(filterTransactionsByRange(rows, all).length, rows.length);
  const groups = groupByCounterparty(rows, all);
  assert.equal(groups.reduce((sum,g) => sum + g.expense, 0), s.totalExpense);
  assert.equal(groups.reduce((sum,g) => sum + g.income, 0), s.totalIncome);
});

test('账期计算及所有汇总不会修改旧交易或增加永久账期字段', () => {
  const before = JSON.stringify(rows);
  summarize(rows, range);
  groupByCounterparty(rows, range);
  buildPeriodTable(rows);
  assert.equal(JSON.stringify(rows), before);
  assert.ok(rows.every(t => !Object.hasOwn(t, 'period')));
});
