// AudioWorklet that downsamples the microphone to 24 kHz mono PCM16 and posts ~20 ms chunks.
// Ported from frontend/voice/mic-worklet.js (the /voice page keeps its own copy).
// It is loaded from a Blob URL so it never depends on how static assets are routed.
const MIC_WORKLET_SOURCE = `
const TARGET_RATE = 24000;
const CHUNK = 480; // 20 ms at 24 kHz

class MicDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE;
    this.pos = 0;
    this.carry = new Float32Array(0);
    this.out = new Int16Array(CHUNK);
    this.n = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const buf = new Float32Array(this.carry.length + ch.length);
    buf.set(this.carry, 0);
    buf.set(ch, this.carry.length);

    let pos = this.pos;
    while (pos + 1 < buf.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      let s = buf[i] + (buf[i + 1] - buf[i]) * frac;
      s = Math.max(-1, Math.min(1, s));
      this.sumSq += s * s;
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === CHUNK) {
        const level = Math.sqrt(this.sumSq / CHUNK);
        this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
        this.out = new Int16Array(CHUNK);
        this.n = 0;
        this.sumSq = 0;
      }
      pos += this.step;
    }
    const keepFrom = Math.floor(pos);
    this.carry = buf.slice(keepFrom);
    this.pos = pos - keepFrom;
    return true;
  }
}

registerProcessor('evade-mic-downsampler', MicDownsampler);
`;

export const MIC_WORKLET_NAME = 'evade-mic-downsampler';

// Registers the worklet on an AudioContext.
export async function addMicWorklet(ctx: AudioContext): Promise<void> {
  const url = URL.createObjectURL(new Blob([MIC_WORKLET_SOURCE], { type: 'application/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
