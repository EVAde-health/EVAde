// EVAde mic capture: downsample the mic to 24 kHz mono PCM16 and post ~20 ms chunks.
// Runs in the AudioWorklet thread. `sampleRate` is the AudioContext rate (44.1/48 kHz).
const TARGET_RATE = 24000;
const CHUNK = 480; // 20 ms at 24 kHz

class MicDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE; // input samples per output sample
    this.pos = 0;                         // fractional read position into `carry + input`
    this.carry = new Float32Array(0);     // leftover input from the previous block
    this.out = new Int16Array(CHUNK);
    this.n = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Join leftover + new block so interpolation spans block edges.
    const buf = new Float32Array(this.carry.length + ch.length);
    buf.set(this.carry, 0);
    buf.set(ch, this.carry.length);

    let pos = this.pos;
    while (pos + 1 < buf.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      let s = buf[i] + (buf[i + 1] - buf[i]) * frac; // linear interpolation
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

registerProcessor("mic-downsampler", MicDownsampler);
