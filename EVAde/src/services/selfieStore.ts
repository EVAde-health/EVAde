export interface Selfie {
  id: string;
  createdAt: number;
  blob: Blob;
  note: string;
}

const STORE = 'selfies';

const databases = new Map<string, Promise<IDBDatabase>>();

// Opens (and lazily upgrades) the local IndexedDB database once.
function openDb(userId: string) {
  const existing = databases.get(userId);
  if (existing) return existing;
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`evade:selfies:${userId}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databases.delete(userId);
      reject(request.error);
    };
  });
  databases.set(userId, database);
  return database;
}

// Runs one request inside a transaction and resolves its result.
async function run<T>(userId: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb(userId);
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

// Lists saved selfies, newest first.
export async function listSelfies(userId: string) {
  const all = await run<Selfie[]>(userId, 'readonly', store => store.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// Persists a captured selfie locally (swap for an R2 upload later).
export async function saveSelfie(userId: string, blob: Blob, note = '') {
  const selfie: Selfie = { id: crypto.randomUUID(), createdAt: Date.now(), blob, note };
  await run(userId, 'readwrite', store => store.put(selfie));
  return selfie;
}

// Removes a selfie by id.
export async function deleteSelfie(userId: string, id: string) {
  await run(userId, 'readwrite', store => store.delete(id));
}
