import { isManualTransaction } from './manual.js';
import { adjustTransaction } from './review.js';

const DB_NAME = 'jizhang', STORE_TXN = 'transactions', STORE_MEM = 'merchantMemory';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TXN))
        db.createObjectStore(STORE_TXN, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_MEM))
        db.createObjectStore(STORE_MEM, { keyPath: 'counterparty' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTransactions(txns) {
  const db = await openDb();
  const tx = db.transaction(STORE_TXN, 'readwrite');
  const store = tx.objectStore(STORE_TXN);
  for (const t of txns) store.put(t);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

export async function loadAllTransactions() {
  const db = await openDb();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE_TXN).objectStore(STORE_TXN).getAll();
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}

// 在同一读写事务中检查实际存储的来源，不能凭页面参数删除导入记录。
export async function deleteManualTransaction(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TXN, 'readwrite');
    const store = tx.objectStore(STORE_TXN);
    let refusal;
    const req = store.get(id);
    req.onsuccess = () => {
      if (!isManualTransaction(req.result)) {
        refusal = new Error('只能删除手动补录记录');
        tx.abort();
        return;
      }
      store.delete(id);
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(refusal || tx.error || new Error('删除未完成'));
  });
}

// 从实际存储的记录生成单笔调整，避免覆盖原始字段或并发更新的其他信息。
export async function saveExpenseAdjustment(id, action, amount) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TXN, 'readwrite');
    const store = tx.objectStore(STORE_TXN);
    let updated, failure;
    const req = store.get(id);
    req.onsuccess = () => {
      try {
        updated = adjustTransaction(req.result, action, amount);
        store.put(updated);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(updated);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(failure || tx.error || new Error('调整未完成'));
  });
}

export async function saveMemory(counterparty, category) {
  const db = await openDb();
  const tx = db.transaction(STORE_MEM, 'readwrite');
  tx.objectStore(STORE_MEM).put({ counterparty, category });
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

export async function loadMemory() {
  const db = await openDb();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE_MEM).objectStore(STORE_MEM).getAll();
    req.onsuccess = () => {
      const map = {};
      for (const row of req.result) map[row.counterparty] = row.category;
      res(map);
    };
    req.onerror = () => rej(req.error);
  });
}

export async function clearAllData() {
  const db = await openDb();
  const tx = db.transaction([STORE_TXN, STORE_MEM], 'readwrite');
  tx.objectStore(STORE_TXN).clear();
  tx.objectStore(STORE_MEM).clear();
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

export async function exportBackup() {
  const txns = await loadAllTransactions();
  const mem = await loadMemory();
  const blob = new Blob([JSON.stringify({ txns, mem }, null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `记账备份-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}

export async function importBackup(file) {
  const { txns, mem } = JSON.parse(await file.text());
  if (txns) await saveTransactions(txns);
  if (mem) for (const [cp, cat] of Object.entries(mem)) await saveMemory(cp, cat);
}
