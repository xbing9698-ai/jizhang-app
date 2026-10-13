import { createManualExpense, todayDate } from './manual.js';

export function newQuickEntry(now = new Date()) {
  return { amount: '', category: '其他', date: todayDate(now), text: '' };
}

// 金额由按钮输入；尾部小数点可暂存，第三位小数与重复小数点不进入草稿。
export function keypadAmount(current, key) {
  if (key === 'delete') return current.slice(0, -1);
  if (key === '.') return current.includes('.') ? current : (current || '0') + '.';
  if (!/^\d$/.test(key)) return current;
  if (current.includes('.') && current.split('.')[1].length >= 2) return current;
  return current === '0' ? key : current + key;
}

export function createQuickExpense(draft) {
  const amount = typeof draft.amount === 'string' && /^\d+\.$/.test(draft.amount)
    ? draft.amount.slice(0, -1) : draft.amount;
  return createManualExpense({ ...draft, amount });
}
