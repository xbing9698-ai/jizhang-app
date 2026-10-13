// 依赖全局 Papa（浏览器由 vendor 脚本注入，测试加载同一份 vendor）。

const LEDGER_HEADERS = ['记录时间', '分类', '收支类型', '金额', '备注', '账户', '来源', '标签'];
const FLOW_HEADERS = ['交易时间', '收/支', '金额'];

function findHeader(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const headerIdx = lines.findIndex(line => {
    const fields = line.trim().split(',').map(field =>
      field.trim().replace(/^"(.*)"$/, '$1').trim());
    return [LEDGER_HEADERS, FLOW_HEADERS].some(required =>
      required.every(field => fields.includes(field)));
  });
  if (headerIdx === -1) throw new Error('未找到支付宝表头行');
  return { lines, headerIdx };
}

// 纯逻辑：定位表头行，返回从表头开始的 CSV 文本
export function stripAlipayHeader(text) {
  const { lines, headerIdx } = findHeader(text);
  return lines.slice(headerIdx).join('\n');
}

// 纯逻辑：清洗单行（键名/值去空白，订单号去尾部制表符）
export function cleanRow(r) {
  const out = {};
  for (const k of Object.keys(r)) out[k.trim()] = String(r[k] ?? '').trim();
  return out;
}

// 集成：完整解析，使用全局 Papa（浏览器中运行）
export function parseAlipayCsv(text) {
  const body = stripAlipayHeader(text);
  const parsed = Papa.parse(body, {
    header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim()
  });
  return parsed.data
    .map(cleanRow)
    .filter(r => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(r['记录时间'] || r['交易时间'] || ''));
}
