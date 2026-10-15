import test from 'node:test';
import assert from 'node:assert/strict';
import {
  USAGE_START_DATE, findStartingSnapshot, hasStartingSnapshot,
  estimateCurrentNet, checkDifference
} from '../js/estimated-assets.js';
import { usageTimeRange, rangeText, allTimeRange, filterTransactionsByRange, prevPeriodRange } from '../js/period.js';
import { createSnapshot } from '../js/snapshots.js';

const snap = (date, assets, liabilities = 0) => createSnapshot({ date, totalAssets:assets, totalLiabilities:liabilities });

test('正式记账起点固定为 2026-10-15，使用以来范围从该日到今天', () => {
  assert.equal(USAGE_START_DATE, '2026-10-15');
  const range = usageTimeRange();
  assert.equal(range.start, '2026-10-15');
  assert.equal(range.end, null);
  assert.equal(range.mode, 'usage');
  assert.equal(rangeText(range), '使用以来');
  // 使用以来不比较上一账期，也没有月份选择。
  assert.equal(prevPeriodRange(range), null);
});

test('2026-10-15 前交易不进入使用以来统计，当天及以后才进入', () => {
  const rows = [
    { id:'before',  datetime:'2026-10-14T23:59:59', direction:'支出', amount:999 },
    { id:'start',   datetime:'2026-10-15T00:00:00', direction:'支出', amount:10 },
    { id:'after',   datetime:'2026-10-16T12:00:00', direction:'支出', amount:5 }
  ];
  assert.deepEqual(filterTransactionsByRange(rows, usageTimeRange()).map(t => t.id), ['start','after']);
  // 旧记录仍然存在，仍可被自定义时间或全部时间看到。
  assert.equal(rows.length, 3);
  assert.deepEqual(filterTransactionsByRange(rows, allTimeRange()).map(t => t.id), ['before','start','after']);
});

test('起始净资产只读取 2026-10-15 那一天的快照，不用其他日期冒充', () => {
  const other = snap('2026-10-14', 9000);
  const exact = snap(USAGE_START_DATE, 5000);
  assert.equal(findStartingSnapshot([other]), null);
  assert.equal(hasStartingSnapshot([other]), false);
  assert.equal(findStartingSnapshot([other, exact]), exact);
  assert.equal(findStartingSnapshot([]), null);
  assert.equal(findStartingSnapshot(undefined), null);
  // 同一天有多条时取第一条，不会用其他日期替换。
  assert.equal(findStartingSnapshot([snap('2026-11-01', 1), exact]).date, USAGE_START_DATE);
});

test('起始 5000 支出 20 → 预计 4980；再收入 100 → 预计 5080', () => {
  const starting = snap(USAGE_START_DATE, 5000);
  const first = estimateCurrentNet(starting, { totalIncome:0, totalExpense:20 });
  assert.deepEqual(first, { startNetAssets:5000, income:0, expense:20, estimatedNetAssets:4980 });
  const second = estimateCurrentNet(starting, { totalIncome:100, totalExpense:20 });
  assert.deepEqual(second, { startNetAssets:5000, income:100, expense:20, estimatedNetAssets:5080 });
  // 收入与支出按分计算，不产生浮点误差。
  assert.equal(estimateCurrentNet(starting, { totalIncome:'0.10', totalExpense:'0.20' }).estimatedNetAssets, 4999.9);
  // 没有起始快照时返回 null，绝不把 0 当起点。
  assert.equal(estimateCurrentNet(null, { totalIncome:100, totalExpense:20 }), null);
});

test('待核对差额 = 实际当前净资产 − 预计当前净资产，为 0 时提示一致', () => {
  assert.deepEqual(checkDifference(4980, 5000), { difference:20, aligned:false });
  assert.deepEqual(checkDifference(5000, 4980), { difference:-20, aligned:false });
  assert.deepEqual(checkDifference(5000, 5000), { difference:0, aligned:true });
  assert.equal(checkDifference(null, 5000), null);
  assert.equal(checkDifference(5000, null), null);
});

test('估算是纯函数：只读取快照与统计结果，不修改快照或返回新快照', () => {
  const starting = Object.freeze(snap(USAGE_START_DATE, 5000));
  const summary = Object.freeze({ totalIncome:100, totalExpense:20 });
  const result = estimateCurrentNet(starting, summary);
  assert.equal(result.estimatedNetAssets, 5080);
  assert.equal(starting.netAssets, 5000);
  assert.deepEqual(Object.keys(starting).sort(), ['createdAt','date','id','netAssets','note','totalAssets','totalLiabilities']);
});
