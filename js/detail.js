import { filterTransactionsByRange } from './period.js';
import { matchesSearch } from './aggregate.js';
import { needsReview } from './review.js';

export function sortTransactions(transactions, order = 'newest') {
  const time = t => String(t.datetime ?? '');
  const amount = t => Number.isFinite(Number(t.amount)) ? Number(t.amount) : 0;
  const compare = {
    newest: (a,b) => time(b).localeCompare(time(a)),
    oldest: (a,b) => time(a).localeCompare(time(b)),
    highest: (a,b) => amount(b)-amount(a),
    lowest: (a,b) => amount(a)-amount(b)
  }[order];
  if (!compare) throw new Error('无效排序方式');
  return transactions.slice().sort(compare);
}

export function filterDetails(transactions, range, filters = {}) {
  const { source, category, direction, onlyUncat, onlyNeedsReview, query, order } = filters;
  const rows = filterTransactionsByRange(transactions, range).filter(t =>
    (!source || t.source === source) && (!category || t.myCategory === category) &&
    (!direction || t.direction === direction) && (!onlyUncat || t.myCategory === '其他') &&
    (!onlyNeedsReview || needsReview(t)) && matchesSearch(t, query));
  return sortTransactions(rows, order);
}
