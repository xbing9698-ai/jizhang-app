import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../css/style.css',import.meta.url),'utf8');
test('首页按结余、分类组织，保留全部时间控件及资产入口',()=>{
  const page=html.slice(html.indexOf('id="view-overview"'),html.indexOf('id="view-detail"'));
  assert.ok(!page.includes('id="quickEntryOpen"'));
  assert.ok(page.indexOf('id="sumNet"')<page.indexOf('id="pieChart"'));
  for(const id of ['billingRange','customRangeOpen','allRange','monthPick','sumIncome','sumExpense','snapshotsOpen','balanceOpen','trendChart','periodRows'])assert.ok(page.includes('id="'+id+'"'));
});
test('记一笔是页面外的唯一全局动作，位于三项导航之前并为内容预留安全区',()=>{
  const action=html.indexOf('class="global-quick-action"');
  assert.ok(action>html.indexOf('</main>'));
  assert.ok(action<html.indexOf('<nav'));
  assert.equal([...html.matchAll(/id="quickEntryOpen"/g)].length,1);
  assert.match(css,/\.global-quick-action\{position:fixed;/);
  assert.ok(css.includes('bottom:calc(var(--bottom-nav-height) + 10px + env(safe-area-inset-bottom))'));
  assert.ok(css.includes('padding-bottom:calc(var(--bottom-nav-height) + var(--quick-action-height) + 34px + env(safe-area-inset-bottom))'));
});
test('底部只保留三项导航，子图标不拦截既有按钮点击，安全区留白保留',()=>{
  const nav=html.match(/<nav[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]),['overview','detail','import']);
  assert.match(css,/\.tab>\*\{pointer-events:none\}/);
  assert.ok(css.includes('env(safe-area-inset-bottom)'));
});
