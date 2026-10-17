import { readFileSync, writeFileSync } from 'node:fs';
const read = p => readFileSync(p,'utf8');
const write = (p,s) => writeFileSync(p,s,'utf8');

// Keep the public reconcileBalance result backward-compatible; uncertainty is surfaced on the live reference card instead.
{
  const p='js/snapshots.js'; let s=read(p);
  s=s.replace(`  return { opening:opening.netAssets, income, expense, theoretical, actual:closing.netAssets,\n    difference:(Math.round(closing.netAssets * 100) - Math.round(theoretical * 100)) / 100,\n    uncertainCount };`,
`  return { opening:opening.netAssets, income, expense, theoretical, actual:closing.netAssets,\n    difference:(Math.round(closing.netAssets * 100) - Math.round(theoretical * 100)) / 100 };`);
  write(p,s);
}

// The superseded dashboard tests assumed the current ledger alone was the homepage net-asset figure.
// Replace them with tests for the now-locked product contract: selected range affects cash flow only;
// reference net assets always start from the latest actual snapshot.
write('tests/usage-dashboard.test.js', `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentBillingPeriod, customDateRange, usageTimeRange } from '../js/period.js';
import { summarize } from '../js/aggregate.js';
import { createSnapshot, referenceFromSnapshot } from '../js/snapshots.js';

const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const app=readFileSync(new URL('js/app.js',root),'utf8');
const css=readFileSync(new URL('css/style.css',root),'utf8');
const home=html.slice(html.indexOf('id="view-overview"'),html.indexOf('id="view-detail"'));
const tx=(id,datetime,direction,amount,extra={})=>({id,datetime,direction,amount,source:'微信',myCategory:'餐饮',...extra});
const rows=[
  tx('salary','2026-10-15T10:00:00','收入',5200),
  tx('food','2026-10-16T12:00:00','支出',20),
  tx('old','2026-10-01T12:00:00','支出',100)
];

test('保留本账期、自定义、使用以来三项时间控件，账期选择改为完整日期范围下拉',()=>{
  for(const id of ['billingRange','customRangeOpen','allRange','monthPick'])assert.ok(home.includes(\`id="\${id}"\`));
  assert.match(home,/id="monthPick"[^>]*><\\/select>/);
  assert.match(app,/function billingOptionLabel\(label\)/);
  assert.match(app,/月.*日－/);
  assert.match(css,/\.range-picker\[open\] \.range-label\{display:none\}/);
});

test('首页结构为收支概览、参考资产、分类统计，底部记一笔仍是独立全局动作',()=>{
  assert.ok(home.indexOf('id="sumNet"')<home.indexOf('id="assetCurrent"'));
  assert.ok(home.indexOf('id="assetCurrent"')<home.indexOf('id="pieChart"'));
  for(const id of ['assetNetLabel','assetNet','assetReferenceMeta','assetReferenceChange','assetSnapshotNow','assetLedgerOpen','snapshotsOpen','balanceOpen'])
    assert.ok(home.includes(\`id="\${id}"\`));
  assert.equal([...html.matchAll(/id="quickEntryOpen"/g)].length,1);
  assert.ok(html.indexOf('class="global-quick-action"')<html.indexOf('<nav'));
});

test('切换历史账期只改变收支统计，不改变当前参考净资产的计算基准',()=>{
  const snapshot=createSnapshot({date:'2026-10-15',time:'09:00',totalAssets:'5000',totalLiabilities:'0',transactionIdsAtCapture:[]});
  const ref=referenceFromSnapshot(snapshot,rows,new Date(2026,9,17,20));
  assert.equal(ref.referenceNetAssets,10180); // 5000 + 5200 - 20
  const billing=summarize(rows,currentBillingPeriod(new Date(2026,9,17)));
  const custom=summarize(rows,customDateRange('2026-10-16','2026-10-16'));
  const usage=summarize(rows,usageTimeRange());
  assert.notEqual(billing.net,custom.net);
  assert.notEqual(custom.net,usage.net);
  // 参考值函数不接收“当前查看范围”，因此切换范围不会回拨资产卡。
  assert.equal(referenceFromSnapshot(snapshot,rows,new Date(2026,9,17,20)).referenceNetAssets,ref.referenceNetAssets);
  const fn=app.slice(app.indexOf('function renderAssetReference()'),app.indexOf('// 环比变化文字'));
  assert.ok(fn.includes('referenceFromSnapshot(latest, transactions)'));
  assert.ok(!fn.includes('summarize(transactions, range)'));
});

test('没有快照时资产卡明确提示先记录盘点，而不是用收支差额冒充净资产',()=>{
  const fn=app.slice(app.indexOf('function renderAssetReference()'),app.indexOf('// 环比变化文字'));
  assert.match(fn,/记录一次资产快照后/);
  assert.match(fn,/if \(!latest && !hasLedger\)/);
});

test('参考资产卡显示最近真实盘点、盘点后变化和同日无时间警告',()=>{
  const fn=app.slice(app.indexOf('function renderAssetReference()'),app.indexOf('// 环比变化文字'));
  for(const text of ['参考当前净资产','最近盘点','盘点后变化','同日无准确时间'])assert.ok(fn.includes(text));
});
`);

// Transaction panel tests now exercise the true editor fields instead of the removed category-only button.
write('tests/transaction-panel.test.js', `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CATEGORIES, INCOME_CATEGORIES } from '../js/classify.js';
import { isManualTransaction } from '../js/manual.js';
import { canAdjustTransaction, isValidCountedAmount } from '../js/review.js';

const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const editor=app.slice(app.indexOf('function editorCategories('),app.indexOf("document.getElementById('transactionDirection').addEventListener"));
for(const [source,direction,category,adjustable,deletable] of [['微信','支出','餐饮',true,false],['手动','收入','工资',false,true]]) {
  test(\`点击\${source}\${direction}打开统一编辑详情，填入当前金额日期方向分类且不改原记录\`,()=>{
    const record=Object.freeze({id:'test-id',source,direction,myCategory:category,amount:100,status:'原始状态',datetime:'2026-10-01T12:00:00',counterparty:'测试对方',description:'测试说明'});
    const ids=['adjustmentFacts','transactionAmount','transactionDate','transactionDirection','transactionCategory','transactionDescription','categoryMsg','adjustmentControls','transactionDelete','reconciliationUndo','adjustmentAmount','adjustmentRule','adjustmentMsg'];
    const elements=Object.fromEntries(ids.map(id=>[id,{dataset:{},value:'',hidden:false,innerHTML:'',textContent:''}]));
    const dialog={open:false,showModal(){this.open=true;}};
    const context={transactions:[record],adjustingId:null,CATEGORIES,INCOME_CATEGORIES,isManualTransaction,canAdjustTransaction,isValidCountedAmount,
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
  for(const id of ['transactionAmount','transactionDate','transactionDirection','transactionCategory','transactionDescription','saveTransaction'])assert.ok(dialog.includes(\`id="\${id}"\`));
  assert.ok(!dialog.includes('id="transactionCounterparty"'));
  assert.match(app,/商户（只读）/);
});

test('首页、快速面板和详情ID唯一，避免入口绑定到错误按钮',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ['quickEntryOpen','quickEntryDialog','adjustmentDialog','transactionCategory','sortOrder'])assert.ok(ids.includes(id));
});
`);

// Make the cache simulation follow the new service-worker version.
{
  const p='tests/service-worker.test.js'; let s=read(p);
  s=s.replaceAll("jizhang-v36", "jizhang-v37").replaceAll("jizhang-runtime-v36", "jizhang-runtime-v37");
  // Include the immediately previous pair so activation proves both old shell/runtime caches are removed.
  s=s.replace("keys: async () => ['jizhang-v35', 'jizhang-v37', 'jizhang-runtime-v37', 'other-cache'],",
    "keys: async () => ['jizhang-v35', 'jizhang-v36', 'jizhang-runtime-v36', 'jizhang-v37', 'jizhang-runtime-v37', 'other-cache'],");
  s=s.replace("assert.deepEqual(worker.deleted, ['jizhang-v35']);",
    "assert.deepEqual(worker.deleted, ['jizhang-v35','jizhang-v36','jizhang-runtime-v36']);");
  // New editor module is part of the shell and must be checked too.
  s=s.replace("'js/quick-entry.js','js/asset-ledger-ui.js'", "'js/quick-entry.js','js/transaction-update.js','js/asset-ledger-ui.js'");
  write(p,s);
}

// Fix the static assertion added by the first patcher (literal parentheses, not regex groups).
{
  const p='tests/asset-ledger-layout.test.js'; let s=read(p);
  s=s.replace("assert.match(app,/referenceFromSnapshot(latest, transactions)/);",
    "assert.ok(app.includes('referenceFromSnapshot(latest, transactions)'));");
  write(p,s);
}

console.log('Finance upgrade follow-up fixes applied.');
