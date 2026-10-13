// 文件身份只依赖内容，不依赖文件名或修改时间；相同文件重命名后仍可去重。
export async function fingerprintFile(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// 用于没有文件上下文的纯逻辑调用，排序键名以消除对象插入顺序的影响。
export function stableSerialize(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k =>
      JSON.stringify(k) + ':' + stableSerialize(value[k])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

export function cleanOrderId(value) {
  const id = String(value ?? '').trim();
  return ['', '/', '-', 'undefined', 'null'].includes(id) ? '' : id;
}

export function transactionIdentity(source, orderId, row, context = {}) {
  const externalOrderId = cleanOrderId(orderId);
  const platform = encodeURIComponent(source);
  const id = externalOrderId
    ? `order:v1:${platform}:${encodeURIComponent(externalOrderId)}`
    : context.fileFingerprint
      ? `file:v1:${platform}:${context.fileFingerprint}:${context.rowIndex ?? 0}`
      : `row:v1:${platform}:${encodeURIComponent(stableSerialize(row))}:${context.rowIndex ?? 0}`;
  return {
    id,
    externalOrderId,
    ...(context.fileFingerprint ? {
      importFileFingerprint: context.fileFingerprint,
      importRowIndex: context.rowIndex ?? 0
    } : {})
  };
}

// 旧记录的 id 就是外部订单号。只在比较时建立平台化身份，不改写旧记录。
export function businessOrderKey(t) {
  const orderId = cleanOrderId(Object.hasOwn(t, 'externalOrderId') ? t.externalOrderId : t.id);
  return t.source && orderId
    ? JSON.stringify([t.source, orderId])
    : null;
}
