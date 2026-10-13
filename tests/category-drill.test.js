import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { filterTransactionsByRange, billingPeriodRange } from '../js/period.js';
import { filterTransactionsBySource, matchesSearch } from '../js/aggregate.js';
import { needsReview } from '../js/review.js';

// 执行应用实际的下钻事件逻辑，只替代 DOM 和渲染出口。
const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const drillSource = source.slice(source.indexOf('function drillToCategory('), source.indexOf('\nfunction renderCatList('));

function drill(priorFilters) {
  const controls = {
    filterSource: { value: '' }, filterCategory: { value: '' },
    filterDirection: { value: '' }, onlyUncat: { checked: false },
    onlyNeedsReview: { checked: false }, searchInput: { value: '' }
  };
  for (const [id, state] of Object.entries(priorFilters)) Object.assign(controls[id], state);
  const transactions = [
    { id: 'ordinary', source: '微信', datetime: '2026-09-15T00:00:00', direction: '支出', amount: 10, myCategory: '餐饮', status: '支付成功' },
    { id: 'reviewed', source: '支付宝', datetime: '2026-10-14T23:59:59', direction: '支出', amount: 20, myCategory: '餐饮', status: '已退款', reviewed: true },
    { id: 'outside', source: '微信', datetime: '2026-09-14T23:59:59', direction: '支出', amount: 30, myCategory: '餐饮' },
    { id: 'different-category', source: '微信', datetime: '2026-10-01T00:00:00', direction: '支出', amount: 40, myCategory: '购物' }
  ];
  const range = billingPeriodRange('2026-10');
  const before = JSON.stringify({ transactions, range });
  let rows, view;
  const context = {
    document: { getElementById: id => controls[id], querySelectorAll: () => [] },
    detailMode: 'list',
    renderDetail: () => {
      rows = filterTransactionsBySource(filterTransactionsByRange(transactions, range), controls.filterSource.value).filter(t =>
        (!controls.filterCategory.value || t.myCategory === controls.filterCategory.value) &&
        (!controls.filterDirection.value || t.direction === controls.filterDirection.value) &&
        (!controls.onlyUncat.checked || t.myCategory === '其他') &&
        (!controls.onlyNeedsReview.checked || needsReview(t)) && matchesSearch(t, controls.searchInput.value));
    },
    switchView: name => { view = name; }
  };
  vm.runInNewContext(drillSource + '\ndrillToCategory("餐饮");', context);
  assert.deepEqual(rows.map(t => t.id), ['ordinary', 'reviewed']);
  assert.equal(context.detailMode, 'merchant');
  assert.equal(view, 'detail');
  assert.equal(JSON.stringify({ transactions, range }), before);
}

test('查看需处理后分类下钻仍包含普通消费和已处理消费', () => {
  drill({ onlyNeedsReview: { checked: true } });
});

test('分类下钻清除先前收入筛选并保持原账期边界', () => {
  drill({ filterDirection: { value: '收入' } });
});

test('分类下钻清除组合明细筛选，不改交易或账期', () => {
  drill({ filterSource: { value: '手动' }, filterDirection: { value: '中性' },
    onlyUncat: { checked: true }, onlyNeedsReview: { checked: true }, searchInput: { value: '不存在的说明' } });
});
