import { isManualTransaction } from './manual.js';
import { adjustTransaction } from './review.js';
import { categoryUpdatePlan } from './transaction-edit.js';
import { updateTransactionFields, editAffectsReconciliation } from './transaction-update.js';
import { createSnapshot, sortSnapshots } from './snapshots.js';
import { reconcileTransaction, isReconciledDuplicate } from './reconciliation.js';
import { LEDGER_ID, normalizeLedger, emptyLedger } from './asset-ledger.js';

const DB_NAME = 'jizhang', STORE_TXN = 'transactions', STORE_MEM = 'merchantMemory',
  STORE_SNAPSHOT = 'snapshots', STORE_LEDGER = 'assetLedger';
// v2 -> v3 只新增 assetLedger，既有 store 与全部记录原样保留。
const DB_VERSION = 3;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    req.onblocked = () => {
      blocked = true;
      reject(new Error('数据库升级被旧页面占用，请关闭其他记账页面后刷新；数据未被清空'));
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TXN))
        db.createObjectStore(STORE_TXN, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_MEM))
        db.createObjectStore(STORE_MEM, { keyPath: 'counterparty' });
      if (!db.objectStoreNames.contains(STORE_SNAPSHOT))
        db.createObjectStore(STORE_SNAPSHOT, { keyPath: 'id' });
      // 只创建缺失的 store，绝不删除或重建已有 store。
      if (!db.objectStoreNames.contains(STORE_LEDGER))
        db.createObjectStore(STORE_LEDGER, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close(); else resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveTransactions(txns) {
  const db = await openDb();
  const tx = db.transaction(STORE_TXN, 'readwrite');
  const store = tx.objectStore(STORE_TXN);
  for (const t of txns) store.put(t);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); })
    .finally(() => db.close());
}

export async function loadAllTransactions() {
  const db = await openDb();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE_TXN).objectStore(STORE_TXN).getAll();
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  }).finally(() => db.close());
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
  }).finally(() => db.close());
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
  }).finally(() => db.close());
}

// 编辑与关联核对、商户记忆在同一事务内完成；只在最新记录上应用可编辑字段。
export async function saveTransactionEdit(id, input) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_TXN, STORE_MEM], 'readwrite');
    const store = tx.objectStore(STORE_TXN);
    let result, failure;
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        const rows = request.result;
        const before = rows.find(t => t.id === id);
        if (!before) throw new Error('记录已不存在，请刷新后重试');
        const updated = updateTransactionFields(before, input);
        const current = new Map(rows.map(t => [t.id, t]));
        current.set(id, updated);
        const touchedIds = new Set([id]);
        let memoryEntry = null;
        if (before.myCategory !== updated.myCategory) {
          const plan = categoryUpdatePlan([...current.values()], id, updated.myCategory);
          for (const t of plan.touched) { current.set(t.id, t); touchedIds.add(t.id); }
          memoryEntry = plan.memoryEntry;
        }
        if (editAffectsReconciliation(before, updated)) {
          for (const t of current.values()) {
            const own = t.id === id;
            const linked = t.reconciledDuplicateOf === id;
            const dismissed = t.reconciliationDismissedIds?.includes(id);
            if (!own && !linked && !dismissed) continue;
            const copy = { ...t };
            if (own || linked) delete copy.reconciledDuplicateOf;
            if (own) delete copy.reconciliationDismissedIds;
            else if (dismissed) copy.reconciliationDismissedIds = copy.reconciliationDismissedIds.filter(other => other !== id);
            current.set(t.id, copy); touchedIds.add(t.id);
          }
        }
        const touched = [...touchedIds].map(key => current.get(key));
        for (const t of touched) store.put(t);
        if (memoryEntry) tx.objectStore(STORE_MEM).put(memoryEntry);
        result = { touched, memoryEntry,
          adjustmentCleared:before.countedAmount != null && updated.countedAmount == null && updated.direction === '支出' };
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(failure || tx.error || new Error('编辑保存未完成'));
  }).finally(() => db.close());
}

export async function saveMemory(counterparty, category) {
  const db = await openDb();
  const tx = db.transaction(STORE_MEM, 'readwrite');
  tx.objectStore(STORE_MEM).put({ counterparty, category });
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); })
    .finally(() => db.close());
}

export async function saveTransactionCategory(id, category) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_TXN, STORE_MEM], 'readwrite');
    const store = tx.objectStore(STORE_TXN);
    let plan, failure;
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        plan = categoryUpdatePlan(request.result, id, category);
        for (const t of plan.touched) store.put(t);
        if (plan.memoryEntry) tx.objectStore(STORE_MEM).put(plan.memoryEntry);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(plan);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(failure || tx.error || new Error('分类保存未完成'));
  }).finally(() => db.close());
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
  }).finally(() => db.close());
}

export async function clearAllData() {
  const db = await openDb();
  const tx = db.transaction([STORE_TXN, STORE_MEM, STORE_SNAPSHOT, STORE_LEDGER], 'readwrite');
  tx.objectStore(STORE_TXN).clear();
  tx.objectStore(STORE_MEM).clear();
  tx.objectStore(STORE_SNAPSHOT).clear();
  tx.objectStore(STORE_LEDGER).clear();
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); })
    .finally(() => db.close());
}

// ===== 资产总账（当前状态；单一 singleton 记录） =====
export async function loadAssetLedger() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_LEDGER).objectStore(STORE_LEDGER).get(LEDGER_ID);
    req.onsuccess = () => resolve(req.result ? normalizeLedger(req.result) : emptyLedger());
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

// 写入前先在事务外校验；非法总账不会落库。
export async function saveAssetLedger(ledger) {
  const checked = normalizeLedger(ledger);
  const db = await openDb();
  const tx = db.transaction(STORE_LEDGER, 'readwrite');
  tx.objectStore(STORE_LEDGER).put(checked);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); })
    .finally(() => db.close());
}

export async function exportBackup() {
  const db = await openDb();
  // 四类数据在同一只读事务中取一致的快照。
  const backup = await new Promise((resolve,reject) => {
    const tx = db.transaction([STORE_TXN,STORE_MEM,STORE_SNAPSHOT,STORE_LEDGER]);
    const txns = tx.objectStore(STORE_TXN).getAll();
    const memories = tx.objectStore(STORE_MEM).getAll();
    const snapshots = tx.objectStore(STORE_SNAPSHOT).getAll();
    const ledger = tx.objectStore(STORE_LEDGER).get(LEDGER_ID);
    tx.oncomplete = () => resolve({txns:txns.result,
      mem:Object.fromEntries(memories.result.map(m => [m.counterparty,m.category])), snapshots:sortSnapshots(snapshots.result),
      assetLedger:ledger.result ? normalizeLedger(ledger.result) : emptyLedger()});
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
  const blob = new Blob([JSON.stringify(backup, null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `记账备份-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}

export async function importBackup(file) {
  const parsed = JSON.parse(await file.text());
  const { txns = [], mem = {}, snapshots = [] } = parsed;
  if (!Array.isArray(txns) || txns.some(t => !t || typeof t.id !== 'string' || !t.id) ||
      !mem || typeof mem !== 'object' || Array.isArray(mem) || !Array.isArray(snapshots))
    throw new Error('备份结构无效，现有数据未改动');
  // 老备份没有 assetLedger：跳过该表，旧数据与现有总账都不改动。
  const hasLedger = Object.hasOwn(parsed, 'assetLedger') && parsed.assetLedger != null;
  let ledger = null;
  if (hasLedger) {
    try { ledger = normalizeLedger(parsed.assetLedger); }
    catch (error) { throw new Error('资产总账备份无效：' + error.message); }
  }
  const checked = snapshots.map(s => {
    if (!s || typeof s.id !== 'string' || !s.id || typeof s.createdAt !== 'string' || !s.createdAt)
      throw new Error('快照备份无效');
    const valid = createSnapshot(s, s);
    if (valid.netAssets !== s.netAssets) throw new Error('快照净资产不一致');
    return valid;
  });
  const db = await openDb();
  return new Promise((resolve,reject) => {
    const tx = db.transaction([STORE_TXN, STORE_MEM, STORE_SNAPSHOT, STORE_LEDGER], 'readwrite');
    let failure;
    const store = tx.objectStore(STORE_TXN), request = store.getAll();
    request.onsuccess = () => {
      try {
        const merged = new Map(request.result.map(t => [t.id,t]));
        for (const t of txns) merged.set(t.id,t);
        const targets = new Set();
        for (const t of merged.values()) if (isReconciledDuplicate(t)) {
          if (targets.has(t.reconciledDuplicateOf)) throw new Error('备份核对关系冲突，未恢复任何数据');
          targets.add(t.reconciledDuplicateOf);
        }
        for (const t of txns) store.put(t);
        for (const [cp,cat] of Object.entries(mem)) tx.objectStore(STORE_MEM).put({counterparty:cp,category:cat});
        for (const s of checked) tx.objectStore(STORE_SNAPSHOT).put(s);
        if (ledger) tx.objectStore(STORE_LEDGER).put(ledger);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = resolve;
    tx.onabort = () => reject(failure || tx.error || new Error('备份恢复未完成'));
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

export async function loadSnapshots() {
  const db = await openDb();
  return new Promise((resolve,reject) => {
    const req = db.transaction(STORE_SNAPSHOT).objectStore(STORE_SNAPSHOT).getAll();
    req.onsuccess = () => resolve(sortSnapshots(req.result));
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

export async function saveSnapshot(input, id = null) {
  const db = await openDb();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE_SNAPSHOT, 'readwrite'), store = tx.objectStore(STORE_SNAPSHOT);
    let updated, failure;
    const save = existing => {
      try {
        if (id && !existing) throw new Error('快照不存在');
        updated = createSnapshot(input, existing); store.put(updated);
      } catch (error) { failure = error; tx.abort(); }
    };
    if (id) { const req = store.get(id); req.onsuccess = () => save(req.result); }
    else save(null);
    tx.oncomplete = () => resolve(updated);
    tx.onabort = () => reject(failure || tx.error || new Error('快照保存未完成'));
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

export async function deleteSnapshot(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_SNAPSHOT, 'readwrite');
  tx.objectStore(STORE_SNAPSHOT).delete(id);
  return new Promise((resolve,reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); })
    .finally(() => db.close());
}

export async function saveReconciliation(manualId, importedId, action) {
  const db = await openDb();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE_TXN, 'readwrite'), store = tx.objectStore(STORE_TXN);
    let updated, failure;
    const req = store.getAll();
    req.onsuccess = () => {
      try { updated = reconcileTransaction(req.result, manualId, importedId, action); store.put(updated); }
      catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(updated);
    tx.onabort = () => reject(failure || tx.error || new Error('核对未完成'));
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}
