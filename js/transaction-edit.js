import { transactionCategories } from './classify.js';

// 只改分类。商户记忆延续原有联动规则，手动记录始终单独修改。
export function categoryUpdatePlan(transactions, id, category) {
  const selected = transactions.find(t => t.id === id);
  if (!selected) throw new Error('记录不存在');
  if (!transactionCategories(selected).includes(category)) throw new Error('请选择合法分类');
  const cp = typeof selected.counterparty === 'string' ? selected.counterparty.trim() : '';
  const remember = selected.source !== '手动' && cp && !['/','-','（未填对方）'].includes(cp);
  const touched = transactions.filter(t => remember
    ? t.source !== '手动' && t.counterparty === selected.counterparty : t.id === id)
    .map(t => ({ ...t, myCategory:category, manual:true }));
  return { touched, memoryEntry:remember ? { counterparty:selected.counterparty, category } : null };
}
