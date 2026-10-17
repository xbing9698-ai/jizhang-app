import { readFileSync, writeFileSync } from 'node:fs';
const read = p => readFileSync(p, 'utf8');
const write = (p, s) => writeFileSync(p, s, 'utf8');

// 1) 清理 app.js 中已被新交易编辑器替代的旧分类编辑死代码，并允许“只有快照、还没建总账”时继续进入管理资产。
{
  const p = 'js/app.js';
  let s = read(p);
  s = s.replace(
    "import { resolveCategory, CATEGORIES, INCOME_CATEGORIES, transactionCategories } from './classify.js';",
    "import { resolveCategory, CATEGORIES, INCOME_CATEGORIES } from './classify.js';"
  );
  s = s.replace(
    'clearAllData, exportBackup, importBackup, deleteManualTransaction, saveExpenseAdjustment, saveTransactionCategory,\n  loadSnapshots',
    'clearAllData, exportBackup, importBackup, deleteManualTransaction, saveExpenseAdjustment,\n  loadSnapshots'
  );
  s = s.replace(
    /\nasync function onChangeCategory\(\) \{[\s\S]*?\n\}\n\nfunction populateCategoryFilter\(\) \{/,
    '\nfunction populateCategoryFilter() {'
  );
  s = s.replace(
    "document.getElementById('assetLedgerOpen').hidden = !hasLedger;",
    "document.getElementById('assetLedgerOpen').hidden = !hasLedger && !latest;"
  );
  write(p, s);
}

// 2) 修复新交易详情测试文件里由生成脚本写出的转义换行。
{
  const p = 'tests/transaction-panel.test.js';
  let s = read(p);
  const broken = "vm.runInNewContext(editor+'\nonOpenAdjustment({currentTarget:{dataset:{id:\"test-id\"}}});',context);";
  const fixed = "vm.runInNewContext(editor+'\\nonOpenAdjustment({currentTarget:{dataset:{id:\"test-id\"}}});',context);";
  if (s.includes(broken)) s = s.replace(broken, fixed);
  if (!s.includes(fixed)) throw new Error('未能修复 transaction-panel 测试换行');
  write(p, s);
}

// 3) 两个断言本意是检查源码包含固定文本，不应把括号当正则分组。
{
  const p = 'tests/usage-dashboard.test.js';
  let s = read(p);
  s = s.replace(
    "assert.match(app,/function billingOptionLabel(label)/);",
    "assert.ok(app.includes('function billingOptionLabel(label)'));"
  );
  s = s.replace(
    "assert.match(fn,/if \\(!latest && !hasLedger\\)/);",
    "assert.ok(fn.includes('if (!latest && !hasLedger)'));"
  );
  // 兼容上一轮生成文件中转义符已被模板吃掉的形式。
  s = s.replace(
    "assert.match(fn,/if (!latest && !hasLedger)/);",
    "assert.ok(fn.includes('if (!latest && !hasLedger)'));"
  );
  if (!s.includes("assert.ok(app.includes('function billingOptionLabel(label)'))")) throw new Error('账期标签断言未修复');
  if (!s.includes("assert.ok(fn.includes('if (!latest && !hasLedger)'))")) throw new Error('空资产状态断言未修复');
  write(p, s);
}

console.log('Finance upgrade finalizer applied.');
