import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'evade:motion';
const listeners = new Set<() => void>();

// Reads the saved in-app motion preference; full motion by default.
function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'reduced';
  } catch {
    return false;
  }
}

let reduced = readPreference();
syncRootAttribute();

// Mirrors the preference onto <html data-motion> for CSS.
function syncRootAttribute() {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
}

// Registers a listener for motion preference changes.
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

// Current motion preference snapshot.
function getSnapshot() {
  return reduced;
}

// Saves the motion preference and notifies every subscriber.
export function setReducedMotion(next: boolean) {
  reduced = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'reduced' : 'full');
  } catch {
    /* storage unavailable: keep in memory only */
  }
  syncRootAttribute();
  listeners.forEach(listener => listener());
}

// Non-hook read for event handlers outside React render.
export function isReducedMotion() {
  return reduced;
}

// True when the user turned on "Reduce motion" inside EVAde.
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
