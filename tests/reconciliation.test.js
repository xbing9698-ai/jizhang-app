import test from 'node:test';
import assert from 'node:assert/strict';
import { reconciliationCandidates, reconcileTransaction, isReconciledDuplicate } from '../js/reconciliation.js';
import { summarize,groupByCounterparty,buildPeriodTable } from '../js/aggregate.js';
import { countedExpenseAmount } from '../js/review.js';
import { filterDetails } from '../js/detail.js';
const manual={id:'manual:test',source:'手动',datetime:'2026-10-18T00:00:00',direction:'支出',amount:32,myCategory:'餐饮',manual:true,description:'测试晚饭'};
const imported={id:'wx:test',source:'微信',datetime:'2026-10-18T19:42:00',direction:'支出',amount:32,myCategory:'餐饮',counterparty:'测试店',status:'交易成功'};
for(const [days,count] of [[0,1],[1,1],[-1,1],[2,0],[-2,0]]) test(`手动与导入日期相差${days}天候选数${count}`,()=>{
  const date=new Date(Date.UTC(2026,9,18+days)).toISOString().slice(0,10);
  assert.equal(reconciliationCandidates([manual,{...imported,datetime:date+'T12:00:00'}]).length,count);
});
test('只比较同方向、同分金额的手动与导入，不靠文字相似或伪装manual标记',()=>{
  for(const change of [{amount:32.01},{amount:32.001},{direction:'收入'},{source:'手动'},{datetime:'非法'}])
    assert.equal(reconciliationCandidates([manual,{...imported,...change}]).length,0);
  assert.equal(reconciliationCandidates([{...manual,source:'支付宝'},imported]).length,0);
  assert.equal(reconciliationCandidates([manual,{...imported,counterparty:'完全不同',manual:true}]).length,1);
});
test('确认同一笔手动不计所有支出统计，正式记录正常，明细仍存在且字段不改变',()=>{
  const linked=reconcileTransaction([manual,imported],manual.id,imported.id,'confirm'),rows=[linked,imported];
  assert.equal(isReconciledDuplicate(linked),true); assert.equal(linked.amount,32); assert.equal(linked.excluded,undefined);
  const s=summarize(rows); assert.equal(s.totalExpense,32); assert.equal(s.count,1); assert.deepEqual(s.byCategory,{餐饮:32});
  assert.deepEqual(s.byDay,{'2026-10-18':32}); assert.deepEqual(s.topExpenses,[imported]); assert.equal(countedExpenseAmount(linked),0);
  assert.equal(groupByCounterparty(rows).reduce((n,g)=>n+g.expense,0),32); assert.equal(buildPeriodTable(rows)[0].expenseCount,1);
  assert.equal(filterDetails(rows,null,{query:'测试晚饭',source:'手动'}).length,1);
  const undone=reconcileTransaction(rows,manual.id,null,'undo'); assert.equal(summarize([undone,imported]).totalExpense,64);
  assert.deepEqual(undone,manual); assert.equal(reconciliationCandidates(rows).length,0);
});
test('手动收入确认后只计正式收入，影响结余和历史收入笔数，撤销恢复',()=>{
  const m={...manual,direction:'收入'},i={...imported,direction:'收入'},linked=reconcileTransaction([m,i],m.id,i.id,'confirm');
  const rows=[linked,i],s=summarize(rows);assert.equal(s.totalIncome,32);assert.equal(s.net,32);assert.equal(s.totalExpense,0);
  assert.equal(buildPeriodTable(rows)[0].incomeCount,1);assert.equal(groupByCounterparty(rows).reduce((n,g)=>n+g.income,0),32);
  assert.equal(summarize([reconcileTransaction(rows,m.id,null,'undo'),i]).totalIncome,64);
});
test('不是同一笔持久化字段抑制该候选，其他候选正常；暂不处理无数据改动',()=>{
  const dismissed=reconcileTransaction([manual,imported],manual.id,imported.id,'dismiss');
  assert.deepEqual(dismissed.reconciliationDismissedIds,[imported.id]);assert.equal(reconciliationCandidates([dismissed,imported]).length,0);
  assert.equal(reconciliationCandidates([dismissed,imported,{...imported,id:'other'}]).length,1);
  assert.equal(summarize([dismissed,imported]).totalExpense,64);assert.equal(manual.reconciliationDismissedIds,undefined);
});
test('一对一约束：手动只能匹配一个，正式不能被多个手动匹配，撤销释放',()=>{
  const other={...manual,id:'manual:other'},i2={...imported,id:'wx:other'};
  const linked=reconcileTransaction([manual,other,imported,i2],manual.id,imported.id,'confirm'),rows=[linked,other,imported,i2];
  assert.throws(()=>reconcileTransaction(rows,other.id,imported.id,'confirm'),/重复匹配/);
  assert.throws(()=>reconcileTransaction(rows,manual.id,i2.id,'confirm'),/重复匹配/);
  assert.equal(reconciliationCandidates(rows).length,1);
  const undone=reconcileTransaction(rows,manual.id,null,'undo');assert.ok(reconcileTransaction([undone,other,imported],other.id,imported.id,'confirm'));
});
test('退款调整保留，核对不改变正式记录amount/status/source或统计覆盖',()=>{
  const refund={...imported,status:'部分退款',countedAmount:20,reviewed:true};
  const linked=reconcileTransaction([manual,refund],manual.id,refund.id,'confirm');
  assert.equal(summarize([linked,refund]).totalExpense,20); assert.equal(refund.amount,32); assert.equal(refund.status,'部分退款');
  assert.equal(summarize([linked,{...refund,excluded:true}]).totalExpense,0);
});
