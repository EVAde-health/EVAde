import { flushSync } from 'react-dom';
import { usePersistentState } from './usePersistentState';

export type ColorMode = 'light' | 'dark';

// Picks the OS color scheme for first-time visitors.
function systemMode(): ColorMode {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// Expands the new theme as a circle from the click point.
function revealFrom(x: number, y: number) {
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.documentElement.animate(
    { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
    { duration: 650, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
  );
}

// Light/dark mode with a persisted choice and View Transition reveal.
export function useColorMode() {
  const [mode, setMode] = usePersistentState<ColorMode>('evade:mode', systemMode);

  // Flips the mode, animating with the View Transitions API when available.
  function toggleMode(origin?: { x: number; y: number }) {
    const next: ColorMode = mode === 'dark' ? 'light' : 'dark';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduced) {
      setMode(next);
      return;
    }
    document.documentElement.dataset.themeSwitch = 'true';
    const transition = document.startViewTransition(() => flushSync(() => setMode(next)));
    transition.ready.then(() => revealFrom(origin?.x ?? innerWidth / 2, origin?.y ?? 0)).catch(() => {});
    transition.finished.finally(() => delete document.documentElement.dataset.themeSwitch);
  }

  return { mode, toggleMode };
}
