import { fileToTransactions } from './import-transactions.js';
import { mergeTransactions } from './dedup.js';
import { classify, resolveCategory, CATEGORIES } from './classify.js';
import {
  summarize,
  filterTransactionsBySource,
  matchesSearch,
  groupByCounterparty,
  buildPeriodTable
} from './aggregate.js';
import { billingPeriodRange, latestCompletedPeriod, prevPeriodRange, filterTransactionsByRange, billingPeriodLabel } from './period.js';
import { renderCategoryPie, renderTrend, colorForCategory } from './charts.js';
import { iconSvg } from './icons.js';
import { isManualTransaction } from './manual.js';
import { newQuickEntry, keypadAmount, createQuickExpense } from './quick-entry.js';
import { countedExpenseAmount, isValidCountedAmount, canAdjustTransaction, needsReview, filterNeedsReview } from './review.js';
import {
  saveTransactions, loadAllTransactions, saveMemory, loadMemory,
  clearAllData, exportBackup, importBackup, deleteManualTransaction, saveExpenseAdjustment
} from './storage.js';

// ===== 状态 =====
let transactions = [];
let memory = {};
let range = latestCompletedPeriod();
let lastImport = null;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function classifyAll() {
  for (const t of transactions) t.myCategory = resolveCategory(t, memory);
}

// ===== 标签切换 =====
function switchView(name) {
  document.querySelectorAll('.tab').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'detail') renderDetail();
}
document.getElementById('tabs').addEventListener('click', e => {
  if (e.target.classList.contains('tab')) switchView(e.target.dataset.view);
});

// ===== 导入 =====
async function onFiles(files) {
  const msg = document.getElementById('importMsg');
  msg.className = 'import-msg';
  try {
    let incoming = [];
    for (const f of files) incoming.push(...await fileToTransactions(f));
    const { merged, added, skipped } = mergeTransactions(transactions, incoming);
    transactions = merged;
    classifyAll();
    await saveTransactions(transactions);
    lastImport = { added, skipped };
    refreshAll();
    switchView(filterNeedsReview(transactions).length ? 'import' : 'overview');
  } catch (err) {
    lastImport = null;
    msg.textContent = '导入失败：' + err.message;
    msg.classList.add('error');
  }
}
document.getElementById('fileInput').addEventListener('change', e => onFiles(e.target.files));

// ===== 首页与导入页共用的快速支出记账 =====
const quickDialog = document.getElementById('quickEntryDialog');
const quickCategories = document.getElementById('quickCategories');
let quickDraft = newQuickEntry();
let quickSaving = false;
quickCategories.innerHTML = CATEGORIES.map(cat =>
  '<button type="button" class="quick-category" data-category="' + esc(cat) + '" aria-pressed="false">' +
  iconSvg(cat, 20) + '<span>' + esc(cat) + '</span></button>').join('');

function renderQuickEntry() {
  document.getElementById('quickAmount').textContent = quickDraft.amount || '0.00';
  quickCategories.querySelectorAll('button').forEach(button => {
    const selected = button.dataset.category === quickDraft.category;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('selected', selected);
  });
}
function openQuickEntry() {
  if (quickSaving || quickDialog.open) return;
  quickDraft = newQuickEntry();
  document.getElementById('quickDate').value = quickDraft.date;
  document.getElementById('quickText').value = '';
  document.getElementById('quickMsg').textContent = '';
  document.getElementById('quickFeedback').textContent = '';
  renderQuickEntry();
  quickDialog.showModal();
}
['quickEntryOpen', 'quickEntryImportOpen'].forEach(id =>
  document.getElementById(id).addEventListener('click', openQuickEntry));
quickCategories.addEventListener('click', e => {
  const button = e.target.closest('[data-category]');
  if (!button || quickSaving) return;
  quickDraft.category = button.dataset.category;
  renderQuickEntry();
});
document.getElementById('quickKeypad').addEventListener('click', e => {
  const button = e.target.closest('[data-key]');
  if (!button || quickSaving) return;
  quickDraft.amount = keypadAmount(quickDraft.amount, button.dataset.key);
  document.getElementById('quickMsg').textContent = '';
  renderQuickEntry();
});
document.getElementById('quickClose').addEventListener('click', () => {
  if (!quickSaving) quickDialog.close();
});
quickDialog.addEventListener('cancel', e => { if (quickSaving) e.preventDefault(); });
// 桌面也能输入数字；日期和说明仍采用各自的原生输入，不拦截文本编辑。
quickDialog.addEventListener('keydown', e => {
  if (e.target.matches('input') || quickSaving) return;
  const key = e.key === 'Backspace' ? 'delete' : e.key;
  if (/^[0-9.]$/.test(key) || key === 'delete') {
    e.preventDefault();
    quickDraft.amount = keypadAmount(quickDraft.amount, key);
    renderQuickEntry();
  }
});
document.getElementById('quickDone').addEventListener('click', async () => {
  if (quickSaving) return;
  const msg = document.getElementById('quickMsg');
  quickSaving = true;
  quickDialog.querySelectorAll('button,input').forEach(control => { control.disabled = true; });
  try {
    const record = createQuickExpense({ ...quickDraft,
      date: document.getElementById('quickDate').value,
      text: document.getElementById('quickText').value });
    await saveTransactions([record]);
    transactions.push(record);
    refreshAll(); // 保留所查看的账期与页面。
    quickDialog.close();
    document.getElementById('quickFeedback').textContent =
      '已记一笔：' + record.myCategory + ' ' + fmtMoney(record.amount) +
      '（账期 ' + billingPeriodLabel(record.datetime) + '）。';
  } catch (err) {
    msg.textContent = '未保存：' + err.message;
  } finally {
    quickSaving = false;
    quickDialog.querySelectorAll('button,input').forEach(control => { control.disabled = false; });
  }
});

// ===== 明细 =====
let detailMode = 'list'; // 'list' | 'merchant'

function refreshReviewNotice() {
  const pending = filterNeedsReview(transactions).length;
  const button = document.getElementById('reviewPending');
  button.hidden = pending === 0;
  button.textContent = `查看需处理（${pending}条）`;
  if (lastImport) {
    const msg = document.getElementById('importMsg');
    msg.className = 'import-msg ok';
    msg.textContent = `本次新增 ${lastImport.added} 条，重复跳过 ${lastImport.skipped} 条，` +
      (pending ? `当前需处理 ${pending} 条（全部时间）。` : '当前无需处理。');
  }
}

document.getElementById('reviewPending').addEventListener('click', () => {
  range = { start:null, end:null, label:'全部' };
  document.getElementById('onlyNeedsReview').checked = true;
  document.getElementById('filterSource').value = '';
  document.getElementById('filterCategory').value = '';
  document.getElementById('filterDirection').value = '';
  document.getElementById('onlyUncat').checked = false;
  document.getElementById('searchInput').value = '';
  detailMode = 'list';
  document.querySelectorAll('#viewToggle .seg').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === 'list'));
  refreshAll();
  switchView('detail');
});

function filteredTransactions() {
  const src = document.getElementById('filterSource').value;
  const cat = document.getElementById('filterCategory').value;
  const dir = document.getElementById('filterDirection').value;
  const onlyUncat = document.getElementById('onlyUncat').checked;
  const query = document.getElementById('searchInput').value;
  // 明细、分类下钻及商户汇总共用概览账期；全部时间时解除日期限制。
  return filterTransactionsBySource(filterTransactionsByRange(transactions, range), src).filter(t =>
    (!cat || t.myCategory === cat) &&
    (!dir || t.direction === dir) &&
    (!onlyUncat || t.myCategory === '其他') &&
    (!document.getElementById('onlyNeedsReview').checked || needsReview(t)) &&
    matchesSearch(t, query));
}

// 明细页明确展示账期结束月及实际起止日期，并可一键看全部。
function updateDetailTimeChip() {
  const chip = document.getElementById('detailTimeChip');
  if (!chip) return;
  if (range.start) {
    chip.hidden = false;
    chip.innerHTML = `账期 ${range.label}（${range.start} ～ ${range.end}） <span class="x" aria-hidden="true">✕</span>`;
    chip.setAttribute('aria-label', `当前只显示账期 ${range.label}，${range.start} 至 ${range.end}，点击查看全部时间`);
  } else {
    chip.hidden = true;
  }
}

function renderDetail() {
  updateDetailTimeChip();
  const rows = filteredTransactions().sort((a, b) => b.datetime.localeCompare(a.datetime));
  document.getElementById('detailCount').textContent = `${rows.length} 条`;
  document.getElementById('listView').hidden = detailMode !== 'list';
  document.getElementById('merchantView').hidden = detailMode !== 'merchant';
  if (detailMode === 'list') renderListView(rows);
  else renderMerchantView(rows);
}

function accountingNote(t) {
  if (t.direction !== '支出') return '';
  if (t.excluded === true) return `原 ${fmtMoney(t.amount)} · 不计入统计`;
  if (t.status === '交易关闭') return `原 ${fmtMoney(t.amount)} · 交易关闭自动不计入`;
  if (isValidCountedAmount(t.countedAmount, t.amount))
    return `原 ${fmtMoney(t.amount)} → 计入 ${fmtMoney(countedExpenseAmount(t))}`;
  return t.reviewed === true ? '已处理 · 按原规则计入' : '';
}

function accountingBadges(t) {
  const reason = needsReview(t) ? `<small class="review-badge">需处理：${esc(t.status)}</small>` : '';
  const note = accountingNote(t);
  return reason + (note ? `<small class="accounting-note">${esc(note)}</small>` : '');
}

function rowHtml(t) {
  const opts = CATEGORIES.map(c =>
    `<option value="${c}"${c === t.myCategory ? ' selected' : ''}>${c}</option>`).join('');
  const hl = t.myCategory === '其他' ? ' class="hl"' : '';
  const dirClass = directionClass(t);
  return `<tr${hl}>
    <td>${esc(t.datetime.replace('T', ' ').slice(5))}</td>
    <td>${esc(t.source)}</td>
    <td><span class="flow-badge ${dirClass}">${esc(directionLabel(t.direction))}</span></td>
    <td class="num amount-cell ${dirClass}">${fmtSignedMoney(t)}</td>
    <td>${esc(t.counterparty)}</td>
    <td>${esc(t.description || (isManualTransaction(t) ? '手动记账' : ''))}${accountingBadges(t)}</td>
    <td><select class="cat-select" data-id="${esc(t.id)}">${opts}</select>
      ${isManualTransaction(t) ? `<button type="button" class="manual-delete" data-id="${esc(t.id)}"
        aria-label="删除手动记录：${esc(t.description || '未填说明')}">删除</button>` : ''}
      ${canAdjustTransaction(t) ? `<button type="button" class="adjust-txn" data-id="${esc(t.id)}"
        aria-label="调整记录：${esc(t.counterparty || t.description || '未填说明')}">调整</button>` : ''}
    </td>
  </tr>`;
}

function renderListView(rows) {
  const tbody = document.querySelector('#txnTable tbody');
  document.getElementById('tableEmpty').hidden = rows.length > 0;
  document.getElementById('tableEmpty').textContent = document.getElementById('onlyNeedsReview').checked
    ? '当前筛选下无需处理' : '还没有记录';
  tbody.innerHTML = rows.map(rowHtml).join('');
  tbody.querySelectorAll('.cat-select').forEach(sel =>
    sel.addEventListener('change', onChangeCategory));
  tbody.querySelectorAll('.manual-delete').forEach(button =>
    button.addEventListener('click', onDeleteManual));
  tbody.querySelectorAll('.adjust-txn').forEach(button =>
    button.addEventListener('click', onOpenAdjustment));
}

const adjustmentDialog = document.getElementById('adjustmentDialog');
let adjustingId = null;

function onOpenAdjustment(e) {
  const record = transactions.find(t => t.id === e.currentTarget.dataset.id);
  if (!canAdjustTransaction(record)) return;
  adjustingId = record.id;
  const facts = [
    ['日期', record.datetime.replace('T', ' ')], ['来源', record.source],
    ['原始金额', fmtMoney(record.amount)],
    ['商户 / 说明', [record.counterparty, record.description].filter(Boolean).join(' / ') || '—'],
    ['原始分类', record.rawCategory || '—'], ['交易状态', record.status || '—']
  ];
  document.getElementById('adjustmentFacts').innerHTML = facts.map(([key,value]) =>
    `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('');
  const amount = document.getElementById('adjustmentAmount');
  amount.max = String(record.amount);
  amount.value = String(isValidCountedAmount(record.countedAmount, record.amount) ? record.countedAmount : record.amount);
  document.getElementById('adjustmentRule').textContent = record.status === '交易关闭'
    ? '交易关闭仍自动不计入统计。' : '原始账单信息保留，只调整支出统计。';
  document.getElementById('adjustmentMsg').textContent = '';
  adjustmentDialog.showModal();
}

async function onSaveAdjustment(action) {
  const buttons = adjustmentDialog.querySelectorAll('button');
  if (document.getElementById('adjustmentInclude').disabled || !adjustingId) return;
  buttons.forEach(button => { button.disabled = true; });
  const msg = document.getElementById('adjustmentMsg');
  try {
    const updated = await saveExpenseAdjustment(adjustingId, action,
      document.getElementById('adjustmentAmount').value);
    transactions = transactions.map(t => t.id === updated.id ? updated : t);
    classifyAll();
    refreshAll();
    adjustmentDialog.close();
    document.getElementById('adjustmentFeedback').textContent = '处理已保存，统计已更新。';
  } catch (error) {
    msg.textContent = error.message;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

document.getElementById('adjustmentInclude').addEventListener('click', () => onSaveAdjustment('include'));
document.getElementById('adjustmentExclude').addEventListener('click', () => onSaveAdjustment('exclude'));
document.getElementById('adjustmentForm').addEventListener('submit', e => {
  e.preventDefault();
  onSaveAdjustment('amount');
});
document.getElementById('adjustmentClose').addEventListener('click', () => adjustmentDialog.close());
adjustmentDialog.addEventListener('close', () => { adjustingId = null; });

async function onDeleteManual(e) {
  const button = e.currentTarget;
  const id = button.dataset.id;
  const record = transactions.find(t => t.id === id);
  if (!isManualTransaction(record) || button.disabled) return;
  if (!confirm('删除这条手动记账记录？输错后可重新记一笔。')) return;
  button.disabled = true;
  const msg = document.getElementById('manualDeleteMsg');
  msg.className = 'import-msg';
  try {
    await deleteManualTransaction(id);
    transactions = transactions.filter(t => t.id !== id);
    refreshAll();
    msg.textContent = '手动记录已删除，统计已更新。';
    msg.classList.add('ok');
  } catch (err) {
    msg.textContent = '删除失败：' + err.message;
    msg.classList.add('error');
    button.disabled = false;
  }
}

function renderMerchantView(rows) {
  const ul = document.getElementById('merchantView');
  const groups = groupByCounterparty(rows);
  if (!groups.length) {
    ul.innerHTML = '<li class="empty-hint">没有匹配的记录</li>';
    return;
  }
  ul.innerHTML = groups.map((g, i) => {
    const color = colorForCategory(g.items[0].myCategory);
    const sub = g.items.slice().sort((a, b) => b.datetime.localeCompare(a.datetime))
      .map(t => `<li class="mc-sub-item">
        <span class="mc-sub-date">${esc(t.datetime.slice(5, 10))}</span>
        <span class="flow-badge ${directionClass(t)}">${esc(directionLabel(t.direction))}</span>
        <span class="mc-sub-desc">${esc(t.description || t.myCategory)}${accountingBadges(t)}</span>
        <span class="mc-sub-amt ${directionClass(t)}">${fmtSignedMoney(t, true)}</span>
      </li>`).join('');
    const summary = `支出 ${fmtMoney(g.expense)} · 收入 ${fmtMoney(g.income)}`;
    return `<li class="mc-group">
      <button class="mc-head" data-idx="${i}" aria-expanded="false">
        <span class="mc-icon" style="color:${color}">${iconSvg(g.items[0].myCategory, 16)}</span>
        <span class="mc-name">${esc(g.counterparty)}</span>
        <span class="mc-count">${g.count} 条</span>
        <span class="mc-flow-summary">${summary}</span>
        <span class="mc-total ${g.net >= 0 ? 'income' : 'expense'}">${fmtMoney(g.net)}</span>
        <span class="mc-caret" aria-hidden="true">▾</span>
      </button>
      <ul class="mc-sub" hidden>${sub}</ul>
    </li>`;
  }).join('');
  ul.querySelectorAll('.mc-head').forEach(btn => btn.addEventListener('click', () => {
    const sub = btn.nextElementSibling;
    const open = !sub.hidden;
    sub.hidden = open;
    btn.setAttribute('aria-expanded', String(!open));
    btn.classList.toggle('open', !open);
  }));
}

async function onChangeCategory(e) {
  const id = e.target.dataset.id, cat = e.target.value;
  const t = transactions.find(x => x.id === id);
  if (!t) return;
  const cp = t.counterparty;
  const realMerchant = cp && cp !== '/';   // 真实商户名才适合做"记忆"与批量联动
  const touched = [];
  if (realMerchant && !isManualTransaction(t)) {
    // 真实商户：记住该商户，同商户记录全部联动
    memory[cp] = cat;
    await saveMemory(cp, cat);
    for (const o of transactions)
      if (o.counterparty === cp && !isManualTransaction(o)) { o.myCategory = cat; o.manual = true; touched.push(o); }
  } else {
    // 手动记账或无对方：只改这一笔，保留其他手动记录各自选择的分类。
    t.myCategory = cat; t.manual = true; touched.push(t);
  }
  await saveTransactions(touched);
  refreshAll();
}

function populateCategoryFilter() {
  const sel = document.getElementById('filterCategory');
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部分类</option>' +
    CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
  sel.value = cur;
}
['filterSource', 'filterCategory', 'filterDirection', 'onlyUncat', 'onlyNeedsReview'].forEach(id =>
  document.getElementById(id).addEventListener('change', renderDetail));
document.getElementById('searchInput').addEventListener('input', renderDetail);
document.getElementById('detailTimeChip').addEventListener('click', () => {
  // 一键解除时间限制：看全部时间（与概览"全部"一致）
  range = { start: null, end: null, label: '全部' };
  refreshAll();
});
document.getElementById('viewToggle').addEventListener('click', e => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  detailMode = btn.dataset.mode;
  document.querySelectorAll('#viewToggle .seg').forEach(b =>
    b.classList.toggle('active', b === btn));
  renderDetail();
});

// ===== 仪表盘 =====
function fmtMoney(n) {
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedMoney(t, counted = false) {
  const sign = t.direction === '收入' ? '+' : t.direction === '支出' ? '-' : '';
  return sign + fmtMoney(counted && t.direction === '支出' ? countedExpenseAmount(t) : t.amount);
}

function directionLabel(direction) {
  if (direction === '收入') return '入账';
  if (direction === '支出') return '出账';
  return '中性';
}

function directionClass(t) {
  if (t.direction === '收入') return 'income';
  if (t.direction === '支出') return 'expense';
  return 'neutral';
}

// 环比变化文字（本期 vs 上期），返回 {text, cls}
function deltaInfo(cur, prev) {
  if (prev == null || range.label === '全部') return { text: '', cls: '' };
  if (prev === 0) return cur > 0 ? { text: '较上一账期新增', cls: 'up' } : { text: '', cls: '' };
  const pct = (cur - prev) / prev * 100;
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '';
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
  return { text: `较上一账期 ${arrow}${Math.abs(pct).toFixed(0)}%`, cls };
}

function drillToCategory(cat) {
  document.getElementById('filterSource').value = '';
  document.getElementById('filterDirection').value = '';
  document.getElementById('onlyUncat').checked = false;
  document.getElementById('onlyNeedsReview').checked = false;
  document.getElementById('filterCategory').value = cat;
  document.getElementById('searchInput').value = '';
  // 下钻默认进入"按商户汇总"，直观看到该类钱给了谁
  detailMode = 'merchant';
  document.querySelectorAll('#viewToggle .seg').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === 'merchant'));
  renderDetail();
  switchView('detail');
}

function renderCatList(byCategory, total) {
  const ul = document.getElementById('catList');
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  ul.innerHTML = entries.map(([cat, amt]) => {
    const pct = total > 0 ? (amt / total * 100) : 0;
    const color = colorForCategory(cat);
    return `<li class="cat-item" data-cat="${esc(cat)}" tabindex="0" role="button"
        aria-label="${esc(cat)} ${fmtMoney(amt)}，占比 ${pct.toFixed(1)}%，点击查看明细">
      <span class="cat-icon" style="color:${color}">${iconSvg(cat, 18)}</span>
      <span class="cat-info">
        <span class="cat-row1">
          <span class="cat-name">${esc(cat)}</span>
          <span class="cat-amt">${fmtMoney(amt)}</span>
        </span>
        <span class="cat-bar"><span class="cat-bar-fill" style="width:${pct}%;background:${color}"></span></span>
      </span>
      <span class="cat-pct">${pct.toFixed(0)}%</span>
      <span class="cat-arrow" aria-hidden="true">›</span>
    </li>`;
  }).join('');
  ul.querySelectorAll('.cat-item').forEach(li => {
    const go = () => drillToCategory(li.dataset.cat);
    li.addEventListener('click', go);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

function renderTopList(topExpenses) {
  const card = document.getElementById('topCard');
  const ul = document.getElementById('topList');
  if (!topExpenses.length) { card.hidden = true; return; }
  card.hidden = false;
  ul.innerHTML = topExpenses.map(t => {
    const color = colorForCategory(t.myCategory);
    return `<li class="top-item">
      <span class="top-icon" style="color:${color}">${iconSvg(t.myCategory, 16)}</span>
      <span class="top-main">
        <span class="top-name">${esc(t.counterparty || t.description || '—')}</span>
        <span class="top-meta">${esc(t.datetime.slice(5, 10))} · ${esc(t.myCategory)} · ${esc(t.source)}</span>
        ${accountingBadges(t)}
      </span>
      <span class="top-amt">${fmtMoney(countedExpenseAmount(t))}</span>
    </li>`;
  }).join('');
}

function renderPeriodTable() {
  const rows = buildPeriodTable(transactions);
  const tbody = document.querySelector('#periodTable tbody');
  document.getElementById('periodEmpty').hidden = rows.length > 0;
  tbody.innerHTML = rows.map(r => `<tr>
    <td>${esc(r.period)}</td>
    <td class="num expense">${fmtMoney(r.expense)}</td>
    <td class="num income">${fmtMoney(r.income)}</td>
    <td class="num ${r.net >= 0 ? 'income' : 'expense'}">${fmtMoney(r.net)}</td>
    <td>${r.expenseCount} 出 / ${r.incomeCount} 入</td>
  </tr>`).join('');
}

function refreshDashboard() {
  const s = summarize(transactions, range);
  const previousRange = prevPeriodRange(range);
  const prev = previousRange ? summarize(transactions, previousRange) : null;

  document.getElementById('sumExpense').textContent = fmtMoney(s.totalExpense);
  document.getElementById('sumIncome').textContent = fmtMoney(s.totalIncome);
  document.getElementById('sumNet').textContent = fmtMoney(s.net);
  document.getElementById('rangeLabel').textContent = range.label === '全部'
    ? '全部时间' : `账期 ${range.label} · ${range.start} ～ ${range.end}`;
  document.getElementById('expenseCount').textContent = s.count ? `${s.count} 笔` : '';

  const ed = deltaInfo(s.totalExpense, prev ? prev.totalExpense : null);
  const idd = deltaInfo(s.totalIncome, prev ? prev.totalIncome : null);
  const eEl = document.getElementById('expenseDelta');
  const iEl = document.getElementById('incomeDelta');
  eEl.textContent = ed.text; eEl.className = 'kpi-delta ' + ed.cls;
  iEl.textContent = idd.text; iEl.className = 'kpi-delta ' + idd.cls;
  document.getElementById('netSub').textContent = s.net >= 0 ? '本期结余' : '本期超支';

  const hasData = Object.keys(s.byCategory).length > 0;
  document.getElementById('pieEmpty').hidden = hasData;
  document.getElementById('pieChart').style.display = hasData ? '' : 'none';
  document.getElementById('pieCenter').hidden = !hasData;
  if (hasData) {
    document.getElementById('pieCenterValue').textContent = fmtMoney(s.totalExpense);
    renderCategoryPie(document.getElementById('pieChart'), s.byCategory);
  }
  renderCatList(s.byCategory, s.totalExpense);
  renderTopList(s.topExpenses);

  const trendCard = document.getElementById('trendCard');
  trendCard.hidden = !hasData;
  if (hasData) renderTrend(document.getElementById('trendChart'), s.byDay);
  renderPeriodTable();
}

document.getElementById('monthPick').addEventListener('change', e => {
  const ym = e.target.value;
  if (!ym) return;
  range = billingPeriodRange(ym);
  refreshAll();
});
document.getElementById('allRange').addEventListener('click', () => {
  range = { start: null, end: null, label: '全部' };
  refreshAll();
});
function refreshAll() {
  refreshReviewNotice();
  document.getElementById('monthPick').value = range.start ? range.label : '';
  populateCategoryFilter();
  renderDetail();
  refreshDashboard();
}

// ===== 备份 / 清空 =====
document.getElementById('exportBtn').addEventListener('click', exportBackup);
document.getElementById('importBackup').addEventListener('change', async e => {
  if (!e.target.files[0]) return;
  await importBackup(e.target.files[0]);
  memory = await loadMemory();
  transactions = await loadAllTransactions();
  classifyAll();
  await saveTransactions(transactions);
  refreshAll();
  switchView('overview');
});
document.getElementById('clearBtn').addEventListener('click', async () => {
  if (!confirm('确定清空所有账单与商户记忆？此操作不可撤销。')) return;
  await clearAllData();
  transactions = []; memory = {};
  refreshAll();
});

// ===== 启动 =====
(async () => {
  memory = await loadMemory();
  transactions = await loadAllTransactions();
  classifyAll();
  refreshAll();
})();

// ===== Service Worker =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./sw.js').catch(console.error));
}
