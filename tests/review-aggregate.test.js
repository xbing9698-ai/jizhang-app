import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, groupByCounterparty, buildPeriodTable } from '../js/aggregate.js';
import { countedExpenseAmount, adjustTransaction } from '../js/review.js';
import { billingPeriodRange } from '../js/period.js';

const mk = (id, amount, extra = {}) => ({ id, source:'微信', direction:'支出', status:'交易成功',
  datetime:'2026-09-15T12:00:00', amount, counterparty:'测试商户', myCategory:'餐饮', ...extra });
const rows = [
  mk('partial', 100, { countedAmount:70, reviewed:true, status:'部分退款' }),
  mk('excluded', 200, { excluded:true, reviewed:true, status:'退款成功', myCategory:'交通' }),
  mk('normal', 90, { datetime:'2026-09-16T12:00:00' }),
  mk('closed', 300, { status:'交易关闭', countedAmount:90, myCategory:'购物' }),
  mk('income', 400, { direction:'收入', excluded:true, countedAmount:1 }),
  mk('neutral', 500, { direction:'中性', status:'退款成功' }),
  mk('monthEnd', 40, { datetime:'2026-10-14T23:59:59' })
];
const range = billingPeriodRange('2026-10');

test('不计入后总支出减少，恢复正常计入恢复原金额', () => {
  const t = mk('test', 100);
  assert.equal(summarize([t], range).totalExpense, 100);
  assert.equal(summarize([adjustTransaction(t, 'exclude')], range).totalExpense, 0);
  assert.equal(summarize([adjustTransaction(adjustTransaction(t, 'exclude'), 'include')], range).totalExpense, 100);
});

test('修改计入金额后总支出及结余正确，收入仍使用原金额', () => {
  const s = summarize(rows, range);
  assert.equal(s.totalExpense, 200);
  assert.equal(s.totalIncome, 400);
  assert.equal(s.net, 200);
  assert.equal(s.count, 3);
});

test('分类金额及占比使用实际金额，排除和关闭记录不产生分类支出', () => {
  const s = summarize(rows, range);
  assert.deepEqual(s.byCategory, { '餐饮':200 });
  assert.equal(s.byCategory['餐饮'] / s.totalExpense, 1);
});

test('商户汇总使用实际金额，排除记录不计支出笔数但原始明细仍保留', () => {
  const [g] = groupByCounterparty(rows, range);
  assert.equal(g.expense, 200);
  assert.equal(g.total, 200);
  assert.equal(g.income, 400);
  assert.equal(g.net, 200);
  assert.equal(g.expenseCount, 3);
  assert.equal(g.items.length, 7);
});

test('历史账期汇总使用实际金额和支出笔数，日期边界维持不变', () => {
  const list = [...rows, mk('nextPeriod', 500, { countedAmount:50, datetime:'2026-10-15T00:00:00' })];
  const history = buildPeriodTable(list);
  assert.deepEqual(history.map(r => r.period), ['2026-11','2026-10']);
  assert.equal(history[0].expense, 50);
  assert.equal(history[1].expense, 200);
  assert.equal(history[1].income, 400);
  assert.equal(history[1].net, 200);
  assert.equal(history[1].expenseCount, 3);
});

test('跨自然月每日趋势使用实际金额，不包含排除或关闭记录', () => {
  assert.deepEqual(summarize(rows, range).byDay, {
    '2026-09-15':70, '2026-09-16':90, '2026-10-14':40
  });
});

test('Top5按实际金额排序和取值，保留原amount，排除记录不进入', () => {
  const list = [...rows, mk('sixty', 60), mk('thirty', 30), mk('twenty', 20)];
  const top = summarize(list, range).topExpenses;
  assert.deepEqual(top.map(t => t.id), ['normal','partial','sixty','monthEnd','thirty']);
  assert.deepEqual(top.map(countedExpenseAmount), [90,70,60,40,30]);
  assert.equal(top[1].amount, 100);
});

test('旧记录缺少三个新增字段仍正常统计，全部时间及范围筛选仍兼容', () => {
  const legacy = [mk('old', 100), mk('other', 20, { datetime:'2026-10-15T00:00:00' })];
  assert.equal(summarize(legacy, range).totalExpense, 100);
  assert.equal(summarize(legacy).totalExpense, 120);
});

test('所有统计均不修改原始记录或处理字段', () => {
  const before = structuredClone(rows);
  const frozen = rows.map(t => Object.freeze({ ...t }));
  summarize(frozen, range);
  groupByCounterparty(frozen, range);
  buildPeriodTable(frozen);
  assert.deepEqual(frozen, before);
});
