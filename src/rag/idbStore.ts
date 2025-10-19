// Simple IndexedDB helper for storing RAG embeddings (VectorDB persistence)
// We persist two stores: 'meta' (single record) and 'chunks' (embedding chunks)

export interface IDBVectorChunk {
  id: string;
  text: string;
  embedding: number[]; // store as number[]; convert to Float32Array on load
  page?: number;
  offset?: number;
  tokens?: number;
}

export interface IDBMeta {
  model: string;
  dims: number;
  createdAt: string;
}

const DEFAULT_DB_NAME = 'ragDB';
const DEFAULT_DB_VERSION = 1;
const STORE_CHUNKS = 'chunks';
const STORE_META = 'meta';

export async function openRagDB(dbName: string = DEFAULT_DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DEFAULT_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

export async function getMeta(db: IDBDatabase): Promise<IDBMeta | null> {
  return new Promise((resolve, reject) => {
    const store = tx(db, STORE_META);
    const req = store.get('meta');
    req.onsuccess = () => resolve((req.result && (req.result.value as IDBMeta)) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(db: IDBDatabase, meta: IDBMeta): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = tx(db, STORE_META, 'readwrite');
    const req = store.put({ key: 'meta', value: meta });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function putChunks(db: IDBDatabase, chunks: IDBVectorChunk[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_CHUNKS, 'readwrite');
    const store = t.objectStore(STORE_CHUNKS);
    for (const ch of chunks) store.put(ch);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function getAllChunks(db: IDBDatabase): Promise<IDBVectorChunk[]> {
  return new Promise((resolve, reject) => {
    const store = tx(db, STORE_CHUNKS);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as IDBVectorChunk[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORE_CHUNKS, STORE_META], 'readwrite');
    const chunks = t.objectStore(STORE_CHUNKS);
    const meta = t.objectStore(STORE_META);
    chunks.clear();
    meta.clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const RagIDBConst = { DEFAULT_DB_NAME, STORE_CHUNKS, STORE_META };
