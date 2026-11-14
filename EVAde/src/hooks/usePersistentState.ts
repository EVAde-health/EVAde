import { useEffect, useState } from 'react';

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
  const [value, setValue] = useState<T>(() => {
    const fallback = initial instanceof Function ? initial() : initial;
    return readStored(key, fallback);
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked; state still works in memory.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
