import { createSnapshot, snapshotTimeNow } from './snapshots.js';
import { loadAssetLedger, saveAssetLedger, saveSnapshot } from './storage.js';
import {
  emptyLedger, addAccount, updateAccount, removeAccount, calculateLedgerTotals,
  hasLedgerAccounts, accountTypeLabel
} from './asset-ledger.js';
import { todayDate } from './manual.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const money = n => '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits:2, maximumFractionDigits:2 });

// 资产总账 = 当前状态。保存总账与记录快照是两个独立动作：
// 改余额只写总账，快照只在用户点击"记录当前为资产快照"时生成。
export function setupAssetLedgerUI({ refreshApp, refreshSnapshots, getTransactions = () => [] }) {
  const el = id => document.getElementById(id);
  let ledger = emptyLedger();
  let editingId = null, pendingDeleteId = null, busy = false;

  const setBusy = value => {
    busy = value;
    ['accountSave','accountCancel','accountDeleteConfirm','accountDeleteCancel','snapshotFromLedgerSave','snapshotFromLedgerClose']
      .forEach(id => { if (el(id)) el(id).disabled = value; });
  };

  function renderHome() {
    const section = el('assetCurrent');
    const has = hasLedgerAccounts(ledger);
    el('assetCurrentEmpty').hidden = has;
    el('assetCurrentBody').hidden = !has;
    el('assetLedgerOpen').hidden = !has;
    if (!has) return;
    const totals = calculateLedgerTotals(ledger.accounts);
    el('assetNet').textContent = money(totals.netAssets);
    el('assetTotal').textContent = money(totals.totalAssets);
    el('assetLiability').textContent = money(totals.totalLiabilities);
    el('assetUpdated').textContent = ledger.updatedAt
      ? `更新于 ${ledger.updatedAt.slice(0, 10)} · ${ledger.accounts.length} 个账户`
      : `${ledger.accounts.length} 个账户`;
  }

  function renderSummary() {
    const totals = calculateLedgerTotals(ledger.accounts);
    el('ledgerNet').textContent = money(totals.netAssets);
    el('ledgerTotal').textContent = money(totals.totalAssets);
    el('ledgerLiability').textContent = money(totals.totalLiabilities);
  }

  function rowHtml(account) {
    return '<div class="account-row"><span class="account-main">' +
      '<span class="account-name">' + esc(account.name) + '</span>' +
      '<span class="account-meta">' + esc(accountTypeLabel(account.type)) +
      (account.note ? ' · ' + esc(account.note) : '') + '</span></span>' +
      '<span class="account-balance">' + money(account.balance) + '</span>' +
      '<span class="btn-row account-actions">' +
      '<button type="button" class="text-button" data-edit="' + esc(account.id) + '">编辑</button>' +
      '<button type="button" class="text-button" data-delete="' + esc(account.id) + '">删除</button>' +
      '</span></div>';
  }

  function renderLedger() {
    renderSummary();
    el('accountList').innerHTML = ledger.accounts.length
      ? ledger.accounts.map(rowHtml).join('')
      : '<p class="empty-hint">还没有建立资产总账，先添加一个账户。</p>';
    el('snapshotFromLedger').disabled = !ledger.accounts.length;
  }

  function cancelAccountDelete() { pendingDeleteId = null; el('accountDeletePrompt').hidden = true; }

  function openLedger() {
    cancelAccountDelete();
    el('accountMsg').textContent = '';
    renderLedger();
    el('assetLedgerDialog').showModal();
  }

  function editAccount(id = null) {
    cancelAccountDelete();
    editingId = id;
    const account = ledger.accounts.find(a => a.id === id);
    el('accountEditTitle').textContent = account ? '编辑账户' : '添加账户';
    el('accountName').value = account?.name || '';
    el('accountType').value = account?.type || 'asset';
    el('accountBalance').value = account ? String(account.balance) : '';
    el('accountNote').value = account?.note || '';
    el('accountEditMsg').textContent = '';
    el('accountEditDialog').showModal();
  }

  el('assetLedgerOpen').addEventListener('click', openLedger);
  el('assetLedgerOpenEmpty').addEventListener('click', openLedger);
  el('assetLedgerClose').addEventListener('click', () => { if (!busy) el('assetLedgerDialog').close(); });

  el('accountAdd').addEventListener('click', () => editAccount());
  el('accountList').addEventListener('click', e => {
    if (busy) return;
    const edit = e.target.closest('[data-edit]'), remove = e.target.closest('[data-delete]');
    if (edit) editAccount(edit.dataset.edit);
    if (remove) {
      const selected = ledger.accounts.find(a => a.id === remove.dataset.delete);
      if (!selected) return;
      pendingDeleteId = selected.id;
      el('accountDeleteLabel').textContent = `删除账户「${selected.name}」（${accountTypeLabel(selected.type)} ${money(selected.balance)}）？已保存的资产快照不受影响。`;
      el('accountDeletePrompt').hidden = false;
      el('accountDeletePrompt').scrollIntoView({ block:'nearest' });
    }
  });
  el('accountDeleteCancel').addEventListener('click', cancelAccountDelete);
  el('accountDeleteConfirm').addEventListener('click', async () => {
    if (busy || !pendingDeleteId) return;
    setBusy(true);
    try {
      ledger = removeAccount(ledger, pendingDeleteId);
      await saveAssetLedger(ledger);
      await load(); refreshApp();
      el('accountMsg').textContent = '账户已删除。';
    } catch (error) { el('accountMsg').textContent = error.message; }
    finally { cancelAccountDelete(); setBusy(false); }
  });

  el('accountEditClose').addEventListener('click', () => { if (!busy) el('accountEditDialog').close(); });
  el('accountCancel').addEventListener('click', () => { if (!busy) el('accountEditDialog').close(); });
  el('accountEditDialog').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  el('accountForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const input = { name:el('accountName').value, type:el('accountType').value,
      balance:el('accountBalance').value, note:el('accountNote').value };
    try {
      ledger = editingId ? updateAccount(ledger, editingId, input) : addAccount(ledger, input);
      await saveAssetLedger(ledger);
      await load(); refreshApp();
      el('accountEditDialog').close();
      el('accountMsg').textContent = editingId ? '账户已更新。' : '账户已添加。';
    } catch (error) { el('accountEditMsg').textContent = error.message; }
    finally { setBusy(false); }
  });

  // 记录快照：日期由用户选择（默认今天），金额一律由总账自动算出。
  function openSnapshotFromLedger() {
    const totals = calculateLedgerTotals(ledger.accounts);
    el('ledgerSnapshotDate').value = todayDate();
    el('ledgerSnapshotTime').value = snapshotTimeNow();
    el('ledgerSnapshotTotal').textContent = money(totals.totalAssets);
    el('ledgerSnapshotLiability').textContent = money(totals.totalLiabilities);
    el('ledgerSnapshotNet').textContent = money(totals.netAssets);
    el('ledgerSnapshotMsg').textContent = '';
    el('ledgerSnapshotDialog').showModal();
  }
  el('snapshotFromLedger').addEventListener('click', openSnapshotFromLedger);
  el('snapshotFromLedgerClose').addEventListener('click', () => { if (!busy) el('ledgerSnapshotDialog').close(); });
  el('ledgerSnapshotDialog').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  el('ledgerSnapshotForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await recordLedgerSnapshot(el('ledgerSnapshotDate').value, el('ledgerSnapshotTime').value);
      el('ledgerSnapshotDialog').close();
      el('accountMsg').textContent = '已按当前总账记录资产快照。';
    } catch (error) { el('ledgerSnapshotMsg').textContent = error.message; }
    finally { setBusy(false); }
  });

  // 用资产总账的自动合计生成一条资产快照；用户只需要日期。
  async function recordLedgerSnapshot(date, time = snapshotTimeNow()) {
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

  async function load() {
    ledger = await loadAssetLedger();
    cancelAccountDelete();
    renderHome();
    renderLedger();
  }

  return { load, openLedger, openSnapshotFromLedger, recordLedgerSnapshot, getLedger:() => ledger };
}
