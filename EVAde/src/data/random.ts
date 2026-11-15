// Deterministic PRNG so mock telemetry is stable across reloads.
export function createRandom(seed: number) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Approximately normal noise from a uniform generator.
export function gaussian(random: () => number) {
  return (random() + random() + random() + random() - 2) / 0.8165;
}

// Rounds to a fixed number of decimals.
export function round(value: number, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Clamps a value into an inclusive range.
export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
