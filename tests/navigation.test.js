import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('切换页面时回到顶部，显示对应导航和明细入口',()=>{
  const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function switchView('),source.indexOf("document.getElementById('tabs')"));
  const positions=[];let renders=0;
  const tabs=['overview','detail','import'].map(view=>({dataset:{view},classList:{toggle(_,active){this.active=active;}}}));
  const views=tabs.map(t=>({id:'view-'+t.dataset.view,classList:{toggle(_,active){this.active=active;}}}));
  const context={document:{querySelectorAll:selector=>selector==='.tab'?tabs:views},window:{scrollTo:(x,y)=>positions.push([x,y])},renderDetail:()=>{renders++;}};
  vm.runInNewContext(fn+'\nswitchView("detail");',context);
  assert.equal(renders,1);assert.equal(tabs[1].classList.active,true);assert.equal(views[1].classList.active,true);assert.deepEqual(positions,[[0,0]]);
  context.switchView('overview');assert.equal(views[0].classList.active,true);assert.deepEqual(positions,[[0,0],[0,0]]);
});
