import type { CSSProperties } from 'react';

// Sets the --i custom property used by staggered entrance animations.
export function stagger(index: number) {
  return { '--i': index } as CSSProperties;
}
