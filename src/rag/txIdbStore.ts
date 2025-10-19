// IndexedDB helper for transaction RAG outputs (tx_index.json, sum_index.json, and raw JSONL)
// Stores:
// - meta (single record)
// - tx_chunks (transaction docs)
// - sum_chunks (summary docs)
// - raw (raw JSONL strings for tx_docs.jsonl and sum_docs.jsonl)

export interface TxChunk {
  id: string;
  text: string;
  embedding: number[]; // store as number[] for simplicity
  metadata?: any;
}

export interface SumChunk {
  id: string;
  text: string;
  embedding: number[];
  metadata?: any;
}

export interface TxMeta {
  model: string;
  dims: number;
  createdAt: string;
}

const DB_NAME = 'txRagDB';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_TX = 'tx_chunks';
const STORE_SUM = 'sum_chunks';
const STORE_RAW = 'raw';

export async function openTxDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TX)) db.createObjectStore(STORE_TX, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_SUM)) db.createObjectStore(STORE_SUM, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_RAW)) db.createObjectStore(STORE_RAW, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(db: IDBDatabase, name: string, mode: IDBTransactionMode = 'readonly') {
  return db.transaction(name, mode).objectStore(name);
}

export async function getMeta(db: IDBDatabase): Promise<TxMeta | null> {
  return new Promise((resolve, reject) => {
    const req = store(db, STORE_META).get('meta');
    req.onsuccess = () => resolve((req.result && (req.result.value as TxMeta)) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(db: IDBDatabase, meta: TxMeta): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store(db, STORE_META, 'readwrite').put({ key: 'meta', value: meta });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function putTxChunks(db: IDBDatabase, chunks: TxChunk[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_TX, 'readwrite');
    const s = t.objectStore(STORE_TX);
    for (const ch of chunks) s.put(ch);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function putSumChunks(db: IDBDatabase, chunks: SumChunk[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SUM, 'readwrite');
    const s = t.objectStore(STORE_SUM);
    for (const ch of chunks) s.put(ch);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function getTxChunks(db: IDBDatabase): Promise<TxChunk[]> {
  return new Promise((resolve, reject) => {
    const req = store(db, STORE_TX).getAll();
    req.onsuccess = () => resolve((req.result as TxChunk[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getSumChunks(db: IDBDatabase): Promise<SumChunk[]> {
  return new Promise((resolve, reject) => {
    const req = store(db, STORE_SUM).getAll();
    req.onsuccess = () => resolve((req.result as SumChunk[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function setRaw(db: IDBDatabase, key: 'tx_docs' | 'sum_docs', value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store(db, STORE_RAW, 'readwrite').put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getRaw(db: IDBDatabase, key: 'tx_docs' | 'sum_docs'): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const req = store(db, STORE_RAW).get(key);
    req.onsuccess = () => resolve((req.result && (req.result.value as string)) || null);
    req.onerror = () => reject(req.error);
  });
}

export const TxIDBConst = { DB_NAME, STORE_META, STORE_TX, STORE_SUM, STORE_RAW };
