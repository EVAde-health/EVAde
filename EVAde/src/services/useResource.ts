import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

type Result<T> = { path: string; tick: number; data?: T; error?: string };

export function useResource<T>(path: string | null) {
  const [result, setResult] = useState<Result<T>>();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(value => value + 1), []);
  const current = result?.path === path ? result : undefined;

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setResult({ path, tick, data });
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        const error = reason instanceof ApiError ? reason.message : 'This page could not be loaded.';
        setResult({ path, tick, error });
      });
    return () => controller.abort();
  }, [path, tick]);

  return { data: current?.data, error: current?.error ?? null, loading: !!path && current?.tick !== tick, reload };
}
