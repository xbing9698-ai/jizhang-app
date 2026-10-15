// 资产总账：回答"现在有多少钱、钱分别在哪里"。
// 单一当前状态，不做账户流水；资产快照负责历史状态，收支账负责钱的流动。
export const LEDGER_ID = 'current';
export const LEDGER_ACCOUNT_TYPES = ['asset', 'liability'];

const TYPE_LABEL = { asset:'资产', liability:'负债' };
const TYPE_VALUES = new Set(LEDGER_ACCOUNT_TYPES);
const CENTS = value => Math.round(value * 100);

export function accountTypeLabel(type) {
  return TYPE_LABEL[type] || '';
}

// 金额按分校验：只用非负数字表示余额，负债不使用负数。
export function parseBalance(value, label = '余额') {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const n = Number(text);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(n) || !Number.isSafeInteger(CENTS(n)))
    throw new Error(`${label}须为非负金额，最多两位小数`);
  return n;
}

function parseName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new Error('请填写账户名称');
  if (name.length > 40) throw new Error('账户名称最多 40 个字');
  return name;
}

function parseType(value) {
  if (!TYPE_VALUES.has(value)) throw new Error('账户类型只能是资产或负债');
  return value;
}

function parseNote(value) {
  const note = value == null ? '' : String(value).trim();
  if (note.length > 80) throw new Error('备注最多 80 个字');
  return note;
}

export function newAccountId() {
  return `account:${crypto.randomUUID()}`;
}

// 空总账：只有结构，没有任何示例或真实账户。
export function emptyLedger() {
  return { id: LEDGER_ID, accounts: [], updatedAt: null };
}

export function createAccount(input = {}, id = null) {
  return {
    id: id || input.id || newAccountId(),
    name: parseName(input.name),
    type: parseType(input.type),
    balance: parseBalance(input.balance),
    note: parseNote(input.note)
  };
}

export function calculateLedgerTotals(accounts) {
  let totalAssets = 0, totalLiabilities = 0;
  for (const account of accounts || []) {
    if (account.type === 'asset') totalAssets += CENTS(account.balance);
    else if (account.type === 'liability') totalLiabilities += CENTS(account.balance);
  }
  return {
    totalAssets: totalAssets / 100,
    totalLiabilities: totalLiabilities / 100,
    netAssets: (totalAssets - totalLiabilities) / 100
  };
}

export function hasLedgerAccounts(ledger) {
  return Array.isArray(ledger?.accounts) && ledger.accounts.length > 0;
}

// 校验并规整一个总账对象；非法输入直接抛错，绝不返回半成品。
export function normalizeLedger(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('资产总账结构无效');
  if (input.id !== LEDGER_ID) throw new Error('资产总账结构无效');
  if (!Array.isArray(input.accounts)) throw new Error('资产总账账户列表无效');
  if (input.accounts.length > 200) throw new Error('资产总账账户过多');
  const seen = new Set();
  const accounts = input.accounts.map(account => {
    if (!account || typeof account !== 'object' || Array.isArray(account))
      throw new Error('资产总账账户无效');
    if (typeof account.id !== 'string' || !account.id.trim())
      throw new Error('资产总账账户缺少编号');
    if (seen.has(account.id)) throw new Error('资产总账账户编号重复');
    seen.add(account.id);
    return createAccount(account, account.id);
  });
  return {
    id: LEDGER_ID,
    accounts,
    updatedAt: typeof input.updatedAt === 'string' && input.updatedAt ? input.updatedAt : null
  };
}

export function addAccount(ledger, input) {
  const accounts = [...(ledger.accounts || []), createAccount(input)];
  return { ...ledger, accounts, updatedAt: new Date().toISOString() };
}

export function updateAccount(ledger, accountId, input) {
  const existing = (ledger.accounts || []).find(a => a.id === accountId);
  if (!existing) throw new Error('账户不存在');
  const accounts = ledger.accounts.map(a =>
    a.id === accountId ? createAccount({ ...a, ...input }, accountId) : a);
  return { ...ledger, accounts, updatedAt: new Date().toISOString() };
}

export function removeAccount(ledger, accountId) {
  if (!(ledger.accounts || []).some(a => a.id === accountId)) throw new Error('账户不存在');
  return {
    ...ledger,
    accounts: ledger.accounts.filter(a => a.id !== accountId),
    updatedAt: new Date().toISOString()
  };
}
