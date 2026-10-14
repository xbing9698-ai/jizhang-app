import test from 'node:test';
import assert from 'node:assert/strict';
import { fileToTransactions } from '../js/import-transactions.js';
import { mergeTransactions } from '../js/dedup.js';
import { resolveCategory, transactionCategories } from '../js/classify.js';
import { GENERIC_CSV_TEMPLATE } from '../js/generic-csv.js';
import { installVendors } from './vendor-helpers.js';
import { summarize } from '../js/aggregate.js';
import { colorForCategory } from '../js/charts.js';
import { iconSvg } from '../js/icons.js';
installVendors();
const header = '日期,金额,收支,分类,说明,来源,外部ID\n';
const read = (line, name = '通用.csv') => fileToTransactions(new File([header + line],name));

test('通用 CSV 支出完整保留来源和用户分类，说明不伪造商户',async()=>{
  const [t] = await read('2026-10-18 19:42,32.00,支出,外出用餐,"晚饭,测试",拼多多,order-1');
  assert.equal(t.datetime,'2026-10-18T19:42:00'); assert.equal(t.amount,32); assert.equal(t.direction,'支出');
  assert.equal(t.source,'拼多多'); assert.equal(t.rawCategory,'外出用餐'); assert.equal(resolveCategory(t,{测试:'购物'}),'外出用餐');
  assert.equal(t.counterparty,''); assert.equal(t.description,'晚饭,测试'); assert.equal(t.externalOrderId,'order-1');
  assert.ok(transactionCategories(t).includes('外出用餐'));
});
test('通用收入、纯日期与秒时间均不改变本地日期，空分类沿用规则',async()=>{
  const [income,expense] = await read('2026-10-01,5200,收入,工资,,招商银行,\n2026-10-01 23:59:59,1.20,支出,,现金午餐,现金,');
  assert.equal(income.direction,'收入'); assert.equal(income.datetime,'2026-10-01T00:00:00'); assert.equal(income.source,'招商银行');
  assert.equal(expense.datetime,'2026-10-01T23:59:59'); assert.equal(resolveCategory(expense),'餐饮');
});
test('无外部ID同文件改名跳过，相同行保留各自行身份，不同文件不按时间金额去重',async()=>{
  const line = '2026-10-18,32,支出,餐饮,测试,现金,', rows = await read(line+'\n'+line);
  assert.notEqual(rows[0].id,rows[1].id); assert.match(rows[0].id,/^file:v1:/);
  const again = mergeTransactions(rows,await read(line+'\n'+line,'改名.csv'));
  assert.equal(again.added,0); assert.equal(again.skipped,2);
  assert.equal(mergeTransactions(rows,await read(line.replace('测试','另一份测试'))).added,1);
});
test('外部ID按真实来源稳定去重，不同来源同号不冲突',async()=>{
  const a = await read('2026-10-18,32,支出,餐饮,测试,拼多多,same');
  const b = await read('2026-10-18,32,支出,餐饮,不同说明,拼多多,same');
  const c = await read('2026-10-18,32,支出,餐饮,测试,招商银行,same');
  assert.equal(a[0].id,b[0].id); assert.notEqual(a[0].id,c[0].id);
  assert.equal(mergeTransactions(a,b).added,0); assert.equal(mergeTransactions(a,c).added,1);
});
for (const date of ['','2026-02-30','2026-13-01','2026-10-01 24:00','2026-10-01 12:60','2026-10-01 12:00:60','2026/10/01'])
  test(`通用 CSV 拒绝非法日期 ${date || '空'}`,async()=>assert.rejects(read(`${date},1,支出,,,现金,`),/第 2 行.*日期/));
for (const amount of ['0','-1','NaN','1.234','','Infinity','1e3','10元'])
  test(`通用 CSV 拒绝非法金额 ${amount || '空'}`,async()=>assert.rejects(read(`2026-10-01,${amount},支出,,,现金,`),/金额/));
test('通用 CSV 拒绝缺来源、保留来源手动与非法收支，非法后行不静默丢失',async()=>{
  await assert.rejects(read('2026-10-01,1,支出,,,,') , /来源/);
  await assert.rejects(read('2026-10-01,1,支出,,,手动,') , /来源/);
  await assert.rejects(read('2026-10-01,1,不计收支,,,现金,') , /收支/);
  await assert.rejects(read('2026-10-01,1,支出,,,现金,\n坏日期,1,支出,,,现金,'),/第 3 行/);
});
test('通用 CSV 支持BOM及可选列缺省，模板只有标准表头',async()=>{
  const rows = await fileToTransactions(new File(['\uFEFF日期,金额,收支,来源\r\n2026-10-01,1,收入,Google Play'],'minimal.csv'));
  assert.equal(rows[0].description,''); assert.equal(rows[0].source,'Google Play');
  assert.equal(GENERIC_CSV_TEMPLATE,'\uFEFF'+header.trim()+'\r\n');
});
test('CSV列数错误明确报错，不截断额外列',async()=>assert.rejects(read('2026-10-01,1,支出,,,现金,,多余列'),/格式错误/));
test('任意用户分类名安全计入分类金额，特殊对象键也不丢失或产生无效图标配色',async()=>{
  const categories=['__proto__','constructor','toString'];
  const rows=await read(categories.map(c=>`2026-10-01,1,支出,${c},,现金,`).join('\n'));
  const result=summarize(rows);assert.equal(result.totalExpense,3);
  for(const c of categories){
    assert.ok(Object.hasOwn(result.byCategory,c));assert.equal(result.byCategory[c],1);
    assert.equal(colorForCategory(c),colorForCategory('其他'));assert.equal(iconSvg(c),iconSvg('其他'));
  }
});
