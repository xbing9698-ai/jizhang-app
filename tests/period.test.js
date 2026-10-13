import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingPeriodRange, latestCompletedPeriod, prevPeriodRange,
  billingPeriodLabel, filterTransactionsByRange
} from '../js/period.js';

test('结束月2026-10对应9月15日至10月14日', () => {
  assert.deepEqual(billingPeriodRange('2026-10'), {
    start:'2026-09-15', end:'2026-10-14', label:'2026-10'
  });
  assert.equal(billingPeriodLabel('2026-09-15T00:00:00'), '2026-10');
  assert.equal(billingPeriodLabel('2026-10-14T23:59:59'), '2026-10');
});

test('14日23:59:59与15日00:00:00进入不同账期', () => {
  assert.equal(billingPeriodLabel('2026-09-14T23:59:59'), '2026-09');
  assert.equal(billingPeriodLabel('2026-09-14T23:59:59.999'), '2026-09');
  assert.equal(billingPeriodLabel('2026-09-15T00:00:00'), '2026-10');
  assert.equal(billingPeriodLabel('2026-09-15 00:00:00'), '2026-10');
});

test('10月13日默认最近完整账期2026-09', () => {
  assert.deepEqual(latestCompletedPeriod(new Date(2026, 9, 13)), {
    start:'2026-08-15', end:'2026-09-14', label:'2026-09'
  });
});

test('10月15日零点默认最近完整账期2026-10，14日结束前仍是2026-09', () => {
  assert.equal(latestCompletedPeriod(new Date(2026, 9, 14, 23, 59, 59, 999)).label, '2026-09');
  assert.deepEqual(latestCompletedPeriod(new Date(2026, 9, 15)), billingPeriodRange('2026-10'));
});

test('默认账期覆盖月初、月末、跨年和闰年', () => {
  for (const [date, expected] of [
    [new Date(2026, 9, 1), '2026-09'], [new Date(2026, 9, 31), '2026-10'],
    [new Date(2026, 0, 1), '2025-12'], [new Date(2026, 0, 14), '2025-12'],
    [new Date(2026, 0, 15), '2026-01'], [new Date(2026, 11, 31), '2026-12'],
    [new Date(2024, 1, 14), '2024-01'], [new Date(2024, 1, 15), '2024-02'],
    [new Date(2024, 1, 29), '2024-02']
  ]) assert.deepEqual(latestCompletedPeriod(date), billingPeriodRange(expected));
});

test('1月跨年账期正确包含12月15日至1月14日', () => {
  assert.deepEqual(billingPeriodRange('2026-01'), {
    start:'2025-12-15', end:'2026-01-14', label:'2026-01'
  });
  assert.equal(billingPeriodLabel('2025-12-15T00:00:00'), '2026-01');
  assert.equal(billingPeriodLabel('2026-01-14T23:59:59'), '2026-01');
  assert.equal(billingPeriodLabel('2026-01-15T00:00:00'), '2026-02');
});

test('上一账期计算完整起止日期，跨年正确，全部时间无上一账期', () => {
  assert.deepEqual(prevPeriodRange(billingPeriodRange('2026-10')), billingPeriodRange('2026-09'));
  assert.deepEqual(prevPeriodRange(billingPeriodRange('2026-01')), billingPeriodRange('2025-12'));
  assert.equal(prevPeriodRange({ start:null, end:null, label:'全部' }), null);
  assert.equal(prevPeriodRange(null), null);
});

test('同一范围含首尾全天，排除相邻账期记录，不改写交易', () => {
  const rows = [
    '2026-09-14T23:59:59', '2026-09-15T00:00:00',
    '2026-10-14T23:59:59', '2026-10-14T23:59:59.999', '2026-10-15T00:00:00'
  ].map(datetime => Object.freeze({ datetime }));
  const before = JSON.stringify(rows);
  assert.deepEqual(filterTransactionsByRange(Object.freeze(rows), billingPeriodRange('2026-10')), rows.slice(1, 4));
  assert.equal(JSON.stringify(rows), before);
});

test('全部时间不限制日期，也兼容缺少日期的旧记录', () => {
  const rows = [{ datetime:'2020-01-01T00:00:00' }, { datetime:'2027-01-01T00:00:00' }, {}];
  assert.deepEqual(filterTransactionsByRange(rows), rows);
  assert.deepEqual(filterTransactionsByRange(rows, { start:null, end:null, label:'全部' }), rows);
});

test('所有月份和闰年每天均归入唯一正确范围，无需月底31日', () => {
  for (const year of [2024, 2025, 2026]) {
    for (let month = 1; month <= 12; month++) {
      const days = new Date(year, month, 0).getDate();
      for (let day = 1; day <= days; day++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const range = billingPeriodRange(billingPeriodLabel(date));
        assert.ok(date >= range.start && date <= range.end);
        const previous = prevPeriodRange(range);
        assert.ok(date > previous.end);
      }
    }
  }
  assert.equal(billingPeriodLabel('2024-02-29T12:00:00'), '2024-03');
  assert.equal(billingPeriodLabel('2025-02-29T12:00:00'), '');
});
