import { createContext, useContext } from 'react';
import { useToast as useAstryxToast, type ShowToastFn } from '@astryxdesign/core/Toast';

export interface ToastCenterValue {
  show: ShowToastFn;
}

export const ToastCenterContext = createContext<ToastCenterValue | null>(null);

// Drop-in for Astryx useToast: same signature, but toasts join the "Close all" stack.
export function useToast(): ShowToastFn {
  const center = useContext(ToastCenterContext);
  const fallback = useAstryxToast();
  return center?.show ?? fallback;
}
