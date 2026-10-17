import { readFileSync, writeFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const write = (path, text) => writeFileSync(path, text, 'utf8');

function replaceOnce(path, from, to) {
  const text = read(path);
  if (text.includes(to)) return;
  if (!text.includes(from)) throw new Error(`Missing replacement target in ${path}: ${String(from).slice(0, 80)}`);
  write(path, text.replace(from, to));
}

function replaceRegex(path, pattern, to, marker = null) {
  const text = read(path);
  if (marker && text.includes(marker)) return;
  if (!pattern.test(text)) throw new Error(`Missing regex target in ${path}: ${pattern}`);
  pattern.lastIndex = 0;
  write(path, text.replace(pattern, to));
}

// --- New transaction editing helper: stable identity/source are never rewritten. ---
write('js/transaction-update.js', `import { CATEGORIES, INCOME_CATEGORIES } from './classify.js';
import { billingPeriodLabel } from './period.js';

const money = value => {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  const n = Number(text);
  if (!/^(?:\\d+(?:\\.\\d{1,2})?|\\.\\d{1,2})$/.test(text) || !Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(Math.round(n * 100)))
    throw new Error('金额须大于0，且最多两位小数');
  return n;
};

function validDate(date) {
  if (typeof date !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || !billingPeriodLabel(date))
    throw new Error('请选择有效日期');
  return date;
}

function categoriesFor(direction) {
  return direction === '收入' ? INCOME_CATEGORIES : CATEGORIES;
}

export function editAffectsReconciliation(before, after) {
  return before?.direction !== after?.direction || before?.amount !== after?.amount ||
    String(before?.datetime ?? '').slice(0, 10) !== String(after?.datetime ?? '').slice(0, 10);
}

export function updateTransactionFields(record, input) {
  if (!record?.id) throw new Error('记录不存在');
  const date = validDate(input.date);
  const direction = String(input.direction || '');
  if (!['支出','收入','中性'].includes(direction)) throw new Error('请选择有效收支类型');
  const amount = money(input.amount);
  const choices = categoriesFor(direction);
  const category = String(input.category || '').trim();
  if (!choices.includes(category)) throw new Error('请选择合法分类');
  const description = String(input.description ?? '').trim();
  const oldDatetime = String(record.datetime || '');
  const time = /^\\d{4}-\\d{2}-\\d{2}(T.*)$/.exec(oldDatetime)?.[1] || 'T00:00:00';
  const updated = {
    ...record,
    datetime: date + time,
    amount,
    direction,
    description,
    myCategory: category,
    manual: true,
    userEdited: true,
    editedAt: new Date().toISOString()
  };
  // 手动记账没有独立“商户”编辑框；其内部对方字段继续与说明同步。
  if (record.source === '手动') updated.counterparty = description;
  // 导入记录的 counterparty/source/id/externalOrderId 均由展开保留，不能被用户编辑覆盖。
  if (direction !== '支出') {
    delete updated.countedAmount;
    delete updated.excluded;
    delete updated.reviewed;
  }
  return updated;
}
`);

// --- Snapshot semantics: exact local moment + transaction watermark for same-day no-time rows. ---
write('js/snapshots.js', `import { billingPeriodLabel, customDateRange } from './period.js';
import { summarize } from './aggregate.js';

function money(value, label) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const n = Number(text);
  if (!/^\\d+(?:\\.\\d{1,2})?$/.test(text) || !Number.isFinite(n) || !Number.isSafeInteger(Math.round(n * 100)))
    throw new Error(\`\${label}须为非负金额，最多两位小数\`);
  return n;
}

function normalizedTime(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const m = text.match(/^([01]\\d|2[0-3]):([0-5]\\d)(?::([0-5]\\d))?$/);
  if (!m) throw new Error('请选择有效快照时间');
  return \`\${m[1]}:\${m[2]}:\${m[3] || '00'}\`;
}

function normalizedCapturedAt(value) {
  const text = String(value ?? '').trim();
  const m = text.match(/^(\\d{4}-\\d{2}-\\d{2})T([0-2]\\d:[0-5]\\d(?::[0-5]\\d)?)$/);
  if (!m || !billingPeriodLabel(m[1])) return '';
  return \`\${m[1]}T\${normalizedTime(m[2])}\`;
}

export function createSnapshot(input, existing = null) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(input.date || '') || !billingPeriodLabel(input.date))
    throw new Error('请选择有效快照日期');
  const totalAssets = money(input.totalAssets, '总资产');
  const totalLiabilities = money(input.totalLiabilities, '总负债');
  const explicitCapturedAt = normalizedCapturedAt(input.capturedAt);
  const explicitTime = input.time == null ? '' : normalizedTime(input.time);
  const capturedAt = explicitCapturedAt || (explicitTime ? \`\${input.date}T\${explicitTime}\` : (existing?.capturedAt || ''));
  const sameMoment = !!existing?.capturedAt && existing.capturedAt === capturedAt;
  let transactionIdsAtCapture;
  if (Array.isArray(input.transactionIdsAtCapture)) transactionIdsAtCapture = [...new Set(input.transactionIdsAtCapture.filter(id => typeof id === 'string' && id))];
  else if (sameMoment && Array.isArray(existing?.transactionIdsAtCapture)) transactionIdsAtCapture = existing.transactionIdsAtCapture.slice();
  const snapshot = {
    id:existing?.id || \`snapshot:\${crypto.randomUUID()}\`, date:input.date,
    totalAssets, totalLiabilities,
    netAssets:(Math.round(totalAssets * 100) - Math.round(totalLiabilities * 100)) / 100,
    note:String(input.note ?? '').trim(), createdAt:existing?.createdAt || input.createdAt || new Date().toISOString()
  };
  if (capturedAt) snapshot.capturedAt = capturedAt;
  if (transactionIdsAtCapture) snapshot.transactionIdsAtCapture = transactionIdsAtCapture;
  return snapshot;
}

export function snapshotMoment(snapshot) {
  return snapshot?.capturedAt || (snapshot?.date ? \`\${snapshot.date}T23:59:59\` : '');
}

export function formatSnapshotMoment(snapshot) {
  if (!snapshot?.date) return '';
  return snapshot.capturedAt ? \`\${snapshot.date} \${snapshot.capturedAt.slice(11,16)}\` : \`\${snapshot.date}（旧快照）\`;
}

export function sortSnapshots(snapshots) {
  return snapshots.slice().sort((a,b) => snapshotMoment(b).localeCompare(snapshotMoment(a)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export function latestSnapshot(snapshots) {
  return sortSnapshots(snapshots || [])[0] || null;
}

function transactionParts(t) {
  const text = String(t?.datetime ?? '');
  const date = text.slice(0,10);
  const match = text.match(/^\\d{4}-\\d{2}-\\d{2}T(\\d{2}):(\\d{2})(?::(\\d{2}))?/);
  const time = match ? \`\${match[1]}:\${match[2]}:\${match[3] || '00'}\` : '';
  const midnightMayBeUnknown = time === '00:00:00' && (t?.source === '手动' || t?.importFormat === 'generic-csv');
  return { date, time, meaningfulTime:!!time && !midnightMayBeUnknown };
}

// relation: -1 = transaction is already represented by the snapshot; 1 = after snapshot.
// uncertain marks same-day rows where the source did not provide a usable time.
export function relationToSnapshot(snapshot, transaction) {
  const { date, time, meaningfulTime } = transactionParts(transaction);
  if (!billingPeriodLabel(date)) return { relation:1, uncertain:true };
  if (date < snapshot.date) return { relation:-1, uncertain:false };
  if (date > snapshot.date) return { relation:1, uncertain:false };
  if (meaningfulTime && snapshot.capturedAt) {
    const moment = \`\${date}T\${time}\`;
    return { relation:moment > snapshot.capturedAt ? 1 : -1, uncertain:false };
  }
  if (meaningfulTime && !snapshot.capturedAt) return { relation:-1, uncertain:false }; // 旧快照按当日结束处理。
  if (Array.isArray(snapshot.transactionIdsAtCapture)) {
    const existed = snapshot.transactionIdsAtCapture.includes(transaction.id);
    return { relation:existed ? -1 : 1, uncertain:!existed };
  }
  // 无水印时不能可靠判断同日无时间记录；沿用旧口径避免重复计入，并显式标记新时点快照的不确定性。
  return { relation:-1, uncertain:!!snapshot.capturedAt };
}

function localNowString(now = new Date()) {
  const pad = n => String(n).padStart(2,'0');
  return \`\${now.getFullYear()}-\${pad(now.getMonth()+1)}-\${pad(now.getDate())}T\${pad(now.getHours())}:\${pad(now.getMinutes())}:\${pad(now.getSeconds())}\`;
}

function notFuture(transaction, now = new Date()) {
  const { date, time, meaningfulTime } = transactionParts(transaction);
  const current = localNowString(now);
  if (!billingPeriodLabel(date)) return false;
  if (date < current.slice(0,10)) return true;
  if (date > current.slice(0,10)) return false;
  return !meaningfulTime || \`\${date}T\${time}\` <= current;
}

export function summarizeSnapshotChanges(opening, transactions, range = null, closing = null) {
  let uncertainCount = 0;
  const changes = (transactions || []).filter(t => {
    const afterOpening = relationToSnapshot(opening, t);
    if (afterOpening.relation <= 0) return false;
    if (closing) {
      const beforeClosing = relationToSnapshot(closing, t);
      if (beforeClosing.relation > 0) return false;
      if (afterOpening.uncertain || beforeClosing.uncertain) uncertainCount++;
    } else if (afterOpening.uncertain) uncertainCount++;
    return true;
  });
  return { ...summarize(changes, range), uncertainCount };
}

export function referenceFromSnapshot(snapshot, transactions, now = new Date()) {
  if (!snapshot) return null;
  let uncertainCount = 0;
  const after = (transactions || []).filter(t => {
    if (!notFuture(t, now)) return false;
    const rel = relationToSnapshot(snapshot, t);
    if (rel.relation > 0 && rel.uncertain) uncertainCount++;
    return rel.relation > 0;
  });
  const summary = summarize(after, null);
  const delta = Math.round((summary.totalIncome - summary.totalExpense) * 100) / 100;
  return {
    snapshotNetAssets:snapshot.netAssets,
    income:summary.totalIncome,
    expense:summary.totalExpense,
    delta,
    referenceNetAssets:(Math.round(snapshot.netAssets * 100) + Math.round(delta * 100)) / 100,
    uncertainCount
  };
}

export function reconcileBalance(opening, closing, transactions, range) {
  if (!opening || !closing || opening.id === closing.id) throw new Error('请选择不同的期初和期末快照');
  if (snapshotMoment(opening) > snapshotMoment(closing)) throw new Error('期初快照时间不能晚于期末');
  customDateRange(range?.start, range?.end);
  const { totalIncome:income, totalExpense:expense, uncertainCount } = summarizeSnapshotChanges(opening, transactions, range, closing);
  const theoretical = (Math.round(opening.netAssets * 100) + Math.round(income * 100) - Math.round(expense * 100)) / 100;
  return { opening:opening.netAssets, income, expense, theoretical, actual:closing.netAssets,
    difference:(Math.round(closing.netAssets * 100) - Math.round(theoretical * 100)) / 100,
    uncertainCount };
}
`);

// --- index.html ---
replaceOnce('index.html',
  '<label id="billingMonthWrap" class="billing-month"><span class="sr-only">选择账期</span><input type="month" id="monthPick" aria-label="选择账期"></label>',
  '<label id="billingMonthWrap" class="billing-month"><span class="sr-only">选择账期</span><select id="monthPick" aria-label="选择账期"></select></label>');

replaceOnce('index.html',
`        <div id="assetCurrentBody" hidden>
          <p class="asset-net-label">当前净资产</p>
          <p class="asset-net-value" id="assetNet">¥0.00</p>
          <p class="asset-split"><span>总资产 <b id="assetTotal">¥0.00</b></span><span>总负债 <b id="assetLiability">¥0.00</b></span></p>
        </div>`,
`        <div id="assetCurrentBody" hidden>
          <p class="asset-net-label" id="assetNetLabel">参考当前净资产</p>
          <p class="asset-net-value" id="assetNet">¥0.00</p>
          <p class="asset-reference-meta" id="assetReferenceMeta"></p>
          <p class="asset-reference-change" id="assetReferenceChange"></p>
          <p class="asset-reference-warning" id="assetReferenceWarning" hidden></p>
          <p class="asset-split"><span>总资产 <b id="assetTotal">¥0.00</b></span><span>总负债 <b id="assetLiability">¥0.00</b></span></p>
        </div>`);

replaceOnce('index.html',
`        <div class="asset-actions">
          <button type="button" class="text-button" id="assetLedgerOpen">管理资产</button>
          <button type="button" class="text-button" id="snapshotsOpen">资产快照</button>
          <button type="button" class="text-button" id="balanceOpen">账期核对</button>
        </div>`,
`        <div class="asset-actions">
          <button type="button" class="text-button" id="assetSnapshotNow">记录盘点</button>
          <button type="button" class="text-button" id="assetLedgerOpen">管理资产</button>
          <button type="button" class="text-button" id="snapshotsOpen">资产快照</button>
          <button type="button" class="text-button" id="balanceOpen">账期核对</button>
        </div>`);

replaceOnce('index.html',
  '<div id="listView"><div id="txnList" class="transaction-list"></div><p class="empty-hint" id="tableEmpty">还没有记录</p></div>',
  '<div id="listView"><div id="txnList" class="transaction-list"></div><div class="detail-empty" id="tableEmpty"><p class="empty-hint" id="tableEmptyText">还没有记录</p><button type="button" class="btn btn-secondary" id="emptyImport">去导入</button></div></div>');

replaceRegex('index.html', /  <dialog id="adjustmentDialog"[\s\S]*?  <\/dialog>\n\n  <dialog id="snapshotsDialog"/, `  <dialog id="adjustmentDialog" class="sheet transaction-sheet" aria-labelledby="adjustmentTitle">
    <div class="sheet-header"><h2 id="adjustmentTitle">交易详情</h2><button type="button" class="sheet-close" id="adjustmentClose" aria-label="关闭交易详情">×</button></div>
    <dl id="adjustmentFacts" class="adjustment-facts"></dl>
    <form id="transactionEditForm" class="sheet-form transaction-edit-form" novalidate>
      <label>金额（元）<input type="number" id="transactionAmount" inputmode="decimal" min="0.01" step="0.01" required></label>
      <label>日期<input type="date" id="transactionDate" required></label>
      <label>收支<select id="transactionDirection"><option value="支出">支出</option><option value="收入">收入</option><option value="中性">不计收支</option></select></label>
      <label>分类<select id="transactionCategory"></select></label>
      <label>说明<input type="text" id="transactionDescription" maxlength="160"></label>
      <p class="section-note">导入记录的来源和商户保持原样；人工修改不会改变导入身份，也不会影响同一账单再次导入时的去重。</p>
      <p id="categoryMsg" class="form-error" role="alert"></p>
      <button type="submit" class="btn btn-primary" id="saveTransaction">保存修改</button>
    </form>
    <details class="advanced-transaction"><summary>高级处理</summary>
      <div id="adjustmentControls" class="adjustment-controls">
        <p id="adjustmentRule" class="card-desc"></p>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="adjustmentInclude">正常计入</button>
          <button type="button" class="btn btn-secondary" id="adjustmentExclude">不计入统计</button>
        </div>
        <form id="adjustmentForm" class="adjustment-form" novalidate>
          <label for="adjustmentAmount">实际计入金额（元）</label>
          <input type="number" id="adjustmentAmount" inputmode="decimal" min="0.01" step="0.01" required>
          <button type="submit" class="btn btn-secondary" id="adjustmentSave">保存计入金额</button>
        </form>
        <p id="adjustmentMsg" class="import-msg error" role="status" aria-live="polite"></p>
      </div>
      <button type="button" class="btn btn-danger" id="transactionDelete" hidden>删除手动记录</button>
      <button type="button" class="btn btn-secondary" id="reconciliationUndo" hidden>撤销核对</button>
    </details>
  </dialog>

  <dialog id="snapshotsDialog"`, 'id="transactionEditForm"');

replaceOnce('index.html',
  '<label>日期<input type="date" id="snapshotDate" required></label>',
  '<label>日期<input type="date" id="snapshotDate" required></label>\n      <label>时间<input type="time" id="snapshotTime" step="60" required></label>');
replaceOnce('index.html',
  '<label>日期<input type="date" id="ledgerSnapshotDate" required></label>',
  '<label>日期<input type="date" id="ledgerSnapshotDate" required></label>\n      <label>时间<input type="time" id="ledgerSnapshotTime" step="60" required></label>');
replaceOnce('index.html',
  '记录一个时间点的总资产与总负债，不管理账户。资产总账的"记录当前为资产快照"会按当前账户自动算出这三个数。',
  '记录一个具体时间点的总资产与总负债，不管理账户。资产总账的“记录当前为资产快照”会按当前账户自动算出这三个数。');
replaceOnce('index.html',
  '快照代表该日结束时的资产状态。核对仅计算期初快照日期之后、期末快照日期当天及之前的收支，并与所选范围取交集。差额仅用于辅助检查。',
  '新快照按具体时间点核对；旧快照没有时间时仍按原来的“当日结束”口径兼容。差额仅用于辅助检查。');

// --- app.js imports ---
replaceOnce('js/app.js',
  "import { isManualTransaction } from './manual.js';",
  "import { isManualTransaction, todayDate } from './manual.js';\nimport { updateTransactionFields, editAffectsReconciliation } from './transaction-update.js';\nimport { latestSnapshot, referenceFromSnapshot, formatSnapshotMoment } from './snapshots.js';\nimport { calculateLedgerTotals, hasLedgerAccounts } from './asset-ledger.js';");
replaceOnce('js/app.js',
  '  clearAllData, exportBackup, importBackup, deleteManualTransaction, saveExpenseAdjustment, saveTransactionCategory,\n  loadSnapshots',
  '  clearAllData, exportBackup, importBackup, deleteManualTransaction, saveExpenseAdjustment, saveTransactionCategory,\n  loadSnapshots');

replaceOnce('js/app.js',
`    if (!filterNeedsReview(transactions).length && !duplicateCount)
      document.getElementById('quickFeedback').textContent = \`已导入：新增 \${added} 条，重复跳过 \${skipped} 条。\`;
    switchView(filterNeedsReview(transactions).length || duplicateCount ? 'import' : 'overview');`,
`    if (duplicateCount) document.getElementById('quickFeedback').textContent =
      \`已导入：新增 \${added} 条，重复跳过 \${skipped} 条。发现 \${duplicateCount} 组疑似重复，请先核对；确认前统计可能暂时重复。\`;
    else if (!filterNeedsReview(transactions).length)
      document.getElementById('quickFeedback').textContent = \`已导入：新增 \${added} 条，重复跳过 \${skipped} 条。\`;
    switchView(filterNeedsReview(transactions).length || duplicateCount ? 'import' : 'overview');`);

replaceOnce('js/app.js',
`  document.getElementById('tableEmpty').hidden = rows.length > 0;
  document.getElementById('tableEmpty').textContent = document.getElementById('onlyNeedsReview').checked
    ? '当前范围和筛选下无需处理' : '没有符合条件的记录';`,
`  document.getElementById('tableEmpty').hidden = rows.length > 0;
  document.getElementById('tableEmptyText').textContent = document.getElementById('onlyNeedsReview').checked
    ? '当前范围和筛选下无需处理' : '没有符合条件的记录';`);

const adjustmentBlock = `const adjustmentDialog = document.getElementById('adjustmentDialog');
let adjustingId = null;

function editorCategories(direction, current = '') {
  const choices = direction === '收入' ? INCOME_CATEGORIES : CATEGORIES;
  return current && choices.includes(current) ? choices : [...new Set([...(current ? [current] : []), ...choices])];
}

function syncEditorCategories(preferred = '') {
  const direction = document.getElementById('transactionDirection').value;
  const select = document.getElementById('transactionCategory');
  const current = preferred || select.value || '其他';
  const choices = editorCategories(direction, current);
  select.innerHTML = choices.map(cat => '<option value="' + esc(cat) + '">' + esc(cat) + '</option>').join('');
  select.value = choices.includes(current) ? current : (choices.includes('其他') ? '其他' : choices[0]);
}

function onOpenAdjustment(e) {
  const record = transactions.find(t => t.id === e.currentTarget.dataset.id);
  if (!record) return;
  adjustingId = record.id;
  const facts = [['来源', record.source || '—']];
  if (!isManualTransaction(record)) facts.push(['商户（只读）', record.counterparty || '—']);
  if (record.rawCategory) facts.push(['账单原分类', record.rawCategory]);
  if (record.status) facts.push(['交易状态', record.status]);
  document.getElementById('adjustmentFacts').innerHTML = facts.map(([key,value]) =>
    \`<dt>\${esc(key)}</dt><dd>\${esc(value)}</dd>\`).join('');
  document.getElementById('transactionAmount').value = String(record.amount);
  document.getElementById('transactionDate').value = String(record.datetime || '').slice(0,10);
  document.getElementById('transactionDirection').value = ['支出','收入','中性'].includes(record.direction) ? record.direction : '中性';
  syncEditorCategories(record.myCategory || '其他');
  document.getElementById('transactionDescription').value = record.description || (isManualTransaction(record) ? record.counterparty || '' : '');
  document.getElementById('categoryMsg').textContent = '';
  const controls = document.getElementById('adjustmentControls');
  controls.hidden = !canAdjustTransaction(record);
  document.getElementById('transactionDelete').hidden = !isManualTransaction(record);
  document.getElementById('transactionDelete').dataset.id = record.id;
  const undo = document.getElementById('reconciliationUndo');
  if (undo) { undo.hidden = !isReconciledDuplicate(record); undo.dataset.id = record.id; }
  const amount = document.getElementById('adjustmentAmount');
  amount.max = String(record.amount);
  amount.value = String(isValidCountedAmount(record.countedAmount, record.amount) ? record.countedAmount : record.amount);
  document.getElementById('adjustmentRule').textContent = record.status === '交易关闭'
    ? '交易关闭仍自动不计入统计。' : '这里只处理是否计入支出统计；普通金额、日期和说明请用上方“保存修改”。';
  document.getElementById('adjustmentMsg').textContent = '';
  if (!adjustmentDialog.open) adjustmentDialog.showModal();
}

document.getElementById('transactionDirection').addEventListener('change', () => syncEditorCategories('其他'));
document.getElementById('transactionEditForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!adjustingId) return;
  const controls = adjustmentDialog.querySelectorAll('button,select,input');
  controls.forEach(control => { control.disabled = true; });
  const msg = document.getElementById('categoryMsg');
  try {
    const before = transactions.find(t => t.id === adjustingId);
    if (!before) throw new Error('记录不存在');
    let updated = updateTransactionFields(before, {
      amount:document.getElementById('transactionAmount').value,
      date:document.getElementById('transactionDate').value,
      direction:document.getElementById('transactionDirection').value,
      category:document.getElementById('transactionCategory').value,
      description:document.getElementById('transactionDescription').value
    });
    const changed = new Map([[updated.id, updated]]);
    if (editAffectsReconciliation(before, updated)) {
      if (updated.reconciledDuplicateOf) {
        updated = { ...updated }; delete updated.reconciledDuplicateOf; changed.set(updated.id, updated);
      }
      for (const t of transactions) if (t.reconciledDuplicateOf === before.id) {
        const copy = { ...t }; delete copy.reconciledDuplicateOf; changed.set(copy.id, copy);
      }
    }
    await saveTransactions([...changed.values()]);
    transactions = transactions.map(t => changed.get(t.id) || t);
    classifyAll(); refreshAll(); adjustmentDialog.close();
    document.getElementById('adjustmentFeedback').textContent = '交易修改已保存，统计已更新。';
  } catch (error) { msg.textContent = error.message; }
  finally { controls.forEach(control => { control.disabled = false; }); }
});

async function onSaveAdjustment(action) {
  const buttons = adjustmentDialog.querySelectorAll('button');
  if (document.getElementById('adjustmentInclude').disabled || !adjustingId) return;
  buttons.forEach(button => { button.disabled = true; });
  const msg = document.getElementById('adjustmentMsg');
  try {
    const updated = await saveExpenseAdjustment(adjustingId, action,
      document.getElementById('adjustmentAmount').value);
    transactions = transactions.map(t => t.id === updated.id ? updated : t);
    classifyAll(); refreshAll(); adjustmentDialog.close();
    document.getElementById('adjustmentFeedback').textContent = '处理已保存，统计已更新。';
  } catch (error) { msg.textContent = error.message; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}

document.getElementById('adjustmentInclude').addEventListener('click', () => onSaveAdjustment('include'));
document.getElementById('adjustmentExclude').addEventListener('click', () => onSaveAdjustment('exclude'));
document.getElementById('adjustmentForm').addEventListener('submit', e => { e.preventDefault(); onSaveAdjustment('amount'); });
document.getElementById('adjustmentClose').addEventListener('click', () => {
  if (!document.getElementById('saveTransaction').disabled) adjustmentDialog.close();
});
adjustmentDialog.addEventListener('cancel', e => { if (document.getElementById('saveTransaction').disabled) e.preventDefault(); });
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
  if (!confirm('删除这条手动记账记录？')) return;
  button.disabled = true;
  const msg = document.getElementById('manualDeleteMsg');
  msg.className = 'import-msg';
  try {
    await deleteManualTransaction(id);
    transactions = transactions.filter(t => t.id !== id);
    refreshAll(); adjustmentDialog.close();
    msg.textContent = '手动记录已删除，统计已更新。'; msg.classList.add('ok');
  } catch (err) {
    msg.textContent = '删除失败：' + err.message; msg.classList.add('error');
  } finally { button.disabled = false; }
}
`;
replaceRegex('js/app.js', /const adjustmentDialog = document\.getElementById\('adjustmentDialog'\);[\s\S]*?\nfunction renderMerchantView\(rows\) \{/, adjustmentBlock + '\nfunction renderMerchantView(rows) {', 'transactionEditForm').catch?.(() => {});

// The helper above is synchronous; marker guard is handled by checking source explicitly here.
if (!read('js/app.js').includes("document.getElementById('transactionEditForm').addEventListener")) {
  const src = read('js/app.js');
  const re = /const adjustmentDialog = document\.getElementById\('adjustmentDialog'\);[\s\S]*?\nfunction renderMerchantView\(rows\) \{/;
  if (!re.test(src)) throw new Error('Missing adjustment block in js/app.js');
  write('js/app.js', src.replace(re, adjustmentBlock + '\nfunction renderMerchantView(rows) {'));
}

// Remove the obsolete category-only handler after the real editor is installed.
replaceRegex('js/app.js', /\nasync function onChangeCategory\(\) \{[\s\S]*?\n\}\n\nfunction populateCategoryFilter\(\) \{/, '\nfunction populateCategoryFilter() {', 'function populateCategoryFilter() {');

replaceOnce('js/app.js',
`document.getElementById('overviewDetail').addEventListener('click', () => {`,
`document.getElementById('emptyImport').addEventListener('click', () => switchView('import'));
document.getElementById('overviewDetail').addEventListener('click', () => {`);

// Dashboard helpers: period range labels and current reference net assets are independent of selected historical range.
const dashboardHelpers = `
function billingOptionLabel(label) {
  const r = billingPeriodRange(label);
  const parts = d => d.split('-').map(Number);
  const [sy,sm,sd] = parts(r.start), [ey,em,ed] = parts(r.end);
  return sy === ey ? \`\${sm}月\${sd}日－\${em}月\${ed}日\` : \`\${sy}年\${sm}月\${sd}日－\${ey}年\${em}月\${ed}日\`;
}

function populateBillingPeriodSelect() {
  const labels = new Set([currentBillingPeriod().label]);
  if (range?.label && !range.mode) labels.add(range.label);
  for (const t of transactions) {
    const label = billingPeriodLabel(t.datetime);
    if (label) labels.add(label);
  }
  const select = document.getElementById('monthPick');
  const options = [...labels].sort((a,b) => b.localeCompare(a));
  select.innerHTML = options.map(label => \`<option value="\${esc(label)}">\${esc(billingOptionLabel(label))}</option>\`).join('');
}

function signedMoney(value) {
  if (value === 0) return '¥0.00';
  return (value > 0 ? '+' : '−') + fmtMoney(Math.abs(value));
}

function renderAssetReference() {
  const ledger = assetLedgerUI.getLedger();
  const hasLedger = hasLedgerAccounts(ledger);
  const totals = hasLedger ? calculateLedgerTotals(ledger.accounts) : null;
  const latest = latestSnapshot(ledgerTools.getSnapshots());
  const empty = document.getElementById('assetCurrentEmpty');
  const body = document.getElementById('assetCurrentBody');
  document.getElementById('assetLedgerOpen').hidden = !hasLedger;
  if (!latest && !hasLedger) {
    empty.hidden = false; body.hidden = true;
    document.getElementById('assetUpdated').textContent = '';
    return;
  }
  empty.hidden = true; body.hidden = false;
  const warning = document.getElementById('assetReferenceWarning');
  if (latest) {
    const ref = referenceFromSnapshot(latest, transactions);
    document.getElementById('assetNetLabel').textContent = '参考当前净资产';
    document.getElementById('assetNet').textContent = fmtMoney(ref.referenceNetAssets);
    document.getElementById('assetReferenceMeta').textContent = \`最近盘点 \${formatSnapshotMoment(latest)} · 实际净资产 \${fmtMoney(latest.netAssets)}\`;
    document.getElementById('assetReferenceChange').textContent = \`盘点后变化 \${signedMoney(ref.delta)} · 收入 \${fmtMoney(ref.income)} · 支出 \${fmtMoney(ref.expense)}\`;
    warning.hidden = !ref.uncertainCount;
    warning.textContent = ref.uncertainCount ? \`有 \${ref.uncertainCount} 笔同日无准确时间的流水需要核对，参考值可能有偏差。\` : '';
    document.getElementById('assetTotal').textContent = fmtMoney(totals ? totals.totalAssets : latest.totalAssets);
    document.getElementById('assetLiability').textContent = fmtMoney(totals ? totals.totalLiabilities : latest.totalLiabilities);
  } else {
    document.getElementById('assetNetLabel').textContent = '当前净资产';
    document.getElementById('assetNet').textContent = fmtMoney(totals.netAssets);
    document.getElementById('assetReferenceMeta').textContent = '记录一次资产快照后，将从真实盘点时点开始推算参考当前净资产。';
    document.getElementById('assetReferenceChange').textContent = '';
    warning.hidden = true; warning.textContent = '';
    document.getElementById('assetTotal').textContent = fmtMoney(totals.totalAssets);
    document.getElementById('assetLiability').textContent = fmtMoney(totals.totalLiabilities);
  }
  document.getElementById('assetUpdated').textContent = hasLedger && ledger.updatedAt ? \`总账更新于 \${ledger.updatedAt.slice(0,10)}\` : '';
}
`;
replaceOnce('js/app.js', '// 环比变化文字（本期 vs 上期），返回 {text, cls}', dashboardHelpers + '\n// 环比变化文字（本期 vs 上期），返回 {text, cls}');
replaceOnce('js/app.js', '  renderPeriodTable();\n}', '  renderPeriodTable();\n  renderAssetReference();\n}');
replaceOnce('js/app.js',
`  document.getElementById('monthPick').value = mode === 'billing' ? range.label : '';
  document.getElementById('billingMonthWrap').hidden = mode !== 'billing';`,
`  populateBillingPeriodSelect();
  document.getElementById('monthPick').value = mode === 'billing' ? range.label : '';
  document.getElementById('billingMonthWrap').hidden = mode !== 'billing';`);

replaceOnce('js/app.js',
`const assetLedgerUI = setupAssetLedgerUI({
  refreshApp:refreshAll,
  refreshSnapshots:() => ledgerTools.load()
});`,
`const assetLedgerUI = setupAssetLedgerUI({
  refreshApp:refreshAll,
  refreshSnapshots:() => ledgerTools.load(),
  getTransactions:() => transactions
});
document.getElementById('assetSnapshotNow').addEventListener('click', async () => {
  const ledger = assetLedgerUI.getLedger();
  if (hasLedgerAccounts(ledger)) assetLedgerUI.openSnapshotFromLedger();
  else await ledgerTools.newSnapshot(todayDate());
});`);

// --- ledger-tools.js ---
replaceOnce('js/ledger-tools.js',
  "import { createSnapshot, reconcileBalance } from './snapshots.js';",
  "import { createSnapshot, reconcileBalance, formatSnapshotMoment } from './snapshots.js';");
replaceOnce('js/ledger-tools.js',
  "  const money = n => '¥' + n.toLocaleString('zh-CN', {minimumFractionDigits:2,maximumFractionDigits:2});",
  "  const money = n => '¥' + n.toLocaleString('zh-CN', {minimumFractionDigits:2,maximumFractionDigits:2});\n  const nowTime = () => { const d = new Date(), pad = n => String(n).padStart(2,'0'); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };");
replaceOnce('js/ledger-tools.js',
  '<div class="snapshot-row"><strong>${esc(s.date)} · 净资产 ${money(s.netAssets)}</strong>',
  '<div class="snapshot-row"><strong>${esc(formatSnapshotMoment(s))} · 净资产 ${money(s.netAssets)}</strong>');
replaceOnce('js/ledger-tools.js',
`    el('snapshotDate').value = s?.date || date || todayDate();
    el('snapshotAssets').value = s ? s.totalAssets : '';`,
`    el('snapshotDate').value = s?.date || date || todayDate();
    el('snapshotTime').value = s?.capturedAt?.slice(11,16) || nowTime();
    el('snapshotAssets').value = s ? s.totalAssets : '';`);
replaceOnce('js/ledger-tools.js',
`  function snapshotInput() { return { date:el('snapshotDate').value, totalAssets:el('snapshotAssets').value,
    totalLiabilities:el('snapshotLiabilities').value, note:el('snapshotNote').value }; }`,
`  function snapshotInput() {
    const date = el('snapshotDate').value;
    return { date, time:el('snapshotTime').value, totalAssets:el('snapshotAssets').value,
      totalLiabilities:el('snapshotLiabilities').value, note:el('snapshotNote').value,
      transactionIdsAtCapture:!editingId && date === todayDate() ? getTransactions().map(t => t.id) : undefined };
  }`);
replaceOnce('js/ledger-tools.js',
  "  ['snapshotDate','snapshotAssets','snapshotLiabilities'].forEach(id => el(id).addEventListener('input',previewNet));",
  "  ['snapshotDate','snapshotTime','snapshotAssets','snapshotLiabilities'].forEach(id => el(id).addEventListener('input',previewNet));");
replaceOnce('js/ledger-tools.js',
  "    try { await deleteSnapshot(pendingDeleteId); await load(); el('snapshotListMsg').textContent = '快照已删除。'; }",
  "    try { await deleteSnapshot(pendingDeleteId); await load(); refreshApp(); el('snapshotListMsg').textContent = '快照已删除。'; }");
replaceOnce('js/ledger-tools.js',
  "    try { await saveSnapshot(snapshotInput(),editingId); await load(); el('snapshotEditDialog').close(); el('snapshotListMsg').textContent = '快照已保存。'; }",
  "    try { await saveSnapshot(snapshotInput(),editingId); await load(); refreshApp(); el('snapshotEditDialog').close(); el('snapshotListMsg').textContent = '快照已保存。'; }");
replaceOnce('js/ledger-tools.js',
  "  return { load, refresh, newSnapshot, async undo(id) {",
  "  return { load, refresh, newSnapshot, getSnapshots:() => snapshots.slice(), async undo(id) {");

// --- asset-ledger-ui.js ---
replaceOnce('js/asset-ledger-ui.js',
  'export function setupAssetLedgerUI({ refreshApp, refreshSnapshots }) {',
  'export function setupAssetLedgerUI({ refreshApp, refreshSnapshots, getTransactions = () => [] }) {');
replaceOnce('js/asset-ledger-ui.js',
  "const money = n => '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits:2, maximumFractionDigits:2 });",
  "const money = n => '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits:2, maximumFractionDigits:2 });\nconst nowTime = () => { const d = new Date(), pad = n => String(n).padStart(2,'0'); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };");
replaceOnce('js/asset-ledger-ui.js',
  "      await load();\n      el('accountMsg').textContent = '账户已删除。';",
  "      await load(); refreshApp();\n      el('accountMsg').textContent = '账户已删除。';");
replaceOnce('js/asset-ledger-ui.js',
  "      await load();\n      el('accountEditDialog').close();",
  "      await load(); refreshApp();\n      el('accountEditDialog').close();");
replaceOnce('js/asset-ledger-ui.js',
`    el('ledgerSnapshotDate').value = todayDate();
    el('ledgerSnapshotTotal').textContent = money(totals.totalAssets);`,
`    el('ledgerSnapshotDate').value = todayDate();
    el('ledgerSnapshotTime').value = nowTime();
    el('ledgerSnapshotTotal').textContent = money(totals.totalAssets);`);
replaceOnce('js/asset-ledger-ui.js',
  "      await recordLedgerSnapshot(el('ledgerSnapshotDate').value);",
  "      await recordLedgerSnapshot(el('ledgerSnapshotDate').value, el('ledgerSnapshotTime').value);");
replaceRegex('js/asset-ledger-ui.js', /  async function recordLedgerSnapshot\(date\) \{[\s\S]*?\n  \}\n\n  async function load\(\) \{/, `  async function recordLedgerSnapshot(date, time = nowTime()) {
    if (!hasLedgerAccounts(ledger)) throw new Error('还没有建立资产总账');
    const totals = calculateLedgerTotals(ledger.accounts);
    const saved = await saveSnapshot({
      date, time, totalAssets:totals.totalAssets, totalLiabilities:totals.totalLiabilities,
      note:'来自资产总账',
      transactionIdsAtCapture:date === todayDate() ? getTransactions().map(t => t.id) : undefined
    });
    await refreshSnapshots(); refreshApp();
    return saved;
  }

  async function load() {`, 'transactionIdsAtCapture:date === todayDate()');
replaceOnce('js/asset-ledger-ui.js',
  '  return { load, openLedger, recordLedgerSnapshot, getLedger:() => ledger };',
  '  return { load, openLedger, openSnapshotFromLedger, recordLedgerSnapshot, getLedger:() => ledger };');

// --- CSS overrides, intentionally leaves the current bottom quick-action/nav geometry untouched. ---
const cssMarker = '/* finance-upgrade-20261017 */';
if (!read('css/style.css').includes(cssMarker)) write('css/style.css', read('css/style.css') + `

${cssMarker}
:root{--mute:#716b64;--negative:#b65f57;--positive:#56745f}
.range-picker{display:block;background:#fffdf9;border:1px solid var(--line);border-radius:18px;padding:12px 16px;box-shadow:0 1px 2px rgba(70,55,45,.025)}
.range-picker>summary{display:flex;align-items:center;gap:8px;min-height:42px;cursor:pointer;list-style:none;color:var(--ink2)}
.range-picker>summary::-webkit-details-marker{display:none}.range-picker>summary svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6}.range-picker .range-chevron{margin-left:auto}.range-picker[open] .range-label{display:none}.range-mode-title{display:none}.range-picker[open] .range-mode-title{display:inline}.range-picker[open] .range-mode-title::after{content:'选择时间范围'}
.range-context{margin-top:8px;min-height:0}.billing-month{width:100%}.billing-month select{width:100%;min-height:40px;border:0;border-radius:10px;background:var(--paper2);padding:8px 10px;font-size:13px;color:var(--ink2)}
#view-overview>.card{background:#fffdf9;border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:0 1px 2px rgba(70,55,45,.025)}
#view-overview>.card .card-head{margin-bottom:14px}.card-meta,.card-desc,.section-note,.kpi-sub,.kpi-delta,.txn-meta,.txn-tags,.empty-hint{color:var(--mute)}
.kpi-expense .kpi-value,.expense,.top-amt{color:var(--negative)}.income{color:var(--positive)}
.time-chip{display:inline-flex;align-items:center;width:max-content;border-radius:999px;background:var(--accent-weak);color:var(--ink2);padding:8px 12px;min-height:36px}
.detail-empty{text-align:center;padding:8px 0 22px}.detail-empty .empty-hint{padding-bottom:12px}.detail-empty .btn{min-width:112px}
.asset-reference-meta,.asset-reference-change,.asset-reference-warning{font-size:12px;line-height:1.55;margin-top:7px;color:var(--mute);overflow-wrap:anywhere}.asset-reference-change{color:var(--ink2)}.asset-reference-warning{color:var(--negative)}
.advanced-transaction{margin-top:18px;border-top:1px solid var(--line);padding-top:8px}.advanced-transaction>summary{min-height:44px;padding:10px 0;cursor:pointer;color:var(--ink2);font-size:13px}.transaction-edit-form{margin-top:12px}
.history-section>summary{display:flex;align-items:center;list-style:none}.history-section>summary::-webkit-details-marker{display:none}.history-section>summary::after{content:'›';margin-left:auto;color:var(--mute);transition:transform .15s}.history-section[open]>summary::after{transform:rotate(90deg)}
@media(max-width:360px){#view-overview>.card{padding:16px}.asset-reference-meta,.asset-reference-change{font-size:11px}}
`);

// --- Service worker ---
replaceOnce('sw.js', "const CACHE = 'jizhang-v36';", "const CACHE = 'jizhang-v37';");
replaceOnce('sw.js', "const RUNTIME_CACHE = 'jizhang-runtime-v36';", "const RUNTIME_CACHE = 'jizhang-runtime-v37';");
replaceOnce('sw.js', "  './js/manual.js',\n  './js/quick-entry.js',", "  './js/manual.js',\n  './js/quick-entry.js','./js/transaction-update.js',");

// --- Tests for the newly locked behavior. ---
write('tests/transaction-update-fields.test.js', `import test from 'node:test';
import assert from 'node:assert/strict';
import { updateTransactionFields, editAffectsReconciliation } from '../js/transaction-update.js';

test('导入交易可改金额日期方向分类说明但稳定导入身份与商户不变', () => {
  const before={id:'wechat:1',source:'微信',externalOrderId:'wx-1',counterparty:'原商户',datetime:'2026-10-17T12:34:56',amount:35.6,direction:'支出',myCategory:'餐饮',description:'旧说明'};
  const after=updateTransactionFields(before,{date:'2026-10-18',amount:'32.60',direction:'支出',category:'购物',description:'修正说明'});
  assert.equal(after.id,before.id);assert.equal(after.source,'微信');assert.equal(after.externalOrderId,'wx-1');assert.equal(after.counterparty,'原商户');
  assert.equal(after.datetime,'2026-10-18T12:34:56');assert.equal(after.amount,32.6);assert.equal(after.myCategory,'购物');assert.equal(after.description,'修正说明');
  assert.equal(after.userEdited,true);
});

test('手动交易说明与内部对方同步，收入使用收入分类', () => {
  const before={id:'manual:1',source:'手动',counterparty:'工资',datetime:'2026-10-15T00:00:00',amount:5000,direction:'收入',myCategory:'工资',description:'工资'};
  const after=updateTransactionFields(before,{date:'2026-10-15',amount:'5200',direction:'收入',category:'工资',description:'10月工资'});
  assert.equal(after.counterparty,'10月工资');assert.equal(after.description,'10月工资');assert.equal(after.amount,5200);
  assert.throws(()=>updateTransactionFields(before,{date:'2026-10-15',amount:'5200',direction:'收入',category:'餐饮',description:''}),/分类/);
});

test('金额日期或方向变化会使旧重复核对失效，只有说明变化不会', () => {
  const before={datetime:'2026-10-17T00:00:00',amount:100,direction:'收入'};
  assert.equal(editAffectsReconciliation(before,{...before,description:'x'}),false);
  assert.equal(editAffectsReconciliation(before,{...before,amount:101}),true);
  assert.equal(editAffectsReconciliation(before,{...before,datetime:'2026-10-18T00:00:00'}),true);
});
`);

write('tests/snapshot-reference.test.js', `import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot, referenceFromSnapshot, relationToSnapshot, formatSnapshotMoment } from '../js/snapshots.js';

test('参考当前净资产从最近真实快照时点之后的流水推算', () => {
  const s=createSnapshot({date:'2026-10-17',time:'12:00',totalAssets:'6000',totalLiabilities:'1000',transactionIdsAtCapture:['old']});
  const rows=[
    {id:'old',datetime:'2026-10-17T00:00:00',source:'手动',direction:'支出',amount:20,myCategory:'餐饮'},
    {id:'income',datetime:'2026-10-17T13:00:00',source:'微信',direction:'收入',amount:100,myCategory:'其他'},
    {id:'expense',datetime:'2026-10-17T14:00:00',source:'微信',direction:'支出',amount:30,myCategory:'餐饮'}
  ];
  const r=referenceFromSnapshot(s,rows,new Date(2026,9,17,20,0,0));
  assert.equal(r.referenceNetAssets,5070);assert.equal(r.income,100);assert.equal(r.expense,30);assert.equal(r.uncertainCount,0);
  assert.equal(formatSnapshotMoment(s),'2026-10-17 12:00');
});

test('同日无时间流水用快照水印判断是否已存在，快照后才出现则标记不确定', () => {
  const s=createSnapshot({date:'2026-10-17',time:'12:00',totalAssets:'5000',totalLiabilities:'0',transactionIdsAtCapture:['known']});
  assert.equal(relationToSnapshot(s,{id:'known',datetime:'2026-10-17T00:00:00',source:'手动'}).relation,-1);
  const rel=relationToSnapshot(s,{id:'late',datetime:'2026-10-17T00:00:00',source:'手动'});
  assert.equal(rel.relation,1);assert.equal(rel.uncertain,true);
});

test('旧快照无时间继续按当日结束口径兼容', () => {
  const legacy={id:'s',date:'2026-10-17',totalAssets:5000,totalLiabilities:0,netAssets:5000,createdAt:'2026-10-17T12:00:00Z'};
  assert.equal(relationToSnapshot(legacy,{id:'x',datetime:'2026-10-17T18:00:00',source:'微信'}).relation,-1);
});
`);

// Update one test that intentionally encoded the superseded product decision.
replaceRegex('tests/asset-ledger-layout.test.js', /test\('首页删除预计净资产及快照公式布局，保留窄屏安全的真实资产卡片',[\s\S]*?\n\}\);\s*$/, `test('首页恢复参考当前净资产，但底部导航与记一笔结构保持不变',()=>{
  const home=html.slice(html.indexOf('id="view-overview"'),html.indexOf('id="view-detail"'));
  for(const id of ['assetNetLabel','assetNet','assetReferenceMeta','assetReferenceChange','assetSnapshotNow']) assert.ok(home.includes(\`id="\${id}"\`));
  assert.match(app,/function renderAssetReference\(\)/);
  assert.match(app,/referenceFromSnapshot\(latest, transactions\)/);
  const nav=html.match(/<nav[\\s\\S]*?<\\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]),['overview','detail','import']);
  assert.equal([...html.matchAll(/id="quickEntryOpen"/g)].length,1);
  assert.ok(html.indexOf('class="global-quick-action"')<html.indexOf('<nav'));
});
`, '首页恢复参考当前净资产');

console.log('Finance UI/editing upgrade patch applied.');
