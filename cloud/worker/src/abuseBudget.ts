import { DurableObject } from "cloudflare:workers";
import type { QuotaDecision, UsageCounts } from "../../../shared/abuse";

type BudgetConfig = {
  AI_DAILY_CALL_BUDGET?: string;
  AI_PER_USER_DAILY?: string;
  AI_STAFF_DAILY_CALL_BUDGET?: string;
  AI_STAFF_PER_USER_DAILY?: string;
  VOICE_DAILY_SECONDS_BUDGET?: string;
  MODEL_PER_USER_DAILY?: string;
  NEW_ACCOUNT_IP_HOURLY?: string;
};

type Reservation = { kind: string; key: string; staff?: boolean; seconds?: number };

function budget(value: string | undefined, fallback: number) {
  return value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : fallback;
}

export class AbuseBudget extends DurableObject<BudgetConfig> {
  private get sql() { return this.ctx.storage.sql; }

  constructor(ctx: DurableObjectState, env: BudgetConfig) {
    super(ctx, env);
    this.sql.exec("CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, count INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS voice_leases (id TEXT PRIMARY KEY, seconds INTEGER NOT NULL)");
  }

  private count(key: string) {
    return this.sql.exec<{ count: number }>("SELECT count FROM counters WHERE key=?", key).toArray()[0]?.count ?? 0;
  }

  private add(key: string, n = 1) {
    this.sql.exec("INSERT INTO counters (key,count) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET count=count+excluded.count", key, n);
  }

  private usage(): UsageCounts {
    return {
      date: new Date().toISOString().slice(0, 10),
      calls: { count: this.count("ai"), budget: budget(this.env.AI_DAILY_CALL_BUDGET, 3000) },
      staff_calls: { count: this.count("ai:staff"), budget: budget(this.env.AI_STAFF_DAILY_CALL_BUDGET, 6000) },
      voice_seconds: { count: this.count("voice"), budget: budget(this.env.VOICE_DAILY_SECONDS_BUDGET, 18000),
        used: this.count("voice:used") },
    };
  }

  private reserve(input: Reservation): QuotaDecision & { leaseId?: string } {
    const { key, kind } = input;
    if (kind === "accounts" || kind === "predictions") {
      const metric = `${kind}:${key}`;
      const cap = kind === "accounts" ? budget(this.env.NEW_ACCOUNT_IP_HOURLY, 3) : budget(this.env.MODEL_PER_USER_DAILY, 100);
      if (this.count(metric) >= cap) return { allowed: false };
      this.add(metric);
      return { allowed: true };
    }
    const usage = this.usage();
    const staff = kind === "ai" && input.staff === true;
    const callBucket = staff ? "ai:staff" : "ai";
    const group = staff ? usage.staff_calls : usage.calls;
    const userKey = `${callBucket}:${key}`;
    const userCap = staff ? budget(this.env.AI_STAFF_PER_USER_DAILY, 600) : budget(this.env.AI_PER_USER_DAILY, 120);
    if (group.count >= group.budget || this.count(userKey) >= userCap) return { allowed: false };
    if (kind === "voice") {
      // Reserve the maximum supported duration before opening xAI. Charging up front bounds
      // concurrent starts and remains safe when a process terminates without a close event.
      const seconds = Math.min(input.seconds ?? 0, usage.voice_seconds.budget - usage.voice_seconds.count);
      if (!Number.isSafeInteger(seconds) || seconds < 1) return { allowed: false };
      this.add("voice", seconds);
      this.add(callBucket);
      this.add(userKey);
      const leaseId = crypto.randomUUID();
      this.sql.exec("INSERT INTO voice_leases (id, seconds) VALUES (?,?)", leaseId, seconds);
      return { allowed: true, seconds, leaseId };
    }
    this.add(callBucket);
    this.add(userKey);
    return { allowed: true };
  }

  override async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === "/usage" && request.method === "GET") return Response.json(this.usage());
    if (path === "/settle" && request.method === "POST") {
      const input = await request.json<{ id: string; used: number }>();
      if (!input || typeof input.id !== "string" || !Number.isSafeInteger(input.used) || input.used < 0) {
        return new Response(null, { status: 400 });
      }
      this.ctx.storage.transactionSync(() => {
        const lease = this.sql.exec<{ seconds: number }>("DELETE FROM voice_leases WHERE id=? RETURNING seconds", input.id).toArray()[0];
        if (!lease) return;
        const used = Math.min(input.used, lease.seconds);
        this.add("voice", used - lease.seconds);
        this.add("voice:used", used);
      });
      return new Response(null, { status: 204 });
    }
    if (path !== "/reserve" || request.method !== "POST") return new Response(null, { status: 404 });
    const input = await request.json<Reservation>();
    if (!input || !["ai", "voice", "accounts", "predictions"].includes(input.kind) || !/^[a-f0-9]{64}$/.test(input.key)) {
      return new Response(null, { status: 400 });
    }
    if (await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now() + 48 * 3600_000);
    }
    const decision = this.ctx.storage.transactionSync(() => this.reserve(input));
    return Response.json(decision);
  }

  override async alarm() {
    this.sql.exec("DELETE FROM counters");
    this.sql.exec("DELETE FROM voice_leases");
  }
}
