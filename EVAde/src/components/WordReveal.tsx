import type { CSSProperties } from 'react';
import { Heading, Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { useScrollProgress } from '../hooks/useScrollProgress';
import './css/WordReveal.css';

// Index-based reveal threshold for each word as a CSS variable.
function wordStyle(index: number, total: number) {
  return { '--w': (index / total).toFixed(3) } as CSSProperties;
}

// Statement that lights up word by word as it scrolls through view.
export default function WordReveal({ text, accentWords = [] }: { text: string; accentWords?: string[] }) {
  const [ref] = useScrollProgress<HTMLHeadingElement>({ mode: 'through' });
  const words = text.split(' ');

  return (
    <Heading level={2} type="display-2" ref={ref} className="word-reveal">
      <VisuallyHidden>{text}</VisuallyHidden>
      {words.map((word, i) => (
        <Text
          key={`${word}-${i}`}
          type="inherit"
          aria-hidden="true"
          className={`word-reveal__word ${accentWords.includes(word) ? 'text-gradient' : ''}`}
          style={wordStyle(i, words.length)}>
          {word}{' '}
        </Text>
      ))}
    </Heading>
  );
}
