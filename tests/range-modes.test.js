import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { currentBillingPeriod, billingPeriodRange, customDateRange, allTimeRange, prevPeriodRange, filterTransactionsByRange } from '../js/period.js';
import { summarize, groupByCounterparty, buildPeriodTable } from '../js/aggregate.js';

test('默认本账期是今天所在账期，14/15日及跨年正确', () => {
  for (const [date,label] of [[new Date(2026,9,14),'2026-10'],[new Date(2026,9,15),'2026-11'],[new Date(2025,11,15),'2026-01'],[new Date(2024,1,29),'2024-03']])
    assert.deepEqual(currentBillingPeriod(date), billingPeriodRange(label));
});
test('自定义首尾包含整天，统计与商户、历史分组一致，不改交易', () => {
  const rows = ['2026-09-30T23:59:59','2026-10-01T00:00:00','2026-10-02T23:59:59','2026-10-03T00:00:00'].map((datetime,i)=>Object.freeze({ id:String(i),datetime,direction:'支出',amount:10,myCategory:'餐饮',counterparty:'测试商户' }));
  const range = customDateRange('2026-10-01','2026-10-02');
  assert.deepEqual(filterTransactionsByRange(rows,range), rows.slice(1,3));
  assert.equal(summarize(rows,range).totalExpense,20);
  assert.equal(groupByCounterparty(rows,range)[0].expense,20);
  assert.equal(buildPeriodTable(filterTransactionsByRange(rows,range))[0].expense,20);
  assert.ok(rows.every(t=>!Object.hasOwn(t,'period')));
});
test('自定义拒绝空日期、无效日期及颠倒日期，允许同一天', () => {
  for (const [start,end] of [['','2026-10-01'],['2026-10-01',''],['2026-02-29','2026-03-01'],['2026-10-03','2026-10-02']])
    assert.throws(()=>customDateRange(start,end), /日期/);
  assert.equal(customDateRange('2026-10-01','2026-10-01').start,'2026-10-01');
});
test('自定义即使与账期日期完全相同也不比较上一账期，全部时间亦不比较', () => {
  assert.equal(prevPeriodRange(customDateRange('2026-09-15','2026-10-14')),null);
  assert.equal(prevPeriodRange(allTimeRange()),null);
  assert.deepEqual(prevPeriodRange(currentBillingPeriod(new Date(2026,9,14))),billingPeriodRange('2026-09'));
});
test('自定义与全部时间的实际界面环比文案为空', () => {
  const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function deltaInfo('),source.indexOf('\nfunction drillToCategory('));
  for(const range of [customDateRange('2026-10-01','2026-10-02'),allTimeRange()]) {
    const result=vm.runInNewContext(fn+'\ndeltaInfo(100,80)',{range});
    assert.equal(result.text,'');
  }
});
test('全部时间包含全部记录，且不修改输入顺序', () => {
  const rows=[{ datetime:'2000-01-01' },{ datetime:'2030-01-01' }];
  assert.deepEqual(filterTransactionsByRange(rows,allTimeRange()),rows);
});
