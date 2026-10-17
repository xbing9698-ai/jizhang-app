import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot, referenceFromSnapshot, relationToSnapshot, formatSnapshotMoment } from '../js/snapshots.js';

test('参考当前净资产从最近真实快照时点之后的流水推算', () => {
  const s=createSnapshot({date:'2026-10-17',time:'12:00',totalAssets:'6000',totalLiabilities:'1000',transactionIdsAtCapture:['old']});
  const rows=[
    {id:'old',datetime:'2026-10-17T00:00:00',source:'手动',direction:'支出',amount:20,myCategory:'餐饮'},
    {id:'income',datetime:'2026-10-17T13:00:00',source:'微信',direction:'收入',amount:100,myCategory:'其他'},
    {id:'expense',datetime:'2026-10-17T14:00:00',source:'微信',direction:'支出',amount:30,myCategory:'餐饮'}
  ];
  const r=referenceFromSnapshot(s,rows,new Date(2026,9,17,20,0,0));
  assert.equal(r.referenceNetAssets,5070);assert.equal(r.income,100);assert.equal(r.expense,30);assert.equal(r.uncertainCount,0);
  assert.equal(formatSnapshotMoment(s),'2026-10-17 12:00');
});

test('同日无时间流水用快照水印判断是否已存在，快照后才出现则标记不确定', () => {
  const s=createSnapshot({date:'2026-10-17',time:'12:00',totalAssets:'5000',totalLiabilities:'0',transactionIdsAtCapture:['known']});
  assert.equal(relationToSnapshot(s,{id:'known',datetime:'2026-10-17T00:00:00',source:'手动'}).relation,-1);
  const rel=relationToSnapshot(s,{id:'late',datetime:'2026-10-17T00:00:00',source:'手动'});
  assert.equal(rel.relation,1);assert.equal(rel.uncertain,true);
});

test('旧快照无时间继续按当日结束口径兼容', () => {
  const legacy={id:'s',date:'2026-10-17',totalAssets:5000,totalLiabilities:0,netAssets:5000,createdAt:'2026-10-17T12:00:00Z'};
  assert.equal(relationToSnapshot(legacy,{id:'x',datetime:'2026-10-17T18:00:00',source:'微信'}).relation,-1);
});
