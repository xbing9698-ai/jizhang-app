import { transactionIdentity } from './identity.js';

function mapDirection(raw) {
  raw = String(raw ?? '').trim();
  if (raw === '支出') return '支出';
  if (raw === '收入') return '收入';
  return '中性'; // 不计收支 / 中性交易
}

function toIso(v) {
  if (v instanceof Date) {
    // Excel 浮点日期经 SheetJS 转换可能落在整数秒前 1ms，按账单秒精度还原。
    v = new Date(Math.round(v.getTime() / 1000) * 1000);
    const p = n => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth()+1)}-${p(v.getDate())}` +
           `T${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  return String(v).trim().replace(' ', 'T');
}

export function normalizeAlipay(r, context = {}) {
  const ledger = Object.hasOwn(r, '记录时间');
  return {
    ...transactionIdentity('支付宝', ledger ? '' : r['交易订单号'], r, context),
    source: '支付宝',
    datetime: toIso(r[ledger ? '记录时间' : '交易时间']),
    amount: parseFloat(r['金额']) || 0,
    direction: mapDirection(r[ledger ? '收支类型' : '收/支']),
    counterparty: ledger ? '' : (r['交易对方'] || ''),
    description: r[ledger ? '备注' : '商品说明'] || '',
    rawCategory: r[ledger ? '分类' : '交易分类'] || '',
    myCategory: '',
    status: r['交易状态'] || '',
    payMethod: r[ledger ? '账户' : '收/付方式'] || '',
    sourceDetail: r['来源'] || '',
    tags: r['标签'] || '',
    note: r['备注'] || ''
  };
}

export function normalizeWechat(r, context = {}) {
  return {
    ...transactionIdentity('微信', r['交易单号'], r, context),
    source: '微信',
    datetime: toIso(r['交易时间']),
    amount: parseFloat(r['金额(元)']) || 0,
    direction: mapDirection(r['收/支']),
    counterparty: r['交易对方'] || '',
    description: r['商品'] || '',
    rawCategory: r['交易类型'] || '',
    myCategory: '',
    status: r['当前状态'] || '',
    payMethod: r['支付方式'] || '',
    note: r['备注'] || ''
  };
}
