import test from 'node:test';
import assert from 'node:assert/strict';
import { newQuickEntry, keypadAmount, createQuickExpense } from '../js/quick-entry.js';
import { createManualExpense } from '../js/manual.js';
import { CATEGORIES, resolveCategory } from '../js/classify.js';
import { billingPeriodLabel, billingPeriodRange, filterTransactionsByRange } from '../js/period.js';
import { summarize, matchesSearch, filterTransactionsBySource } from '../js/aggregate.js';

const type = keys => [...keys].reduce(keypadAmount, '');
const draft = overrides => ({ ...newQuickEntry(new Date(2026, 9, 14)), amount: '28.50', category: '餐饮', text: '测试午餐', ...overrides });

test('快速面板默认本地今天、空金额、其他分类和可选空说明', () => {
  assert.deepEqual(newQuickEntry(new Date(2026, 0, 1, 0, 5)), { date:'2026-01-01', amount:'', category:'其他', text:'' });
  assert.deepEqual(newQuickEntry(new Date(2026, 9, 14, 23, 59)), { date:'2026-10-14', amount:'', category:'其他', text:'' });
});

test('数字键盘输入0到9，前导零不累积，金额最多两位小数', () => {
  assert.equal(type('0123456789'), '123456789');
  assert.equal(type('000'), '0');
  assert.equal(type('28.5099'), '28.50');
  assert.equal(type('.019'), '0.01');
});

test('重复小数点、未知按键不改变金额，删除一位后可以重输', () => {
  assert.equal(type('1..2.3'), '1.23');
  assert.equal(keypadAmount('1.23', 'x'), '1.23');
  assert.equal(keypadAmount('1.23', 'delete'), '1.2');
  assert.equal(keypadAmount(keypadAmount('1.23', 'delete'), '8'), '1.28');
  assert.equal(keypadAmount('', 'delete'), '');
});

test('快速创建完全复用旧手动交易结构及UUID规则', () => {
  const input = draft();
  const quick = createQuickExpense(input), previous = createManualExpense(input);
  assert.deepEqual({ ...quick, id:'' }, { ...previous, id:'' });
  assert.match(quick.id, /^manual:[0-9a-f-]{36}$/);
  assert.notEqual(quick.id, previous.id);
  assert.equal(quick.source, '手动');
  assert.equal(quick.direction, '支出');
  assert.equal(resolveCategory(quick, { '测试午餐':'购物' }), '餐饮');
});

test('完成时尾部小数点按整数保存，小数点和零不能单独保存', () => {
  assert.equal(createQuickExpense(draft({ amount:type('12.') })).amount, 12);
  for (const amount of ['', '0', '0.', '.', '0.00'])
    assert.throws(() => createQuickExpense(draft({ amount })), /金额/);
});

test('快速保存继续拒绝负数、非法金额、超精度和非有限金额', () => {
  for (const amount of [-1, '-1', NaN, Infinity, 'abc', '1e2', '12元', '1.234', null, true])
    assert.throws(() => createQuickExpense(draft({ amount })), /金额/);
});

test('快速保存拒绝非法分类，全部宫格分类均可保存', () => {
  for (const category of ['', '不存在', null])
    assert.throws(() => createQuickExpense(draft({ category })), /分类/);
  for (const category of CATEGORIES) assert.equal(createQuickExpense(draft({ category })).myCategory, category);
});

test('修改日期按15日边界归入账期，不给交易写死账期', () => {
  const a = createQuickExpense(draft({ date:'2026-09-14' }));
  const b = createQuickExpense(draft({ date:'2026-09-15' }));
  assert.equal(billingPeriodLabel(a.datetime), '2026-09');
  assert.equal(billingPeriodLabel(b.datetime), '2026-10');
  assert.deepEqual(filterTransactionsByRange([a,b], billingPeriodRange('2026-10')), [b]);
  assert.ok(!Object.hasOwn(b, 'period'));
  for (const date of ['', '2026-02-29']) assert.throws(() => createQuickExpense(draft({ date })), /日期/);
});

test('新入口记录参与总支出、分类、趋势、明细、搜索和来源筛选', () => {
  const t = createQuickExpense(draft({ date:'2026-10-01', amount:type('1.23') }));
  const s = summarize([t], billingPeriodRange('2026-10'));
  assert.equal(s.totalExpense, 1.23);
  assert.equal(s.byCategory['餐饮'], 1.23);
  assert.equal(s.byDay['2026-10-01'], 1.23);
  assert.deepEqual(s.topExpenses, [t]);
  assert.equal(matchesSearch(t, '测试午餐'), true);
  assert.deepEqual(filterTransactionsBySource([t], '手动'), [t]);
});

test('再次打开面板生成全新草稿，不保留之前的金额和日期', () => {
  const previous = draft();
  const reopened = newQuickEntry(new Date(2026, 9, 15));
  assert.equal(reopened.amount, '');
  assert.equal(reopened.date, '2026-10-15');
  assert.equal(previous.amount, '28.50');
});
