import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryUpdatePlan } from '../js/transaction-edit.js';
const create=(id,extra={})=>({ id,source:'微信',counterparty:'测试商户',amount:100,externalOrderId:'order-'+id,status:'已退款',myCategory:'其他',...extra });
test('可靠商户联动导入记录并记忆分类，手动记录不被联动',()=>{
  const rows=[create('a'),create('b',{source:'支付宝'}),create('c',{source:'手动',manual:true})];const before=JSON.stringify(rows);
  const plan=categoryUpdatePlan(rows,'a','餐饮');assert.deepEqual(plan.touched.map(t=>t.id),['a','b']);
  assert.deepEqual(plan.memoryEntry,{counterparty:'测试商户',category:'餐饮'});assert.equal(JSON.stringify(rows),before);
});
test('无对方及占位对方只修改当前记录，不建立记忆',()=>{
  for(const counterparty of ['',undefined,'/','-',' ']){
    const rows=[create('a',{counterparty}),create('b',{counterparty})];const plan=categoryUpdatePlan(rows,'a','购物');
    assert.deepEqual(plan.touched.map(t=>t.id),['a']);assert.equal(plan.memoryEntry,null);
  }
});
test('手动支出与收入均只改当前一笔，收入使用自己的分类',()=>{
  const rows=[create('a',{source:'手动',direction:'收入',myCategory:'工资'}),create('b',{source:'手动',direction:'收入',myCategory:'工资'})];
  const plan=categoryUpdatePlan(rows,'a','退款 / 返款');assert.equal(plan.memoryEntry,null);assert.deepEqual(plan.touched.map(t=>t.id),['a']);
  assert.throws(()=>categoryUpdatePlan(rows,'a','餐饮'),/分类/);
  assert.deepEqual(categoryUpdatePlan([create('x',{source:'手动'})],'x','餐饮').touched.map(t=>t.id),['x']);
});
test('分类修改只改变myCategory和manual，保留原始金额来源订单与退款调整',()=>{
  const row=Object.freeze(create('a',{excluded:true,countedAmount:70,reviewed:true,tags:'测试标签'}));const updated=categoryUpdatePlan([row],'a','交通').touched[0];
  for(const [key,value]of Object.entries(row))if(key!=='myCategory')assert.deepEqual(updated[key],value);
  assert.equal(updated.myCategory,'交通');assert.equal(updated.manual,true);
});
test('不存在记录和非法分类被拒绝',()=>{
  assert.throws(()=>categoryUpdatePlan([create('a')],'missing','餐饮'),/不存在/);
  assert.throws(()=>categoryUpdatePlan([create('a')],'a','工资'),/分类/);
});
