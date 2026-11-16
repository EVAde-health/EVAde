export const TOO_MANY_ATTEMPTS = "Too many attempts, try again in a minute";
export const VOICE_PAUSED = "Voice is paused for today. You can still use the text journal.";
export const bucketSeconds = (period: number, now = Date.now()) =>
  Math.max(1, period - Math.floor(now / 1_000) % period);

export type BudgetEnv = {
  ABUSE_BUDGET?: DurableObjectNamespace;
};

type QuotaKind = "ai" | "voice" | "accounts" | "predictions";
type QuotaRequest = {
  kind: QuotaKind;
  key: string;
  staff?: boolean;
  seconds?: number;
};
export type VoiceLease = { bucket: string; id: string };
export type QuotaDecision = { allowed: boolean; seconds?: number; retryAfter?: number; lease?: VoiceLease };
export type UsageCounts = {
  date: string;
  calls: { count: number; budget: number };
  staff_calls: { count: number; budget: number };
  voice_seconds: { count: number; budget: number; used: number };
};

export function logAbuse(event: "rate_limited" | "budget_limited" | "guard_unavailable" | "turnstile_disabled" | "turnstile_rejected", scope: string) {
  console.warn(JSON.stringify({ event, scope }));
}

export function clientIp(req: Request) {
  return req.headers.get("CF-Connecting-IP")?.trim() || "unknown";
}

export async function limitIp(binding: RateLimit | undefined, req: Request, scope: string) {
  if (!binding || (await binding.limit({ key: clientIp(req) })).success) return true;
  logAbuse("rate_limited", scope);
  return false;
}

export function rateLimited(seconds = 60, message = TOO_MANY_ATTEMPTS) {
  return Response.json({ error: message, detail: message }, { status: 429, headers: { "Retry-After": String(seconds) } });
}

function quotaStub(env: BudgetEnv, bucket: string) {
  const namespace = env.ABUSE_BUDGET;
  return namespace?.get(namespace.idFromName(bucket));
}

async function privateKey(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

export async function reserveQuota(env: BudgetEnv, request: QuotaRequest): Promise<QuotaDecision> {
  const hourly = request.kind === "accounts";
  const period = hourly ? 3600 : 86400;
  const bucket = Math.floor(Date.now() / (period * 1000));
  const retryAfter = bucketSeconds(period);
  const name = `${hourly ? "hour" : "day"}:${bucket}`;
  try {
    const stub = quotaStub(env, name);
    // Production binds the counter. Standalone development fixtures may omit it.
    if (!stub) return { allowed: true, seconds: request.seconds };
    const response = await stub.fetch("https://budget/reserve", {
      method: "POST",
      body: JSON.stringify({ ...request, key: await privateKey(request.key) }),
    });
    if (!response.ok) throw new Error("Budget service failed");
    const result = await response.json<Omit<QuotaDecision, "lease"> & { leaseId?: string }>();
    if (!result.allowed) logAbuse("budget_limited", request.kind);
    return { allowed: result.allowed, seconds: result.seconds, retryAfter,
      lease: result.leaseId ? { bucket: name, id: result.leaseId } : undefined };
  } catch {
    logAbuse("guard_unavailable", request.kind);
    return { allowed: false, retryAfter: 60 };
  }
}

export async function settleVoice(env: BudgetEnv, lease: VoiceLease, used: number) {
  try {
    const response = await quotaStub(env, lease.bucket)?.fetch("https://budget/settle", {
      method: "POST", body: JSON.stringify({ id: lease.id, used }),
    });
    if (!response?.ok) logAbuse("guard_unavailable", "voice_settlement");
  } catch {
    logAbuse("guard_unavailable", "voice_settlement");
  }
}

export async function readUsage(env: BudgetEnv): Promise<UsageCounts | null> {
  const stub = quotaStub(env, "day:" + Math.floor(Date.now() / 86_400_000));
  if (!stub) return null;
  const response = await stub.fetch("https://budget/usage");
  return response.ok ? response.json<UsageCounts>() : null;
}
