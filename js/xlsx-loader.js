// XLSX 按需加载：普通打开 App 不加载约 880KB 的 SheetJS，只有真正处理 .xlsx 时才加载。
const XLSX_URL = new URL('./vendor/xlsx.full.min.js', import.meta.url).href;

export function createXlsxLoader({ url = null, doc = () => document, scope = () => globalThis } = {}) {
  const target = url || XLSX_URL;
  // 每个加载器只有一个 Promise：同一页面生命周期只加载一次，并发调用共享它。
  let pending = null;
  return function ensureXlsxLoaded() {
    const existing = scope().XLSX;
    if (existing) return Promise.resolve(existing);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        const script = doc().createElement('script');
        script.src = target;
        script.async = true;
        script.onload = () => {
          const loaded = scope().XLSX;
          if (loaded) resolve(loaded);
          else reject(new Error('表格解析库加载失败：未找到 XLSX 全局对象'));
        };
        script.onerror = () => reject(new Error('表格解析库加载失败，请检查网络后重试'));
        doc().head.appendChild(script);
      }).catch(error => {
        // 失败后允许用户重试，不把页面永久卡在失败状态。
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}

export const ensureXlsxLoaded = createXlsxLoader();
