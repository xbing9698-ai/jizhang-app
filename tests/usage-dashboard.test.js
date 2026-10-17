import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentBillingPeriod, customDateRange, usageTimeRange } from '../js/period.js';
import { summarize } from '../js/aggregate.js';
import { createSnapshot, referenceFromSnapshot } from '../js/snapshots.js';

const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const app=readFileSync(new URL('js/app.js',root),'utf8');
const css=readFileSync(new URL('css/style.css',root),'utf8');
const home=html.slice(html.indexOf('id="view-overview"'),html.indexOf('id="view-detail"'));
const tx=(id,datetime,direction,amount,extra={})=>({id,datetime,direction,amount,source:'微信',myCategory:'餐饮',...extra});
const rows=[
  tx('salary','2026-10-15T10:00:00','收入',5200),
  tx('food','2026-10-16T12:00:00','支出',20),
  tx('old','2026-10-01T12:00:00','支出',100)
];

test('保留本账期、自定义、使用以来三项时间控件，账期选择改为完整日期范围下拉',()=>{
  for(const id of ['billingRange','customRangeOpen','allRange','monthPick'])assert.ok(home.includes(`id="${id}"`));
  assert.match(home,/id="monthPick"[^>]*><\/select>/);
  assert.ok(app.includes('function billingOptionLabel(label)'));
  assert.match(app,/月.*日－/);
  assert.ok(css.includes('.range-picker[open] .range-label{display:none}'));
});

test('首页结构为收支概览、参考资产、分类统计，底部记一笔仍是独立全局动作',()=>{
  assert.ok(home.indexOf('id="sumNet"')<home.indexOf('id="assetCurrent"'));
  assert.ok(home.indexOf('id="assetCurrent"')<home.indexOf('id="pieChart"'));
  for(const id of ['assetNetLabel','assetNet','assetReferenceMeta','assetReferenceChange','assetSnapshotNow','assetLedgerOpen','snapshotsOpen','balanceOpen'])
    assert.ok(home.includes(`id="${id}"`));
  assert.equal([...html.matchAll(/id="quickEntryOpen"/g)].length,1);
  assert.ok(html.indexOf('class="global-quick-action"')<html.indexOf('<nav'));
});

test('切换历史账期只改变收支统计，不改变当前参考净资产的计算基准',()=>{
  const snapshot=createSnapshot({date:'2026-10-15',time:'09:00',totalAssets:'5000',totalLiabilities:'0',transactionIdsAtCapture:[]});
  const ref=referenceFromSnapshot(snapshot,rows,new Date(2026,9,17,20));
  assert.equal(ref.referenceNetAssets,10180); // 5000 + 5200 - 20
  const billing=summarize(rows,currentBillingPeriod(new Date(2026,9,17)));
  const custom=summarize(rows,customDateRange('2026-10-16','2026-10-16'));
  const usage=summarize(rows,usageTimeRange());
  assert.notEqual(billing.net,custom.net);
  assert.notEqual(custom.net,usage.net);
  // 参考值函数不接收“当前查看范围”，因此切换范围不会回拨资产卡。
  assert.equal(referenceFromSnapshot(snapshot,rows,new Date(2026,9,17,20)).referenceNetAssets,ref.referenceNetAssets);
  const fn=app.slice(app.indexOf('function renderAssetReference()'),app.indexOf('// 环比变化文字'));
  assert.ok(fn.includes('referenceFromSnapshot(latest, transactions)'));
  assert.ok(!fn.includes('summarize(transactions, range)'));
});

test('没有快照时资产卡明确提示先记录盘点，而不是用收支差额冒充净资产',()=>{
  const fn=app.slice(app.indexOf('function renderAssetReference()'),app.indexOf('// 环比变化文字'));
  assert.match(fn,/记录一次资产快照后/);
  assert.ok(fn.includes('if (!latest && !hasLedger)'));
});

test('参考资产卡显示最近真实盘点、盘点后变化和同日无时间警告',()=>{
  const fn=app.slice(app.indexOf('function renderAssetReference()'),app.indexOf('// 环比变化文字'));
  for(const text of ['参考当前净资产','最近盘点','盘点后变化','同日无准确时间'])assert.ok(fn.includes(text));
});
