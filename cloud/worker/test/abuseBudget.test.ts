import { afterEach, describe, expect, it, vi } from "vitest";
import { budgetHarness } from "./budgetHarness";
import { readUsage, reserveQuota, settleVoice } from "../../../shared/abuse";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} },
}));

afterEach(() => vi.useRealTimers());

describe("atomic quota admission", () => {
  it("serializes concurrent calls and isolates staff and per-user allowances", async () => {
    const { env, close } = budgetHarness({
      AI_DAILY_CALL_BUDGET: "2", AI_PER_USER_DAILY: "1", AI_STAFF_DAILY_CALL_BUDGET: "3", AI_STAFF_PER_USER_DAILY: "2",
    });
    try {
      const call = (key: string, staff = false) => reserveQuota(env, { kind: "ai", key, staff });
      const concurrent = await Promise.all([call("a"), call("a"), call("b"), call("c")]);
      expect(concurrent.filter(r => r.allowed)).toHaveLength(2);
      expect((await call("a")).allowed).toBe(false);
      expect((await call("staff-a", true)).allowed).toBe(true);
      expect((await call("staff-a", true)).allowed).toBe(true);
      expect((await call("staff-a", true)).allowed).toBe(false);
      expect((await call("staff-b", true)).allowed).toBe(true);
      expect((await call("staff-c", true)).allowed).toBe(false);
      expect(await readUsage(env)).toMatchObject({ calls: { count: 2 }, staff_calls: { count: 3 } });
    } finally { close(); }
  });

  it("enforces hourly account and daily model caps with independent keys and resets in UTC", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T23:59:58Z"));
    const { env, close } = budgetHarness({ MODEL_PER_USER_DAILY: "1" });
    try {
      const account = () => reserveQuota(env, { kind: "accounts", key: "192.0.2.1" });
      for (let i = 0; i < 3; i++) expect((await account()).allowed).toBe(true);
      expect(await account()).toMatchObject({ allowed: false, retryAfter: 2 });
      const run = () => reserveQuota(env, { kind: "predictions", key: "account-a" });
      expect((await run()).allowed).toBe(true);
      expect((await run()).allowed).toBe(false);
      expect((await reserveQuota(env, { kind: "predictions", key: "account-b" })).allowed).toBe(true);
      vi.setSystemTime(new Date("2026-11-16T00:00:00Z"));
      expect((await account()).allowed).toBe(true);
      expect((await run()).allowed).toBe(true);
    } finally { close(); }
  });

  it("reserves voice seconds before admission and releases unused seconds exactly once", async () => {
    const { env, close } = budgetHarness({ VOICE_DAILY_SECONDS_BUDGET: "10" });
    try {
      const voice = () => reserveQuota(env, { kind: "voice", key: "browser", seconds: 8 });
      const first = await voice();
      expect(first).toMatchObject({ allowed: true, seconds: 8 });
      expect(await voice()).toMatchObject({ allowed: true, seconds: 2 });
      expect((await voice()).allowed).toBe(false);
      expect(await readUsage(env)).toMatchObject({ calls: { count: 2 }, voice_seconds: { count: 10, used: 0 } });
      await settleVoice(env, first.lease!, 3);
      await settleVoice(env, first.lease!, 3);
      expect(await readUsage(env)).toMatchObject({ voice_seconds: { count: 5, used: 3 } });
      expect(await voice()).toMatchObject({ allowed: true, seconds: 5 });
    } finally { close(); }
  });
});
