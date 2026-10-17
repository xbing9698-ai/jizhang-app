import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  saveTransactions, loadAllTransactions, saveTransactionEdit, saveExpenseAdjustment, saveReconciliation,
  deleteManualTransaction, loadMemory, importBackup, exportBackup, clearAllData, saveSnapshot, loadSnapshots
} from '../js/storage.js';
import { countedExpenseAmount } from '../js/review.js';
import { reconciliationCandidates } from '../js/reconciliation.js';
import { updateTransactionFields, editableTransactionCategories } from '../js/transaction-update.js';
import { fileToTransactions } from '../js/import-transactions.js';
import { mergeTransactions } from '../js/dedup.js';
import { ALIPAY_LEDGER_CSV_TEXT, ALIPAY_CSV_TEXT, WECHAT_ROWS } from './fixtures.js';
import { installVendors } from './vendor-helpers.js';
import { summarize } from '../js/aggregate.js';

installVendors();
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { mock.restoreAll(); delete globalThis.document; });
const imported = (extra = {}) => ({ id:'wechat:edit', source:'微信', externalOrderId:'original-order', counterparty:'合成店',
  datetime:'2026-10-17T12:00:30', amount:100, direction:'支出', myCategory:'餐饮', description:'原说明', status:'部分退款', ...extra });
const manual = (extra = {}) => imported({ id:'manual:edit', source:'手动', manual:true, externalOrderId:'', ...extra });
const find = async id => (await loadAllTransactions()).find(t => t.id === id);

test('陈旧页面只改说明：事务读取最新退款调整和最新金额，不覆盖其他页面保存的字段', async () => {
  await saveTransactions([imported()]);
  const stale = await find('wechat:edit');
  await saveTransactionEdit(stale.id,{ amount:'120' });
  await saveExpenseAdjustment(stale.id,'amount','40');
  await saveTransactionEdit(stale.id,{ description:'陈旧页面只改说明' });
  const saved = await find(stale.id);
  assert.equal(saved.amount,120); assert.equal(saved.countedAmount,40); assert.equal(saved.reviewed,true);
  assert.equal(saved.excluded,false); assert.equal(saved.description,'陈旧页面只改说明');
  assert.equal(countedExpenseAmount(saved),40); assert.equal(stale.amount,100);
});

test('陈旧页面保存保留最新排除状态和重复核对关系，两个并发编辑互不抹除', async () => {
  await saveTransactions([imported(),manual()]);
  await loadAllTransactions(); // 第二页面取得旧缓存后，第一页才保存下列状态。
  await saveExpenseAdjustment('wechat:edit','exclude');
  await saveReconciliation('manual:edit','wechat:edit','confirm');
  await Promise.all([
    saveTransactionEdit('wechat:edit',{ description:'仅改说明' }),
    saveTransactionEdit('manual:edit',{ description:'手动说明' })
  ]);
  assert.equal((await find('wechat:edit')).excluded,true);
  assert.equal((await find('wechat:edit')).reviewed,true);
  assert.equal((await find('manual:edit')).reconciledDuplicateOf,'wechat:edit');
});

test('已被其他页面删除的手动记录拒绝编辑，不会重新创建', async () => {
  await saveTransactions([manual()]); const stale = await find('manual:edit');
  await deleteManualTransaction(stale.id);
  await assert.rejects(saveTransactionEdit(stale.id,{ description:'陈旧页面保存' }),/不存在/);
  assert.deepEqual(await loadAllTransactions(),[]); assert.deepEqual(await loadMemory(),{});
});

for (const patch of [{ amount:'101' },{ date:'2026-10-18' },{ direction:'收入', category:'工资' }])
  test(`编辑导入记录${JSON.stringify(patch)}原子解除最新核对关系，并保留手动记录其他字段`, async () => {
    await saveTransactions([imported(),manual({ description:'必须保留' })]);
    await saveReconciliation('manual:edit','wechat:edit','confirm');
    await saveTransactionEdit('wechat:edit',patch);
    const saved = await find('manual:edit');
    assert.equal(saved.reconciledDuplicateOf,undefined); assert.equal(saved.description,'必须保留'); assert.equal(saved.amount,100);
  });

test('编辑手动金额解除自身核对关系；改变候选条件后旧否定关系也失效', async () => {
  await saveTransactions([imported(),manual()]);
  await saveReconciliation('manual:edit','wechat:edit','confirm');
  await saveTransactionEdit('manual:edit',{ amount:'101' });
  assert.equal((await find('manual:edit')).reconciledDuplicateOf,undefined);
  await saveTransactionEdit('manual:edit',{ amount:'100' });
  await saveReconciliation('manual:edit','wechat:edit','dismiss');
  assert.equal(reconciliationCandidates(await loadAllTransactions()).length,0);
  await saveTransactionEdit('wechat:edit',{ date:'2026-10-18' });
  assert.equal(reconciliationCandidates(await loadAllTransactions()).length,1);
});

test('非法编辑整笔事务回滚，不改变核对关系、商户记忆或原记录', async () => {
  await saveTransactions([imported(),manual()]); await saveReconciliation('manual:edit','wechat:edit','confirm');
  const before = await loadAllTransactions();
  await assert.rejects(saveTransactionEdit('wechat:edit',{ amount:'0', category:'购物' }),/金额/);
  assert.deepEqual(await loadAllTransactions(),before); assert.deepEqual(await loadMemory(),{});
});

test('旧备份自定义分类可以原样编辑其他字段，方向改变后按新方向验证', async () => {
  const old = imported({ myCategory:'咖啡', counterparty:'' });
  await importBackup({ text:async () => JSON.stringify({ txns:[old], mem:{} }) });
  assert.ok(editableTransactionCategories(old).includes('咖啡'));
  await saveTransactionEdit(old.id,{ amount:'99', description:'只改金额说明', category:'咖啡' });
  assert.equal((await find(old.id)).myCategory,'咖啡');
  assert.ok(!editableTransactionCategories(old,'收入').includes('咖啡'));
  await assert.rejects(saveTransactionEdit(old.id,{ direction:'收入', category:'咖啡' }),/分类/);
  await saveTransactionEdit(old.id,{ direction:'收入', category:'工资' });
  assert.equal((await find(old.id)).myCategory,'工资');
});

test('实际通用CSV自定义分类编辑保存，并保持来源和稳定导入身份', async () => {
  const file = new File(['日期,金额,收支,分类,说明,来源,外部ID\n2026-10-17,25,支出,咖啡,测试,现金,'], '通用.csv');
  const [t] = await fileToTransactions(file); await saveTransactions([t]);
  await saveTransactionEdit(t.id,{ amount:'26', category:'咖啡', description:'更新说明' });
  const saved = await find(t.id);
  assert.equal(saved.myCategory,'咖啡'); assert.equal(saved.amount,26); assert.equal(saved.source,'现金');
  assert.equal(saved.counterparty,''); assert.equal(saved.importFileFingerprint,t.importFileFingerprint);
});

test('金额调小使countedAmount无效时清除并取消已审状态，金额调回也不复活', async () => {
  await saveTransactions([imported()]); await saveExpenseAdjustment('wechat:edit','amount','70');
  const result = await saveTransactionEdit('wechat:edit',{ amount:'50' });
  let saved = await find('wechat:edit');
  assert.equal(result.adjustmentCleared,true); assert.equal(saved.countedAmount,undefined); assert.equal(saved.reviewed,undefined);
  assert.equal(countedExpenseAmount(saved),50);
  await saveTransactionEdit(saved.id,{ amount:'100' }); saved = await find(saved.id);
  assert.equal(saved.countedAmount,undefined); assert.equal(countedExpenseAmount(saved),100);
});

test('金额变化仍有效的计入金额或排除选择保留，改为收入时清除支出调整', async () => {
  await saveTransactions([imported()]); await saveExpenseAdjustment('wechat:edit','amount','70');
  await saveTransactionEdit('wechat:edit',{ amount:'80' });
  assert.equal((await find('wechat:edit')).countedAmount,70);
  await saveExpenseAdjustment('wechat:edit','exclude'); await saveTransactionEdit('wechat:edit',{ amount:'60' });
  assert.equal((await find('wechat:edit')).excluded,true); assert.equal(countedExpenseAmount(await find('wechat:edit')),0);
  await saveTransactionEdit('wechat:edit',{ direction:'收入', category:'工资' });
  const saved = await find('wechat:edit');
  for (const key of ['countedAmount','excluded','reviewed']) assert.equal(saved[key],undefined);
  assert.equal(summarize([saved],null).totalIncome,60);
});

test('统一编辑保存商户分类记忆，关联交易只改变分类，不传播金额日期说明', async () => {
  const peer = imported({ id:'alipay:peer', source:'支付宝', externalOrderId:'peer-order', amount:20,
    datetime:'2026-10-16T10:00:00', description:'其他记录', countedAmount:15, reviewed:true });
  const ownManual = manual({ description:'手动不联动' });
  await saveTransactions([imported(),peer,ownManual]);
  await saveTransactionEdit('wechat:edit',{ amount:'90', date:'2026-10-18', category:'购物', description:'选中记录的新说明' });
  assert.deepEqual(await loadMemory(),{'合成店':'购物'});
  assert.deepEqual(await find(peer.id),{ ...peer, myCategory:'购物', manual:true });
  assert.deepEqual(await find(ownManual.id),ownManual);
  const selected = await find('wechat:edit');
  assert.equal(selected.amount,90); assert.equal(selected.description,'选中记录的新说明'); assert.equal(selected.datetime,'2026-10-18T12:00:30');
});

for (const record of [manual(),imported({ counterparty:'' }),imported({ counterparty:'/' })])
  test(`手动或无可靠商户只改当前分类，不建立商户记忆：${record.source}/${record.counterparty}`, async () => {
    const peer = imported({ ...record, id:'peer' }); await saveTransactions([record,peer]);
    await saveTransactionEdit(record.id,{ category:'购物' });
    assert.deepEqual(await loadMemory(),{}); assert.equal((await find(peer.id)).myCategory,'餐饮');
  });

for (const kind of ['支付宝记账本','支付宝流水','微信XLSX'])
  test(`${kind}完整编辑→保存→重读→同文件及改名重导入，用户编辑不被覆盖`, async () => {
    let file;
    if (kind === '微信XLSX') {
      const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(WECHAT_ROWS),'账单');
      file = new File([XLSX.write(workbook,{ type:'array', bookType:'xlsx' })],'微信.xlsx');
    } else file = new File([kind === '支付宝流水' ? ALIPAY_CSV_TEXT : ALIPAY_LEDGER_CSV_TEXT],'支付宝.csv');
    const incoming = await fileToTransactions(file); await saveTransactions(incoming);
    const selected = incoming.find(t => t.direction === '支出'); assert.ok(selected);
    await saveTransactionEdit(selected.id,{ amount:'88.88', date:'2026-10-18', direction:'收入', category:'工资', description:'人工编辑值',
      id:'tampered', source:'手动', counterparty:'tampered', externalOrderId:'tampered' });
    const saved = await find(selected.id);
    for (const key of ['id','source','counterparty','externalOrderId','importFileFingerprint','importRowIndex']) assert.equal(saved[key],selected[key]);
    for (const name of [file.name,'改名.' + file.name.split('.').pop()]) {
      const again = await fileToTransactions(new File([await file.arrayBuffer()],name));
      const existing = await loadAllTransactions(), merged = mergeTransactions(existing,again);
      assert.equal(merged.added,0); assert.equal(merged.skipped,incoming.length);
      await saveTransactions(merged.merged.filter(t => !existing.some(old => old.id === t.id)));
      assert.deepEqual(await find(selected.id),saved);
    }
    assert.equal(saved.amount,88.88); assert.equal(saved.direction,'收入'); assert.equal(saved.description,'人工编辑值');
  });

test('新编辑字段、秒级快照、水印与旧快照经过真实备份导出清空恢复完整保留', async () => {
  await saveTransactions([imported()]); await saveTransactionEdit('wechat:edit',{ description:'编辑后备份', category:'购物' });
  await saveExpenseAdjustment('wechat:edit','amount','70');
  await saveSnapshot({ date:'2026-10-17', time:'12:00:45', totalAssets:5000, totalLiabilities:0, transactionIdsAtCapture:['wechat:edit'] });
  await saveSnapshot({ date:'2026-10-16', totalAssets:4900, totalLiabilities:0 });
  const before = { txns:await loadAllTransactions(), mem:await loadMemory(), snapshots:await loadSnapshots() };
  let blob; mock.method(URL,'createObjectURL',value => { blob=value; return 'blob:editing-test'; }); mock.method(URL,'revokeObjectURL',() => {});
  globalThis.document = { createElement:() => ({ click() {} }) }; await exportBackup();
  const text = await blob.text(); await clearAllData(); await importBackup({ text:async () => text });
  assert.deepEqual(await loadAllTransactions(),before.txns); assert.deepEqual(await loadMemory(),before.mem); assert.deepEqual(await loadSnapshots(),before.snapshots);
});

for (const amount of ['0','-1','NaN','1.001',''])
  test(`统一编辑拒绝非法金额${amount || '空'}且不改原数据`, async () => {
    const record = imported(); await saveTransactions([record]);
    await assert.rejects(saveTransactionEdit(record.id,{ amount }),/金额/); assert.deepEqual(await find(record.id),record);
  });

test('日期与分类错误拒绝保存，纯逻辑更新也不改变输入对象', async () => {
  const record = Object.freeze(imported());
  for (const patch of [{ date:'' },{ date:'2026-02-30' },{ category:'不存在' }]) assert.throws(() => updateTransactionFields(record,patch));
  assert.equal(updateTransactionFields(record,{ description:'新说明' }).description,'新说明'); assert.equal(record.description,'原说明');
});
