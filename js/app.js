import { fileToTransactions } from './import-transactions.js';
import { mergeTransactions } from './dedup.js';
import { resolveCategory, CATEGORIES, INCOME_CATEGORIES, transactionCategories } from './classify.js';
import {
  summarize,
  groupByCounterparty,
  buildPeriodTable
} from './aggregate.js';
import { billingPeriodRange, currentBillingPeriod, customDateRange, allTimeRange, rangeText, prevPeriodRange, filterTransactionsByRange, billingPeriodLabel } from './period.js';
import { renderCategoryPie, renderTrend, colorForCategory } from './charts.js';
import { iconSvg } from './icons.js';
import { isManualTransaction } from './manual.js';
import { isReconciledDuplicate, reconciliationCandidates } from './reconciliation.js';
import { setupLedgerTools } from './ledger-tools.js';
import { filterDetails, sortTransactions } from './detail.js';
import { newQuickEntry, keypadAmount, createQuickTransaction, setQuickDirection } from './quick-entry.js';
import { countedExpenseAmount, isValidCountedAmount, canAdjustTransaction, needsReview, filterNeedsReview } from './review.js';
import {
  saveTransactions, loadAllTransactions, loadMemory,
  clearAllData, exportBackup, importBackup, deleteManualTransaction, saveExpenseAdjustment, saveTransactionCategory
} from './storage.js';

// ===== 状态 =====
let transactions = [];
let memory = {};
let range = currentBillingPeriod();
let lastImport = null;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function classifyAll() {
  // 已保存的分类属于用户数据；只补齐缺失分类，不重置历史分类。
  for (const t of transactions) if (!t.myCategory) t.myCategory = resolveCategory(t, memory);
}

// ===== 标签切换 =====
function switchView(name) {
  document.querySelectorAll('.tab').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'detail') renderDetail();
  window.scrollTo(0, 0);
}
document.getElementById('tabs').addEventListener('click', e => {
  if (e.target.classList.contains('tab')) switchView(e.target.dataset.view);
});

// ===== 导入 =====
async function onFiles(files) {
  const msg = document.getElementById('importMsg');
  document.getElementById('quickFeedback').textContent = '';
  msg.className = 'import-msg';
  try {
    let incoming = [];
    for (const f of files) incoming.push(...await fileToTransactions(f));
    for (const t of incoming) t.myCategory = resolveCategory(t, memory);
    const { merged, added, skipped } = mergeTransactions(transactions, incoming);
    const existingIds = new Set(transactions.map(t => t.id));
    await saveTransactions(merged.filter(t => !existingIds.has(t.id)));
    transactions = merged;
    lastImport = { added, skipped };
    refreshAll();
    const duplicateCount = reconciliationCandidates(transactions).length;
    if (!filterNeedsReview(transactions).length && !duplicateCount)
      document.getElementById('quickFeedback').textContent = `已导入：新增 ${added} 条，重复跳过 ${skipped} 条。`;
    switchView(filterNeedsReview(transactions).length || duplicateCount ? 'import' : 'overview');
  } catch (err) {
    lastImport = null;
    msg.textContent = '导入失败：' + err.message;
    msg.classList.add('error');
  }
}
document.getElementById('fileInput').addEventListener('change', e => {
  const files = Array.from(e.target.files);
  e.target.value = ''; // 允许再次选择完全相同的账单。
  if (files.length) onFiles(files);
});

// ===== 首页与导入页共用的快速支出记账 =====
const quickDialog = document.getElementById('quickEntryDialog');
const quickCategories = document.getElementById('quickCategories');
let quickDraft = newQuickEntry();
let quickSaving = false;

function renderQuickEntry() {
  const direction = quickDraft.direction || '支出';
  document.querySelectorAll('#quickDirection button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.direction === direction)));
  const categories = direction === '收入' ? INCOME_CATEGORIES : CATEGORIES;
  quickCategories.innerHTML = categories.map(cat => '<button type="button" class="quick-category" data-category="' + esc(cat) + '" aria-pressed="false">' + iconSvg(direction === '收入' ? '转账' : cat, 20) + '<span>' + esc(cat) + '</span></button>').join('');
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
document.getElementById('quickEntryOpen').addEventListener('click', openQuickEntry);
document.getElementById('quickDirection').addEventListener('click', e => {
  const button = e.target.closest('[data-direction]');
  if (!button || quickSaving || button.dataset.direction === (quickDraft.direction || '支出')) return;
  quickDraft = setQuickDirection(quickDraft, button.dataset.direction);
  renderQuickEntry();
});
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
    const record = createQuickTransaction({ ...quickDraft,
      date: document.getElementById('quickDate').value,
      text: document.getElementById('quickText').value });
    await saveTransactions([record]);
    transactions.push(record);
    refreshAll(); // 保留所查看的账期与页面。
    quickDialog.close();
    document.getElementById('quickFeedback').textContent =
      '已记一笔' + record.direction + '：' + record.myCategory + ' ' + fmtMoney(record.amount) +
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
  range = allTimeRange();
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
  return filterDetails(transactions, range, {
    source:document.getElementById('filterSource').value,
    category:document.getElementById('filterCategory').value,
    direction:document.getElementById('filterDirection').value,
    onlyUncat:document.getElementById('onlyUncat').checked,
    onlyNeedsReview:document.getElementById('onlyNeedsReview').checked,
    query:document.getElementById('searchInput').value,
    order:document.getElementById('sortOrder').value
  });
}

// 明细页明确展示账期结束月及实际起止日期，并可一键看全部。
function updateDetailTimeChip() {
  const chip = document.getElementById('detailTimeChip');
  if (!chip) return;
  if (range.start) {
    chip.hidden = false;
    chip.innerHTML = esc(rangeText(range)) + ' <span class="x" aria-hidden="true">×</span>';
    chip.setAttribute('aria-label', `当前显示 ${range.start} 至 ${range.end}，点击查看全部时间`);
  } else {
    chip.hidden = true;
  }
}

function renderDetail() {
  updateDetailTimeChip();
  const rows = filteredTransactions();
  updateFilterButton();
  document.getElementById('detailCount').textContent = `${rows.length} 条`;
  document.getElementById('listView').hidden = detailMode !== 'list';
  document.getElementById('merchantView').hidden = detailMode !== 'merchant';
  if (detailMode === 'list') renderListView(rows);
  else renderMerchantView(rows);
}

function accountingNote(t) {
  if (isReconciledDuplicate(t)) return '已与导入记录核对，不计入统计';
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
  const title = t.counterparty || t.description || (isManualTransaction(t) ? '手动记账' : '未填写说明');
  const cls = directionClass(t);
  return '<button type="button" class="transaction-row" data-id="' + esc(t.id) + '" aria-label="查看交易：' + esc(title) + '">' +
    '<span class="txn-icon" style="--category-color:' + colorForCategory(t.myCategory) + '">' + iconSvg(t.myCategory, 20) + '</span>' +
    '<span class="txn-main"><span class="txn-title">' + esc(title) + '</span>' +
    '<span class="txn-meta">' + esc(String(t.datetime || '').replace('T',' ').slice(0,16)) + '</span>' +
    '<span class="txn-tags">' + esc(t.myCategory || '其他') + ' · ' + esc(t.source || '') + '</span>' + accountingBadges(t) + '</span>' +
    '<span class="txn-money ' + cls + '"><span>' + fmtSignedMoney(t) + '</span><small>' + esc(t.direction || '中性') + '</small></span></button>';
}

function renderListView(rows) {
  const list = document.getElementById('txnList');
  document.getElementById('tableEmpty').hidden = rows.length > 0;
  document.getElementById('tableEmpty').textContent = document.getElementById('onlyNeedsReview').checked
    ? '当前范围和筛选下无需处理' : '没有符合条件的记录';
  list.innerHTML = rows.map(rowHtml).join('');
  list.querySelectorAll('.transaction-row').forEach(button => button.addEventListener('click', onOpenAdjustment));
}

const adjustmentDialog = document.getElementById('adjustmentDialog');
let adjustingId = null;

function onOpenAdjustment(e) {
  const record = transactions.find(t => t.id === e.currentTarget.dataset.id);
  if (!record) return;
  adjustingId = record.id;
  const facts = [
    ['日期', String(record.datetime || '').replace('T', ' ')], ['来源', record.source],
    ['原始金额', fmtMoney(record.amount)],
    ['商户 / 说明', [record.counterparty, record.description].filter(Boolean).join(' / ') || '—'],
    ['原始分类', record.rawCategory || '—'], ['交易状态', record.status || '—']
  ];
  document.getElementById('adjustmentFacts').innerHTML = facts.map(([key,value]) =>
    `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('');
  const choices = transactionCategories(record);
  const current = record.myCategory || '其他';
  const options = choices.includes(current) ? choices : [current,...choices];
  document.getElementById('transactionCategory').innerHTML = options.map(cat => '<option value="' + esc(cat) + '"' + (cat === current ? ' selected' : '') + '>' + esc(cat) + '</option>').join('');
  document.getElementById('categoryMsg').textContent = '';
  document.getElementById('adjustmentControls').hidden = !canAdjustTransaction(record);
  document.getElementById('adjustmentControls').open = false;
  document.getElementById('transactionDelete').hidden = !isManualTransaction(record);
  document.getElementById('transactionDelete').dataset.id = record.id;
  const undo = document.getElementById('reconciliationUndo');
  if (undo) { undo.hidden = !isReconciledDuplicate(record); undo.dataset.id = record.id; }

  const amount = document.getElementById('adjustmentAmount');
  amount.max = String(record.amount);
  amount.value = String(isValidCountedAmount(record.countedAmount, record.amount) ? record.countedAmount : record.amount);
  document.getElementById('adjustmentRule').textContent = record.status === '交易关闭'
    ? '交易关闭仍自动不计入统计。' : '原始账单信息保留，只调整支出统计。';
  document.getElementById('adjustmentMsg').textContent = '';
  if (!adjustmentDialog.open) adjustmentDialog.showModal();
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
document.getElementById('adjustmentClose').addEventListener('click', () => {
  if (!document.getElementById('saveCategory').disabled) adjustmentDialog.close();
});
adjustmentDialog.addEventListener('cancel', e => { if (document.getElementById('saveCategory').disabled) e.preventDefault(); });
document.getElementById('saveCategory').addEventListener('click', onChangeCategory);
document.getElementById('transactionDelete').addEventListener('click', onDeleteManual);
document.getElementById('reconciliationUndo').addEventListener('click',async e => {
  const button = e.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  try {
    await ledgerTools.undo(button.dataset.id);
    adjustmentDialog.close();
    document.getElementById('adjustmentFeedback').textContent = '已撤销核对，手动记录恢复计入统计。';
  } catch (error) { document.getElementById('categoryMsg').textContent = error.message; }
  finally { button.disabled = false; }
});
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
    adjustmentDialog.close();
    msg.textContent = '手动记录已删除，统计已更新。';
    msg.classList.add('ok');
  } catch (err) {
    msg.textContent = '删除失败：' + err.message;
    msg.classList.add('error');
  } finally {
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
    const sub = sortTransactions(g.items, document.getElementById('sortOrder').value)
      .map(t => `<li><button type="button" class="mc-sub-item" data-id="${esc(t.id)}">
        <span class="mc-sub-date">${esc(t.datetime.slice(5, 10))}</span>
        <span class="flow-badge ${directionClass(t)}">${esc(directionLabel(t.direction))}</span>
        <span class="mc-sub-desc">${esc(t.description || t.myCategory)}${accountingBadges(t)}</span>
        <span class="mc-sub-amt ${directionClass(t)}">${fmtSignedMoney(t, true)}</span>
      </button></li>`).join('');
    const summary = `支出 ${fmtMoney(g.expense)} · 收入 ${fmtMoney(g.income)}`;
    return `<li class="mc-group">
      <button class="mc-head" data-idx="${i}" aria-expanded="false">
        <span class="mc-icon" style="color:${color}">${iconSvg(g.items[0].myCategory, 16)}</span>
        <span class="mc-name">${esc(g.counterparty)}</span>
        <span class="mc-count">${g.count} 条</span>
        <span class="mc-flow-summary">${summary}</span>
        <span class="mc-total">${g.expense ? '支出 ' + fmtMoney(g.expense) : g.income ? '收入 ' + fmtMoney(g.income) : '不计收支'}</span>
        <span class="mc-caret" aria-hidden="true">▾</span>
      </button>
      <ul class="mc-sub" hidden>${sub}</ul>
    </li>`;
  }).join('');
  ul.querySelectorAll('.mc-sub-item').forEach(button => button.addEventListener('click', onOpenAdjustment));
  ul.querySelectorAll('.mc-head').forEach(btn => btn.addEventListener('click', () => {
    const sub = btn.nextElementSibling;
    const open = !sub.hidden;
    sub.hidden = open;
    btn.setAttribute('aria-expanded', String(!open));
    btn.classList.toggle('open', !open);
  }));
}

async function onChangeCategory() {
  if (!adjustingId || document.getElementById('saveCategory').disabled) return;
  const controls = adjustmentDialog.querySelectorAll('button,select,input');
  controls.forEach(control => { control.disabled = true; });
  try {
    const plan = await saveTransactionCategory(adjustingId, document.getElementById('transactionCategory').value);
    const changed = new Map(plan.touched.map(t => [t.id,t]));
    transactions = transactions.map(t => changed.get(t.id) || t);
    if (plan.memoryEntry) memory[plan.memoryEntry.counterparty] = plan.memoryEntry.category;
    classifyAll();
    refreshAll();
    adjustmentDialog.close();
    document.getElementById('adjustmentFeedback').textContent = '分类已保存。';
  } catch (error) { document.getElementById('categoryMsg').textContent = error.message; }
  finally { controls.forEach(control => { control.disabled = false; }); }
}

function populateCategoryFilter() {
  const sel = document.getElementById('filterCategory');
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部分类</option>' +
    [...new Set([...CATEGORIES,...INCOME_CATEGORIES,...transactions.map(t => t.myCategory).filter(Boolean)])].map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = cur;
  const source = document.getElementById('filterSource'), selectedSource = source.value;
  source.innerHTML = '<option value="">全部来源</option>' + [...new Set(['支付宝','微信','手动',...transactions.map(t => t.source).filter(Boolean)])]
    .map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  source.value = selectedSource;
}
['filterSource', 'filterCategory', 'filterDirection', 'onlyUncat', 'onlyNeedsReview'].forEach(id =>
  document.getElementById(id).addEventListener('change', renderDetail));
document.getElementById('searchInput').addEventListener('input', renderDetail);
document.getElementById('sortOrder').addEventListener('change', renderDetail);
const filterDialog = document.getElementById('filterDialog');
document.getElementById('filterOpen').addEventListener('click', () => filterDialog.showModal());
['filterApply','filterClose'].forEach(id => document.getElementById(id).addEventListener('click', () => filterDialog.close()));
document.getElementById('filterReset').addEventListener('click', () => {
  ['filterSource','filterCategory','filterDirection'].forEach(id => { document.getElementById(id).value = ''; });
  ['onlyUncat','onlyNeedsReview'].forEach(id => { document.getElementById(id).checked = false; });
  renderDetail();
});
function updateFilterButton() {
  const count = ['filterSource','filterCategory','filterDirection'].filter(id => document.getElementById(id).value).length +
    ['onlyUncat','onlyNeedsReview'].filter(id => document.getElementById(id).checked).length;
  document.getElementById('filterOpen').textContent = count ? '筛选 · ' + count : '筛选';
}
document.getElementById('overviewDetail').addEventListener('click', () => {
  ['filterSource','filterCategory','filterDirection'].forEach(id => { document.getElementById(id).value = ''; });
  ['onlyUncat','onlyNeedsReview'].forEach(id => { document.getElementById(id).checked = false; });
  document.getElementById('searchInput').value = '';
  detailMode = 'list';
  document.querySelectorAll('#viewToggle .seg').forEach(button => button.classList.toggle('active', button.dataset.mode === 'list'));
  switchView('detail');
});

document.getElementById('detailTimeChip').addEventListener('click', () => {
  // 一键解除时间限制：看全部时间（与概览"全部"一致）
  range = allTimeRange();
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
  if (prev == null || range.label === '全部' || range.mode === 'custom') return { text: '', cls: '' };
  if (prev === 0) return cur > 0 ? { text: '较上一账期新增', cls: 'up' } : { text: '', cls: '' };
  const pct = (cur - prev) / prev * 100;
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '';
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
  return { text: `较上一账期 ${arrow}${Math.abs(pct).toFixed(0)}%`, cls };
}

function drillToCategory(cat) {
  document.getElementById('filterSource').value = '';
  document.getElementById('filterDirection').value = '支出';
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
  const rows = buildPeriodTable(filterTransactionsByRange(transactions, range));
  document.getElementById('periodEmpty').hidden = rows.length > 0;
  document.getElementById('periodRows').innerHTML = rows.map(r => '<div class="period-row">' +
    '<div class="period-title"><strong>' + esc(r.period) + '</strong><span>' + r.expenseCount + ' 笔支出 · ' + r.incomeCount + ' 笔收入</span></div>' +
    '<div class="period-values"><span>支出 <b>' + fmtMoney(r.expense) + '</b></span><span>收入 <b>' + fmtMoney(r.income) + '</b></span><span>结余 <b>' + fmtMoney(r.net) + '</b></span></div></div>').join('');
}

function refreshDashboard() {
  const s = summarize(transactions, range);
  const previousRange = prevPeriodRange(range);
  const prev = previousRange ? summarize(transactions, previousRange) : null;

  document.getElementById('sumExpense').textContent = fmtMoney(s.totalExpense);
  document.getElementById('sumIncome').textContent = fmtMoney(s.totalIncome);
  document.getElementById('sumNet').textContent = fmtMoney(s.net);
  document.getElementById('rangeLabel').textContent = rangeText(range);
  document.getElementById('expenseCount').textContent = s.count ? `${s.count} 笔` : '';

  const ed = deltaInfo(s.totalExpense, prev ? prev.totalExpense : null);
  const idd = deltaInfo(s.totalIncome, prev ? prev.totalIncome : null);
  const eEl = document.getElementById('expenseDelta');
  const iEl = document.getElementById('incomeDelta');
  eEl.textContent = ed.text; eEl.className = 'kpi-delta ' + ed.cls;
  iEl.textContent = idd.text; iEl.className = 'kpi-delta ' + idd.cls;
  document.getElementById('netSub').textContent = s.net >= 0 ? '收入减支出' : '支出多于收入';

  const hasData = Object.keys(s.byCategory).length > 0;
  document.querySelector('.pie-wrap').hidden = !hasData;
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
  range = allTimeRange();
  refreshAll();
});
const customDialog = document.getElementById('customRangeDialog');
document.getElementById('billingRange').addEventListener('click', () => { range = currentBillingPeriod(); refreshAll(); });
document.getElementById('customRangeOpen').addEventListener('click', () => {
  const initial = range.start ? range : currentBillingPeriod();
  document.getElementById('customStart').value = initial.start;
  document.getElementById('customEnd').value = initial.end;
  document.getElementById('customRangeMsg').textContent = '';
  customDialog.showModal();
});
document.getElementById('customRangeClose').addEventListener('click', () => customDialog.close());
document.getElementById('customRangeForm').addEventListener('submit', e => {
  e.preventDefault();
  try {
    range = customDateRange(document.getElementById('customStart').value, document.getElementById('customEnd').value);
    refreshAll(); customDialog.close();
  } catch (error) { document.getElementById('customRangeMsg').textContent = error.message; }
});
function refreshAll() {
  refreshReviewNotice();
  ledgerTools.refresh();
  const mode = !range.start ? 'all' : range.mode === 'custom' ? 'custom' : 'billing';
  document.getElementById('monthPick').value = mode === 'billing' ? range.label : '';
  document.getElementById('billingMonthWrap').hidden = mode !== 'billing';
  for (const [id,value] of [['billingRange','billing'],['customRangeOpen','custom'],['allRange','all']]) document.getElementById(id).setAttribute('aria-pressed', String(mode === value));
  populateCategoryFilter();
  renderDetail();
  refreshDashboard();
}

// ===== 备份 / 清空 =====
document.getElementById('exportBtn').addEventListener('click', exportBackup);
document.getElementById('importBackup').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = ''; // 清空后选择同一个备份也必须触发恢复。
  if (!file) return;
  const msg = document.getElementById('backupMsg');
  msg.className = 'import-msg';
  msg.textContent = '正在恢复备份…';
  document.getElementById('quickFeedback').textContent = '';
  try {
    await importBackup(file);
    memory = await loadMemory();
    transactions = await loadAllTransactions();
    classifyAll();
    await ledgerTools.load();
    refreshAll();
    switchView('overview');
    msg.className = 'import-msg ok';
    msg.textContent = '备份已恢复。';
    document.getElementById('quickFeedback').textContent = `备份已恢复：${transactions.length}条记录。`;
  } catch (error) {
    msg.className = 'import-msg error';
    msg.textContent = '恢复失败：' + error.message;
  }
});

document.getElementById('clearBtn').addEventListener('click', async () => {
  if (!confirm('确定清空所有账单、商户记忆与资产快照？此操作不可撤销。')) return;
  await clearAllData();
  transactions = []; memory = {};
  await ledgerTools.load();
  refreshAll();
});

// ===== 启动 =====
const ledgerTools = setupLedgerTools({
  getTransactions:() => transactions, getRange:() => range,
  updateTransaction:updated => { transactions = transactions.map(t => t.id === updated.id ? updated : t); },
  refreshApp:refreshAll
});
(async () => {
  try {
    memory = await loadMemory();
    transactions = await loadAllTransactions();
    await ledgerTools.load();
    classifyAll(); refreshAll();
  } catch (error) {
    document.getElementById('quickFeedback').textContent = '未能读取本地数据：' + error.message;
  }
})();

// ===== Service Worker =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./sw.js').catch(console.error));
}
