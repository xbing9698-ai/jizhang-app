import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../css/style.css',import.meta.url),'utf8');
test('首页按记一笔、结余、分类组织，保留全部时间控件及资产入口',()=>{
  const page=html.slice(html.indexOf('id="view-overview"'),html.indexOf('id="view-detail"'));
  assert.ok(page.indexOf('id="quickEntryOpen"')<page.indexOf('id="sumNet"'));
  assert.ok(page.indexOf('id="sumNet"')<page.indexOf('id="pieChart"'));
  for(const id of ['billingRange','customRangeOpen','allRange','monthPick','sumIncome','sumExpense','snapshotsOpen','balanceOpen','trendChart','periodRows'])assert.ok(page.includes('id="'+id+'"'));
});
test('底部只保留三项导航，子图标不拦截既有按钮点击，安全区留白保留',()=>{
  const nav=html.match(/<nav[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]),['overview','detail','import']);
  assert.match(css,/\.tab>\*\{pointer-events:none\}/);
  assert.ok(css.includes('env(safe-area-inset-bottom)'));
});
