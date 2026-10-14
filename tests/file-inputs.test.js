import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { importBackup, loadAllTransactions, loadMemory, saveTransactions, clearAllData } from '../js/storage.js';
const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
beforeEach(()=>{globalThis.indexedDB=new IDBFactory();});
function input(file) {
  let selected=[file],value='selected';
  return { get files(){return selected;},get value(){return value;},set value(next){value=next;if(!next)selected=[];},select(){selected=[file];value='selected';} };
}
test('账单选择后重置输入，但异步导入仍拿到原文件，可再选同一文件',()=>{
  const code=source.slice(source.indexOf("document.getElementById('fileInput').addEventListener"),source.indexOf('// ===== 首页'));
  const file=new File(['test'],'bill.csv'),control=input(file);let handler,captured;
  vm.runInNewContext(code,{document:{getElementById:()=>({addEventListener:(_,fn)=>{handler=fn;}})},onFiles:files=>{captured=files;}});
  handler({target:control});assert.equal(control.value,'');assert.equal(captured[0],file);
  control.select();handler({target:control});assert.equal(control.value,'');assert.equal(captured[0],file);
});
test('清空后立即选择同一备份仍恢复完整记录，输入重置不丢File对象',async()=>{
  const code=source.slice(source.indexOf("document.getElementById('importBackup').addEventListener"),source.indexOf("\ndocument.getElementById('clearBtn')"));
  const row={id:'manual:old-test',source:'手动',direction:'收入',amount:100,datetime:'2026-10-01T00:00:00',myCategory:'工资',manual:true};
  const file=new File([JSON.stringify({txns:[row],mem:{}})],'backup.json'),control=input(file),msg={},feedback={};let handler;
  vm.runInNewContext(code,{document:{getElementById:id=>id==='importBackup'?{addEventListener:(_,fn)=>{handler=fn;}}:id==='quickFeedback'?feedback:msg},
    importBackup,loadAllTransactions,loadMemory,saveTransactions,classifyAll(){},refreshAll(){},switchView(){},transactions:[],memory:{}});
  await handler({target:control});assert.equal(control.value,'');assert.deepEqual(await loadAllTransactions(),[row]);
  await clearAllData();control.select();await handler({target:control});
  assert.equal(control.value,'');assert.deepEqual(await loadAllTransactions(),[row]);assert.equal(msg.textContent,'备份已恢复。');
  assert.equal(feedback.textContent,'备份已恢复：1条记录。');
});
