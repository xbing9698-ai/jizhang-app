// 账期以结束月命名：YYYY-MM = 上月 15 日至本月 14 日。
function shiftMonth(label, offset) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(label)) throw new Error('无效的账期结束月');
  const [year, month] = label.split('-').map(Number);
  const index = year * 12 + month - 1 + offset;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
}

export function billingPeriodRange(endingMonth) {
  const previousMonth = shiftMonth(endingMonth, -1);
  return { start: `${previousMonth}-15`, end: `${endingMonth}-14`, label: endingMonth };
}

// 14 日尚未完整结束；15 日零点起，本月结束的账期才成为最近完整账期。
// 默认以设备本地日期判断，与导入的本地账单日期一致。
export function latestCompletedPeriod(now = new Date()) {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return billingPeriodRange(shiftMonth(month, now.getDate() >= 15 ? 0 : -1));
}

export function prevPeriodRange(range) {
  if (!range?.end || range.mode === 'custom' || range.mode === 'all') return null;
  const expected = billingPeriodRange(range.end.slice(0, 7));
  if (range.start !== expected.start || range.end !== expected.end) return null;
  return billingPeriodRange(shiftMonth(range.end.slice(0, 7), -1));
}

export function currentBillingPeriod(now = new Date()) {
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return billingPeriodRange(billingPeriodLabel(date));
}

export function customDateRange(start, end) {
  if (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !billingPeriodLabel(start))
    throw new Error('请选择有效的开始日期');
  if (typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !billingPeriodLabel(end))
    throw new Error('请选择有效的结束日期');
  if (start > end) throw new Error('开始日期不能晚于结束日期');
  return { start, end, label:'自定义', mode:'custom' };
}

export function allTimeRange() {
  return { start:null, end:null, label:'全部', mode:'all' };
}

export function rangeText(range) {
  if (!range?.start) return '全部时间';
  return `${range.start.replaceAll('-', '.')} — ${range.end.replaceAll('-', '.')}`;
}

// 直接使用账单本地日期，避免把交易时间转成 UTC 后跨日。
export function billingPeriodLabel(datetime) {
  const date = String(datetime ?? '').slice(0, 10);
  const match = date.match(/^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/);
  if (!match) return '';
  const [, year, month, day] = match;
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  if (Number(day) < 1 || Number(day) > lastDay) return '';
  return shiftMonth(`${year}-${month}`, Number(day) >= 15 ? 1 : 0);
}

// 含首尾两天：15 日 00:00:00 起至 14 日 23:59:59（及毫秒）均按日期归属。
// 不改写交易；无范围表示全部时间。
export function filterTransactionsByRange(transactions, range) {
  if (!range?.start && !range?.end) return transactions.slice();
  return transactions.filter(t => {
    const date = String(t.datetime ?? '').slice(0, 10);
    return date && (!range.start || date >= range.start) && (!range.end || date <= range.end);
  });
}
