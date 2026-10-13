import { test } from 'node:test';
import assert from 'node:assert';
const { stripAlipayHeader, cleanRow, parseAlipayCsv } = await import('../js/parse-alipay.js');
import { ALIPAY_CSV_TEXT, ALIPAY_LEDGER_CSV_TEXT } from './fixtures.js';
import { installVendors } from './vendor-helpers.js';

installVendors();

test('定位表头行：丢弃前面的说明行，返回以表头开头的文本', () => {
  const body = stripAlipayHeader(ALIPAY_CSV_TEXT);
  assert.ok(body.startsWith('交易时间,交易分类'));
});

test('找不到表头时抛错', () => {
  assert.throws(() => stripAlipayHeader('没有表头的文本'), /未找到支付宝表头行/);
});

test('cleanRow 去除键名与值的空白、订单号尾部制表符', () => {
  const r = cleanRow({ '交易订单号': 'ALI0001\t', ' 金额 ': ' 21.92 ' });
  assert.strictEqual(r['交易订单号'], 'ALI0001');
  assert.strictEqual(r['金额'], '21.92');
});

test('定位记录时间表头，跳过记账本说明行', () => {
  assert.ok(stripAlipayHeader(ALIPAY_LEDGER_CSV_TEXT).startsWith('记录时间,分类'));
});

test('记账本八字段正确解析，包括带逗号的备注与标签', () => {
  const rows = parseAlipayCsv(ALIPAY_LEDGER_CSV_TEXT);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows[0], {
    '记录时间': '2026-05-30 20:17:08', '分类': '餐饮', '收支类型': '支出',
    '金额': '21.92', '备注': '午餐,套餐', '账户': '余额', '来源': '手动记账', '标签': '工作,午餐'
  });
});

test('记账本首行表头、带引号表头、BOM与空白均可解析', () => {
  const body = stripAlipayHeader(ALIPAY_LEDGER_CSV_TEXT);
  const quoted = '\uFEFF' + body.replace('记录时间,分类,收支类型,金额,备注,账户,来源,标签',
    '"记录时间"," 分类 ","收支类型","金额","备注","账户","来源","标签"');
  assert.deepStrictEqual(parseAlipayCsv(quoted), parseAlipayCsv(body));
});

test('说明中的记录时间文字不会被误认为真正表头', () => {
  const text = '记录时间表示记账时间\n' + ALIPAY_LEDGER_CSV_TEXT;
  assert.strictEqual(parseAlipayCsv(text).length, 3);
});

test('旧支付宝交易流水仍可完整解析', () => {
  const rows = parseAlipayCsv(ALIPAY_CSV_TEXT);
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows[0]['交易订单号'], 'ALI0001');
  assert.strictEqual(rows[0]['交易对方'], '测试商户A');
  assert.strictEqual(rows[0]['金额'], '21.92');
});

test('空行、汇总及尾部说明不产生记账记录，备注内换行仍保留', () => {
  const text = ALIPAY_LEDGER_CSV_TEXT.replace('收入备注', '"收入备注\n第二行"') +
    '\r\n,,,,,,,\r\n合计,3笔\r\n说明：导出结束';
  const rows = parseAlipayCsv(text);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[1]['备注'], '收入备注\n第二行');
});
