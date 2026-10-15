import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEDGER_ID, emptyLedger, createAccount, normalizeLedger, calculateLedgerTotals,
  hasLedgerAccounts, addAccount, updateAccount, removeAccount, accountTypeLabel
} from '../js/asset-ledger.js';

const bank = { name:'招商银行卡', type:'asset', balance:5000 };
const wechat = { name:'微信', type:'asset', balance:'120.30' };
const loan = { name:'房贷', type:'liability', balance:1000.5 };
const seed = (...accounts) => ({ id:LEDGER_ID, accounts, updatedAt:'2026-10-14T00:00:00.000Z' });

test('assetLedger 初始为空，不含任何示例账户', () => {
  const ledger = emptyLedger();
  assert.deepEqual(ledger, { id:'current', accounts:[], updatedAt:null });
  assert.equal(hasLedgerAccounts(ledger), false);
  assert.deepEqual(calculateLedgerTotals(ledger.accounts), { totalAssets:0, totalLiabilities:0, netAssets:0 });
});

test('添加资产账户与负债账户，自动生成编号并规整备注', () => {
  let ledger = emptyLedger();
  ledger = addAccount(ledger, { ...bank, note:' 工资卡 ' });
  ledger = addAccount(ledger, loan);
  assert.equal(ledger.accounts.length, 2);
  assert.notEqual(ledger.accounts[0].id, ledger.accounts[1].id);
  assert.match(ledger.accounts[0].id, /^account:/);
  assert.equal(ledger.accounts[0].note, '工资卡');
  assert.equal(ledger.accounts[0].type, 'asset');
  assert.equal(ledger.accounts[1].type, 'liability');
  assert.ok(ledger.updatedAt);
  assert.equal(accountTypeLabel('asset'), '资产');
  assert.equal(accountTypeLabel('liability'), '负债');
});

test('修改账户名称、余额与类型，保留编号与其他账户', () => {
  const first = createAccount(bank);
  const ledger = seed(first, createAccount(loan));
  const changed = updateAccount(ledger, first.id, { name:'招商银行储蓄卡', balance:'8888.88', type:'liability' });
  assert.equal(changed.accounts[0].id, first.id);
  assert.equal(changed.accounts[0].name, '招商银行储蓄卡');
  assert.equal(changed.accounts[0].balance, 8888.88);
  assert.equal(changed.accounts[0].type, 'liability');
  assert.deepEqual(changed.accounts[1], ledger.accounts[1]);
  // 只改余额时名称与类型不变。
  const onlyBalance = updateAccount(ledger, first.id, { balance:1 });
  assert.equal(onlyBalance.accounts[0].name, '招商银行卡');
  assert.equal(onlyBalance.accounts[0].type, 'asset');
  assert.throws(() => updateAccount(ledger, 'account:missing', { balance:1 }), /账户不存在/);
});

test('删除账户只移除所选账户，其余账户不变', () => {
  const first = createAccount(bank), second = createAccount(wechat);
  const ledger = seed(first, second);
  const after = removeAccount(ledger, first.id);
  assert.deepEqual(after.accounts, [second]);
  assert.throws(() => removeAccount(after, first.id), /账户不存在/);
});

test('总资产、总负债、净资产按分计算，负债不使用负数', () => {
  const accounts = [createAccount(bank), createAccount(wechat), createAccount(loan)];
  assert.deepEqual(calculateLedgerTotals(accounts), { totalAssets:5120.3, totalLiabilities:1000.5, netAssets:4119.8 });
  assert.deepEqual(calculateLedgerTotals([createAccount({ name:'信用卡', type:'liability', balance:'0.10' })]),
    { totalAssets:0, totalLiabilities:0.1, netAssets:-0.1 });
  assert.equal(hasLedgerAccounts(seed(...accounts)), true);
});

test('账户与总账拒绝非法名称、类型和负数或超精度余额', () => {
  for (const [field, value] of [['name',''],['name','   '],['type','现金'],['type',''],['balance',-1],['balance',''],
    ['balance','1.001'],['balance','abc'],['balance',NaN]])
    assert.throws(() => createAccount({ ...bank, [field]:value }));
  assert.throws(() => createAccount({ ...bank, note:'x'.repeat(81) }), /备注/);
  assert.throws(() => createAccount({ ...bank, name:'长'.repeat(41) }), /40/);
});

test('normalizeLedger 拒绝非法总账结构，不返回半成品', () => {
  assert.throws(() => normalizeLedger(null), /结构无效/);
  assert.throws(() => normalizeLedger({ id:'other', accounts:[] }), /结构无效/);
  assert.throws(() => normalizeLedger({ id:LEDGER_ID }), /账户列表无效/);
  assert.throws(() => normalizeLedger({ id:LEDGER_ID, accounts:'x' }), /账户列表无效/);
  assert.throws(() => normalizeLedger({ id:LEDGER_ID, accounts:[{ name:'现金', type:'asset', balance:1 }] }), /缺少编号/);
  assert.throws(() => normalizeLedger({ id:LEDGER_ID, accounts:[null] }), /账户无效/);
  const duplicated = createAccount(bank);
  assert.throws(() => normalizeLedger({ id:LEDGER_ID, accounts:[duplicated, { ...duplicated }] }), /编号重复/);
  const ok = normalizeLedger(seed(createAccount(bank)));
  assert.equal(ok.updatedAt, '2026-10-14T00:00:00.000Z');
  assert.equal(normalizeLedger({ id:LEDGER_ID, accounts:[] }).updatedAt, null);
});
