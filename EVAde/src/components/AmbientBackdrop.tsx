import { VStack } from '@astryxdesign/core/Stack';
import './css/AmbientBackdrop.css';

const ORBS = ['violet', 'cyan', 'pink', 'blue'] as const;

// Fixed aurora orbs and drifting stars behind the frosted app glass.
export default function AmbientBackdrop() {
  return (
    <VStack className="ambient" aria-hidden="true">
      {ORBS.map(orb => (
        <VStack key={orb} className={`ambient__orb ambient__orb--${orb}`} />
      ))}
      <VStack className="ambient__stars" aria-hidden="true" />
      <VStack className="ambient__grid" />
    </VStack>
  );
}
