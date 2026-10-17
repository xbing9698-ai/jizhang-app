import test from 'node:test';
import assert from 'node:assert/strict';
import { updateTransactionFields, editAffectsReconciliation } from '../js/transaction-update.js';

test('导入交易可改金额日期方向分类说明但稳定导入身份与商户不变', () => {
  const before={id:'wechat:1',source:'微信',externalOrderId:'wx-1',counterparty:'原商户',datetime:'2026-10-17T12:34:56',amount:35.6,direction:'支出',myCategory:'餐饮',description:'旧说明'};
  const after=updateTransactionFields(before,{date:'2026-10-18',amount:'32.60',direction:'支出',category:'购物',description:'修正说明'});
  assert.equal(after.id,before.id);assert.equal(after.source,'微信');assert.equal(after.externalOrderId,'wx-1');assert.equal(after.counterparty,'原商户');
  assert.equal(after.datetime,'2026-10-18T12:34:56');assert.equal(after.amount,32.6);assert.equal(after.myCategory,'购物');assert.equal(after.description,'修正说明');
  assert.equal(after.userEdited,true);
});

test('手动交易说明与内部对方同步，收入使用收入分类', () => {
  const before={id:'manual:1',source:'手动',counterparty:'工资',datetime:'2026-10-15T00:00:00',amount:5000,direction:'收入',myCategory:'工资',description:'工资'};
  const after=updateTransactionFields(before,{date:'2026-10-15',amount:'5200',direction:'收入',category:'工资',description:'10月工资'});
  assert.equal(after.counterparty,'10月工资');assert.equal(after.description,'10月工资');assert.equal(after.amount,5200);
  assert.throws(()=>updateTransactionFields(before,{date:'2026-10-15',amount:'5200',direction:'收入',category:'餐饮',description:''}),/分类/);
});

test('金额日期或方向变化会使旧重复核对失效，只有说明变化不会', () => {
  const before={datetime:'2026-10-17T00:00:00',amount:100,direction:'收入'};
  assert.equal(editAffectsReconciliation(before,{...before,description:'x'}),false);
  assert.equal(editAffectsReconciliation(before,{...before,amount:101}),true);
  assert.equal(editAffectsReconciliation(before,{...before,datetime:'2026-10-18T00:00:00'}),true);
});
