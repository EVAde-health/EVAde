export interface Selfie {
  id: string;
  createdAt: number;
  blob: Blob;
  note: string;
}

const DB_NAME = 'evade';
const STORE = 'selfies';

let dbPromise: Promise<IDBDatabase> | null = null;

// Opens (and lazily upgrades) the local IndexedDB database once.
function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

// Runs one request inside a transaction and resolves its result.
async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Lists saved selfies, newest first.
export async function listSelfies() {
  const all = await run<Selfie[]>('readonly', store => store.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// Persists a captured selfie locally (swap for an R2 upload later).
export async function saveSelfie(blob: Blob, note = '') {
  const selfie: Selfie = { id: crypto.randomUUID(), createdAt: Date.now(), blob, note };
  await run('readwrite', store => store.put(selfie));
  return selfie;
}

// Removes a selfie by id.
export async function deleteSelfie(id: string) {
  await run('readwrite', store => store.delete(id));
}
