import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(value => value + 1), []);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setLoading(true);
    api<T>(path, { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        setData(value);
        setError(null);
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setError(reason instanceof ApiError ? reason.message : 'This page could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, tick]);

  return { data, error, loading, reload, setData };
}
