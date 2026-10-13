import { CATEGORIES } from './classify.js';
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
