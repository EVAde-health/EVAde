export interface Selfie {
  id: string;
  createdAt: number;
  blob: Blob;
  note: string;
}

const DB_NAME = 'evade';
const STORE = 'selfies';

// Opens (and lazily upgrades) the local IndexedDB database once.
const openDatabases = new Map<string, Promise<IDBDatabase>>();

function openDb(accountId: string) {
  const open = openDatabases.get(accountId);
  if (open) return open;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`${DB_NAME}:${accountId}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      openDatabases.delete(accountId);
      reject(request.error);
    };
  });
  openDatabases.set(accountId, pending);
  return pending;
}

// Runs one request inside a transaction and resolves its result.
async function run<T>(accountId: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb(accountId);
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Lists saved selfies, newest first.
export async function listSelfies(accountId: string | null) {
  if (accountId === null) return [];
  const all = await run<Selfie[]>(accountId, 'readonly', store => store.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// Persists a captured selfie locally (swap for an R2 upload later).
export async function saveSelfie(accountId: string | null, blob: Blob, note = '') {
  const selfie: Selfie = { id: crypto.randomUUID(), createdAt: Date.now(), blob, note };
  if (accountId !== null) await run(accountId, 'readwrite', store => store.put(selfie));
  return selfie;
}

// Removes a selfie by id.
export async function deleteSelfie(accountId: string | null, id: string) {
  if (accountId !== null) await run(accountId, 'readwrite', store => store.delete(id));
}
