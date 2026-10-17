import { billingPeriodLabel, customDateRange, filterTransactionsByRange } from './period.js';
import { summarize } from './aggregate.js';

function money(value, label) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const n = Number(text);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(n) || !Number.isSafeInteger(Math.round(n * 100)))
    throw new Error(`${label}须为非负金额，最多两位小数`);
  return n;
}

function normalizedTime(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const m = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!m) throw new Error('请选择有效快照时间');
  return `${m[1]}:${m[2]}:${m[3] || '00'}`;
}

export function snapshotTimeNow(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function normalizedCapturedAt(value) {
  const text = String(value ?? '').trim();
  const m = text.match(/^(\d{4}-\d{2}-\d{2})T([0-2]\d:[0-5]\d(?::[0-5]\d)?)$/);
  if (!m || !billingPeriodLabel(m[1])) return '';
  return `${m[1]}T${normalizedTime(m[2])}`;
}

export function createSnapshot(input, existing = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') || !billingPeriodLabel(input.date))
    throw new Error('请选择有效快照日期');
  const totalAssets = money(input.totalAssets, '总资产');
  const totalLiabilities = money(input.totalLiabilities, '总负债');
  const explicitCapturedAt = normalizedCapturedAt(input.capturedAt);
  const explicitTime = input.time == null ? '' : normalizedTime(input.time);
  const capturedAt = explicitCapturedAt || (explicitTime ? `${input.date}T${explicitTime}` :
    (existing?.capturedAt ? `${input.date}T${existing.capturedAt.slice(11)}` : ''));
  if (capturedAt && capturedAt.slice(0,10) !== input.date) throw new Error('快照日期与时间不一致');
  const sameMoment = !!existing && existing.date === input.date && (existing.capturedAt || '') === capturedAt;
  let transactionIdsAtCapture;
  // 改动时点后旧水印失效，不能把原时点的“已包含”判断带到新时点。
  if ((!existing || sameMoment) && Array.isArray(input.transactionIdsAtCapture)) transactionIdsAtCapture = [...new Set(input.transactionIdsAtCapture.filter(id => typeof id === 'string' && id))];
  else if (sameMoment && Array.isArray(existing?.transactionIdsAtCapture)) transactionIdsAtCapture = existing.transactionIdsAtCapture.slice();
  const snapshot = {
    id:existing?.id || `snapshot:${crypto.randomUUID()}`, date:input.date,
    totalAssets, totalLiabilities,
    netAssets:(Math.round(totalAssets * 100) - Math.round(totalLiabilities * 100)) / 100,
    note:String(input.note ?? '').trim(), createdAt:existing?.createdAt || input.createdAt || new Date().toISOString()
  };
  if (capturedAt) snapshot.capturedAt = capturedAt;
  if (transactionIdsAtCapture) snapshot.transactionIdsAtCapture = transactionIdsAtCapture;
  return snapshot;
}

export function snapshotMoment(snapshot) {
  return snapshot?.capturedAt || (snapshot?.date ? `${snapshot.date}T23:59:59` : '');
}

export function formatSnapshotMoment(snapshot) {
  if (!snapshot?.date) return '';
  return snapshot.capturedAt ? `${snapshot.date} ${snapshot.capturedAt.slice(11)}` : `${snapshot.date}（旧快照）`;
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
  const match = text.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::(\d{2}))?/);
  const time = match ? `${match[1]}:${match[2]}:${match[3] || '00'}` : '';
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
    const moment = `${date}T${time}`;
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
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function notFuture(transaction, now = new Date()) {
  const { date, time, meaningfulTime } = transactionParts(transaction);
  const current = localNowString(now);
  if (!billingPeriodLabel(date)) return false;
  if (date < current.slice(0,10)) return true;
  if (date > current.slice(0,10)) return false;
  return !meaningfulTime || `${date}T${time}` <= current;
}

export function summarizeSnapshotChanges(opening, transactions, range = null, closing = null) {
  let uncertainCount = 0;
  const changes = filterTransactionsByRange(transactions || [], range).filter(t => {
    const afterOpening = relationToSnapshot(opening, t);
    const beforeClosing = closing ? relationToSnapshot(closing, t) : null;
    if (!afterOpening.uncertain && afterOpening.relation <= 0) return false;
    if (beforeClosing && !beforeClosing.uncertain && beforeClosing.relation > 0) return false;
    // 临时排除的流水也必须提示不确定，不能只统计被纳入公式的流水。
    if (afterOpening.uncertain || beforeClosing?.uncertain) uncertainCount++;
    return afterOpening.relation > 0 && (!beforeClosing || beforeClosing.relation <= 0);
  });
  return { ...summarize(changes, null), uncertainCount };
}

export function referenceFromSnapshot(snapshot, transactions, now = new Date()) {
  if (!snapshot) return null;
  const summary = summarizeSnapshotChanges(snapshot, (transactions || []).filter(t => notFuture(t, now)));
  const delta = Math.round((summary.totalIncome - summary.totalExpense) * 100) / 100;
  return {
    snapshotNetAssets:snapshot.netAssets,
    income:summary.totalIncome,
    expense:summary.totalExpense,
    delta,
    referenceNetAssets:(Math.round(snapshot.netAssets * 100) + Math.round(delta * 100)) / 100,
    uncertainCount:summary.uncertainCount
  };
}

export function reconcileBalance(opening, closing, transactions, range) {
  if (!opening || !closing || opening.id === closing.id) throw new Error('请选择不同的期初和期末快照');
  if (snapshotMoment(opening) > snapshotMoment(closing)) throw new Error('期初快照时间不能晚于期末');
  customDateRange(range?.start, range?.end);
  const { totalIncome:income, totalExpense:expense, uncertainCount } = summarizeSnapshotChanges(opening, transactions, range, closing);
  const theoretical = (Math.round(opening.netAssets * 100) + Math.round(income * 100) - Math.round(expense * 100)) / 100;
  return { opening:opening.netAssets, income, expense, theoretical, actual:closing.netAssets, uncertainCount,
    difference:(Math.round(closing.netAssets * 100) - Math.round(theoretical * 100)) / 100 };
}
