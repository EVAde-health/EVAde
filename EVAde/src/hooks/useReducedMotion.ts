import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

// Subscribes to OS reduced-motion preference changes.
function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

// Reads the current reduced-motion preference.
function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

// True when the user asked the OS for less motion.
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
