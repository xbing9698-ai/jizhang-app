import { fileToTransactions } from './import-transactions.js';
import { mergeTransactions } from './dedup.js';
import { classify, resolveCategory, CATEGORIES } from './classify.js';
import {
  summarize,
  prevMonthRange,
  matchesSearch,
  groupByCounterparty,
  buildPeriodTable
} from './aggregate.js';
import { renderCategoryPie, renderTrend, colorForCategory } from './charts.js';
import { iconSvg } from './icons.js';
import {
  saveTransactions, loadAllTransactions, saveMemory, loadMemory,
  clearAllData, exportBackup, importBackup
} from './storage.js';

// ===== 状态 =====
let transactions = [];
let memory = {};
let range = currentMonthRange();
let periodMode = 'month';

function currentMonthRange() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { start: `${ym}-01`, end: `${ym}-31`, label: ym };
}

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
    refreshAll();
    msg.textContent = `本次新增 ${added} 条，去重跳过 ${skipped} 条，共 ${transactions.length} 条。`;
    msg.classList.add('ok');
    switchView('overview');
  } catch (err) {
    msg.textContent = '导入失败：' + err.message;
    msg.classList.add('error');
  }
}
document.getElementById('fileInput').addEventListener('change', e => onFiles(e.target.files));

// ===== 明细 =====
let detailMode = 'list'; // 'list' | 'merchant'

function filteredTransactions() {
  const src = document.getElementById('filterSource').value;
  const cat = document.getElementById('filterCategory').value;
  const dir = document.getElementById('filterDirection').value;
  const onlyUncat = document.getElementById('onlyUncat').checked;
  const query = document.getElementById('searchInput').value;
  // 跟随概览当前时间范围：从某月下钻进来时，只看该月（range 为"全部"时不限时间）
  const inRange = t => {
    const d = t.datetime.slice(0, 10);
    return (!range.start || d >= range.start) && (!range.end || d <= range.end);
  };
  return transactions.filter(t =>
    inRange(t) &&
    (!src || t.source === src) &&
    (!cat || t.myCategory === cat) &&
    (!dir || t.direction === dir) &&
    (!onlyUncat || t.myCategory === '其他') &&
    matchesSearch(t, query));
}

// 明细页顶部的时间范围标记：透明告知"正在只看某月"，并可一键看全部
function updateDetailTimeChip() {
  const chip = document.getElementById('detailTimeChip');
  if (!chip) return;
  if (range.start) {
    chip.hidden = false;
    chip.innerHTML = `仅看 ${range.label} <span class="x" aria-hidden="true">✕</span>`;
    chip.setAttribute('aria-label', `当前只显示 ${range.label} 的账单，点击查看全部时间`);
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
    <td>${esc(t.description)}</td>
    <td><select class="cat-select" data-id="${esc(t.id)}">${opts}</select></td>
  </tr>`;
}

function renderListView(rows) {
  const tbody = document.querySelector('#txnTable tbody');
  document.getElementById('tableEmpty').hidden = rows.length > 0;
  tbody.innerHTML = rows.map(rowHtml).join('');
  tbody.querySelectorAll('.cat-select').forEach(sel =>
    sel.addEventListener('change', onChangeCategory));
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
        <span class="mc-sub-desc">${esc(t.description || t.myCategory)}</span>
        <span class="mc-sub-amt ${directionClass(t)}">${fmtSignedMoney(t)}</span>
      </li>`).join('');
    const summary = `支出 ${fmtMoney(g.expense)} · 收入 ${fmtMoney(g.income)}`;
    return `<li class="mc-group">
      <button class="mc-head" data-idx="${i}" aria-expanded="false">
        <span class="mc-icon" style="color:${color}">${iconSvg(g.items[0].myCategory, 16)}</span>
        <span class="mc-name">${esc(g.counterparty)}</span>
        <span class="mc-count">${g.count} 笔</span>
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
  if (realMerchant) {
    // 真实商户：记住该商户，同商户记录全部联动
    memory[cp] = cat;
    await saveMemory(cp, cat);
    for (const o of transactions)
      if (o.counterparty === cp) { o.myCategory = cat; o.manual = true; touched.push(o); }
  } else {
    // 无对方(如转账/退款/"/")：只改这一笔，不波及其他同样无对方的交易
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
['filterSource', 'filterCategory', 'filterDirection', 'onlyUncat'].forEach(id =>
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

function fmtSignedMoney(t) {
  const sign = t.direction === '收入' ? '+' : t.direction === '支出' ? '-' : '';
  return sign + fmtMoney(t.amount);
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
  if (prev === 0) return cur > 0 ? { text: '较上月新增', cls: 'up' } : { text: '', cls: '' };
  const pct = (cur - prev) / prev * 100;
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '';
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
  return { text: `较上月 ${arrow}${Math.abs(pct).toFixed(0)}%`, cls };
}

function drillToCategory(cat) {
  document.getElementById('filterSource').value = '';
  document.getElementById('onlyUncat').checked = false;
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
      </span>
      <span class="top-amt">${fmtMoney(t.amount)}</span>
    </li>`;
  }).join('');
}

function renderCalendar(byDay, monthLabel) {
  const card = document.getElementById('calendarCard');
  const grid = document.getElementById('calGrid');
  // 仅在选中具体月份时显示日历（"全部"时无意义）
  if (!/^\d{4}-\d{2}$/.test(monthLabel)) { card.hidden = true; return; }
  card.hidden = false;
  const [y, m] = monthLabel.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  // 该月1号是周几（把周日的0转成7，让周一为首列）
  let firstDow = new Date(y, m - 1, 1).getDay();
  firstDow = firstDow === 0 ? 7 : firstDow;
  const max = Math.max(0, ...Object.values(byDay));
  let cells = '';
  for (let i = 1; i < firstDow; i++) cells += '<span class="cal-cell cal-empty"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${monthLabel}-${String(d).padStart(2, '0')}`;
    const amt = byDay[key] || 0;
    // 颜色深浅：0=空白，>0 按占最大值比例分 4 档
    let lvl = 0;
    if (amt > 0 && max > 0) lvl = Math.min(4, Math.ceil(amt / max * 4));
    const title = amt > 0 ? `${key} 支出 ${fmtMoney(amt)}` : `${key} 无支出`;
    cells += `<span class="cal-cell cal-l${lvl}" title="${title}">
      <span class="cal-day">${d}</span>
      ${amt > 0 ? `<span class="cal-amt">${amt >= 100 ? Math.round(amt) : amt.toFixed(0)}</span>` : ''}
    </span>`;
  }
  grid.innerHTML = cells;
}

function renderPeriodTable() {
  const rows = buildPeriodTable(transactions, periodMode);
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
  const prev = summarize(transactions, prevMonthRange(range));

  document.getElementById('sumExpense').textContent = fmtMoney(s.totalExpense);
  document.getElementById('sumIncome').textContent = fmtMoney(s.totalIncome);
  document.getElementById('sumNet').textContent = fmtMoney(s.net);
  document.getElementById('rangeLabel').textContent = range.label === '全部' ? '全部时间' : range.label;
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

  // 收支日历（仅具体月份，且有数据时）
  if (hasData) renderCalendar(s.byDay, range.label);
  else document.getElementById('calendarCard').hidden = true;

  const trendCard = document.getElementById('trendCard');
  trendCard.hidden = !hasData;
  if (hasData) renderTrend(document.getElementById('trendChart'), s.byDay);
  renderPeriodTable();
}

document.getElementById('monthPick').addEventListener('change', e => {
  const ym = e.target.value;
  if (!ym) return;
  range = { start: `${ym}-01`, end: `${ym}-31`, label: ym };
  refreshAll();
});
document.getElementById('allRange').addEventListener('click', () => {
  range = { start: null, end: null, label: '全部' };
  refreshAll();
});
document.getElementById('periodToggle').addEventListener('click', e => {
  const btn = e.target.closest('.mini-seg');
  if (!btn) return;
  periodMode = btn.dataset.periodMode;
  document.querySelectorAll('#periodToggle .mini-seg').forEach(b =>
    b.classList.toggle('active', b === btn));
  renderPeriodTable();
});

function refreshAll() {
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
  document.getElementById('monthPick').value = range.label;
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
