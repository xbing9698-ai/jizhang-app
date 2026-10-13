import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileToTransactions } from '../js/import-transactions.js';
import { fingerprintFile } from '../js/identity.js';
import { mergeTransactions } from '../js/dedup.js';
import { resolveCategory } from '../js/classify.js';
import { summarize } from '../js/aggregate.js';
import { ALIPAY_CSV_TEXT, ALIPAY_LEDGER_CSV_TEXT, WECHAT_ROWS } from './fixtures.js';
import { installVendors } from './vendor-helpers.js';

installVendors();
const csvFile = (text = ALIPAY_LEDGER_CSV_TEXT, name = '记账本.csv') => new File([text], name);
const importCsv = (text, name) => fileToTransactions(csvFile(text, name));

test('文件指纹是标准SHA-256，与Node实现一致', async () => {
  const buffer = await csvFile().arrayBuffer();
  assert.equal(await fingerprintFile(buffer), createHash('sha256').update(new Uint8Array(buffer)).digest('hex'));
});

test('完整记账本导入无订单号记录不丢弃，内部ID可重复计算', async () => {
  const first = await importCsv();
  const second = await importCsv();
  assert.equal(first.length, 3);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(t => t.id)).size, 3);
  assert.ok(first.every(t => t.id && t.externalOrderId === ''));
  assert.match(first[0].importFileFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first[0].importRowIndex, 0);
});

test('同一记账本文件再次导入及改名导入可靠跳过', async () => {
  const first = mergeTransactions([], await importCsv());
  const second = mergeTransactions(first.merged, await importCsv(undefined, '改名.CSV'));
  assert.equal(first.added, 3);
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 3);
  assert.equal(second.merged.length, 3);
});

test('不同文件仅时间金额相同不去重，连相同行也不跨文件推测', async () => {
  const first = await importCsv();
  const other = await importCsv(ALIPAY_LEDGER_CSV_TEXT.replace('说明：以下为测试记录', '说明：另一份导出'));
  assert.equal(first[0].datetime, other[0].datetime);
  assert.equal(first[0].amount, other[0].amount);
  assert.notEqual(first[0].id, other[0].id);
  const result = mergeTransactions(first, other);
  assert.equal(result.added, 3);
  assert.equal(result.skipped, 0);
});

test('同文件完全相同两行都保留，再次导入分别跳过', async () => {
  const lines = ALIPAY_LEDGER_CSV_TEXT.split('\r\n');
  const text = [...lines.slice(0, 4), lines[4], lines[4]].join('\r\n');
  const rows = await importCsv(text);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  const result = mergeTransactions(rows, await importCsv(text));
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 2);
});

test('一次选择两份相同文件也只新增一份', async () => {
  const result = mergeTransactions([], [...await importCsv(), ...await importCsv()]);
  assert.equal(result.added, 3);
  assert.equal(result.skipped, 3);
});

test('旧支付宝流水完整路径与跨文件订单去重继续正常', async () => {
  const first = await importCsv(ALIPAY_CSV_TEXT);
  assert.equal(first.length, 4);
  assert.equal(first[0].externalOrderId, 'ALI0001');
  assert.equal(first[0].counterparty, '测试商户A');
  const result = mergeTransactions(first, await importCsv('另一份说明\n' + ALIPAY_CSV_TEXT));
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 4);
});

test('旧支付宝流水无订单号也保留，空号及占位符不当成业务订单', async () => {
  for (const replacement of ['', '/', '-']) {
    const text = ALIPAY_CSV_TEXT.replace('ALI0001\t', replacement).replace('ALI0002\t', replacement);
    const rows = await importCsv(text);
    assert.equal(rows.length, 4);
    assert.equal(rows[0].externalOrderId, '');
    assert.notEqual(rows[0].id, rows[1].id);
    assert.equal(mergeTransactions([], rows).added, 4);
  }
});

test('微信真实XLSX读入、归一化和重复导入继续正常', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(WECHAT_ROWS), '账单');
  const file = new File([XLSX.write(wb, { type:'array', bookType:'xlsx' })], '微信.xlsx');
  const rows = await fileToTransactions(file);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].externalOrderId, 'WX0001');
  assert.equal(rows[0].amount, 19.6);
  assert.equal(rows[0].datetime, '2026-05-31T12:48:45');
  assert.equal(mergeTransactions(rows, await fileToTransactions(file)).skipped, 3);
});

test('微信XLSX无订单号的相同行分开存储', async () => {
  const header = WECHAT_ROWS.find(row => row[0] === '交易时间');
  const row = [...WECHAT_ROWS.at(-1)];
  row[8] = '';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, row, row]), '账单');
  const file = new File([XLSX.write(wb, { type:'array', bookType:'xlsx' })], '微信无订单号.xlsx');
  const rows = await fileToTransactions(file);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].externalOrderId, '');
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(mergeTransactions([], rows).added, 2);
});

test('新字段经JSON备份往返保留，恢复后仍可去重；旧记录缺字段可统计', async () => {
  const legacy = { id:'OLD', source:'微信', datetime:'2026-05-01T00:00:00',
    amount:10, direction:'支出', rawCategory:'', counterparty:'', description:'',
    manual:true, myCategory:'医疗健康' };
  const incoming = await importCsv();
  const backup = JSON.parse(JSON.stringify({ txns:[legacy, ...incoming], mem:{} }));
  assert.deepEqual(backup.txns[1], incoming[0]);
  assert.equal(mergeTransactions(backup.txns, incoming).skipped, 3);
  for (const t of backup.txns) t.myCategory = resolveCategory(t, backup.mem);
  const summary = summarize(backup.txns);
  assert.equal(summary.totalExpense, 31.92);
  assert.equal(summary.totalIncome, 500);
  assert.equal(summary.count, 2);
  assert.equal(backup.txns[0].id, 'OLD');
  assert.equal(backup.txns[0].myCategory, '医疗健康');
});
