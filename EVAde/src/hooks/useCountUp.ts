import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

// Cubic ease-out curve for natural-feeling counters.
function easeOutCubic(progress: number) {
  return 1 - (1 - progress) ** 3;
}

// Animates a number toward its target with requestAnimationFrame.
export function useCountUp(target: number, durationMs = 1400) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const start = performance.now();
    const from = latest.current;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      latest.current = from + (target - from) * easeOutCubic(progress);
      setValue(latest.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduced]);

  return reduced ? target : value;
}
