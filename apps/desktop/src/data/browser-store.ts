/* ══ 本地素材库（IndexedDB）═════════════════════════════════
   浏览器端的临时落点。Tauri 落地后换成 SQLite + 文件系统，
   但「按哈希去重、缩略图独立存放」这个结构不变。
   ------------------------------------------------------------ */

export type StoredItem = {
  id: string;
  hash: string;
  name: string;
  w: number;
  h: number;
  bytes: number;
  /** 主色，用来做加载占位 */
  color: string;
  /** 512 长边的缩略图；视频是首帧封面 */
  thumb: Blob;
  createdAt: number;
  /** 已有来源元数据时供检索使用，旧记录可缺省。 */
  site?: string;
  relativePath?: string;
  description?: string;
  sourceUrl?: string;
  rating?: number;
  palette?: string[];
  modifiedAt?: number;
  deletedSeq?: number;
  fileState?: "ready"|"pending"|"missing"|"unreadable"|"decode";
  storedPath?:string;
  collectionId?:string;
  /** 缺省按图片处理，兼容 v2 之前的记录 */
  kind?: "image" | "video" | "file";
  /** 视频时长（秒） */
  duration?: number;
  /** 原图扩展名；内容寻址落盘时用来拼文件名 */
  ext?: string;
};

const DB_NAME = "ceas";
/* v2：新增 originals 存储。原图必须和元数据分开存 ——
   否则 getAll() 会把几千张原图一起读进内存。 */
const DB_VERSION = 4;
const STORE = "items";
const ORIGINALS = "originals";

let connection: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("hash", "hash", { unique: true });
        os.createIndex("createdAt", "createdAt");
      }
      if (req.transaction && db.objectStoreNames.contains(STORE)) {
        const items = req.transaction.objectStore(STORE);
        if (items.indexNames.contains("hash")) items.deleteIndex("hash");
        items.createIndex("hash", "hash");
      }
      if (!db.objectStoreNames.contains(ORIGINALS)) {
        db.createObjectStore(ORIGINALS, { keyPath: "hash" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { connection = null; reject(req.error); };
    req.onblocked = () => { connection = null; reject(new Error("请关闭其它旧版 Ceas 页面，再重试升级存储")); };
  });
  return connection;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onabort = () => reject(t.error ?? new Error("存储事务已中止"));
    req.onerror = () => reject(req.error);
  });
}

export async function allItems(includeDeleted = false): Promise<StoredItem[]> {
  const rows = await tx<StoredItem[]>("readonly", (s) => s.getAll() as IDBRequest<StoredItem[]>);
  return rows.filter((row) => includeDeleted || row.deletedSeq === undefined).sort((a, b) => a.createdAt - b.createdAt);
}

export async function cachedItem(hash: string): Promise<StoredItem | undefined> {
  return tx("readonly", (store) => store.index("hash").get(hash) as IDBRequest<StoredItem | undefined>);
}

export async function hasHash(hash: string): Promise<boolean> {
  const hit = await tx<StoredItem | undefined>("readonly", (s) => s.index("hash").get(hash) as IDBRequest<StoredItem | undefined>);
  return !!hit;
}

export async function putItem(item: StoredItem): Promise<void> {
  await tx("readwrite", (s) => s.put(item) as IDBRequest<IDBValidKey>);
}

export async function countItems(): Promise<number> {
  return (await allItems()).length;
}

export async function clearItems(): Promise<void> {
  await deleteItems((await allItems()).map((item) => item.id));
}

/* ── 原图：按哈希存，按需取 ─────────────────────────────────
   blobs/{hash} 的重量级版本。将来搬到 Tauri 后就是磁盘上的
   内容寻址文件，这里只是先占住接口形状。 */

export async function putOriginal(hash: string, blob: Blob): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(ORIGINALS, "readwrite");
    const req = t.objectStore(ORIGINALS).put({ hash, blob });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getOriginal(hash: string): Promise<Blob | null> {
  const db = await open();
  return new Promise<Blob | null>((resolve, reject) => {
    const t = db.transaction(ORIGINALS, "readonly");
    const req = t.objectStore(ORIGINALS).get(hash) as IDBRequest<{ hash: string; blob: Blob } | undefined>;
    req.onsuccess = () => resolve(req.result?.blob ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function originalStats(): Promise<{ count: number; bytes: number }> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(ORIGINALS, "readonly");
    const os = t.objectStore(ORIGINALS);
    const c = os.count();
    let count = 0;
    let bytes = 0;
    c.onsuccess = () => {
      count = c.result;
    };
    const cursor = os.openCursor();
    cursor.onsuccess = () => {
      const cur = cursor.result;
      if (cur) {
        const v = cur.value as { blob: Blob };
        bytes += v.blob.size;
        cur.continue();
      } else {
        resolve({ count, bytes });
      }
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

/** 与桌面端一致：仅标记素材，原件与标签不做写时级联。 */
export async function deleteItems(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const db = await open();
  const removed: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([STORE, "meta"], "readwrite");
    const items = t.objectStore(STORE);
    const meta = t.objectStore("meta");
    const sequence = meta.get("sequence") as IDBRequest<{key:string;value:number}|undefined>;
    sequence.onsuccess = () => {
      const next = (sequence.result?.value ?? 0) + 1;
      meta.put({key:"sequence",value:next});
      for (const id of ids) {
      const g = items.get(id);
      g.onsuccess = () => {
        const row = g.result as StoredItem | undefined;
        if (!row || row.deletedSeq !== undefined) return;
        removed.push(row.hash);
        items.put({...row, deletedSeq:next});
      };
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  return removed;
}

export async function restoreItems(ids: string[]): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve,reject) => {
    const t=db.transaction(STORE,"readwrite");
    const store=t.objectStore(STORE);
    for(const id of ids) {
      const request=store.get(id) as IDBRequest<StoredItem|undefined>;
      request.onsuccess=()=>{if(request.result){const restored={...request.result};delete restored.deletedSeq;store.put(restored);}};
    }
    t.oncomplete=()=>resolve();t.onabort=()=>reject(t.error);t.onerror=()=>reject(t.error);
  });
}

/* ── 迁移用：整表取/删原件 ─────────────────────────────── */

export async function allOriginals(): Promise<{ hash: string; blob: Blob }[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(ORIGINALS, "readonly");
    const req = t.objectStore(ORIGINALS).getAll() as IDBRequest<{ hash: string; blob: Blob }[]>;
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteOriginals(hashes: string[]): Promise<void> {
  if (hashes.length === 0) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(ORIGINALS, "readwrite");
    const os = t.objectStore(ORIGINALS);
    for (const h of hashes) os.delete(h);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
