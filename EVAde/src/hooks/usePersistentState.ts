import { useContext, useEffect, useState } from 'react';
import { AccountStorageContext } from '../context/AccountStorageContext';

// Reads a JSON value from localStorage, falling back safely.
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

// useState that mirrors its value into localStorage.
export function usePersistentState<T>(key: string, initial: T | (() => T)) {
  const account = useContext(AccountStorageContext);
  const storageKey = typeof account === 'string' ? `${key}:${account}` : account === null ? null : key;
  const [value, setValue] = useState<T>(() => {
    const fallback = initial instanceof Function ? initial() : initial;
    return storageKey === null ? fallback : readStored(storageKey, fallback);
  });

  useEffect(() => {
    if (storageKey === null) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Storage full or blocked; state still works in memory.
    }
  }, [storageKey, value]);

  return [value, setValue] as const;
}
