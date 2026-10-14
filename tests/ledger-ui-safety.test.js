import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
import {setupLedgerTools} from '../js/ledger-tools.js';
import {saveSnapshot,loadSnapshots} from '../js/storage.js';
import {mergeTransactions} from '../js/dedup.js';
import {resolveCategory} from '../js/classify.js';
import {reconciliationCandidates} from '../js/reconciliation.js';
import {filterNeedsReview} from '../js/review.js';
beforeEach(()=>{globalThis.indexedDB=new IDBFactory();});
afterEach(()=>{delete globalThis.document;});
test('实际快照UI处理器先展示二次确认，取消不删，确认只删所选快照',async()=>{
  const a=await saveSnapshot({date:'2026-10-14',totalAssets:1,totalLiabilities:0});
  const b=await saveSnapshot({date:'2026-09-15',totalAssets:100,totalLiabilities:0});
  const elements=new Map();
  globalThis.document={getElementById:id=>{
    if(!elements.has(id))elements.set(id,{hidden:true,value:'',handlers:{},scrollIntoView(){},addEventListener(type,handler){this.handlers[type]=handler;}});
    return elements.get(id);
  }};
  const tools=setupLedgerTools({getTransactions:()=>[],getRange:()=>({start:'2026-09-15',end:'2026-10-14'}),refreshApp(){},updateTransaction(){}});
  await tools.load();
  const choose=()=>elements.get('snapshotList').handlers.click({target:{closest:s=>s==='[data-delete]'?{dataset:{delete:a.id}}:null}});
  choose();assert.equal(elements.get('snapshotDeletePrompt').hidden,false);assert.equal((await loadSnapshots()).length,2);
  elements.get('snapshotDeleteCancel').handlers.click();assert.equal(elements.get('snapshotDeletePrompt').hidden,true);assert.equal((await loadSnapshots()).length,2);
  choose();await elements.get('snapshotDeleteConfirm').handlers.click();assert.deepEqual(await loadSnapshots(),[b]);
  assert.equal(elements.get('snapshotDeletePrompt').hidden,true);assert.equal(elements.get('snapshotDeleteConfirm').disabled,false);
});

const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
test('启动分类逻辑保留旧交易已有分类，只补缺失分类，不改稳定ID或退款字段',()=>{
  const existing=Object.freeze({id:'old-order',source:'微信',myCategory:'旧自定义分类',amount:100,status:'部分退款',countedAmount:70,description:'美团'});
  const missing={id:'missing',source:'微信',description:'公交'},context={transactions:[existing,missing],memory:{},resolveCategory};
  const fn=app.slice(app.indexOf('function classifyAll('),app.indexOf('// ===== 标签切换'));
  vm.runInNewContext(fn+'\nclassifyAll();',context);
  assert.equal(existing.myCategory,'旧自定义分类');assert.equal(existing.id,'old-order');assert.equal(existing.countedAmount,70);assert.equal(missing.myCategory,'交通');
});
test('实际导入流程只写新增交易，不覆盖旧分类、ID和核对结果；重复批次写入零条',async()=>{
  const old=Object.freeze({id:'old-order',source:'微信',myCategory:'旧分类',amount:100,status:'部分退款',countedAmount:70,reviewed:true,datetime:'2026-10-01'});
  const added={id:'new-file-row',source:'现金',amount:1,direction:'支出',myCategory:'用户分类',manual:true,datetime:'2026-10-02'};
  const fn=app.slice(app.indexOf('async function onFiles('),app.indexOf("document.getElementById('fileInput').addEventListener"));
  let writes=[];
  const msg={classList:{add(){}}},context={transactions:[old],memory:{},lastImport:null,
    document:{getElementById:()=>msg},fileToTransactions:async()=>[{...added}],resolveCategory,mergeTransactions,filterNeedsReview,reconciliationCandidates,
    saveTransactions:async rows=>{writes=rows;},refreshAll(){},switchView(){}};
  vm.runInNewContext(fn,context);await context.onFiles([{}]);assert.deepEqual(writes,[added]);assert.equal(context.transactions[0],old);
  await context.onFiles([{}]);assert.equal(writes.length,0);assert.equal(context.transactions.length,2);assert.equal(context.lastImport.skipped,1);
});
