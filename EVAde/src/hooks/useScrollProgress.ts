import { useEffect, useRef, useState } from 'react';

type ProgressMode = 'through' | 'sticky' | 'exit';

interface ScrollProgressOptions {
  mode?: ProgressMode;
  steps?: number;
}

// Clamps a number into the 0–1 range.
function unit(value: number) {
  return Math.min(1, Math.max(0, value));
}

// Converts an element's viewport position into 0–1 progress for a mode.
function measure(rect: DOMRect, mode: ProgressMode) {
  const viewport = window.innerHeight;
  if (mode === 'sticky') return unit(-rect.top / Math.max(1, rect.height - viewport));
  if (mode === 'exit') return unit(-rect.top / Math.max(1, rect.height));
  return unit((viewport - rect.top) / (viewport + rect.height));
}

// Streams scroll progress into `--progress` on the element; returns the active step.
export function useScrollProgress<T extends HTMLElement>({ mode = 'through', steps = 1 }: ScrollProgressOptions = {}) {
  const ref = useRef<T>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;

    // Measures once per animation frame and writes the CSS variable.
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      if (rect.bottom < -window.innerHeight || rect.top > window.innerHeight * 2) return;
      const progress = measure(rect, mode);
      element.style.setProperty('--progress', progress.toFixed(4));
      setStep(Math.min(steps - 1, Math.floor(progress * steps)));
    };

    // Coalesces scroll/resize bursts into a single frame.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [mode, steps]);

  return [ref, step] as const;
}
