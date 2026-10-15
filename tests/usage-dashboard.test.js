import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import {
  usageTimeRange, currentBillingPeriod, customDateRange, rangeText,
  filterTransactionsByRange, prevPeriodRange, USAGE_START_DATE
} from '../js/period.js';
import { summarize, buildPeriodTable } from '../js/aggregate.js';
import { findStartingSnapshot, estimateCurrentNet, checkDifference } from '../js/estimated-assets.js';
import { hasLedgerAccounts, calculateLedgerTotals, emptyLedger, addAccount } from '../js/asset-ledger.js';
import { saveSnapshot, saveAssetLedger, loadAssetLedger } from '../js/storage.js';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const app = readFileSync(new URL('js/app.js', root), 'utf8');
const css = readFileSync(new URL('css/style.css', root), 'utf8');

// 只创建缺失元素的最小 DOM 桩，用于跑真实的 refreshDashboard。
function stubDom() {
  const elements = new Map();
  const create = id => ({ id, hidden:false, disabled:false, value:'', textContent:'', innerHTML:'',
    className:'', style:{}, handlers:{}, setAttribute(){}, addEventListener(){}, showModal(){}, close(){}, scrollIntoView(){} });
  globalThis.document = {
    getElementById: id => { if (!elements.has(id)) elements.set(id, create(id)); return elements.get(id); },
    querySelector: () => elements.get('__pieWrap'),
    querySelectorAll: () => []
  };
  elements.set('__pieWrap', create('__pieWrap'));
  return elements;
}

// 用真实 app.js 源码切片运行 refreshDashboard，统计与范围函数全部来自真实模块。
function dashboardSlice() {
  const start = app.indexOf('function fmtMoney(');
  const end = app.indexOf("document.getElementById('monthPick').addEventListener");
  assert.ok(start > 0 && end > start, '应能定位到仪表盘代码块');
  return app.slice(start, end)
    .replace(/renderCategoryPie\(/g, 'noopPie(')
    .replace(/renderTrend\(/g, 'noopTrend(')
    // 分类与 Top 列表的 DOM 渲染不属于本次逻辑，整体替换为记录调用，避免引入图标/配色依赖。
    .replace(/function renderCatList\([\s\S]*?\n}\n/, 'function renderCatList(){}\n')
    .replace(/function renderTopList\([\s\S]*?\n}\n/, 'function renderTopList(){}\n');
}
const SLICE = dashboardSlice();
// app.js 中 renderPeriodTable 用到的最小转义函数。
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

function runDashboard({ transactions = [], snapshots = [], ledger = emptyLedger(), range = usageTimeRange() }) {
  const elements = stubDom();
  const context = {
    document: globalThis.document,
    esc,
    transactions, snapshots, range, memory: {}, lastImport: null,
    summarize, prevPeriodRange, rangeText, filterTransactionsByRange, buildPeriodTable,
    findStartingSnapshot, estimateCurrentNet, checkDifference, USAGE_START_DATE,
    hasLedgerAccounts, calculateLedgerTotals,
    assetLedgerUI: { getLedger: () => ledger },
    noopPie(){}, noopTrend(){}
  };
  vm.createContext(context);
  vm.runInContext(SLICE + '\nrefreshDashboard();', context);
  return id => elements.get(id);
}

const tx = (id, datetime, direction, amount, extra = {}) =>
  ({ id, datetime, direction, amount, myCategory:'餐饮', source:'微信', ...extra });
const startingSnapshot = (netAssets, extras = {}) => ({
  id:'snapshot:start', date:USAGE_START_DATE, totalAssets:netAssets, totalLiabilities:0,
  netAssets, note:'', createdAt:'2026-10-15T00:00:00.000Z', ...extras
});

test('全部时间文案不存在，使用以来存在（按钮、范围文案、窄屏标签）', () => {
  const rangeBar = html.slice(html.indexOf('class="range-bar"'), html.indexOf('class="kpi-row"'));
  assert.ok(rangeBar.includes('使用以来'), '时间按钮应显示"使用以来"');
  assert.ok(!rangeBar.includes('全部时间'), '时间按钮不应再出现"全部时间"');
  assert.match(html, /id="allRange"[^>]*>使用以来</);
  assert.ok(!html.includes('累计收支差额'), '不再使用"累计收支差额"作为主数字文案');
  const css = readFileSync(new URL('css/style.css', root), 'utf8');
  assert.match(css, /#allRange\[aria-pressed="true"\]\) \.range-mode-title::before\{content:'使用以来'\}/);
  assert.ok(!css.includes("content:'全部时间'"));
  assert.equal(rangeText(usageTimeRange()), '使用以来');
});

test('使用以来模式下主KPI是预计当前净资产，收支差额为次级信息', () => {
  const ledger = addAccount(emptyLedger(), { name:'招商银行卡', type:'asset', balance:5020 });
  const el = runDashboard({
    snapshots:[startingSnapshot(5000)], ledger, range: usageTimeRange(),
    transactions:[tx('old','2026-10-14T10:00:00','支出',999), tx('e1','2026-10-16T10:00:00','支出',20)]
  });

  assert.equal(el('usageNetCard').hidden, false);
  assert.equal(el('netUsage').hidden, false);
  // 最大主数字 = 预计当前净资产（起始 5000 − 支出 20）。
  assert.equal(el('sumNetLabel').textContent, '预计当前净资产');
  assert.equal(el('sumNet').textContent, '¥4,980.00');
  // 收支差额不再是主数字，只在次级列表里出现。
  assert.notEqual(el('sumNetLabel').textContent, '使用以来收支差额');
  assert.notEqual(el('sumNet').textContent, '¥-20.00');
  assert.match(el('netSub').textContent, /仅表示区间收支差额，不等于当前资产/);
  // 次级信息保留起始净资产、使用以来收入、支出与收支差额。
  assert.equal(el('netStartValue').textContent, '¥5,000.00');
  assert.equal(el('netStartIncome').textContent, '¥0.00');
  assert.equal(el('netStartExpense').textContent, '¥20.00');
  assert.equal(el('usageFlowNet').textContent, '¥-20.00');
  assert.equal(el('netStartList').hidden, false);
  assert.equal(el('netStartHint').hidden, true);
  assert.equal(el('usageSnapshotSetup').hidden, true);
  // 实际净资产来自资产总账；10-15 前的 999 元支出不影响预计值。
  assert.equal(el('usageActualNet').textContent, '¥5,020.00');
  assert.match(el('usageActualMeta').textContent, /来自资产总账/);
  assert.equal(el('usageDiffRow').hidden, false);
  assert.equal(el('usageDiff').textContent, '+¥40.00');
  // 主 KPI 结构：预计净资产在 netUsage 之前，收支差额在 netUsage 之内。
  const card = html.slice(html.indexOf('class="kpi-card kpi-net"'), html.indexOf('kpi-expense'));
  assert.ok(card.indexOf('id="sumNet"') < card.indexOf('id="netUsage"'));
  assert.ok(card.indexOf('id="usageFlowNet"') > card.indexOf('id="netUsage"'));
  assert.match(css, /\.kpi-net \.kpi-value\{font-size:39px/);
  assert.ok(!/\.net-usage-values li:first-child b\{font-size:17px\}/.test(css), '列表首行不应放大成主数字');
});

test('「设置起始资产快照」复用现有资产快照功能，日期预填且不覆盖已有当日快照', async () => {
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

test('使用以来模式下按钮状态与月份控件正确：只有本账期显示月份选择', () => {
  const start = app.indexOf('function refreshAll()');
  const end = app.indexOf('// ===== 备份 / 清空 =====');
  assert.ok(start > 0 && end > start, '应能定位到 refreshAll');
  const slice = app.slice(start, end);

  for (const [range, expected] of [
    [usageTimeRange(), 'usage'],
    [currentBillingPeriod(new Date(2026, 9, 20)), 'billing'],
    [customDateRange('2026-10-01', '2026-10-31'), 'custom']
  ]) {
    const elements = new Map();
    const create = id => ({ id, hidden:false, value:'', textContent:'', innerHTML:'', pressed:null,
      setAttribute(name, value){ this.pressed = value; } });
    const context = {
      range,
      document: { getElementById: id => { if (!elements.has(id)) elements.set(id, create(id)); return elements.get(id); } },
      refreshReviewNotice(){}, ledgerTools:{ refresh(){} }, populateCategoryFilter(){},
      renderDetail(){}, refreshDashboard(){}
    };
    vm.createContext(context);
    vm.runInContext(slice + '\nrefreshAll();', context);

    assert.equal(elements.get('allRange').pressed, String(expected === 'usage'), '使用以来按钮高亮状态');
    assert.equal(elements.get('billingRange').pressed, String(expected === 'billing'));
    assert.equal(elements.get('customRangeOpen').pressed, String(expected === 'custom'));
    assert.equal(elements.get('billingMonthWrap').hidden, expected !== 'billing');
    // 只有本账期才写入并显示月份控件；使用以来不显示月份选择。
    assert.equal(elements.get('monthPick').value, expected === 'billing' ? range.label : '');
  }
});

test('新增、修改、删除交易后预计当前净资产生效于主KPI并同步变化', () => {
  const snapshots = [startingSnapshot(5000)];
  const ledger = addAccount(emptyLedger(), { name:'现金', type:'asset', balance:100 });
  const base = [tx('e1','2026-10-16T10:00:00','支出',20)];

  let el = runDashboard({ transactions:base, snapshots, ledger, range:usageTimeRange() });
  assert.equal(el('sumNetLabel').textContent, '预计当前净资产');
  assert.equal(el('sumNet').textContent, '¥4,980.00');

  el = runDashboard({ transactions:[...base, tx('i1','2026-10-17T10:00:00','收入',100)], snapshots, ledger, range:usageTimeRange() });
  assert.equal(el('sumNet').textContent, '¥5,080.00');
  assert.equal(el('usageFlowNet').textContent, '¥80.00');
  assert.equal(el('usageDiff').textContent, '−¥4,980.00');

  el = runDashboard({ transactions:[tx('e1','2026-10-16T10:00:00','支出',50)], snapshots, ledger, range:usageTimeRange() });
  assert.equal(el('sumNet').textContent, '¥4,950.00');

  el = runDashboard({ transactions:[], snapshots, ledger, range:usageTimeRange() });
  assert.equal(el('sumNet').textContent, '¥5,000.00');
  assert.equal(el('usageDiff').textContent, '−¥4,900.00');
});

test('预计净资产复用现有统计口径：退款计入金额、排除项、关闭、中性、已核对重复', () => {
  const ledger = addAccount(emptyLedger(), { name:'现金', type:'asset', balance:1000 });
  const transactions = [
    tx('refund','2026-10-16T10:00:00','支出',100,{ status:'部分退款', countedAmount:30 }), // 只计 30
    tx('excluded','2026-10-16T11:00:00','支出',500,{ excluded:true }),                      // 不计
    tx('closed','2026-10-16T12:00:00','支出',500,{ status:'交易关闭' }),                    // 不计
    tx('neutral','2026-10-16T13:00:00','中性',500),                                        // 不计
    // 已核对重复：手动记录不再计入统计，导入记录照常计入。
    tx('manual-dup','2026-10-16T14:00:00','支出',200,{ source:'手动', manual:true, reconciledDuplicateOf:'imported-dup' }),
    tx('imported-dup','2026-10-16T14:05:00','支出',200,{ source:'微信' }),
    tx('income','2026-10-16T15:00:00','收入',80)
  ];
  const el = runDashboard({ transactions, snapshots:[startingSnapshot(1000)], ledger, range:usageTimeRange() });
  // 预计 = 1000 + 80 - (30 + 200) = 850，直接体现在主 KPI 上。
  assert.equal(el('sumNetLabel').textContent, '预计当前净资产');
  assert.equal(el('sumNet').textContent, '¥850.00');
  assert.equal(el('netStartExpense').textContent, '¥230.00');
  assert.equal(el('netStartIncome').textContent, '¥80.00');
  assert.equal(el('usageFlowNet').textContent, '¥-150.00');
  // 同一笔交易在"本账期"和"使用以来"用同一口径。
  const billing = currentBillingPeriod(new Date(2026, 10, 1));
  const billingSummary = summarize(transactions, billing);
  const usageSummary = summarize(transactions, usageTimeRange());
  assert.equal(billingSummary.totalExpense, usageSummary.totalExpense);
  assert.equal(billingSummary.totalIncome, usageSummary.totalIncome);
  assert.equal(usageSummary.totalExpense, 230);
});

test('没有 2026-10-15 快照时不把 0 当起点，显示设置提示与入口', () => {
  const ledger = addAccount(emptyLedger(), { name:'现金', type:'asset', balance:12 });
  const el = runDashboard({
    snapshots:[{ id:'snapshot:other', date:'2026-10-14', totalAssets:9000, totalLiabilities:0,
      netAssets:9000, createdAt:'2026-10-14T00:00:00.000Z' }],
    ledger, range: usageTimeRange(), transactions:[tx('e1','2026-10-16T10:00:00','支出',20)]
  });

  assert.equal(el('netStartList').hidden, true);
  assert.equal(el('netStartHint').hidden, false);
  assert.match(el('netStartHint').textContent, /尚未设置起始净资产/);
  assert.match(el('netStartHint').textContent, new RegExp(USAGE_START_DATE));
  assert.match(el('netStartHint').textContent, /请记录 2026-10-15 的资产快照/);
  assert.equal(el('usageSnapshotSetup').hidden, false);
  // 主区域不出现任何数字：既不显示 0，也不显示用 9000 或收支差额推出来的净资产。
  assert.equal(el('sumNetLabel').textContent, '尚未设置起始净资产');
  assert.equal(el('sumNet').textContent, '');
  assert.notEqual(el('sumNetLabel').textContent, '预计当前净资产');
  assert.notEqual(el('sumNet').textContent, '¥-20.00');
  assert.match(el('netSub').textContent, /不等于当前资产/);
  assert.equal(el('netUsage').hidden, false);
  assert.equal(el('usageFlowNet').textContent, '¥-20.00');
  // 没有起始快照就不显示差额。
  assert.equal(el('usageDiffRow').hidden, true);
  // 入口本质是创建/编辑 2026-10-15 的资产快照，复用现有功能。
  assert.match(html, /id="usageSnapshotSetup"/);
  assert.match(app, /ledgerTools\.newSnapshot\(USAGE_START_DATE\)/);
  assert.match(readFileSync(new URL('js/ledger-tools.js', root), 'utf8'), /newSnapshot/);
});

test('没有资产总账时实际净资产显示为 — 且不显示差额', () => {
  const el = runDashboard({ snapshots:[startingSnapshot(5000)], ledger: emptyLedger(), range: usageTimeRange() });
  assert.equal(el('usageActualNet').textContent, '—');
  assert.equal(el('usageActualMeta').textContent, '还没有建立资产总账');
  assert.equal(el('usageDiffRow').hidden, true);
  assert.equal(el('usageDiffNote').hidden, true);
});

test('预计与实际一致时显示账目与资产一致，不用警告文案', () => {
  const ledger = addAccount(emptyLedger(), { name:'现金', type:'asset', balance:4980 });
  const el = runDashboard({
    transactions:[tx('e1','2026-10-16T10:00:00','支出',20)],
    snapshots:[startingSnapshot(5000)], ledger, range: usageTimeRange()
  });
  assert.equal(el('sumNetLabel').textContent, '预计当前净资产');
  assert.equal(el('sumNet').textContent, '¥4,980.00');
  assert.equal(el('usageActualNet').textContent, '¥4,980.00');
  assert.equal(el('usageDiff').textContent, '账目与资产一致');
  assert.equal(el('usageDiffRow').hidden, false);
  const text = ['usageDiff','usageDiffNote','netSub','usageFlowNet'].map(id => el(id).textContent).join(' ');
  for (const word of ['错误','异常','警告','不平']) assert.ok(!text.includes(word), `不应出现 ${word}`);
});

test('本账期与自定义范围仍只显示收支结余，不出现预计净资产', () => {
  const ledger = addAccount(emptyLedger(), { name:'现金', type:'asset', balance:4980 });
  const snapshots = [startingSnapshot(5000)];
  const transactions = [tx('e1','2026-10-16T10:00:00','支出',20), tx('i1','2026-10-16T11:00:00','收入',100)];

  for (const range of [currentBillingPeriod(new Date(2026,9,20)), customDateRange('2026-10-01','2026-10-31')]) {
    const el = runDashboard({ transactions, snapshots, ledger, range });
    assert.equal(el('sumNetLabel').textContent, '收支结余');
    assert.equal(el('netUsage').hidden, true);
    assert.equal(el('usageNetCard').hidden, true);
    assert.equal(el('sumNet').textContent, '¥80.00');
    assert.equal(el('netSub').textContent, '收入减支出');
  }
});

test('使用以来不修改任何资产账户余额，实际净资产只在总账变化时改变', async () => {
  globalThis.indexedDB = new IDBFactory();
  const ledger = addAccount(emptyLedger(), { name:'微信', type:'asset', balance:300 });
  await saveAssetLedger(ledger);
  await saveSnapshot({ date:USAGE_START_DATE, totalAssets:300, totalLiabilities:0 });

  const el = runDashboard({
    transactions:[tx('e1','2026-10-16T10:00:00','支出',20)],
    snapshots:[startingSnapshot(300)], ledger, range: usageTimeRange()
  });
  assert.equal(el('sumNet').textContent, '¥280.00');
  assert.equal(el('usageActualNet').textContent, '¥300.00');
  // 记一笔支出后，资产总账与账户余额原样不动。
  const reloaded = await loadAssetLedger();
  assert.deepEqual(reloaded, ledger);
  assert.deepEqual(reloaded.accounts.map(a => a.balance), [300]);
  assert.deepEqual(calculateLedgerTotals(reloaded.accounts), { totalAssets:300, totalLiabilities:0, netAssets:300 });
  delete globalThis.document;
});

test('2026-10-15 前旧交易完全保留，仍可被自定义时间查看', () => {
  const old = tx('old','2026-09-01T10:00:00','支出',123);
  const transactions = [old, tx('new','2026-10-20T10:00:00','支出',10)];
  assert.deepEqual(filterTransactionsByRange(transactions, usageTimeRange()).map(t => t.id), ['new']);
  assert.equal(summarize(transactions, usageTimeRange()).totalExpense, 10);
  const custom = customDateRange('2026-09-01','2026-09-30');
  assert.deepEqual(filterTransactionsByRange(transactions, custom).map(t => t.id), ['old']);
  assert.equal(summarize(transactions, custom).totalExpense, 123);
  // 记录本身没有被修改。
  assert.equal(old.amount, 123);
  assert.equal(old.datetime, '2026-09-01T10:00:00');
});

test('使用以来是"开始日期不同、口径相同"：只差 2026-10-15 之前的部分', () => {
  const transactions = [
    tx('old','2026-10-01T10:00:00','支出',777),
    tx('e1','2026-10-16T10:00:00','支出',20),
    tx('i1','2026-10-17T10:00:00','收入',100)
  ];
  const usage = summarize(transactions, usageTimeRange());
  const everything = summarize(transactions, { start:null, end:null });
  assert.equal(usage.totalExpense, 20);
  assert.equal(usage.totalIncome, 100);
  assert.equal(everything.totalExpense, 797);
  assert.equal(everything.totalIncome, 100);
  assert.equal(everything.totalExpense - usage.totalExpense, 777);
});
