import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transactionCategories } from '../js/classify.js';
import { isManualTransaction } from '../js/manual.js';
import { canAdjustTransaction, isValidCountedAmount } from '../js/review.js';

const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const open=app.slice(app.indexOf('function onOpenAdjustment('),app.indexOf('\nasync function onSaveAdjustment('));
for(const [source,direction,category,adjustable,deletable]of [['微信','支出','餐饮',true,false],['手动','收入','工资',false,true]]) {
  test(`点击${source}${direction}打开同一详情，可编辑正确分类且不改原始交易`,()=>{
    const record=Object.freeze({id:'test-id',source,direction,myCategory:category,amount:100,status:'原始状态',datetime:'2026-10-01T12:00:00',counterparty:'测试对方'});
    const elements=Object.fromEntries(['adjustmentFacts','transactionCategory','categoryMsg','adjustmentControls','transactionDelete','adjustmentAmount','adjustmentRule','adjustmentMsg'].map(id=>[id,{dataset:{},value:''}]));
    const dialog={open:false,showModal(){this.open=true;}};
    const context={transactions:[record],adjustingId:null,transactionCategories,isManualTransaction,canAdjustTransaction,isValidCountedAmount,
      fmtMoney:n=>String(n),esc:s=>String(s??''),adjustmentDialog:dialog,document:{getElementById:id=>elements[id]}};
    vm.runInNewContext(open+'\nonOpenAdjustment({currentTarget:{dataset:{id:"test-id"}}});',context);
    assert.equal(dialog.open,true);assert.equal(context.adjustingId,record.id);
    assert.ok(elements.transactionCategory.innerHTML.includes('value="'+category+'" selected'));
    assert.equal(elements.adjustmentControls.hidden,!adjustable);assert.equal(elements.transactionDelete.hidden,!deletable);
    assert.equal(elements.transactionDelete.dataset.id,record.id);assert.equal(elements.adjustmentAmount.max,'100');
    assert.ok(elements.adjustmentFacts.innerHTML.includes('原始状态'));assert.equal(record.amount,100);
  });
}
test('首页、快速面板和详情ID唯一，避免入口绑定到错误按钮',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ['quickEntryOpen','quickEntryDialog','adjustmentDialog','transactionCategory','sortOrder'])assert.ok(ids.includes(id));
});

test('共用详情删除按钮完成一次删除后可继续删除另一笔手动记录',async()=>{
  const fn=app.slice(app.indexOf('async function onDeleteManual('),app.indexOf('\nfunction renderMerchantView('));
  const button={dataset:{id:'one'},disabled:false},feedback={classList:{add(){}}};
  const context={transactions:[{id:'one',source:'手动'},{id:'two',source:'手动'}],isManualTransaction,
    confirm:()=>true,deleteManualTransaction:async()=>{},refreshAll:()=>{},adjustmentDialog:{close(){}},document:{getElementById:()=>feedback}};
  vm.runInNewContext(fn,context);
  await context.onDeleteManual({currentTarget:button});
  assert.equal(button.disabled,false);assert.equal(context.transactions.length,1);
  button.dataset.id='two';await context.onDeleteManual({currentTarget:button});
  assert.equal(button.disabled,false);assert.equal(context.transactions.length,0);
});
