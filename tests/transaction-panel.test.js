import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CATEGORIES, INCOME_CATEGORIES } from '../js/classify.js';
import { isManualTransaction } from '../js/manual.js';
import { canAdjustTransaction, isValidCountedAmount } from '../js/review.js';
import { editableTransactionCategories } from '../js/transaction-update.js';

const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const editor=app.slice(app.indexOf('function editorCategories('),app.indexOf("document.getElementById('transactionDirection').addEventListener"));
for(const [source,direction,category,adjustable,deletable] of [['微信','支出','餐饮',true,false],['手动','收入','工资',false,true]]) {
  test(`点击${source}${direction}打开统一编辑详情，填入当前金额日期方向分类且不改原记录`,()=>{
    const record=Object.freeze({id:'test-id',source,direction,myCategory:category,amount:100,status:'原始状态',datetime:'2026-10-01T12:00:00',counterparty:'测试对方',description:'测试说明'});
    const ids=['adjustmentFacts','transactionAmount','transactionDate','transactionDirection','transactionCategory','transactionDescription','categoryMsg','adjustmentControls','transactionDelete','reconciliationUndo','adjustmentAmount','adjustmentRule','adjustmentMsg'];
    const elements=Object.fromEntries(ids.map(id=>[id,{dataset:{},value:'',hidden:false,innerHTML:'',textContent:''}]));
    const dialog={open:false,showModal(){this.open=true;}};
    const context={transactions:[record],adjustingId:null,CATEGORIES,INCOME_CATEGORIES,editableTransactionCategories,isManualTransaction,canAdjustTransaction,isValidCountedAmount,
      esc:s=>String(s??''),isReconciledDuplicate:()=>false,adjustmentDialog:dialog,document:{getElementById:id=>elements[id]}};
    vm.runInNewContext(editor+'\nonOpenAdjustment({currentTarget:{dataset:{id:"test-id"}}});',context);
    assert.equal(dialog.open,true);assert.equal(context.adjustingId,record.id);
    assert.equal(elements.transactionAmount.value,'100');assert.equal(elements.transactionDate.value,'2026-10-01');
    assert.equal(elements.transactionDirection.value,direction);assert.equal(elements.transactionCategory.value,category);
    assert.equal(elements.transactionDescription.value,'测试说明');
    assert.equal(elements.adjustmentControls.hidden,!adjustable);assert.equal(elements.transactionDelete.hidden,!deletable);
    assert.equal(elements.transactionDelete.dataset.id,record.id);assert.equal(elements.adjustmentAmount.max,'100');
    assert.ok(elements.adjustmentFacts.innerHTML.includes('原始状态'));assert.equal(record.amount,100);
  });
}

test('导入记录商户只读、手动记录没有独立商户编辑字段',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const dialog=html.slice(html.indexOf('id="adjustmentDialog"'),html.indexOf('id="snapshotsDialog"'));
  for(const id of ['transactionAmount','transactionDate','transactionDirection','transactionCategory','transactionDescription','saveTransaction'])assert.ok(dialog.includes(`id="${id}"`));
  assert.ok(!dialog.includes('id="transactionCounterparty"'));
  assert.match(app,/商户（只读）/);
});

test('首页、快速面板和详情ID唯一，避免入口绑定到错误按钮',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ['quickEntryOpen','quickEntryDialog','adjustmentDialog','transactionCategory','sortOrder'])assert.ok(ids.includes(id));
});
