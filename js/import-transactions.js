import { decodeSmart } from './decode.js';
import { parseAlipayCsv } from './parse-alipay.js';
import { readWechatFile, parseWechatRows } from './parse-wechat.js';
import { normalizeAlipay, normalizeWechat } from './normalize.js';
import { fingerprintFile } from './identity.js';

// 浏览器和测试共用的完整导入路径，确保每笔无订单号记录也有文件及行身份。
export async function fileToTransactions(file) {
  const extension = file.name.toLowerCase().split('.').pop();
  if (!['csv', 'xlsx'].includes(extension))
    throw new Error('不支持的文件类型：' + file.name);
  const buffer = await file.arrayBuffer();
  const fileFingerprint = await fingerprintFile(buffer);
  const rows = extension === 'csv'
    ? parseAlipayCsv(decodeSmart(buffer))
    : parseWechatRows(await readWechatFile(file, buffer));
  const normalize = extension === 'csv' ? normalizeAlipay : normalizeWechat;
  return rows.map((row, rowIndex) => normalize(row, { fileFingerprint, rowIndex }));
}
