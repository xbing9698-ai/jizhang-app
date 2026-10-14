import { billingPeriodLabel, customDateRange } from './period.js';
import { summarize } from './aggregate.js';

function money(value, label) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const n = Number(text);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(n) || !Number.isSafeInteger(Math.round(n * 100)))
    throw new Error(`${label}须为非负金额，最多两位小数`);
  return n;
}

export function createSnapshot(input, existing = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') || !billingPeriodLabel(input.date))
    throw new Error('请选择有效快照日期');
  const totalAssets = money(input.totalAssets, '总资产');
  const totalLiabilities = money(input.totalLiabilities, '总负债');
  return {
    id:existing?.id || `snapshot:${crypto.randomUUID()}`, date:input.date,
    totalAssets, totalLiabilities,
    netAssets:(Math.round(totalAssets * 100) - Math.round(totalLiabilities * 100)) / 100,
    note:String(input.note ?? '').trim(), createdAt:existing?.createdAt || new Date().toISOString()
  };
}

export function sortSnapshots(snapshots) {
  return snapshots.slice().sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function reconcileBalance(opening, closing, transactions, range) {
  if (!opening || !closing || opening.id === closing.id) throw new Error('请选择不同的期初和期末快照');
  if (opening.date > closing.date) throw new Error('期初快照日期不能晚于期末');
  customDateRange(range?.start, range?.end);
  const { totalIncome:income, totalExpense:expense } = summarize(transactions, range);
  const theoretical = (Math.round(opening.netAssets * 100) + Math.round(income * 100) - Math.round(expense * 100)) / 100;
  return { opening:opening.netAssets, income, expense, theoretical, actual:closing.netAssets,
    difference:(Math.round(closing.netAssets * 100) - Math.round(theoretical * 100)) / 100 };
}
