import { isCountableExpense } from './dedup.js';

export function isValidCountedAmount(value, originalAmount) {
  return typeof originalAmount === 'number' && Number.isFinite(originalAmount) &&
    typeof value === 'number' && Number.isFinite(value) && value > 0 &&
    value <= originalAmount && /^\d+(?:\.\d{1,2})?$/.test(String(value)) &&
    Number.isSafeInteger(Math.round(value * 100));
}

// 所有支出计算的唯一金额入口；旧记录没有新增字段时仍使用原金额。
export function countedExpenseAmount(t) {
  if (!isCountableExpense(t)) return 0;
  return isValidCountedAmount(t.countedAmount, t.amount) ? t.countedAmount : t.amount;
}

export function canAdjustTransaction(t) {
  return t?.direction === '支出' && ['微信', '支付宝'].includes(t.source);
}

export function reviewReason(t) {
  if (!canAdjustTransaction(t) || t.status === '交易关闭') return '';
  const status = String(t.status ?? '').trim();
  return status.includes('退款') ? status : '';
}

export function needsReview(t) {
  return !!reviewReason(t) && t.reviewed !== true;
}

export function filterNeedsReview(transactions) {
  return transactions.filter(needsReview);
}

// 返回新对象，只改变统计选择；原始金额、状态、来源及其他信息全部保留。
export function adjustTransaction(t, action, input) {
  if (!canAdjustTransaction(t)) throw new Error('只能调整微信或支付宝导入的支出');
  let excluded = false, countedAmount = null;
  if (action === 'exclude') excluded = true;
  else if (action === 'amount') {
    const text = typeof input === 'number' || typeof input === 'string' ? String(input).trim() : '';
    const value = Number(text);
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text) || !isValidCountedAmount(value, t.amount))
      throw new Error('计入金额须大于0、不超过原始金额，且最多两位小数；0元请选择不计入统计');
    countedAmount = value;
  } else if (action !== 'include') throw new Error('未知处理动作');
  return { ...t, excluded, countedAmount, reviewed: true };
}
