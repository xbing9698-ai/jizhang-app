import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 运行应用实际随附的解析器，避免以简化 CSV/XLSX 桩替代集成验证。
export function installVendors() {
  for (const [name, file] of [['Papa', 'papaparse.min.js'], ['XLSX', 'xlsx.full.min.js']]) {
    const sandbox = { Date, Uint8Array, ArrayBuffer };
    vm.runInNewContext(readFileSync(new URL('../js/vendor/' + file, import.meta.url), 'utf8'), sandbox);
    globalThis[name] = sandbox[name];
  }
}
