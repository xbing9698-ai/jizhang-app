import { businessOrderKey, stableSerialize, transactionIdentity } from './identity.js';

export function mergeTransactions(existing, incoming) {
  const seen = new Set(existing.map(t => t.id));
  const seenOrders = new Set(existing.map(businessOrderKey).filter(Boolean));
  // 防御无 id 的直接调用：以完整批次内容和行序号保留每一行，不按时间/金额合并。
  const batchIdentity = incoming.some(t => !t.id) ? stableSerialize(incoming) : '';
  let added = 0, skipped = 0;
  const merged = existing.slice();
  for (const [rowIndex, original] of incoming.entries()) {
    const t = original.id ? original : {
      ...original,
      ...transactionIdentity(original.source || '', original.externalOrderId,
        batchIdentity, { rowIndex })
    };
    const orderKey = businessOrderKey(t);
    if (seen.has(t.id) || (orderKey && seenOrders.has(orderKey))) { skipped++; continue; }
    if (orderKey) seenOrders.add(orderKey);
    seen.add(t.id); merged.push(t); added++;
  }
  return { merged, added, skipped };
}

export function isCountableExpense(t) {
  return t.direction === '支出' && t.status !== '交易关闭';
}
