import {test,beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {saveTransactions,loadAllTransactions,saveMemory,loadMemory,saveSnapshot,loadSnapshots,deleteSnapshot,
  saveReconciliation,exportBackup,importBackup,clearAllData,loadAssetLedger} from '../js/storage.js';
import {reconciliationCandidates} from '../js/reconciliation.js';
import {summarize} from '../js/aggregate.js';
beforeEach(()=>{globalThis.indexedDB=new IDBFactory();});
afterEach(()=>{mock.restoreAll();delete globalThis.document;});
const manual={id:'manual:ledger-test',source:'手动',amount:32,direction:'支出',datetime:'2026-10-18T00:00:00',myCategory:'餐饮',manual:true};
const imported={id:'wx:ledger-test',externalOrderId:'old-ext',source:'微信',amount:32,direction:'支出',datetime:'2026-10-18T19:42:00',myCategory:'用户分类',status:'部分退款',countedAmount:20,reviewed:true};
async function legacyDb() {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('jizhang',1);
    req.onupgradeneeded=()=>{req.result.createObjectStore('transactions',{keyPath:'id'});req.result.createObjectStore('merchantMemory',{keyPath:'counterparty'});};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function seedV1(db) {
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(['transactions','merchantMemory'],'readwrite');
    tx.objectStore('transactions').put(imported);tx.objectStore('merchantMemory').put({counterparty:'旧商户',category:'用户分类'});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
test('真实v1结构升级只新增快照表，旧记录所有字段、稳定ID和记忆逐项保持',async()=>{
  const old=await legacyDb();await seedV1(old);old.close();
  assert.deepEqual(await loadAllTransactions(),[imported]);assert.deepEqual(await loadMemory(),{'旧商户':'用户分类'});
  assert.deepEqual(await loadSnapshots(),[]);
  const db=await new Promise(resolve=>{const req=indexedDB.open('jizhang');req.onsuccess=()=>resolve(req.result);});
  assert.equal(db.version,3);assert.deepEqual([...db.objectStoreNames],['assetLedger','merchantMemory','snapshots','transactions']);db.close();
  await saveSnapshot({date:'2026-10-14',totalAssets:1000,totalLiabilities:100,note:'测试'});
  assert.deepEqual(await loadAllTransactions(),[imported]);
});
test('升级被旧连接占用会明确报错，关闭旧连接后可继续，不清空',async()=>{
  const old=await legacyDb();await seedV1(old);
  await assert.rejects(loadSnapshots(),/旧页面占用/);old.close();
  assert.deepEqual(await loadAllTransactions(),[imported]);assert.deepEqual(await loadMemory(),{'旧商户':'用户分类'});
});
test('升级事务失败回滚到v1，重试后旧数据仍在',async()=>{
  const old=await legacyDb();await seedV1(old);old.close();
  const original=indexedDB.open.bind(indexedDB);let abortOnce=true;
  // 当前版本为 v3；中断一次升级事务，验证回滚后重试仍能读到旧数据。
  mock.method(indexedDB,'open',(...args)=>{const req=original(...args);if(args[1]===3&&abortOnce){abortOnce=false;req.addEventListener('upgradeneeded',()=>req.transaction.abort());}return req;});
  await assert.rejects(loadSnapshots());
  const check=await legacyDb();assert.equal(check.version,1);check.close();
  assert.deepEqual(await loadAllTransactions(),[imported]);
  // 重试这次升级必须成功，且旧记录仍在。
  assert.deepEqual(await loadSnapshots(),[]);
  const upgraded=await new Promise(resolve=>{const req=indexedDB.open('jizhang');req.onsuccess=()=>resolve(req.result);});
  assert.equal(upgraded.version,3);upgraded.close();
  assert.deepEqual(await loadAllTransactions(),[imported]);
});
test('快照新建、编辑、历史、删除持久化，纠错不影响交易',async()=>{
  await saveTransactions([manual,imported]);
  const first=await saveSnapshot({date:'2026-09-15',totalAssets:'100.30',totalLiabilities:'0.10'});
  const second=await saveSnapshot({date:'2026-10-14',totalAssets:200,totalLiabilities:0});
  assert.equal(first.netAssets,100.2);assert.deepEqual((await loadSnapshots()).map(s=>s.id),[second.id,first.id]);
  const edit=await saveSnapshot({date:first.date,totalAssets:300,totalLiabilities:20,note:'更正'},first.id);
  assert.equal(edit.id,first.id);assert.equal(edit.createdAt,first.createdAt);assert.equal(edit.netAssets,280);
  await assert.rejects(saveSnapshot({date:first.date,totalAssets:-1,totalLiabilities:0},first.id));
  assert.equal((await loadSnapshots()).find(s=>s.id===first.id).netAssets,280);
  await deleteSnapshot(first.id);assert.deepEqual(await loadSnapshots(),[second]);assert.deepEqual(await loadAllTransactions(),[manual,imported]);
});
async function backupText() {
  let blob;mock.method(URL,'createObjectURL',value=>{blob=value;return 'blob:ledger-test';});mock.method(URL,'revokeObjectURL',()=>{});
  globalThis.document={createElement:()=>({click(){}})};await exportBackup();return blob.text();
}
test('新备份原交易、收入、快照、退款、确认和否定状态完整往返，不新增永久范围字段',async()=>{
  const m2={...manual,id:'manual:income',direction:'收入',amount:100,myCategory:'工资'},i2={...imported,id:'csv:income',source:'现金',direction:'收入',amount:100};
  await saveTransactions([manual,imported,m2,i2]);await saveMemory('测试店','餐饮');
  await saveReconciliation(manual.id,imported.id,'confirm');await saveReconciliation(m2.id,i2.id,'dismiss');
  await saveSnapshot({date:'2026-10-14',totalAssets:5000,totalLiabilities:100});
  const before={txns:await loadAllTransactions(),mem:await loadMemory(),snapshots:await loadSnapshots(),assetLedger:await loadAssetLedger()},text=await backupText();
  assert.deepEqual(JSON.parse(text),before);await clearAllData();await importBackup({text:async()=>text});
  assert.deepEqual(await loadAllTransactions(),before.txns);assert.deepEqual(await loadSnapshots(),before.snapshots);assert.deepEqual(await loadMemory(),before.mem);
  assert.deepEqual(await loadAssetLedger(),before.assetLedger);
  assert.equal(summarize(await loadAllTransactions()).totalExpense,20);assert.equal(reconciliationCandidates(await loadAllTransactions()).length,0);
  assert.ok(before.txns.every(t=>!Object.hasOwn(t,'range')&&!Object.hasOwn(t,'period')));
});
test('旧备份缺snapshots也恢复，导入到非空库不清除现有快照或无关交易',async()=>{
  await importBackup({text:async()=>JSON.stringify({txns:[imported],mem:{旧商户:'交通'}})});
  assert.deepEqual(await loadSnapshots(),[]);assert.deepEqual(await loadAllTransactions(),[imported]);
  const s=await saveSnapshot({date:'2026-10-14',totalAssets:1,totalLiabilities:0});
  await importBackup({text:async()=>JSON.stringify({txns:[manual],mem:{}})});
  assert.deepEqual(await loadSnapshots(),[s]);assert.equal((await loadAllTransactions()).length,2);
});
test('坏快照备份与核对关系冲突均拒绝，恢复全事务回滚，不部分覆盖旧交易或记忆',async()=>{
  await saveTransactions([manual,imported]);await saveMemory('旧商户','交通');
  const s=await saveSnapshot({date:'2026-10-14',totalAssets:1,totalLiabilities:0});
  await assert.rejects(importBackup({text:async()=>JSON.stringify({txns:[{...imported,amount:999}],mem:{旧商户:'购物'},snapshots:[{...s,netAssets:999}]})}));
  assert.deepEqual(await loadAllTransactions(),[manual,imported]);assert.deepEqual(await loadMemory(),{'旧商户':'交通'});
  await saveReconciliation(manual.id,imported.id,'confirm');const before=await loadAllTransactions();
  await assert.rejects(importBackup({text:async()=>JSON.stringify({txns:[{...manual,id:'manual:other',reconciledDuplicateOf:imported.id}],mem:{旧商户:'购物'},snapshots:[]})}),/冲突/);
  assert.deepEqual(await loadAllTransactions(),before);assert.deepEqual(await loadMemory(),{'旧商户':'交通'});
});
test('存储核对在最新数据上遵守一对一，连续/并发确认只有一个成功，撤销恢复',async()=>{
  const other={...manual,id:'manual:other'};await saveTransactions([manual,other,imported]);
  const results=await Promise.allSettled([saveReconciliation(manual.id,imported.id,'confirm'),saveReconciliation(other.id,imported.id,'confirm')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const linked=(await loadAllTransactions()).find(t=>t.reconciledDuplicateOf);assert.ok(linked);
  await saveReconciliation(linked.id,null,'undo');assert.equal(reconciliationCandidates(await loadAllTransactions()).length,2);
  assert.deepEqual((await loadAllTransactions()).find(t=>t.id===imported.id),imported);
});
test('不是同一笔刷新重读仍不提示；不存在记录和非法候选拒绝且数据不变',async()=>{
  await saveTransactions([manual,imported]);await saveReconciliation(manual.id,imported.id,'dismiss');
  const rows=await loadAllTransactions();assert.equal(reconciliationCandidates(rows).length,0);
  await assert.rejects(saveReconciliation(imported.id,manual.id,'confirm'));
  await assert.rejects(saveReconciliation(manual.id,'不存在','confirm'));
  assert.deepEqual(await loadAllTransactions(),rows);
});
