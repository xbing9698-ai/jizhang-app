import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualIncome, createManualExpense } from '../js/manual.js';
import { newQuickEntry, createQuickTransaction, setQuickDirection } from '../js/quick-entry.js';
import { INCOME_CATEGORIES, resolveCategory } from '../js/classify.js';
import { summarize, matchesSearch, filterTransactionsBySource } from '../js/aggregate.js';
import { billingPeriodRange } from '../js/period.js';

const input={ date:'2026-10-01',amount:'100.50',category:'工资',text:'测试工资' };
test('手动收入生成唯一manual UUID，来源和方向固定、分类及说明保留', () => {
  const a=createManualIncome({...input,source:'微信',direction:'支出'}),b=createManualIncome(input);
  assert.match(a.id,/^manual:[0-9a-f-]{36}$/); assert.notEqual(a.id,b.id);
  assert.equal(a.source,'手动');assert.equal(a.direction,'收入');assert.equal(a.manual,true);
  assert.equal(a.rawCategory,'工资');assert.equal(a.myCategory,'工资');assert.equal(a.description,'测试工资');
  assert.equal(a.datetime,'2026-10-01T00:00:00');
  assert.equal(resolveCategory(a,{'测试工资':'餐饮'}),'工资');
});
test('收入仅接受最小收入分类组，不能混用支出分类', () => {
  for(const category of INCOME_CATEGORIES)assert.equal(createManualIncome({...input,category}).myCategory,category);
  for(const category of ['',null,'餐饮','交通'])assert.throws(()=>createManualIncome({...input,category}),/分类/);
});
test('手动收入复用现有金额与日期校验', () => {
  for(const amount of ['0','-1','1.234','NaN','',NaN,Infinity])assert.throws(()=>createManualIncome({...input,amount}),/金额/);
  assert.throws(()=>createManualIncome({...input,date:''}),/日期/);
});
test('收入增加totalIncome和结余，不进入支出分类、每日支出或Top5', () => {
  const expense=createManualExpense({...input,amount:'20',category:'餐饮'}),income=createManualIncome(input);
  const s=summarize([expense,income],billingPeriodRange('2026-10'));
  assert.equal(s.totalIncome,100.5);assert.equal(s.totalExpense,20);assert.equal(s.net,80.5);
  assert.deepEqual(s.byCategory,{'餐饮':20});assert.deepEqual(s.byDay,{'2026-10-01':20});assert.deepEqual(s.topExpenses,[expense]);
});
test('手动收入可按说明搜索与手动来源筛选', () => {
  const t=createManualIncome(input);assert.equal(matchesSearch(t,'工资'),true);
  assert.deepEqual(filterTransactionsBySource([t],'手动'),[t]);
});
test('快速面板默认支出，切换收入保留金额日期，完成共用原有金额规则', () => {
  const original={...newQuickEntry(new Date(2026,9,1)),amount:'10.',text:'测试返款'};
  assert.equal(createQuickTransaction(original).direction,'支出');
  const income=setQuickDirection(original,'收入');assert.equal(income.amount,'10.');assert.equal(income.date,original.date);
  assert.equal(createQuickTransaction(income).direction,'收入');assert.equal(createQuickTransaction(income).amount,10);
  assert.equal(createQuickTransaction(setQuickDirection(income,'支出')).direction,'支出');
  assert.throws(()=>createQuickTransaction({...income,direction:'中性'}),/支出或收入/);
});
