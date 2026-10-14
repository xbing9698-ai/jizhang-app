import { billingPeriodLabel } from './period.js';
import { transactionIdentity } from './identity.js';

export const GENERIC_HEADERS = ['日期','金额','收支','分类','说明','来源','外部ID'];
export const GENERIC_CSV_TEMPLATE = '\uFEFF' + GENERIC_HEADERS.join(',') + '\r\n';

// 标准表头位于第一行；不猜测平台字段，也不忽略非法数据行。
export function isGenericCsv(text) {
  const header = Papa.parse(text.replace(/^\uFEFF/, ''), { preview:1 }).data[0] || [];
  return ['日期','金额','收支','来源'].every(h => header.map(v => v.trim()).includes(h));
}

export function parseGenericCsv(text, context = {}) {
  const parsed = Papa.parse(text.replace(/^\uFEFF/, ''), {
    header:true, skipEmptyLines:'greedy', transformHeader:h => h.trim()
  });
  if (parsed.errors.length) throw new Error('通用 CSV 格式错误：' + parsed.errors[0].message);
  if (!['日期','金额','收支','来源'].every(h => parsed.meta.fields?.includes(h)))
    throw new Error('通用 CSV 缺少日期、金额、收支或来源表头');
  return parsed.data.map((row, rowIndex) => {
    const read = key => String(row[key] ?? '').trim();
    const fail = message => { throw new Error(`通用 CSV 第 ${rowIndex + 2} 行：${message}`); };
    const date = read('日期');
    const match = date.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match || !billingPeriodLabel(match[1]) || Number(match[2] || 0) > 23 ||
        Number(match[3] || 0) > 59 || Number(match[4] || 0) > 59) fail('日期无效');
    const textAmount = read('金额'), amount = Number(textAmount);
    if (!/^\d+(?:\.\d{1,2})?$/.test(textAmount) || amount <= 0 ||
        !Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))) fail('金额须大于0，最多两位小数');
    const direction = read('收支'), source = read('来源');
    if (!['支出','收入'].includes(direction)) fail('收支只能为支出或收入');
    if (!source || source === '手动') fail('来源必填，且不能使用保留来源“手动”');
    const category = read('分类');
    return {
      ...transactionIdentity(source, read('外部ID'), row, { ...context, rowIndex }),
      source, datetime:`${match[1]}T${match[2] || '00'}:${match[3] || '00'}:${match[4] || '00'}`,
      amount, direction, rawCategory:category, myCategory:category,
      ...(category ? { manual:true } : {}),
      counterparty:'', description:read('说明'), status:'', importFormat:'generic-csv'
    };
  });
}
