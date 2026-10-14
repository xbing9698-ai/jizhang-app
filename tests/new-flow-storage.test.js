import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createManualIncome } from '../js/manual.js';
import { resolveCategory } from '../js/classify.js';
import { saveTransactions, loadAllTransactions, loadMemory, saveTransactionCategory, saveExpenseAdjustment, exportBackup, clearAllData, importBackup, deleteManualTransaction } from '../js/storage.js';
beforeEach(()=>{globalThis.indexedDB=new IDBFactory();});afterEach(()=>{mock.restoreAll();delete globalThis.document;});
test('从存储实际记录改分类及商户记忆，保留退款调整的最新结果',async()=>{
  const rows=[{id:'a',source:'微信',counterparty:'测试店',direction:'支出',amount:100,status:'已退款',externalOrderId:'ext-a'},{id:'b',source:'支付宝',counterparty:'测试店',direction:'支出',amount:20}];
  await saveTransactions(rows);await saveExpenseAdjustment('a','amount','70');await saveTransactionCategory('a','餐饮');
  const saved=await loadAllTransactions();assert.equal(saved[0].countedAmount,70);assert.equal(saved[0].amount,100);assert.equal(saved[0].externalOrderId,'ext-a');
  assert.ok(saved.every(t=>t.myCategory==='餐饮'));assert.deepEqual(await loadMemory(),{'测试店':'餐饮'});
  await assert.rejects(saveTransactionCategory('a','非法'),/分类/);assert.deepEqual(await loadAllTransactions(),saved);
});
test('手动收入改分类后导出清空恢复完整，旧记录一同保留，删除仍可用',async()=>{
  const income=createManualIncome({date:'2026-10-01',amount:'3000',category:'工资',text:'测试工资'});
  const legacy={id:'legacy',source:'支付宝',amount:10,direction:'支出',datetime:'2026-09-15T12:00:00'};
  await saveTransactions([income,legacy]);await saveTransactionCategory(income.id,'兼职 / 其他收入');
  let blob;mock.method(URL,'createObjectURL',value=>{blob=value;return 'blob:income-test';});mock.method(URL,'revokeObjectURL',()=>{});
  globalThis.document={createElement:()=>({click(){}})};await exportBackup();const json=await blob.text(),before=await loadAllTransactions();
  assert.deepEqual(Object.keys(JSON.parse(json)).sort(),['mem','snapshots','txns']);await clearAllData();await importBackup({text:async()=>json});assert.deepEqual(await loadAllTransactions(),before);
  const restored=(await loadAllTransactions()).find(t=>t.id===income.id);assert.equal(restored.myCategory,'兼职 / 其他收入');assert.equal(restored.rawCategory,'工资');assert.equal(resolveCategory(restored),'兼职 / 其他收入');
  await deleteManualTransaction(income.id);assert.deepEqual(await loadAllTransactions(),[legacy]);
});
