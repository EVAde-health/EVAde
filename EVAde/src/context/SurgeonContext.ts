import { createContext, useContext } from 'react';
import type { SessionUser } from '../services/healthApi';
import type { AdminNotifications } from '../services/surgeon';

export interface SurgeonContextValue {
  user: SessionUser;
  /** Polled every ~5 s by the surgeon shell: active emergencies and unread messages. */
  notifications: AdminNotifications | undefined;
  refreshNotifications: () => void;
}

export const SurgeonContext = createContext<SurgeonContextValue | null>(null);

export function useSurgeon() {
  const value = useContext(SurgeonContext);
  if (!value) throw new Error('useSurgeon must be used inside the surgeon shell');
  return value;
}
