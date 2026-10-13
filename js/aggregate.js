import { isCountableExpense } from './dedup.js';
import { billingPeriodLabel, filterTransactionsByRange } from './period.js';

export function filterTransactionsBySource(transactions, source = '') {
  return transactions.filter(t => !source || t.source === source);
}

export function summarize(transactions, range) {
  const s = { totalExpense: 0, totalIncome: 0, net: 0, count: 0,
    byCategory: {}, byDay: {}, topExpenses: [] };
  const expenses = [];
  for (const t of filterTransactionsByRange(transactions, range)) {
    if (isCountableExpense(t)) {
      s.totalExpense += t.amount;
      s.count += 1;
      const cat = t.myCategory || '其他';
      s.byCategory[cat] = (s.byCategory[cat] || 0) + t.amount;
      const day = t.datetime.slice(0, 10);
      s.byDay[day] = (s.byDay[day] || 0) + t.amount;
      expenses.push(t);
    } else if (t.direction === '收入') {
      s.totalIncome += t.amount;
    }
  }
  // 大额支出 Top5（金额降序）
  s.topExpenses = expenses.sort((a, b) => b.amount - a.amount).slice(0, 5);
  // 浮点修正
  s.totalExpense = Math.round(s.totalExpense * 100) / 100;
  s.totalIncome = Math.round(s.totalIncome * 100) / 100;
  s.net = Math.round((s.totalIncome - s.totalExpense) * 100) / 100;
  return s;
}

// 搜索匹配：跨"对方/商品/备注/分类/金额"字段做包含匹配。空查询全通过。
export function matchesSearch(t, query) {
  if (!query) return true;
  const s = String(query).trim().toLowerCase();
  if (!s) return true;
  const fields = [t.counterparty, t.description, t.note, t.myCategory, String(t.amount)];
  return fields.some(f => String(f ?? '').toLowerCase().includes(s));
}

// 按"交易对方"汇总，返回 [{counterparty, total, count, items}]，按金额降序。
export function groupByCounterparty(transactions, range) {
  const map = new Map();
  for (const t of filterTransactionsByRange(transactions, range)) {
    const key = t.counterparty || '（未填对方）';
    if (!map.has(key)) map.set(key, {
      counterparty: key,
      total: 0,
      expense: 0,
      income: 0,
      net: 0,
      count: 0,
      expenseCount: 0,
      incomeCount: 0,
      neutralCount: 0,
      items: []
    });
    const g = map.get(key);
    if (isCountableExpense(t)) {
      g.expense += t.amount;
      g.expenseCount += 1;
    } else if (t.direction === '收入') {
      g.income += t.amount;
      g.incomeCount += 1;
    } else {
      g.neutralCount += 1;
    }
    g.count += 1; g.items.push(t);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.expense = Math.round(g.expense * 100) / 100;
    g.income = Math.round(g.income * 100) / 100;
    g.net = Math.round((g.income - g.expense) * 100) / 100;
    g.total = g.expense;
  }
  return groups.sort((a, b) => b.expense - a.expense || b.income - a.income);
}

export function buildPeriodTable(transactions) {
  const map = new Map();
  for (const t of transactions) {
    const period = billingPeriodLabel(t.datetime);
    if (!period) continue;
    if (!map.has(period)) map.set(period, {
      period,
      expense: 0,
      income: 0,
      net: 0,
      expenseCount: 0,
      incomeCount: 0,
      count: 0
    });
    const row = map.get(period);
    if (isCountableExpense(t)) {
      row.expense += t.amount;
      row.expenseCount += 1;
    } else if (t.direction === '收入') {
      row.income += t.amount;
      row.incomeCount += 1;
    }
    row.count += 1;
  }
  return [...map.values()].map(row => ({
    ...row,
    expense: Math.round(row.expense * 100) / 100,
    income: Math.round(row.income * 100) / 100,
    net: Math.round((row.income - row.expense) * 100) / 100
  })).sort((a, b) => b.period.localeCompare(a.period));
}
