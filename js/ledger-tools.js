import { GENERIC_CSV_TEMPLATE } from './generic-csv.js';
import { todayDate } from './manual.js';
import { createSnapshot, reconcileBalance } from './snapshots.js';
import { reconciliationCandidates } from './reconciliation.js';
import { currentBillingPeriod, customDateRange, rangeText } from './period.js';
import { loadSnapshots, saveSnapshot, deleteSnapshot, saveReconciliation, loadAssetLedger } from './storage.js';
import { hasLedgerAccounts, calculateLedgerTotals } from './asset-ledger.js';

export function setupLedgerTools({ getTransactions, getRange, updateTransaction, refreshApp }) {
  const el = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => '¥' + n.toLocaleString('zh-CN', {minimumFractionDigits:2,maximumFractionDigits:2});
  let snapshots = [], editingId = null, pendingDeleteId = null, currentPair = null, busy = false;
  let deferred = new Set();
  const key = p => JSON.stringify([p.manual.id,p.imported.id]);
  const setBusy = value => {
    busy = value;
    ['snapshotSave','snapshotEditClose','snapshotDeleteConfirm','snapshotDeleteCancel','duplicateConfirm','duplicateDismiss','duplicateLater','duplicateClose','snapshotFromLedgerFill'].forEach(id => { el(id).disabled = value; });
  };

  function refresh() {
    const count = reconciliationCandidates(getTransactions()).length;
    el('duplicateNotice').textContent = count ? `发现 ${count} 组疑似重复记录（全部时间），请人工核对。` : '当前无待核对的疑似重复记录。';
    el('duplicateOpen').textContent = count ? `去核对（${count}组）` : '导入对账';
    if (el('balanceDialog').open) { el('balanceResult').textContent = ''; el('balanceMsg').textContent = '记录或统计范围已变化，请重新核对。'; }
  }

  async function load() {
    snapshots = await loadSnapshots();
    cancelSnapshotDelete();
    renderSnapshots();
  }
  function renderSnapshots() {
    el('snapshotList').innerHTML = snapshots.length ? snapshots.map(s =>
      `<div class="snapshot-row"><strong>${esc(s.date)} · 净资产 ${money(s.netAssets)}</strong><p>资产 ${money(s.totalAssets)} · 负债 ${money(s.totalLiabilities)}</p><p>${esc(s.note)}</p><div class="btn-row"><button type="button" class="text-button" data-edit="${esc(s.id)}">编辑</button><button type="button" class="text-button" data-delete="${esc(s.id)}">删除</button></div></div>`).join('') : '<p class="empty-hint">还没有资产快照</p>';
  }
  function cancelSnapshotDelete() { pendingDeleteId = null; el('snapshotDeletePrompt').hidden = true; }
  function openSnapshots() { cancelSnapshotDelete(); el('snapshotListMsg').textContent = ''; el('snapshotsDialog').showModal(); }
  el('snapshotsOpen').addEventListener('click',openSnapshots);
  el('snapshotsClose').addEventListener('click',() => el('snapshotsDialog').close());
  function editSnapshot(id = null, { date = null } = {}) {
    cancelSnapshotDelete();
    editingId = id;
    const s = snapshots.find(s => s.id === id);
    el('snapshotEditTitle').textContent = s ? '编辑快照' : '新增快照';
    el('snapshotDate').value = s?.date || date || todayDate();
    el('snapshotAssets').value = s ? s.totalAssets : '';
    el('snapshotLiabilities').value = s ? s.totalLiabilities : '0';
    el('snapshotNote').value = s?.note || '';
    el('snapshotEditMsg').textContent = '';
    previewNet(); el('snapshotEditDialog').showModal();
  }
  function snapshotInput() { return { date:el('snapshotDate').value, totalAssets:el('snapshotAssets').value,
    totalLiabilities:el('snapshotLiabilities').value, note:el('snapshotNote').value }; }
  function previewNet() {
    try { el('snapshotNet').textContent = money(createSnapshot(snapshotInput()).netAssets); }
    catch { el('snapshotNet').textContent = '—'; }
  }
  el('snapshotAdd').addEventListener('click',() => editSnapshot());
  // 供"设置起始资产快照"复用：先读最新快照，若该日期已有快照就直接进入编辑，不覆盖。
  async function newSnapshot(date) {
    await load();
    if (el('snapshotsDialog').open) el('snapshotsDialog').close();
    const existing = snapshots.find(s => s.date === date);
    el('snapshotListMsg').textContent = existing ? `编辑 ${date} 的资产快照。` : `新增 ${date} 的资产快照。`;
    editSnapshot(existing?.id || null, { date });
    return existing || null;
  }
  // 手工快照仍可独立填写；这里只是把资产总账的自动合计填进表单，保存仍需点击。
  el('snapshotFromLedgerFill').addEventListener('click',async () => {
    try {
      const ledger = await loadAssetLedger();
      if (!hasLedgerAccounts(ledger)) { el('snapshotListMsg').textContent = '还没有建立资产总账，请先在首页的「当前资产」建立总账。'; return; }
      const totals = calculateLedgerTotals(ledger.accounts);
      editSnapshot();
      el('snapshotAssets').value = String(totals.totalAssets);
      el('snapshotLiabilities').value = String(totals.totalLiabilities);
      previewNet();
      el('snapshotListMsg').textContent = '已按当前资产总账填入，可修改后保存。';
    } catch (error) { el('snapshotListMsg').textContent = error.message; }
  });
  el('snapshotList').addEventListener('click',e => {
    if (busy) return;
    const edit = e.target.closest('[data-edit]'), remove = e.target.closest('[data-delete]');
    if (edit) editSnapshot(edit.dataset.edit);
    if (remove) {
      const selected = snapshots.find(s => s.id === remove.dataset.delete);
      if (!selected) return;
      pendingDeleteId = selected.id;
      el('snapshotDeleteLabel').textContent = `删除 ${selected.date} 的快照（净资产 ${money(selected.netAssets)}）？交易记录不受影响。`;
      el('snapshotDeletePrompt').hidden = false;
      el('snapshotDeletePrompt').scrollIntoView({block:'nearest'});
    }
  });
  el('snapshotDeleteCancel').addEventListener('click',cancelSnapshotDelete);
  el('snapshotDeleteConfirm').addEventListener('click',async () => {
    if (busy || !pendingDeleteId) return;
    setBusy(true);
    try { await deleteSnapshot(pendingDeleteId); await load(); el('snapshotListMsg').textContent = '快照已删除。'; }
    catch (error) { el('snapshotListMsg').textContent = error.message; }
    finally { setBusy(false); }
  });
  ['snapshotDate','snapshotAssets','snapshotLiabilities'].forEach(id => el(id).addEventListener('input',previewNet));
  el('snapshotEditClose').addEventListener('click',() => { if (!busy) el('snapshotEditDialog').close(); });
  el('snapshotEditDialog').addEventListener('cancel',e => { if (busy) e.preventDefault(); });
  el('snapshotForm').addEventListener('submit',async e => {
    e.preventDefault(); if (busy) return; setBusy(true);
    try { await saveSnapshot(snapshotInput(),editingId); await load(); el('snapshotEditDialog').close(); el('snapshotListMsg').textContent = '快照已保存。'; }
    catch (error) { el('snapshotEditMsg').textContent = error.message; }
    finally { setBusy(false); }
  });

  function balanceRange() {
    const mode = el('balanceMode').value;
    return mode === 'billing' ? currentBillingPeriod() : mode === 'custom'
      ? customDateRange(el('balanceStart').value,el('balanceEnd').value) : getRange();
  }
  function updateBalanceRange() {
    el('balanceDates').hidden = el('balanceMode').value !== 'custom';
    el('balanceResult').textContent = '';
    try {
      const range = balanceRange();
      if (!range.start || !range.end) throw new Error('核对请选择本账期或自定义范围');
      el('balanceRange').textContent = rangeText(range); el('balanceMsg').textContent = '';
    } catch (error) { el('balanceRange').textContent = ''; el('balanceMsg').textContent = error.message; }
  }
  async function openBalance() {
    try {
      await load();
      if (el('snapshotsDialog').open) el('snapshotsDialog').close();
      const options = '<option value="">请选择快照</option>' + snapshots.map(s => `<option value="${esc(s.id)}">${esc(s.date)} · ${money(s.netAssets)}${s.note ? ' · ' + esc(s.note) : ''}</option>`).join('');
      el('balanceOpening').innerHTML = options; el('balanceClosing').innerHTML = options;
      el('balanceMode').value = getRange().start ? 'current' : 'billing';
      const initial = getRange().start ? getRange() : currentBillingPeriod();
      el('balanceStart').value = initial.start; el('balanceEnd').value = initial.end;
      updateBalanceRange(); el('balanceDialog').showModal();
    } catch (error) { el('quickFeedback').textContent = error.message; }
  }
  ['balanceOpen','snapshotBalance'].forEach(id => el(id).addEventListener('click',openBalance));
  el('balanceClose').addEventListener('click',() => el('balanceDialog').close());
  ['balanceMode','balanceStart','balanceEnd','balanceOpening','balanceClosing'].forEach(id => el(id).addEventListener('change',updateBalanceRange));
  el('balanceForm').addEventListener('submit',e => {
    e.preventDefault(); el('balanceResult').textContent = '';
    try {
      const r = reconcileBalance(snapshots.find(s => s.id === el('balanceOpening').value), snapshots.find(s => s.id === el('balanceClosing').value),getTransactions(),balanceRange());
      el('balanceMsg').textContent = '';
      el('balanceResult').innerHTML = '<dl class="balance-values">' + [
        ['期初净资产',r.opening],['＋ 期间收入',r.income],['− 期间支出',r.expense],['理论期末净资产',r.theoretical],['实际期末净资产',r.actual],['核对差额',r.difference]
      ].map(([label,value]) => `<dt>${label}</dt><dd>${label === '核对差额' && value > 0 ? '+' : ''}${money(value)}</dd>`).join('') + '</dl>';
    } catch (error) { el('balanceMsg').textContent = error.message; }
  });

  function renderPair() {
    const candidates = reconciliationCandidates(getTransactions());
    currentPair = candidates.find(p => !deferred.has(key(p))) || null;
    el('duplicateCount').textContent = `当前 ${candidates.length} 组疑似重复；只是候选，不代表已经重复计账。`;
    el('duplicateActions').hidden = !currentPair;
    el('duplicatePair').innerHTML = currentPair ? [currentPair.manual,currentPair.imported].map((t,i) =>
      `<div class="duplicate-record"><strong>${i ? '导入记录' : '手动记录'} · ${esc(t.direction)} ${money(t.amount)}</strong><p>${esc(t.datetime.replace('T',' '))}</p><p>${esc(t.myCategory || '其他')} · ${esc(t.source)}</p><p>${esc(t.counterparty || t.description || '未填说明')}</p>${t.excluded ? '<p>当前不计入统计</p>' : t.countedAmount != null ? `<p>当前实际计入 ${money(t.countedAmount)}</p>` : ''}</div>`).join('<div class="duplicate-vs">与</div>') : '<p class="empty-hint">' + (candidates.length ? '本次候选已暂不处理，可关闭后再次核对。' : '当前没有待核对的候选。') + '</p>';
  }
  el('duplicateOpen').addEventListener('click',() => { deferred = new Set(); el('duplicateMsg').textContent = ''; renderPair(); el('duplicateDialog').showModal(); });
  el('duplicateClose').addEventListener('click',() => { if (!busy) el('duplicateDialog').close(); });
  el('duplicateDialog').addEventListener('cancel',e => { if (busy) e.preventDefault(); });
  for (const [id,action] of [['duplicateConfirm','confirm'],['duplicateDismiss','dismiss']]) el(id).addEventListener('click',async () => {
    if (busy || !currentPair) return; setBusy(true);
    try {
      const updated = await saveReconciliation(currentPair.manual.id,currentPair.imported.id,action);
      updateTransaction(updated); refreshApp(); renderPair();
      el('duplicateMsg').textContent = action === 'confirm' ? '已确认同一笔，手动记录不计入统计，可在明细撤销。' : '已保存判断，不再提示这组候选。';
    } catch (error) { el('duplicateMsg').textContent = error.message; renderPair(); }
    finally { setBusy(false); }
  });
  el('duplicateLater').addEventListener('click',() => { if (currentPair && !busy) { deferred.add(key(currentPair)); renderPair(); } });

  el('csvTemplate').addEventListener('click',() => {
    const url = URL.createObjectURL(new Blob([GENERIC_CSV_TEMPLATE],{type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = '通用账单模板.csv'; a.click(); URL.revokeObjectURL(url);
  });
  return { load, refresh, newSnapshot, async undo(id) {
    const updated = await saveReconciliation(id,null,'undo'); updateTransaction(updated); refreshApp();
  } };
}
