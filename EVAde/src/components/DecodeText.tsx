import { useEffect, useState } from 'react';
import { Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { useReducedMotion } from '../hooks/useReducedMotion';

const GLYPHS = '01<>/\\[]{}=+*#%&$@ΔΣΩ';

// Mixes resolved characters with random glyphs for the remainder.
function scramble(text: string, resolvedCount: number) {
  let output = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    output += i < resolvedCount || char === ' ' ? char : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  }
  return output;
}

// Text that "decodes" from noise like an incoming transmission.
export default function DecodeText({ text, delayMs = 0, durationMs = 1300 }: { text: string; delayMs?: number; durationMs?: number }) {
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(() => scramble(text, 0));

  useEffect(() => {
    if (reducedMotion) return;
    let frame = 0;
    const start = performance.now() + delayMs;
    const tick = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - start) / durationMs));
      setDisplay(scramble(text, Math.floor(progress * text.length)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, delayMs, durationMs, reducedMotion]);

  return (
    <>
      <VisuallyHidden>{text}</VisuallyHidden>
      <Text type="inherit" aria-hidden="true">{reducedMotion ? text : display}</Text>
    </>
  );
}
