import { billingPeriodLabel } from './period.js';

export function isReconciledDuplicate(t) {
  return t?.source === '手动' && typeof t.reconciledDuplicateOf === 'string' && !!t.reconciledDuplicateOf;
}

function day(t) {
  const date = String(t.datetime ?? '').slice(0,10);
  return billingPeriodLabel(date) ? Date.parse(date + 'T00:00:00Z') / 86400000 : NaN;
}

export function isCandidatePair(manual, imported) {
  const cents = t => typeof t?.amount === 'number' && t.amount > 0 && Number.isFinite(t.amount) &&
    Number.isSafeInteger(Math.round(t.amount * 100)) && Math.abs(t.amount * 100 - Math.round(t.amount * 100)) < 0.000001;
  return !!manual?.id && !!imported?.id && manual.source === '手动' && !!imported.source && imported.source !== '手动' &&
    ['支出','收入'].includes(manual.direction) && manual.direction === imported.direction &&
    cents(manual) && cents(imported) && Math.round(manual.amount * 100) === Math.round(imported.amount * 100) &&
    Math.abs(day(manual) - day(imported)) <= 1;
}

export function reconciliationCandidates(transactions) {
  const matched = new Set(transactions.filter(isReconciledDuplicate).map(t => t.reconciledDuplicateOf));
  const imports = transactions.filter(t => t.source !== '手动' && !matched.has(t.id));
  const pairs = [];
  for (const manual of transactions.filter(t => t.source === '手动' && !isReconciledDuplicate(t)))
    for (const imported of imports)
      if (isCandidatePair(manual, imported) && !manual.reconciliationDismissedIds?.includes(imported.id))
        pairs.push({ manual, imported });
  return pairs.sort((a,b) => Math.abs(day(a.manual)-day(a.imported)) - Math.abs(day(b.manual)-day(b.imported)) ||
    String(b.imported.datetime).localeCompare(String(a.imported.datetime)));
}

// 所有匹配在存储事务中基于最新记录判定，不自动修改退款字段或正式记录。
export function reconcileTransaction(transactions, manualId, importedId, action) {
  const manual = transactions.find(t => t.id === manualId);
  if (!manual || manual.source !== '手动') throw new Error('只能核对手动记录');
  if (action === 'undo') {
    const copy = { ...manual };
    delete copy.reconciledDuplicateOf;
    return copy;
  }
  const imported = transactions.find(t => t.id === importedId);
  if (!isCandidatePair(manual, imported)) throw new Error('两笔记录不符合核对条件');
  if (isReconciledDuplicate(manual) || transactions.some(t => isReconciledDuplicate(t) && t.reconciledDuplicateOf === importedId))
    throw new Error('记录已核对，请先撤销，不能重复匹配');
  if (action === 'confirm') return { ...manual, reconciledDuplicateOf:importedId };
  if (action === 'dismiss') return { ...manual,
    reconciliationDismissedIds:[...new Set([...(manual.reconciliationDismissedIds || []), importedId])] };
  throw new Error('无效核对操作');
}
