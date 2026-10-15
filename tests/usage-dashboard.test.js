import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
import {usageTimeRange,currentBillingPeriod,billingPeriodRange,customDateRange,allTimeRange,rangeText,filterTransactionsByRange,prevPeriodRange,USAGE_START_DATE} from '../js/period.js';
import {summarize,buildPeriodTable} from '../js/aggregate.js';
import {emptyLedger,addAccount} from '../js/asset-ledger.js';
import {setupAssetLedgerUI} from '../js/asset-ledger-ui.js';
import {setupLedgerTools} from '../js/ledger-tools.js';
import {saveAssetLedger,loadAssetLedger,saveSnapshot,loadSnapshots,saveTransactions,loadAllTransactions} from '../js/storage.js';
const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const app=readFileSync(new URL('js/app.js',root),'utf8');
const css=readFileSync(new URL('css/style.css',root),'utf8');
const home=html.slice(html.indexOf('id="view-overview"'),html.indexOf('id="view-detail"'));
afterEach(()=>{delete globalThis.document;});
const tx=(id,datetime,direction,amount,extra={})=>({id,datetime,direction,amount,source:'微信',myCategory:'餐饮',...extra});
const rows=[tx('old-income','2026-10-01T10:00:00','收入',50),tx('salary','2026-10-15T10:00:00','收入',5651.72),
  tx('opening-expense','2026-10-15T23:59:59','支出',20),tx('expense','2026-10-16T10:00:00','支出',100),
  tx('income','2026-10-16T12:00:00','收入',200),tx('old-expense','2026-09-01T10:00:00','支出',9)];
const currentLedger=()=>addAccount(addAccount(addAccount(emptyLedger(),{name:'模拟银行卡',type:'asset',balance:1000}),
  {name:'模拟现金',type:'asset',balance:200}),{name:'模拟负债',type:'liability',balance:300});
const money=n=>'¥'+n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function stubDom(){
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,{id,hidden:false,disabled:false,open:false,
    value:'',textContent:'',innerHTML:'',style:{},className:'',dataset:{},handlers:{},attributes:{},
    setAttribute(name,value){this.attributes[name]=value;},addEventListener(type,fn){this.handlers[type]=fn;},
    showModal(){this.open=true;},close(){this.open=false;},scrollIntoView(){}}]));
  const document={getElementById(id){assert.ok(elements.has(id),`真实DOM缺少 ${id}`);return elements.get(id);},
    querySelector:()=>({hidden:false}),querySelectorAll:()=>[]};
  return {document,el:id=>document.getElementById(id)};
}
const dashboard=app.slice(app.indexOf('function fmtMoney('),app.indexOf("document.getElementById('monthPick').addEventListener"))
  .replace(/renderCategoryPie\(/g,'noopChart(').replace(/renderTrend\(/g,'noopChart(')
  .replace(/function renderCatList\([\s\S]*?\n}\n/,'function renderCatList(){}\n')
  .replace(/function renderTopList\([\s\S]*?\n}\n/,'function renderTopList(){}\n');
const refresh=app.slice(app.indexOf('function refreshAll()'),app.indexOf('// ===== 备份 / 清空 ====='));
async function fixture({ledger=currentLedger(),transactions=rows,range=usageTimeRange(),snapshots=true}={}){
  globalThis.indexedDB=new IDBFactory();
  await saveAssetLedger(ledger);await saveTransactions(transactions);
  if(snapshots)await saveSnapshot({date:USAGE_START_DATE,totalAssets:5481.85,totalLiabilities:0,note:'日末快照（合成）'});
  const {document,el}=stubDom();globalThis.document=document;
  const context={document,transactions,range,summarize,prevPeriodRange,rangeText,filterTransactionsByRange,buildPeriodTable,esc,
    noopChart(){},refreshReviewNotice(){},populateCategoryFilter(){},renderDetail(){}};
  const tools=setupLedgerTools({getTransactions:()=>context.transactions,getRange:()=>context.range,updateTransaction(){},refreshApp(){}});
  context.ledgerTools=tools;await tools.load();
  const assetUI=setupAssetLedgerUI({refreshApp(){},refreshSnapshots:()=>tools.load()});await assetUI.load();
  vm.createContext(context);vm.runInContext(dashboard+'\n'+refresh,context);context.refreshAll();
  return {el,assetUI,context,setRange(range){context.range=range;context.refreshAll();}};
}

test('保留本账期、自定义、使用以来三项时间控件',()=>{
  for(const id of ['billingRange','customRangeOpen','allRange','monthPick'])assert.ok(home.includes(`id="${id}"`));
  assert.match(home,/id="allRange"[^>]*>使用以来</);
  assert.match(css,/#allRange\[aria-pressed="true"\]\) \.range-mode-title::before\{content:'使用以来'\}/);
});
test('首页前两块明确为收支概览与当前资产，分类统计在其后',()=>{
  assert.match(home,/aria-label="收支概览"/);assert.ok(home.includes('>收支概览</h2>'));
  assert.ok(home.indexOf('id="sumNet"')<home.indexOf('id="assetCurrent"'));
  assert.ok(home.indexOf('id="assetCurrent"')<home.indexOf('id="pieChart"'));
});
test('首页删除预计资产与快照公式重复区域，真实资产入口全部留在当前资产卡片',()=>{
  for(const label of ['预计当前净资产','起始净资产','快照后收入','快照后支出','快照后收支差额'])assert.ok(!home.includes(label));
  for(const id of ['netUsage','usageSnapshotSetup','netStartList','usageNetCard','usageActualNet','usageDiff'])assert.ok(!html.includes(`id="${id}"`));
  const asset=home.slice(home.indexOf('id="assetCurrent"'),home.indexOf('class="card category-surface"'));
  for(const id of ['assetNet','assetTotal','assetLiability','assetLedgerOpen','snapshotsOpen','balanceOpen'])assert.ok(asset.includes(`id="${id}"`));
  assert.ok(!app.includes('renderUsageNet'));
});
for(const [name,range,income,expense,count] of [
  ['本账期',currentBillingPeriod(new Date(2026,9,16)),5851.72,120,4],
  ['自定义',customDateRange('2026-10-16','2026-10-16'),200,100,2],
  ['使用以来',usageTimeRange(),5851.72,120,4],
  ['上一账期',billingPeriodRange('2026-10'),50,0,1],
  ['旧全部时间工具',allTimeRange(),5901.72,129,6]
])test(`${name}收支概览按所选范围统计，资产始终来自当前总账`,async()=>{
  const {el}=await fixture({range});
  assert.equal(el('sumNetLabel').textContent,'收支差额');assert.equal(el('sumNet').textContent,money(income-expense));
  assert.equal(el('sumIncome').textContent,money(income));assert.equal(el('sumExpense').textContent,money(expense));
  assert.equal(filterTransactionsByRange(rows,range).length,count);
  assert.equal(el('assetNet').textContent,'¥900.00');assert.equal(el('assetTotal').textContent,'¥1,200.00');assert.equal(el('assetLiability').textContent,'¥300.00');
  assert.equal(el('expenseDelta').textContent==='',!prevPeriodRange(range));
});
test('连续切换时间范围只影响收支与高亮状态，不改资产余额、交易或快照',async()=>{
  const f=await fixture();const before={ledger:await loadAssetLedger(),txns:await loadAllTransactions(),snapshots:await loadSnapshots()};
  for(const range of [currentBillingPeriod(new Date(2026,9,16)),customDateRange('2026-10-16','2026-10-16'),usageTimeRange()]){
    f.setRange(range);const summary=summarize(rows,range);
    assert.equal(f.el('sumNet').textContent,money(summary.net));
    assert.equal(f.el('assetNet').textContent,'¥900.00');assert.equal(f.el('assetTotal').textContent,'¥1,200.00');assert.equal(f.el('assetLiability').textContent,'¥300.00');
    assert.equal(f.el('billingMonthWrap').hidden,range.mode==='custom'||range.mode==='usage');
    for(const [id,active] of [['billingRange',!range.mode],['customRangeOpen',range.mode==='custom'],['allRange',range.mode==='usage']])
      assert.equal(f.el(id).attributes['aria-pressed'],String(active));
  }
  assert.deepEqual(await loadAssetLedger(),before.ledger);assert.deepEqual(await loadAllTransactions(),before.txns);assert.deepEqual(await loadSnapshots(),before.snapshots);
});
test('没有起始快照也能显示真实区间收支，不提示设置起点或推算当前资产',async()=>{
  const {el}=await fixture({snapshots:false});assert.equal(el('sumNet').textContent,'¥5,731.72');assert.equal(el('assetNet').textContent,'¥900.00');
  assert.deepEqual(await loadSnapshots(),[]);
});
test('没有总账显示原有空状态，不使用快照或收支差额冒充资产',async()=>{
  const {el}=await fixture({ledger:emptyLedger()});assert.equal(el('assetCurrentEmpty').hidden,false);assert.equal(el('assetCurrentBody').hidden,true);
  assert.equal(el('assetLedgerOpen').hidden,true);assert.equal(el('sumNet').textContent,'¥5,731.72');
});
test('真实零余额账户显示零净资产，而非未建立总账',async()=>{
  const {el}=await fixture({ledger:addAccount(emptyLedger(),{name:'模拟空账户',type:'asset',balance:0})});
  assert.equal(el('assetCurrentEmpty').hidden,true);assert.equal(el('assetCurrentBody').hidden,false);assert.equal(el('assetNet').textContent,'¥0.00');
});
test('总负债高于总资产时如实显示负净资产',async()=>{
  const ledger=addAccount(addAccount(emptyLedger(),{name:'模拟资产',type:'asset',balance:100}),{name:'模拟负债',type:'liability',balance:150});
  const {el}=await fixture({ledger});assert.equal(el('assetNet').textContent,'¥-50.00');assert.equal(el('assetTotal').textContent,'¥100.00');assert.equal(el('assetLiability').textContent,'¥150.00');
});
test('区间支出继续复用退款实际金额、排除、关闭、中性和导入对账规则',async()=>{
  const transactions=[tx('refund','2026-10-16T10:00:00','支出',100,{status:'部分退款',countedAmount:30}),
    tx('excluded','2026-10-16T11:00:00','支出',500,{excluded:true}),tx('closed','2026-10-16T12:00:00','支出',500,{status:'交易关闭'}),
    tx('neutral','2026-10-16T13:00:00','中性',500),tx('dup','2026-10-16T14:00:00','支出',200,{source:'手动',manual:true,reconciledDuplicateOf:'imported'}),
    tx('imported','2026-10-16T14:05:00','支出',200),tx('income','2026-10-16T15:00:00','收入',80)];
  const {el}=await fixture({transactions});assert.equal(el('sumExpense').textContent,'¥230.00');assert.equal(el('sumIncome').textContent,'¥80.00');
  assert.equal(el('sumNet').textContent,'¥-150.00');assert.equal(el('assetNet').textContent,'¥900.00');
});
test('新增修改删除区间流水会更新收支差额，但不会自动改变当前资产',async()=>{
  const f=await fixture({transactions:[]});
  for(const [transactions,net] of [[[tx('a','2026-10-16','支出',20)],-20],[[tx('a','2026-10-16','支出',50),tx('b','2026-10-16','收入',100)],50],[[],0]]){
    f.context.transactions=transactions;f.context.refreshAll();assert.equal(f.el('sumNet').textContent,money(net));assert.equal(f.el('assetNet').textContent,'¥900.00');
  }
  assert.deepEqual(await loadAssetLedger(),f.assetUI.getLedger());
});
test('管理资产仍打开既有总账弹窗',async()=>{
  const {el}=await fixture();el('assetLedgerOpen').handlers.click();assert.equal(el('assetLedgerDialog').open,true);assert.equal(el('ledgerNet').textContent,'¥900.00');
});
test('无账户时建立总账入口仍可用',async()=>{
  const {el}=await fixture({ledger:emptyLedger()});el('assetLedgerOpenEmpty').handlers.click();assert.equal(el('assetLedgerDialog').open,true);
});
test('资产快照入口仍打开现有快照功能，已有快照保持可读',async()=>{
  const {el}=await fixture();await el('snapshotsOpen').handlers.click();assert.equal(el('snapshotsDialog').open,true);
  assert.match(el('snapshotList').innerHTML,/5,481\.85/);assert.equal((await loadSnapshots()).length,1);
});
test('账期核对入口仍打开现有核对面板',async()=>{
  const {el}=await fixture({range:currentBillingPeriod(new Date(2026,9,16))});await el('balanceOpen').handlers.click();
  assert.equal(el('balanceDialog').open,true);assert.match(el('balanceOpening').innerHTML,/2026-10-15/);
  assert.equal(el('balanceRange').textContent,'2026.10.15 — 2026.11.14');
});
test('更改总账后资产卡片更新，仍不改区间收支',async()=>{
  const f=await fixture();const before=f.el('sumNet').textContent;
  const ledger=addAccount(currentLedger(),{name:'新增模拟资产',type:'asset',balance:50});await saveAssetLedger(ledger);await f.assetUI.load();
  assert.equal(f.el('assetNet').textContent,'¥950.00');assert.equal(f.el('sumNet').textContent,before);
});
test('旧交易保留，使用以来排除起点之前的流水，自定义仍能查看',async()=>{
  const f=await fixture();assert.equal(f.el('sumExpense').textContent,'¥120.00');
  f.setRange(customDateRange('2026-09-01','2026-09-30'));assert.equal(f.el('sumExpense').textContent,'¥9.00');assert.equal(f.el('assetNet').textContent,'¥900.00');
  assert.equal((await loadAllTransactions()).length,rows.length);
});

test('现有资产快照功能仍支持预填日期且不覆盖已有当日快照', async () => {
  globalThis.indexedDB = new IDBFactory();
  const { setupLedgerTools } = await import('../js/ledger-tools.js');
  const { loadSnapshots } = await import('../js/storage.js');
  const elements = new Map();
  const create = id => ({ id, hidden:true, disabled:false, value:'', textContent:'', innerHTML:'',
    className:'', open:false, dataset:{}, handlers:{}, setAttribute(){},
    addEventListener(type, handler){ this.handlers[type] = handler; },
    showModal(){ this.open = true; }, close(){ this.open = false; }, scrollIntoView(){} });
  globalThis.document = { getElementById: id => { if (!elements.has(id)) elements.set(id, create(id)); return elements.get(id); } };

  const tools = setupLedgerTools({ getTransactions:() => [], getRange:() => usageTimeRange(),
    updateTransaction(){}, refreshApp(){} });
  await tools.load();

  // 还没有 10-15 快照：新增，日期预填为起始日。
  const created = await tools.newSnapshot(USAGE_START_DATE);
  assert.equal(created, null);
  assert.equal(elements.get('snapshotEditTitle').textContent, '新增快照');
  assert.equal(elements.get('snapshotDate').value, USAGE_START_DATE);
  assert.equal(elements.get('snapshotEditDialog').open, true);
  assert.deepEqual(await loadSnapshots(), []);

  // 保存后再次进入：走编辑路径，不新增第二条同日期快照。
  await saveSnapshot({ date:USAGE_START_DATE, totalAssets:5000, totalLiabilities:0 });
  const existing = await tools.newSnapshot(USAGE_START_DATE);
  assert.ok(existing);
  assert.equal(existing.date, USAGE_START_DATE);
  assert.equal(elements.get('snapshotEditTitle').textContent, '编辑快照');
  assert.equal(elements.get('snapshotDate').value, USAGE_START_DATE);
  assert.equal((await loadSnapshots()).length, 1);
  delete globalThis.document;
});
