import { useEffect } from 'react';
import { useResource } from '../services/useResource';

/** useResource plus a refresh every `intervalMs` while the tab is visible (and right away when it becomes visible). */
export function usePoll<T>(path: string | null, intervalMs: number) {
  const resource = useResource<T>(path);
  const { reload } = resource;
  useEffect(() => {
    if (!path) return;
    const tick = () => { if (document.visibilityState === 'visible') reload(); };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [path, intervalMs, reload]);
  return resource;
}
