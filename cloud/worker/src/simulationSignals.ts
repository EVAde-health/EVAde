// Demo waveforms for Michael's ECG and sleep models: ECG from a real PTB-XL normal recording scaled to a heart rate,
// sleep EEG ported from pi-sim/evade_sim/signals.py and payloads.py.
import { PTBXL_NORMAL_BEATS, PTBXL_NORMAL_LEADS, PTBXL_NORMAL_UV } from "./ptbxlNormal.generated";

const FS = 100;
const TAU = 2 * Math.PI;
const SLEEP_CHANNELS = ["Fpz-Cz", "Pz-Oz"];
const SLEEP_CYCLE = [
  ...Array<string>(2).fill("W"), ...Array<string>(3).fill("N1"), ...Array<string>(12).fill("N2"),
  ...Array<string>(10).fill("N3"), ...Array<string>(6).fill("N2"), ...Array<string>(8).fill("REM"),
];

function rng(seed: string) {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

const normal = (random: () => number) =>
  Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());

const wave = (seconds: number, center: number, width: number, gain: number) =>
  gain * Math.exp(-0.5 * ((seconds - center) / width) ** 2);

/** 10 s, 12-lead ECG at `heartRate`, built from a real normal PTB-XL recording (held-out fold, ptbxlNormal.generated.ts).
 * Beats are laid end to end from a seeded starting beat. Below the recording's own rate only the diastole after each
 * P-QRS-T complex is stretched, so a slow heart is not mistaken for a wide QRS; above it the whole beat is scaled
 * (QT shortens with rate). 10 uV of seeded noise is added. Michael's ECG models were trained on PTB-XL, so a healthy
 * rhythm reads as normal and only the rate the astronaut logged changes. */
export function simulatedEcgDeep(seed: string, heartRate: number) {
  const random = rng(seed + ":ecg");
  const target = 60 * FS / Math.min(Math.max(heartRate, 30), 200);  // samples per beat
  const complex = 70;                                                // 0.3 s before R to 0.4 s after: P, QRS and T
  const beats = PTBXL_NORMAL_BEATS.length - 1;
  const positions: number[] = [];                                    // fractional source index for each output sample
  for (let beat = Math.floor(random() * beats); positions.length < 10 * FS + target; beat = (beat + 1) % beats) {
    const start = PTBXL_NORMAL_BEATS[beat];
    const length = PTBXL_NORMAL_BEATS[beat + 1] - start;
    const out = Math.round(target);
    for (let j = 0; j < out; j++) {
      const k = out >= length
        ? (j < complex ? j : complex + (j - complex) * (length - 1 - complex) / Math.max(out - 1 - complex, 1))
        : j * (length - 1) / Math.max(out - 1, 1);
      positions.push(start + k);
    }
  }
  const skip = Math.floor(random() * target);
  const samples = PTBXL_NORMAL_UV.map((lead) => positions.slice(skip, skip + 10 * FS).map((position) => {
    const k = Math.floor(position);
    const frac = position - k;
    const uv = lead[k] * (1 - frac) + lead[Math.min(k + 1, lead.length - 1)] * frac;
    return Math.round((uv / 1000 + 0.01 * normal(random)) * 1000) / 1000;
  }));
  return { fs_hz: FS, leads: [...PTBXL_NORMAL_LEADS], samples, source: "simulated" };
}

// Update noise bands at octave intervals to approximate the Python generator's 1/f background.
function pinkNoise(random: () => number) {
  const bands = Array.from({ length: 8 }, () => random() * 2 - 1);
  let sum = bands.reduce((a, b) => a + b, 0);
  let tick = 0;
  return () => {
    tick = (tick + 1) % (1 << bands.length);
    if (tick !== 0) {
      const band = 31 - Math.clz32(tick & -tick);
      const next = random() * 2 - 1;
      sum += next - bands[band];
      bands[band] = next;
    }
    return 8 * (sum + random() * 2 - 1) / Math.sqrt(3);
  };
}

export function simulatedSleepDeep(seed: string, poorSleep: boolean) {
  const random = rng(seed + ":sleep");
  const offset = Math.floor(random() * (SLEEP_CYCLE.length - 9));
  const samples: number[][] = [[], []];
  const noises = samples.map(() => pinkNoise(random));
  for (const stage of SLEEP_CYCLE.slice(offset, offset + 10)) {
    const st = poorSleep && random() < 0.35 ? (random() < 0.5 ? "W" : "N1") : stage;
    const phase = random();
    const spindles = st === "N2" ? Array.from({ length: 3 }, () => 1 + 27 * random()) : [];
    const k = st === "N2" ? 2 + 25 * random() : 0;
    for (let i = 0; i < 30 * FS; i++) {
      const t = i / FS;
      let shared = 0;
      switch (st) {
        case "W": shared = 6 * Math.sin(TAU * 20 * t + phase); break;
        case "N1": shared = 12 * Math.sin(TAU * 5.5 * t + phase); break;
        case "N2":
          shared = 10 * Math.sin(TAU * 5 * t + phase) + wave(t, k, Math.sqrt(0.015), -80) +
            wave(t, k + 0.35, Math.sqrt(0.025), 50);
          for (const start of spindles) {
            const dt = t - start;
            if (dt > 0 && dt < 1) shared += 10 * Math.sin(TAU * 13 * t) * (1 - Math.cos(TAU * dt));
          }
          break;
        case "N3": shared = 75 * Math.sin(TAU * t + phase) + 30 * Math.sin(TAU * 0.6 * t); break;
        case "REM": shared = 14 * Math.sin(TAU * 6 * t + phase) + 10 * Math.sign(Math.sin(TAU * 3 * t)); break;
      }
      const posterior = st === "W" ? 15 * Math.sin(TAU * 10 * t) + 5 * normal(random) : 0;
      samples[0].push(Math.round((shared + noises[0]()) * 10) / 10);
      samples[1].push(Math.round((shared + posterior + noises[1]()) * 10) / 10);
    }
  }
  // Both channels run continuously across the ten consecutive epochs, in raw microvolts.
  return { fs_hz: FS, channels: SLEEP_CHANNELS, samples, source: "simulated" };
}
