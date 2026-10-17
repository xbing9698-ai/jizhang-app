import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import * as storage from '../js/storage.js';
import { editableTransactionCategories } from '../js/transaction-update.js';
import { isManualTransaction } from '../js/manual.js';
import { canAdjustTransaction, isValidCountedAmount, countedExpenseAmount, needsReview } from '../js/review.js';
import { isReconciledDuplicate } from '../js/reconciliation.js';
import { resolveCategory } from '../js/classify.js';
import { summarize, buildPeriodTable } from '../js/aggregate.js';
import * as period from '../js/period.js';
import { latestSnapshot, referenceFromSnapshot, formatSnapshotMoment } from '../js/snapshots.js';
import { calculateLedgerTotals, hasLedgerAccounts, emptyLedger, addAccount } from '../js/asset-ledger.js';
import { setupLedgerTools } from '../js/ledger-tools.js';
import { setupAssetLedgerUI } from '../js/asset-ledger-ui.js';
import { colorForCategory } from '../js/charts.js';
import { iconSvg } from '../js/icons.js';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { delete globalThis.document; });
const app = readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const row = (extra = {}) => ({ id:'imported', source:'微信', counterparty:'合成商户', externalOrderId:'order',
  datetime:'2026-10-17T12:00:00', amount:100, direction:'支出', myCategory:'餐饮', description:'原说明', status:'部分退款', ...extra });
function dom() {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id]) => [id, {
    value:'', textContent:'', innerHTML:'', hidden:false, disabled:false, open:false, dataset:{}, style:{}, handlers:{}, attributes:{},
    addEventListener(type,fn) { this.handlers[type] = fn; }, setAttribute(name,value) { this.attributes[name] = value; },
    querySelectorAll() { return []; }, showModal() { this.open = true; }, close() { this.open = false; }, scrollIntoView() {}
  }]));
  const document = { getElementById(id) { assert.ok(elements.has(id),`真实DOM缺少 ${id}`); return elements.get(id); },
    querySelector:() => ({ hidden:false }), querySelectorAll:() => [] };
  globalThis.document = document;
  return { document, el:id => elements.get(id) };
}

async function editorFixture(rows) {
  await storage.saveTransactions(rows);
  const { document, el } = dom();
  const context = { document, transactions:await storage.loadAllTransactions(), memory:{}, ...storage,
    editableTransactionCategories, isManualTransaction, canAdjustTransaction, isValidCountedAmount, isReconciledDuplicate, esc,
    refreshes:0 };
  context.refreshAll = () => { context.refreshes++; };
  vm.createContext(context);
  const classify = app.slice(app.indexOf('function classifyAll('),app.indexOf('// ===== 标签切换'));
  const editor = app.slice(app.indexOf('const adjustmentDialog ='),app.indexOf('async function onSaveAdjustment('));
  context.resolveCategory = resolveCategory;
  vm.runInContext(classify + '\n' + editor,context);
  context.onOpenAdjustment({ currentTarget:{ dataset:{ id:rows[0].id } } });
  return { context, el, submit:() => el('transactionEditForm').handlers.submit({ preventDefault() {} }) };
}

test('实际统一编辑提交处理器更新商户记忆并重读最新退款状态，只联动分类', async () => {
  const peer = row({ id:'peer', amount:20, description:'同商户另一笔' });
  const f = await editorFixture([row(),peer]);
  await storage.saveExpenseAdjustment('imported','amount','40'); // 另一个页面在面板打开后完成调整。
  f.el('transactionCategory').value = '购物'; f.el('transactionDescription').value = '修改说明';
  await f.submit();
  assert.equal(f.el('categoryMsg').textContent,''); assert.equal(f.el('adjustmentDialog').open,false);
  const saved = await storage.loadAllTransactions(), selected = saved.find(t => t.id === 'imported');
  assert.equal(selected.countedAmount,40); assert.equal(selected.reviewed,true); assert.equal(selected.description,'修改说明');
  assert.equal(saved.find(t => t.id === 'peer').description,peer.description); assert.equal(saved.find(t => t.id === 'peer').amount,20);
  assert.ok(saved.every(t => t.myCategory === '购物')); assert.deepEqual(await storage.loadMemory(),{'合成商户':'购物'});
  assert.equal(f.context.memory['合成商户'],'购物'); assert.equal(f.context.transactions.find(t => t.id === 'imported').countedAmount,40);
});

test('旧编辑面板未触碰字段不会覆盖另一页面的新金额分类和日期', async () => {
  const f = await editorFixture([row()]);
  await storage.saveTransactionEdit('imported',{ amount:'120', date:'2026-10-18', category:'交通' });
  f.el('transactionDescription').value = '只改说明'; await f.submit();
  const [saved] = await storage.loadAllTransactions();
  assert.equal(saved.amount,120); assert.equal(saved.datetime,'2026-10-18T12:00:00'); assert.equal(saved.myCategory,'交通');
  assert.equal(saved.description,'只改说明');
});

test('实际编辑入口可保留旧自定义分类，也会在改变方向时更新合法选项', async () => {
  const f = await editorFixture([row({ myCategory:'咖啡', counterparty:'' })]);
  assert.match(f.el('transactionCategory').innerHTML,/咖啡/); assert.equal(f.el('transactionCategory').value,'咖啡');
  f.el('transactionDescription').value = '更新'; await f.submit();
  assert.equal((await storage.loadAllTransactions())[0].myCategory,'咖啡');
  f.context.onOpenAdjustment({ currentTarget:{ dataset:{ id:'imported' } } });
  f.el('transactionDirection').value = '收入'; f.el('transactionDirection').handlers.change();
  assert.ok(!f.el('transactionCategory').innerHTML.includes('咖啡')); assert.match(f.el('transactionCategory').innerHTML,/工资/);
  f.el('transactionCategory').value = '工资'; await f.submit();
  assert.equal((await storage.loadAllTransactions())[0].direction,'收入');
});

test('实际编辑入口拒绝复活已删除交易，并显示错误且不关闭面板', async () => {
  const f = await editorFixture([row({ id:'manual:deleted', source:'手动', manual:true })]);
  await storage.deleteManualTransaction('manual:deleted'); f.el('transactionDescription').value = '旧面板保存'; await f.submit();
  assert.deepEqual(await storage.loadAllTransactions(),[]); assert.match(f.el('categoryMsg').textContent,/不存在/);
  assert.equal(f.el('adjustmentDialog').open,true);
});

test('实际编辑入口金额调小后明确反馈计入调整已清除，重读数据没有旧值', async () => {
  await storage.saveTransactions([row()]); await storage.saveExpenseAdjustment('imported','amount','70');
  const f = await editorFixture(await storage.loadAllTransactions());
  f.el('transactionAmount').value = '50'; await f.submit();
  assert.match(f.el('adjustmentFeedback').textContent,/已失效并清除.*重新确认/);
  assert.equal((await storage.loadAllTransactions())[0].countedAmount,undefined);
});

test('真实首页刷新切换本账期、自定义、使用以来只改变区间统计，参考资产及警告保持独立', async () => {
  const rows = [row({ id:'income', datetime:'2026-10-15T13:00:00', amount:5200, direction:'收入' }),
    row({ id:'spend', datetime:'2026-10-16T12:00:00', amount:100, countedAmount:30 }),
    row({ id:'unknown', source:'手动', datetime:'2026-10-15T00:00:00', amount:20 }),
    row({ id:'excluded', amount:999, excluded:true }),row({ id:'closed', amount:999, status:'交易关闭' }),
    row({ id:'dup', source:'手动', amount:500, reconciledDuplicateOf:'spend' }),
    row({ id:'old', datetime:'2026-10-01T12:00:00', amount:10 })];
  await storage.saveTransactions(rows);
  await storage.saveSnapshot({ date:'2026-10-15', time:'12:00:45', totalAssets:5000, totalLiabilities:0 });
  const ledger = addAccount(emptyLedger(),{ name:'合成现金', type:'asset', balance:900 }); await storage.saveAssetLedger(ledger);
  const { document, el } = dom();
  const context = { document, transactions:rows, range:period.usageTimeRange(), ...period, ...storage,
    summarize, buildPeriodTable, latestSnapshot, referenceFromSnapshot, formatSnapshotMoment, calculateLedgerTotals, hasLedgerAccounts,
    colorForCategory, iconSvg, countedExpenseAmount, isReconciledDuplicate, isValidCountedAmount, needsReview, esc,
    refreshReviewNotice() {}, populateCategoryFilter() {}, renderDetail() {} };
  context.referenceFromSnapshot = (s,txns) => referenceFromSnapshot(s,txns,new Date(2026,9,17,20));
  context.renderCategoryPie = (_canvas,data) => { context.categoryData = data; };
  context.renderTrend = (_canvas,data) => { context.trendData = data; };
  const tools = setupLedgerTools({ getTransactions:() => context.transactions, getRange:() => context.range, refreshApp() {}, updateTransaction() {} });
  await tools.load(); context.ledgerTools = tools;
  const ui = setupAssetLedgerUI({ refreshApp() {}, refreshSnapshots:() => tools.load() }); await ui.load(); context.assetLedgerUI = ui;
  vm.createContext(context);
  const notes = app.slice(app.indexOf('function accountingNote('),app.indexOf('function rowHtml('));
  const dashboard = app.slice(app.indexOf('function fmtMoney('),app.indexOf("document.getElementById('monthPick').addEventListener"));
  const refresh = app.slice(app.indexOf('function refreshAll()'),app.indexOf('// ===== 备份 / 清空 ====='));
  vm.runInContext(notes + dashboard + refresh,context);
  const before = { rows:await storage.loadAllTransactions(), snapshots:await storage.loadSnapshots(), ledger:await storage.loadAssetLedger() };
  for (const range of [period.currentBillingPeriod(new Date(2026,9,17)),period.customDateRange('2026-10-16','2026-10-16'),period.usageTimeRange(),period.billingPeriodRange('2026-10')]) {
    context.range = range; context.refreshAll(); const summary = summarize(rows,range);
    assert.equal(el('sumExpense').textContent,'¥' + summary.totalExpense.toFixed(2));
    assert.equal(el('sumIncome').textContent,'¥' + summary.totalIncome.toLocaleString('zh-CN',{ minimumFractionDigits:2, maximumFractionDigits:2 }));
    assert.deepEqual(context.categoryData,summary.byCategory); assert.deepEqual(context.trendData,summary.byDay);
    assert.equal(el('assetNet').textContent,'¥10,170.00'); assert.match(el('assetReferenceWarning').textContent,/1 笔/);
    assert.equal(el('assetReferenceWarning').hidden,false);
    assert.equal(el('assetTotal').textContent,'¥900.00'); assert.equal(el('assetLiability').textContent,'¥0.00');
    assert.equal(el('expenseDelta').textContent === '',!period.prevPeriodRange(range));
  }
  assert.deepEqual(await storage.loadAllTransactions(),before.rows); assert.deepEqual(await storage.loadSnapshots(),before.snapshots);
  assert.deepEqual(await storage.loadAssetLedger(),before.ledger);
  el('assetLedgerOpen').handlers.click(); assert.equal(el('assetLedgerDialog').open,true);
  el('snapshotsOpen').handlers.click(); assert.equal(el('snapshotsDialog').open,true);
  await el('balanceOpen').handlers.click(); assert.equal(el('balanceDialog').open,true);
});
