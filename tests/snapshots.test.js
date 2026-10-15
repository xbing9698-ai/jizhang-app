import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot, sortSnapshots, reconcileBalance, summarizeSnapshotChanges } from '../js/snapshots.js';
import { billingPeriodRange, customDateRange } from '../js/period.js';
const make = (assets,liabilities = 0,date = '2026-09-15') => createSnapshot({date,totalAssets:assets,totalLiabilities:liabilities,note:' 测试 '});
test('新快照生成唯一身份，净资产按分计算，可为负数',()=>{
  const a=make('0.30','0.10'),b=make('0.30','0.10');
  assert.match(a.id,/^snapshot:/); assert.notEqual(a.id,b.id); assert.equal(a.netAssets,0.2); assert.equal(a.note,'测试');
  assert.equal(make(100,200).netAssets,-100); assert.ok(a.createdAt);
});
test('编辑快照保留ID和创建时间，重新计算净资产，不改变原对象；历史倒序',()=>{
  const a=make(100),b=createSnapshot({date:'2026-10-14',totalAssets:200,totalLiabilities:10,note:'更正'},a);
  assert.equal(b.id,a.id); assert.equal(b.createdAt,a.createdAt); assert.equal(b.netAssets,190); assert.equal(a.netAssets,100);
  assert.deepEqual(sortSnapshots([a,b]),[b,a]);
});
for(const [field,value] of [['date',''],['date','2026-02-30'],['totalAssets',''],['totalAssets',-1],['totalAssets','NaN'],['totalLiabilities','1.001']])
  test(`快照拒绝非法${field}:${value}`,()=>assert.throws(()=>createSnapshot({date:'2026-10-14',totalAssets:1,totalLiabilities:0,[field]:value})));
const transactions=[
  {id:'income',datetime:'2026-10-01T00:00:00',direction:'收入',amount:5200},
  {id:'expense',datetime:'2026-10-02T00:00:00',direction:'支出',amount:3000},
  {id:'refund',datetime:'2026-10-03T00:00:00',direction:'支出',amount:150,countedAmount:100,status:'部分退款'},
  {id:'excluded',datetime:'2026-10-04T00:00:00',direction:'支出',amount:999,excluded:true},
  {id:'closed',datetime:'2026-10-04T00:00:00',direction:'支出',amount:999,status:'交易关闭'},
  {id:'outside',datetime:'2026-09-14T00:00:00',direction:'支出',amount:999}
];
test('账期核对期初加收入减实际支出，理论7100、实际7038、差额-62',()=>{
  const r=reconcileBalance(make(5000),make(7038,0,'2026-10-14'),transactions,billingPeriodRange('2026-10'));
  assert.deepEqual(r,{opening:5000,income:5200,expense:3100,theoretical:7100,actual:7038,difference:-62});
});
test('账期核对正差额与自定义首尾过滤正确',()=>{
  const r=reconcileBalance(make(5000),make(5100,0,'2026-10-14'),transactions,customDateRange('2026-10-03','2026-10-04'));
  assert.equal(r.income,0); assert.equal(r.expense,100); assert.equal(r.theoretical,4900); assert.equal(r.difference,200);
});
test('账期核对拒绝缺快照、同快照、日期反向、全部时间或非法范围',()=>{
  const a=make(100),b=make(200,0,'2026-10-14');
  assert.throws(()=>reconcileBalance(null,b,[],billingPeriodRange('2026-10')));
  assert.throws(()=>reconcileBalance(a,a,[],billingPeriodRange('2026-10')));
  assert.throws(()=>reconcileBalance(b,a,[],billingPeriodRange('2026-10')));
  assert.throws(()=>reconcileBalance(a,b,[],{start:null,end:null}));
});

test('快照后只按实际日期筛选，排除起始日全部时刻，不使用createdAt或UTC换算',()=>{
  const opening=Object.freeze({...make(5481.85,0,'2026-10-15'),createdAt:'2030-01-01T00:00:00Z'});
  const rows=[
    {datetime:'2026-10-14T20:00:00',direction:'收入',amount:1},
    {datetime:'2026-10-15T00:01:00+14:00',direction:'收入',amount:2},
    {datetime:'2026-10-15T23:59:59-12:00',direction:'收入',amount:3},
    {datetime:'2026-10-16T00:00:00+14:00',direction:'收入',amount:200},
    {datetime:'2026-10-17T12:00:00',direction:'支出',amount:100}
  ].map(Object.freeze);
  const before=JSON.stringify(rows);
  const result=summarizeSnapshotChanges(opening,rows,customDateRange('2026-10-14','2026-10-17'));
  assert.equal(result.totalIncome,200);
  assert.equal(result.totalExpense,100);
  assert.equal(result.net,100);
  assert.equal(JSON.stringify(rows),before);
});

test('快照后汇总继续复用退款实际金额、排除、交易关闭和已核对重复规则',()=>{
  const rows=[
    {datetime:'2026-10-16T10:00:00',direction:'支出',amount:100,countedAmount:30,status:'部分退款'},
    {datetime:'2026-10-16T11:00:00',direction:'支出',amount:500,excluded:true},
    {datetime:'2026-10-16T12:00:00',direction:'支出',amount:500,status:'交易关闭'},
    {datetime:'2026-10-16T13:00:00',direction:'支出',amount:500,source:'手动',reconciledDuplicateOf:'imported'},
    {datetime:'2026-10-16T14:00:00',direction:'收入',amount:200}
  ];
  const s=summarizeSnapshotChanges(make(5481.85,0,'2026-10-15'),rows);
  assert.equal(s.totalExpense,30);assert.equal(s.count,1);assert.equal(s.totalIncome,200);
});

test('账期核对采用(opening.date, closing.date]，期初当天不重算、期末当天计入',()=>{
  const opening=make(5481.85,0,'2026-10-15'),closing=make(5581.85,0,'2026-10-16');
  const rows=[
    {datetime:'2026-10-15T00:01:00',direction:'收入',amount:5651.72},
    {datetime:'2026-10-15T23:59:59',direction:'支出',amount:900},
    {datetime:'2026-10-16T00:00:00',direction:'收入',amount:200},
    {datetime:'2026-10-16T23:59:59',direction:'支出',amount:100},
    {datetime:'2026-10-17T00:00:00',direction:'收入',amount:999}
  ];
  const r=reconcileBalance(opening,closing,rows,customDateRange('2026-10-14','2026-10-17'));
  assert.deepEqual(r,{opening:5481.85,income:200,expense:100,theoretical:5581.85,actual:5581.85,difference:0});
});

test('账期核对仍与所选自定义范围取交集，同日期的两张快照没有增量',()=>{
  const opening=make(100,0,'2026-10-15'),closing=make(150,0,'2026-10-17');
  const rows=[{datetime:'2026-10-16T12:00:00',direction:'收入',amount:30},{datetime:'2026-10-17T12:00:00',direction:'收入',amount:20}];
  const r=reconcileBalance(opening,closing,rows,customDateRange('2026-10-17','2026-10-18'));
  assert.equal(r.income,20);assert.equal(r.theoretical,120);assert.equal(r.difference,30);
  const sameDay=reconcileBalance(opening,make(100,0,opening.date),rows,customDateRange('2026-10-15','2026-10-17'));
  assert.equal(sameDay.income,0);assert.equal(sameDay.expense,0);assert.equal(sameDay.difference,0);
});
