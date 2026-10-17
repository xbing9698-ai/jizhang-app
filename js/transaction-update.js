import { CATEGORIES, INCOME_CATEGORIES } from './classify.js';
import { billingPeriodLabel } from './period.js';

const money = value => {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  const n = Number(text);
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text) || !Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(Math.round(n * 100)))
    throw new Error('金额须大于0，且最多两位小数');
  return n;
};

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !billingPeriodLabel(date))
    throw new Error('请选择有效日期');
  return date;
}

function categoriesFor(direction) {
  return direction === '收入' ? INCOME_CATEGORIES : CATEGORIES;
}

export function editAffectsReconciliation(before, after) {
  return before?.direction !== after?.direction || before?.amount !== after?.amount ||
    String(before?.datetime ?? '').slice(0, 10) !== String(after?.datetime ?? '').slice(0, 10);
}

export function updateTransactionFields(record, input) {
  if (!record?.id) throw new Error('记录不存在');
  const date = validDate(input.date);
  const direction = String(input.direction || '');
  if (!['支出','收入','中性'].includes(direction)) throw new Error('请选择有效收支类型');
  const amount = money(input.amount);
  const choices = categoriesFor(direction);
  const category = String(input.category || '').trim();
  if (!choices.includes(category)) throw new Error('请选择合法分类');
  const description = String(input.description ?? '').trim();
  const oldDatetime = String(record.datetime || '');
  const time = /^\d{4}-\d{2}-\d{2}(T.*)$/.exec(oldDatetime)?.[1] || 'T00:00:00';
  const updated = {
    ...record,
    datetime: date + time,
    amount,
    direction,
    description,
    myCategory: category,
    manual: true,
    userEdited: true,
    editedAt: new Date().toISOString()
  };
  // 手动记账没有独立“商户”编辑框；其内部对方字段继续与说明同步。
  if (record.source === '手动') updated.counterparty = description;
  // 导入记录的 counterparty/source/id/externalOrderId 均由展开保留，不能被用户编辑覆盖。
  if (direction !== '支出') {
    delete updated.countedAmount;
    delete updated.excluded;
    delete updated.reviewed;
  }
  return updated;
}
