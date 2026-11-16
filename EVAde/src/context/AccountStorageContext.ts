import { createContext } from 'react';

// Undefined keeps public preferences browser-wide. Null keeps the shared demo in memory.
export const AccountStorageContext = createContext<string | null | undefined>(undefined);
