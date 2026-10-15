import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  loadAllTransactions, saveTransactions, loadMemory, saveMemory, loadSnapshots, saveSnapshot,
  loadAssetLedger, saveAssetLedger, clearAllData, exportBackup, importBackup
} from '../js/storage.js';
import { addAccount, updateAccount, removeAccount, emptyLedger, LEDGER_ID } from '../js/asset-ledger.js';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { mock.restoreAll(); delete globalThis.document; });

const manual = { id:'manual:v3-test', source:'手动', direction:'支出', amount:32,
  datetime:'2026-10-18T00:00:00', myCategory:'餐饮', manual:true };
const imported = { id:'wx:v3-test', externalOrderId:'old-ext', source:'微信', amount:32,
  direction:'支出', datetime:'2026-10-18T19:42:00', myCategory:'用户分类', status:'部分退款',
  countedAmount:20, reviewed:true };

// 真实模拟已经装过 v2 的旧版应用：三个 store 与真实数据。
async function legacyDbV2() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('jizhang', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('transactions', { keyPath:'id' });
      db.createObjectStore('merchantMemory', { keyPath:'counterparty' });
      db.createObjectStore('snapshots', { keyPath:'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function seedV2(db) {
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['transactions','merchantMemory','snapshots'], 'readwrite');
    tx.objectStore('transactions').put(imported);
    tx.objectStore('transactions').put(manual);
    tx.objectStore('merchantMemory').put({ counterparty:'旧商户', category:'用户分类' });
    tx.objectStore('snapshots').put({ id:'snapshot:legacy', date:'2026-10-14', totalAssets:5000,
      totalLiabilities:100, netAssets:4900, note:'旧快照', createdAt:'2026-10-14T00:00:00.000Z' });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
const openRaw = () => new Promise((resolve, reject) => {
  const req = indexedDB.open('jizhang');
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});

test('已有v2数据升级到v3后transactions全部保留，字段与稳定ID逐项不变', async () => {
  const old = await legacyDbV2(); await seedV2(old); old.close();
  const rows = await loadAllTransactions();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find(t => t.id === imported.id), imported);
  assert.deepEqual(rows.find(t => t.id === manual.id), manual);
});

test('已有v2数据升级到v3后merchantMemory与snapshots全部保留', async () => {
  const old = await legacyDbV2(); await seedV2(old); old.close();
  assert.deepEqual(await loadMemory(), { 旧商户:'用户分类' });
  const snapshots = await loadSnapshots();
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0], { id:'snapshot:legacy', date:'2026-10-14', totalAssets:5000,
    totalLiabilities:100, netAssets:4900, note:'旧快照', createdAt:'2026-10-14T00:00:00.000Z' });
});

test('v2升级到v3只新增assetLedger表，返回的版本与表集合正确', async () => {
  const old = await legacyDbV2(); await seedV2(old); old.close();
  const ledger = await loadAssetLedger();
  assert.deepEqual(ledger, { id:'current', accounts:[], updatedAt:null });
  const db = await openRaw();
  assert.equal(db.version, 3);
  assert.deepEqual([...db.objectStoreNames].sort(), ['assetLedger','merchantMemory','snapshots','transactions']);
  db.close();
  // 升级后旧数据仍可继续读写。
  assert.equal((await loadAllTransactions()).length, 2);
  await saveMemory('新商户','交通');
  assert.deepEqual(await loadMemory(), { 旧商户:'用户分类', 新商户:'交通' });
});

test('全新数据库直接建为v3，总账初始为空且不自动创建任何账户', async () => {
  const ledger = await loadAssetLedger();
  assert.deepEqual(ledger, emptyLedger());
  assert.deepEqual(ledger.accounts, []);
  const db = await openRaw(); assert.equal(db.version, 3); db.close();
});

test('总账账户增删改持久化，重读后总资产、总负债与净资产一致', async () => {
  let ledger = addAccount(emptyLedger(), { name:'招商银行卡', type:'asset', balance:5000 });
  ledger = addAccount(ledger, { name:'微信', type:'asset', balance:'120.30' });
  ledger = addAccount(ledger, { name:'房贷', type:'liability', balance:1000.5, note:'等额本息' });
  await saveAssetLedger(ledger);
  const reloaded = await loadAssetLedger();
  assert.deepEqual(reloaded, ledger);
  assert.deepEqual(reloaded.accounts.map(a => a.name), ['招商银行卡','微信','房贷']);
  assert.equal(reloaded.accounts[2].note, '等额本息');

  const changed = updateAccount(reloaded, reloaded.accounts[0].id, { balance:'6666.66', type:'liability' });
  await saveAssetLedger(changed);
  const afterEdit = await loadAssetLedger();
  assert.equal(afterEdit.accounts[0].balance, 6666.66);
  assert.equal(afterEdit.accounts[0].type, 'liability');
  assert.equal(afterEdit.accounts[0].name, '招商银行卡');

  const removed = removeAccount(afterEdit, afterEdit.accounts[1].id);
  await saveAssetLedger(removed);
  assert.deepEqual((await loadAssetLedger()).accounts.map(a => a.name), ['招商银行卡','房贷']);
});

test('非法总账拒绝落库，原有总账与交易数据不变', async () => {
  const ledger = addAccount(emptyLedger(), { name:'现金', type:'asset', balance:100 });
  await saveAssetLedger(ledger);
  await saveTransactions([manual]);
  for (const bad of [null, {}, { id:'other', accounts:[] }, { id:LEDGER_ID, accounts:'x' },
    { id:LEDGER_ID, accounts:[{ id:'a', name:'', type:'asset', balance:1 }] },
    { id:LEDGER_ID, accounts:[{ id:'a', name:'现金', type:'asset', balance:-1 }] }])
    await assert.rejects(saveAssetLedger(bad));
  assert.deepEqual(await loadAssetLedger(), ledger);
  assert.deepEqual(await loadAllTransactions(), [manual]);
});

test('清空数据同时清除总账，且不影响后续重建', async () => {
  await saveAssetLedger(addAccount(emptyLedger(), { name:'现金', type:'asset', balance:1 }));
  await clearAllData();
  assert.deepEqual(await loadAssetLedger(), emptyLedger());
  await saveAssetLedger(addAccount(emptyLedger(), { name:'支付宝', type:'asset', balance:2 }));
  assert.equal((await loadAssetLedger()).accounts.length, 1);
});

async function backupText() {
  let blob;
  mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:ledger-test'; });
  mock.method(URL, 'revokeObjectURL', () => {});
  globalThis.document = { createElement:() => ({ click() {} }) };
  await exportBackup();
  return blob.text();
}

test('新备份包含assetLedger，清空后导入完整恢复总账与原有三类数据', async () => {
  const ledger = addAccount(addAccount(emptyLedger(),
    { name:'招商银行卡', type:'asset', balance:5000 }), { name:'信用卡', type:'liability', balance:300 });
  await saveTransactions([manual, imported]);
  await saveMemory('旧商户','餐饮');
  await saveSnapshot({ date:'2026-10-14', totalAssets:4700, totalLiabilities:300 });
  await saveAssetLedger(ledger);

  const text = await backupText();
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.assetLedger, ledger);
  assert.deepEqual(Object.keys(parsed).sort(), ['assetLedger','mem','snapshots','txns']);

  await clearAllData();
  assert.deepEqual(await loadAssetLedger(), emptyLedger());
  await importBackup({ text:async () => text });
  assert.deepEqual(await loadAssetLedger(), ledger);
  assert.equal((await loadAllTransactions()).length, 2);
  assert.deepEqual(await loadMemory(), { 旧商户:'餐饮' });
  assert.equal((await loadSnapshots()).length, 1);
});

test('老备份没有assetLedger也能导入，不清除既有总账、交易与快照，也不报错', async () => {
  const ledger = addAccount(emptyLedger(), { name:'现金', type:'asset', balance:88 });
  await saveAssetLedger(ledger);
  await saveSnapshot({ date:'2026-10-14', totalAssets:88, totalLiabilities:0 });
  // 完全是旧版结构的备份：只有 txns / mem / snapshots。
  const legacyBackup = JSON.stringify({ txns:[imported], mem:{ 旧商户:'交通' }, snapshots:[] });
  await importBackup({ text:async () => legacyBackup });
  assert.deepEqual(await loadAssetLedger(), ledger);
  assert.deepEqual(await loadAllTransactions(), [imported]);
  assert.deepEqual(await loadMemory(), { 旧商户:'交通' });
  assert.equal((await loadSnapshots()).length, 1);
});

test('老备份完全缺少 snapshots 与 assetLedger 仍能导入，旧数据不丢', async () => {
  await saveTransactions([manual]);
  await importBackup({ text:async () => JSON.stringify({ txns:[imported], mem:{} }) });
  assert.deepEqual(await loadAssetLedger(), emptyLedger());
  assert.deepEqual((await loadAllTransactions()).map(t => t.id).sort(), [imported.id, manual.id].sort());
});

test('非法assetLedger备份被拒绝，事务回滚且不污染任何数据', async () => {
  const ledger = addAccount(emptyLedger(), { name:'现金', type:'asset', balance:88 });
  await saveAssetLedger(ledger);
  await saveTransactions([manual]);
  await saveMemory('旧商户','交通');
  const bad = [
    { id:'other', accounts:[] },
    { accounts:[{ id:'a', name:'现金', type:'asset', balance:-1 }] },
    { accounts:[{ id:'a', name:'', type:'asset', balance:1 }] },
    { accounts:[{ id:'a', name:'现金', type:'货币', balance:1 }] },
    { accounts:'not-an-array' }
  ];
  for (const assetLedger of bad)
    await assert.rejects(importBackup({ text:async () => JSON.stringify(
      { txns:[{ ...imported, amount:999 }], mem:{ 旧商户:'购物' }, snapshots:[], assetLedger }) }));
  assert.deepEqual(await loadAssetLedger(), ledger);
  assert.deepEqual(await loadAllTransactions(), [manual]);
  assert.deepEqual(await loadMemory(), { 旧商户:'交通' });
});

test('assetLedger为null的备份按缺失处理，只导入其他数据', async () => {
  await saveAssetLedger(addAccount(emptyLedger(), { name:'现金', type:'asset', balance:5 }));
  await importBackup({ text:async () => JSON.stringify(
    { txns:[imported], mem:{}, snapshots:[], assetLedger:null }) });
  assert.equal((await loadAssetLedger()).accounts.length, 1);
  assert.deepEqual(await loadAllTransactions(), [imported]);
});
