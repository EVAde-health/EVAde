import { describe, expect, it } from "vitest";
import { simulatedEcgDeep, simulatedSleepDeep } from "../src/simulationSignals";

const user_id = "00000000-0000-4000-8000-00000000d001";
const seed = user_id + ":2026-11-15T15:00:00.000Z";

function assertBody(samples: number[][], count: number, length: number, payload: object) {
  expect(samples).toHaveLength(count);
  for (const channel of samples) {
    expect(channel).toHaveLength(length);
    expect(channel.every(Number.isFinite)).toBe(true);
    expect(new Set(channel).size).toBeGreaterThan(1);
  }
  expect(new TextEncoder().encode(JSON.stringify({ user_id, ...payload })).length).toBeLessThan(1_000_000);
}

describe("deep model simulator payloads", () => {
  it("sends ten seconds of distinct 100 Hz ECG leads in the model's channel-major order", () => {
    const payload = simulatedEcgDeep(seed, 72);
    expect(payload).toMatchObject({
      fs_hz: 100, source: "simulated",
      leads: ["I", "II", "III", "AVR", "AVL", "AVF", "V1", "V2", "V3", "V4", "V5", "V6"],
    });
    assertBody(payload.samples, 12, 1_000, payload);
    expect(payload.samples[0]).not.toEqual(payload.samples[1]);
    expect(simulatedEcgDeep(seed, 72)).toEqual(payload);
  });

  it("sends ten contiguous 30-second sleep epochs in each raw 100 Hz EEG channel", () => {
    for (const poorSleep of [false, true]) {
      const payload = simulatedSleepDeep(seed, poorSleep);
      expect(payload).toMatchObject({ fs_hz: 100, source: "simulated", channels: ["Fpz-Cz", "Pz-Oz"] });
      assertBody(payload.samples, 2, 10 * 30 * 100, payload);
      expect(payload.samples[0]).not.toEqual(payload.samples[1]);
      expect(payload.samples[0].slice(0, 3_000)).not.toEqual(payload.samples[0].slice(3_000, 6_000));
    }
  });
});
