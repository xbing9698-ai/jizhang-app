import { CATEGORIES, INCOME_CATEGORIES } from './classify.js';
import { billingPeriodLabel } from './period.js';

export function todayDate(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isManualTransaction(t) {
  return t?.source === '手动';
}

export function createManualExpense({ date, amount, category, text = '' }) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !billingPeriodLabel(date))
    throw new Error('请选择有效日期');
  const amountText = typeof amount === 'number' || typeof amount === 'string' ? String(amount).trim() : '';
  const value = Number(amountText);
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(amountText) ||
      !Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(Math.round(value * 100)))
    throw new Error('金额须大于0，且最多两位小数');
  if (!CATEGORIES.includes(category)) throw new Error('请选择现有分类');
  const description = String(text ?? '').trim();
  return {
    id: `manual:${crypto.randomUUID()}`,
    externalOrderId: '',
    source: '手动',
    datetime: `${date}T00:00:00`,
    amount: value,
    direction: '支出',
    counterparty: description,
    description,
    rawCategory: '',
    myCategory: category,
    manual: true,
    status: '手动补录'
  };
}

// 共用原有日期、金额、UUID与手动记录结构；收入只使用独立的最小分类组。
export function createManualIncome(input) {
  if (!INCOME_CATEGORIES.includes(input.category)) throw new Error('请选择现有收入分类');
  const record = createManualExpense({ ...input, category:'其他' });
  return { ...record, direction:'收入', rawCategory:input.category,
    myCategory:input.category, status:'手动记账' };
}
