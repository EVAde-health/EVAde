import './css/EcgLine.css';

const BEAT = 'l12 0 l4 -6 l4 6 l6 0 l3 4 l5 -30 l5 38 l4 -12 l8 0 l5 -5 l6 5 l18 0';
const BEATS_PER_TILE = 3;

// Builds one tile of repeating heartbeats as an SVG path.
function beatPath(beats: number) {
  return `M0 30 ${Array.from({ length: beats }, () => BEAT).join(' ')}`;
}

const TILE_PATH = beatPath(BEATS_PER_TILE);

// Endlessly scrolling ECG trace drawn with compositor-only motion.
export default function EcgLine({ speed = 'normal' }: { speed?: 'slow' | 'normal' | 'fast' }) {
  return (
    <svg className={`ecg-line ecg-line--${speed}`} viewBox="0 0 480 50" preserveAspectRatio="none" aria-hidden="true">
      <g className="ecg-line__track">
        <path d={TILE_PATH} />
        <path d={TILE_PATH} transform="translate(240 0)" />
        <path d={TILE_PATH} transform="translate(480 0)" />
      </g>
    </svg>
  );
}
