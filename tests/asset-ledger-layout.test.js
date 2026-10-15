import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const css = readFileSync(new URL('css/style.css', root), 'utf8');
const app = readFileSync(new URL('js/app.js', root), 'utf8');

// 320×568 与 390×844 都不允许横向溢出、按钮遮挡或弹窗无法完成操作。
// 这里用静态约束验证新增界面：不使用固定 px 宽度、使用 flex 换行、允许长文本换行。
test('新增资产总账界面不使用固定px宽度，避免320px视口横向溢出', () => {
  const block = css.slice(css.indexOf('.asset-current{'), css.indexOf('.ledger-totals dd{') + '.ledger-totals dd{font-size:15px}'.length);
  assert.ok(block.length > 300, '应能定位到资产总账样式块');
  // 320px 视口下，任何 >=320px 的固定宽度都会横向溢出。
  const fixed = [...block.matchAll(/(?:^|[;{}])((?:min-|max-)?width)\s*:\s*([0-9]+)px/g)]
    .filter(m => Number(m[2]) >= 320);
  assert.deepEqual(fixed.map(m => m[1] + ':' + m[2]), [], '资产总账样式不应使用 >=320px 的固定宽度');
  // 长文本与长金额必须能换行。
  assert.match(css, /\.asset-net-value\{[^}]*overflow-wrap:anywhere\}/);
  assert.match(css, /\.account-name\{[^}]*overflow-wrap:anywhere\}/);
  assert.match(css, /\.account-balance\{[^}]*overflow-wrap:anywhere\}/);
  assert.match(css, /\.account-row\{[^}]*overflow-wrap:anywhere\}/);
  // 总资产/总负债并排时允许换行，窄屏不会把内容挤出屏幕。
  assert.match(css, /\.asset-split\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.account-main\{[^}]*min-width:0/);
});

test('320px窄屏断点保留，资产总账仍用可换行按钮容器与可滚动底部弹窗', () => {
  assert.ok(css.includes('@media(max-width:360px)'), '应保留窄屏断点');
  const narrow = css.slice(css.indexOf('@media(max-width:360px)'));
  // 窄屏下弹窗左右内边距收紧，表单仍在视口内。
  assert.match(narrow, /\.sheet,\.quick-sheet\{padding-left:16px;padding-right:16px\}/);
  // 按钮容器换行 + 按钮等分宽度：两个按钮在窄屏会自动换到下一行而不是挤出屏幕。
  assert.match(css, /\.btn-row,\.sheet-actions\{[^}]*flex-wrap:wrap\}/);
  assert.match(css, /\.btn-row \.btn\{flex:1\}/);
  // 弹窗本身可以纵向滚动，且不会超过可视高度，短屏（568px）也能完成操作。
  assert.match(css, /\.sheet,\.quick-sheet\{[^}]*overflow-y:auto/);
  assert.match(css, /\.sheet,\.quick-sheet\{[^}]*max-height:calc\(100dvh - env\(safe-area-inset-top\) - 12px\)/);
  assert.match(css, /\.sheet,\.quick-sheet\{[^}]*padding:16px 20px calc\(20px \+ env\(safe-area-inset-bottom\)\)/);
});

test('新增弹窗都使用底部sheet结构、有关闭与确认控件，并复用可换行按钮容器', () => {
  for (const [id, closeId, submitId] of [
    ['assetLedgerDialog', 'assetLedgerClose', 'accountAdd'],
    ['accountEditDialog', 'accountEditClose', 'accountSave'],
    ['ledgerSnapshotDialog', 'snapshotFromLedgerClose', 'snapshotFromLedgerSave']
  ]) {
    const start = html.indexOf(`id="${id}"`);
    assert.ok(start > 0, `缺少弹窗 ${id}`);
    const dialog = html.slice(start, html.indexOf('</dialog>', start));
    assert.match(dialog, /class="sheet"/, `${id} 应使用与现有弹窗相同的底部 sheet 样式`);
    assert.ok(dialog.includes(`id="${closeId}"`), `${id} 缺少关闭按钮`);
    assert.ok(dialog.includes('class="sheet-header"'), `${id} 缺少弹窗标题栏`);
    assert.ok(dialog.includes(`id="${submitId}"`), `${id} 缺少确认控件`);
    assert.ok(dialog.includes('class="sheet-form"') || dialog.includes('class="btn-row"'), `${id} 缺少可操作区域`);
  }
  // 输入框都是原生控件，不套额外的固定宽度列。
  assert.ok(!/<input[^>]*style=/.test(html));
  assert.ok(!/id="accountBalance"[^>]*style=/.test(html));
});

test('底部导航与全局记一笔按钮保持原样，资产总账不新增导航项且不被底部导航遮挡', () => {
  const nav = html.match(/<nav[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]), ['overview','detail','import']);
  assert.equal([...html.matchAll(/id="quickEntryOpen"/g)].length, 1);
  // 当前资产区域位于页面正常文档流内，不参与固定定位。
  const section = html.slice(html.indexOf('id="assetCurrent"'), html.indexOf('id="assetCurrentBody"'));
  assert.ok(!section.includes('position:fixed'));
  // 页面为底部固定按钮与导航预留了安全区。
  assert.match(css, /body\{[^}]*padding-bottom:calc\(var\(--bottom-nav-height\) \+ var\(--quick-action-height\)/);
});

test('首页当前资产区域位于首页内容内，总账弹窗在页面末尾', () => {
  assert.ok(html.indexOf('id="assetCurrent"') < html.indexOf('id="view-detail"'));
  assert.ok(html.indexOf('id="assetLedgerDialog"') > html.indexOf('</main>'));
  // 记一笔与底部导航仍在外层固定容器中。
  assert.ok(html.indexOf('class="global-quick-action"') < html.indexOf('<nav'));
  // 文案与层级：使用以来的主数字是预计当前净资产，收支差额只作次级信息。
  assert.match(app, /'预计当前净资产' : '尚未设置起始净资产'/);
  assert.match(app, /'收支结余'/);
  assert.match(app, /getElementById\('sumNetLabel'\)/);
  assert.match(html, /<span>使用以来收支差额<\/span><b id="usageFlowNet">/);
  assert.ok(!html.includes('累计收支差额'));
});

test('使用以来的预计/实际净资产区域为窄屏安全布局，不新增底部导航', () => {
  const block = css.slice(css.indexOf('.net-usage{'), css.indexOf('.usage-net-note{') + '.usage-net-note{font-size:10px;color:var(--mute);margin-top:4px;text-align:right;overflow-wrap:anywhere}'.length);
  assert.ok(block.length > 400, '应能定位到使用以来样式块');
  const fixed = [...block.matchAll(/(?:^|[;{}])((?:min-|max-)?width)\s*:\s*([0-9]+)px/g)].filter(m => Number(m[2]) >= 320);
  assert.deepEqual(fixed.map(m => m[1] + ':' + m[2]), [], '不应使用 >=320px 的固定宽度');
  // 长标签与长金额都能换行，行内使用两端对齐而不是固定列宽。
  assert.match(css, /\.net-usage-values li\{[^}]*justify-content:space-between/);
  assert.match(css, /\.net-usage-values b\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.usage-net-row\{[^}]*justify-content:space-between/);
  assert.match(css, /\.usage-net-value\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.usage-net-meta\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.usage-net-note\{[^}]*overflow-wrap:anywhere/);
  // 预计净资产是主 KPI，使用 .kpi-value 大字号；次级列表不再有放大行。
  assert.match(css, /\.kpi-net \.kpi-value\{font-size:39px/);
  assert.ok(!css.includes('.net-usage-values li:first-child b'), '列表首行不应放大成主数字');
  // 新区域仍在首页内，不参与固定定位，不改变底部导航项。
  for (const id of ['netUsage','usageSnapshotSetup','netStartHint','netStartList','usageFlowNet',
    'netStartValue','netStartIncome','netStartExpense','usageNetCard','usageActualNet','usageActualMeta',
    'usageDiffRow','usageDiff','usageDiffNote'])
    assert.ok(html.includes(`id="${id}"`), `缺少 ${id}`);
  assert.ok(!html.includes('id="usageNetCard" style'));
  const nav = html.match(/<nav[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]), ['overview','detail','import']);
  // 使用以来区域位于首页内容内。
  assert.ok(html.indexOf('id="kpi-row"') === -1);
  assert.ok(html.indexOf('class="kpi-row"') < html.indexOf('id="usageNetCard"'));
  assert.ok(html.indexOf('id="usageNetCard"') < html.indexOf('id="view-detail"'));
});

