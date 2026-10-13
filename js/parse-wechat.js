// readWechatFile：浏览器中用 SheetJS 读取 File，cellDates 让时间序列号转 Date
export async function readWechatFile(file, buf = null) {
  buf ??= await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
}

// parseWechatRows：纯逻辑，输入二维数组，定位表头后映射为对象
export function parseWechatRows(rows) {
  const headerIdx = rows.findIndex(r => Array.isArray(r) && r[0] === '交易时间');
  if (headerIdx === -1) throw new Error('未找到微信表头行');
  const header = rows[headerIdx].map(h => String(h).trim());
  return rows.slice(headerIdx + 1)
    .filter(r => r && r[0] !== '' && r[0] != null)
    .map(r => {
      const out = {};
      header.forEach((h, i) => { out[h] = r[i] ?? ''; });
      return out;
    });
}
