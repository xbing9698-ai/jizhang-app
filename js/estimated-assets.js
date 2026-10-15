// "使用以来"的净资产推算：只复用现有统计口径，不新增收入/支出算法。
// 起始净资产必须来自 2026-10-15 的资产快照，禁止用 0 或历史流水反推。
export const USAGE_START_DATE = '2026-10-15';

const cents = value => Math.round(Number(value) * 100);

// 只做"是否存在"和按分求和的校验，返回值仍是元，不改变量纲。
function validMoney(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isSafeInteger(cents(n)))
    throw new Error(`${label}无效`);
  return n;
}

// 只要日期正好等于起始日的快照，不接受用其他日期快照冒充。
export function findStartingSnapshot(snapshots) {
  return (snapshots || []).find(s => s?.date === USAGE_START_DATE) || null;
}

export function hasStartingSnapshot(snapshots) {
  return findStartingSnapshot(snapshots) !== null;
}

// 预计当前净资产 = 起始净资产 + 快照后收入 - 快照后支出。
// 调用方通过 summarizeSnapshotChanges() 取快照日期之后的增量，普通使用以来范围保持不变。
export function estimateCurrentNet(snapshot, afterSnapshotSummary) {
  if (!snapshot) return null;
  const start = validMoney(snapshot.netAssets, '起始净资产');
  const income = validMoney(afterSnapshotSummary?.totalIncome, '快照后收入');
  const expense = validMoney(afterSnapshotSummary?.totalExpense, '快照后支出');
  return {
    startNetAssets: start,
    income,
    expense,
    estimatedNetAssets: (cents(start) + cents(income) - cents(expense)) / 100
  };
}

// 待核对差额 = 实际当前净资产（资产总账） - 预计当前净资产。
// 差额为 0 时明确提示一致，不使用警告文案。
export function checkDifference(estimatedNetAssets, actualNetAssets) {
  if (estimatedNetAssets == null || actualNetAssets == null) return null;
  const difference = (cents(actualNetAssets) - cents(estimatedNetAssets)) / 100;
  return { difference, aligned: difference === 0 };
}
