import test from 'node:test';
import assert from 'node:assert/strict';
import { sortTransactions, filterDetails } from '../js/detail.js';
import { customDateRange } from '../js/period.js';
const rows=[
  { id:'a',datetime:'2026-10-01T10:00:00',amount:30,countedAmount:1,source:'微信',direction:'支出',myCategory:'餐饮',description:'测试午餐',status:'已退款' },
  { id:'b',datetime:'2026-10-02T10:00:00',amount:10,source:'支付宝',direction:'支出',myCategory:'购物' },
  { id:'c',datetime:'2026-09-30T10:00:00',amount:20,source:'手动',direction:'收入',myCategory:'工资' }
];
for(const [order,ids] of [['newest',['b','a','c']],['oldest',['c','a','b']],['highest',['a','c','b']],['lowest',['b','c','a']]]) {
  test(`明细${order}排序正确且不改变数据，金额按原始amount`,()=>{
    const before=JSON.stringify(rows);assert.deepEqual(sortTransactions(rows,order).map(t=>t.id),ids);assert.equal(JSON.stringify(rows),before);
  });
}
test('排序可与来源、分类、方向、需处理、搜索及自定义时间组合',()=>{
  const selected=filterDetails(rows,customDateRange('2026-10-01','2026-10-02'),{source:'微信',category:'餐饮',direction:'支出',onlyNeedsReview:true,query:'午餐',order:'lowest'});
  assert.deepEqual(selected,[rows[0]]);
  assert.deepEqual(filterDetails(rows,customDateRange('2026-10-01','2026-10-02'),{order:'highest'}).map(t=>t.id),['a','b']);
});
test('相同金额稳定排序，旧记录缺失日期也可安全显示',()=>{
  const rows=[{id:'a',amount:1},{id:'b',amount:1}];assert.deepEqual(sortTransactions(rows,'highest'),rows);assert.equal(sortTransactions(rows,'newest').length,2);
});
