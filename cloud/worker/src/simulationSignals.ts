// Synthetic ECG and sleep EEG for the demo, ported from pi-sim/evade_sim/signals.py and payloads.py.
const FS = 100;
const TAU = 2 * Math.PI;
const ECG_LEADS = ["I", "II", "III", "AVR", "AVL", "AVF", "V1", "V2", "V3", "V4", "V5", "V6"];
const LEAD_GAIN = [0.6, 1, 0.45, -0.8, 0.25, 0.7, -0.5, 0.3, 0.8, 1.2, 1.1, 0.9];
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

export function simulatedEcgDeep(seed: string, heartRate: number) {
  const random = rng(seed + ":ecg");
  const rr = 60 / heartRate;
  const signal = Array<number>(10 * FS).fill(0);
  for (let beat = (random() - 1) * rr; beat < 10.35;
    beat += Math.max(0.25, rr + 0.04 * Math.sin(TAU * 0.25 * beat) + 0.04 / 3 * normal(random))) {
    const start = Math.max(0, Math.ceil((beat - 0.35) * FS));
    const end = Math.min(signal.length, Math.ceil((beat + 0.6) * FS));
    for (let i = start; i < end; i++) {
      const t = i / FS - beat;
      signal[i] += wave(t, -0.20, 0.025, 0.12) + wave(t, -0.03, 0.010, -0.15) +
        wave(t, 0, 0.012, 1.1) + wave(t, 0.03, 0.010, -0.25) + wave(t, 0.25, 0.045, 0.30);
    }
  }
  const samples = LEAD_GAIN.map((gain, lead) => signal.map((value, i) => {
    const mv = gain * value + 0.05 * Math.sin(TAU * 0.25 * i / FS + lead) + 0.02 * normal(random);
    return Math.round(mv * 1000) / 1000;
  }));
  return { fs_hz: FS, leads: ECG_LEADS, samples, source: "simulated" };
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
