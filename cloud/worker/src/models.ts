// Michael's model API (FastAPI) behind the "evade-gateway" Worker + Cloudflare Container.
//
// Security rules (agreed on PR #3):
//   - Only this Worker calls the model API. Browsers never do (no CORS there).
//   - Preferred: a service binding MODELS -> evade-gateway (no public URL). Fallback: MODEL_API_URL over HTTPS.
//   - The gateway expects X-Gateway-Key (Worker secret MODEL_GATEWAY_KEY); it adds the API's own X-EVAde-Key itself.
//   - Results with source "mock" (placeholder models) are never stored and never raise alerts.
//   - Every result is a flag for human review, not a diagnosis.

export interface ModelEnv {
  MODELS?: Fetcher; // service binding to evade-gateway
  MODEL_API_URL?: string; // e.g. https://evade-gateway.<sub>.workers.dev (only if no service binding)
  MODEL_GATEWAY_KEY?: string; // secret, sent as X-Gateway-Key
  SESSIONS: KVNamespace; // stores our user_id -> model API user_id
  DB: D1Database;
}

export const PREDICT_KINDS = [
  "ecg", "ecg-deep", "eeg", "sleep-deep", "seizure-deep", "radiation-risk", "space-weather", "risk",
] as const;
export type PredictKind = (typeof PREDICT_KINDS)[number];
export const STAFF_DEEP_MODELS = ["ecg-deep", "sleep-deep"] as const;
type StaffDeepModel = (typeof STAFF_DEEP_MODELS)[number];
const SLEEP_STAGES = ["W", "N1", "N2", "N3", "REM"] as const;

export const REVIEW_NOTE = "Flag for human review, not a diagnosis.";

export class ModelApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const modelsConfigured = (env: ModelEnv) => Boolean((env.MODELS || env.MODEL_API_URL) && env.MODEL_GATEWAY_KEY);

/** Call the model API through the gateway. Only JSON bodies; never logs bodies or ids. */
export async function callModelApi(env: ModelEnv, method: "GET" | "POST" | "DELETE", path: string, payload?: unknown) {
  if (!modelsConfigured(env)) throw new ModelApiError(503, "Model service is not connected yet");
  if (!path.startsWith("/v1/")) throw new ModelApiError(400, "bad model path");
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const headers: Record<string, string> = { "X-Gateway-Key": env.MODEL_GATEWAY_KEY!, Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(new TextEncoder().encode(body).byteLength);
  }
  const init: RequestInit = { method, headers, body, signal: AbortSignal.timeout(60_000) };
  let res: Response;
  try {
    res = env.MODELS
      ? await env.MODELS.fetch(new Request(`https://evade-gateway${path}`, init))
      : await fetch(`${env.MODEL_API_URL!.replace(/\/+$/, "")}${path}`, init);
  } catch {
    throw new ModelApiError(502, "Model service unreachable");
  }
  const out = await res.json<any>().catch(() => null);
  return { status: res.status, ok: res.ok, out, retryAfter: res.headers.get("Retry-After") };
}

/** Map our users.user_id to the model API's own pseudonymous user id (created on first use). */
export async function modelUserId(env: ModelEnv, userId: string): Promise<string> {
  const key = `mu:${userId}`;
  const known = await env.SESSIONS.get(key);
  if (known) return known;
  const r = await callModelApi(env, "POST", "/v1/users", { cohort: "demo" });
  const id = r.out?.data?.user_id ?? r.out?.user_id;
  if (!r.ok || typeof id !== "string") throw new ModelApiError(r.status === 503 ? 503 : 502, "Model service could not register the user");
  await env.SESSIONS.put(key, id);
  return id;
}

/** On account deletion: remove the user's data in the model service too. Retry-safe; 404 counts as done. */
export async function deleteModelUser(env: ModelEnv, userId: string): Promise<"deleted" | "none" | "not_connected"> {
  const key = `mu:${userId}`;
  const id = await env.SESSIONS.get(key);
  if (!id) return "none";
  if (!modelsConfigured(env)) return "not_connected";
  const r = await callModelApi(env, "DELETE", `/v1/users/${encodeURIComponent(id)}`);
  if (!r.ok && r.status !== 404) throw new ModelApiError(503, "Model service deletion incomplete, retry");
  await env.SESSIONS.delete(key);
  return "deleted";
}

export const isMock = (out: any) => out?.source === "mock" || out?.data?.source === "mock";

function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function deepConfidence(kind: PredictKind, data: any) {
  if (kind === "ecg-deep") {
    const values = Object.values(data.probabilities ?? {}).filter(probability);
    return values.length ? values.reduce((max, value) => Math.max(max, value), 0).toFixed(3) : undefined;
  }
  if (kind === "sleep-deep" && Array.isArray(data.epochs)) {
    const values: number[] = data.epochs.map((epoch: any) => epoch?.probabilities?.[epoch.stage]).filter(probability);
    return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3) : undefined;
  }
}

/** Short flag + confidence for the model_results row, following Michael's mapping on PR #3. */
export function summarize(kind: PredictKind, out: any): { model_id: string | null; flag: string | null; confidence: string | null } {
  const d = out?.data ?? {};
  const modelId = Array.isArray(out?.model_ids) && out.model_ids.length ? String(out.model_ids[0]) : d.model_id ?? null;
  const pick = (...v: unknown[]) => {
    for (const x of v) if (x !== undefined && x !== null && x !== "") return String(x);
    return null;
  };
  let flag: string | null;
  if (kind === "ecg-deep") {
    const classes = d.threshold_source === "manifest" && Array.isArray(d.top_classes)
      ? d.top_classes.map((item: any) => item?.class).filter((label: unknown) => ["MI", "STTC", "CD", "HYP"].includes(String(label)))
      : [];
    // Default thresholds are not operating points and must not create class flags.
    flag = pick(d.rhythm?.flag, d.flag, d.label, classes.join(", "),
      d.threshold_source === "default" ? "No calibrated flag" : null);
  }
  else if (kind === "ecg") flag = pick(d.rhythm?.flag, d.flag, d.label);
  else if (kind === "eeg" || kind === "seizure-deep") flag = pick(d.seizure?.flag, d.flag);
  else if (kind === "space-weather") flag = pick(d.nowcast?.level, d.level, d.flag);
  else if (kind === "radiation-risk") flag = pick(d.radiation?.level, d.domains?.radiation?.level, d.level, d.flag);
  else if (kind === "risk") flag = pick(d.risk?.band, d.band);
  else flag = pick(d.flag, d.stage, d.label);
  const conf = pick(d.comparison?.confidence, d.confidence, typeof d.probability === "number" ? d.probability.toFixed(3) : undefined,
    deepConfidence(kind, d));
  return { model_id: modelId, flag: flag ? flag.slice(0, 64) : null, confidence: conf ? conf.slice(0, 32) : null };
}

/** Return the most recent row for each staff model without exposing raw model responses. */
export async function latestDeepModelResults(db: D1Database, userId: string) {
  const entries = await Promise.all(STAFF_DEEP_MODELS.map(async (kind: StaffDeepModel) => {
    const row = await db.prepare(
      "SELECT model_id, flag, confidence, ts, source, output FROM model_results WHERE user_id=? AND endpoint=? ORDER BY ts DESC, id DESC LIMIT 1"
    ).bind(userId, "/v1/predict/" + kind).first<{
      model_id: string | null; flag: string | null; confidence: string | null; ts: string; source: string; output: string;
    }>();
    if (!row) return [kind, null] as const;

    let out;
    try { out = JSON.parse(row.output); } catch { out = null; }
    if (row.source === "mock" || isMock(out) || out?.placeholder === true) {
      return [kind, { status: "placeholder" }] as const;
    }
    const summary = summarize(kind, out);
    const stages = kind === "sleep-deep" ? out?.data?.summary?.minutes_per_stage : null;
    const minutes = stages ? Object.fromEntries(SLEEP_STAGES.map(stage => {
      const value = stages[stage];
      return [stage, typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null];
    })) : null;
    return [kind, {
      status: "result", model_id: row.model_id ?? summary.model_id, flag: row.flag ?? summary.flag,
      confidence: row.confidence ?? summary.confidence, ts: row.ts, source: row.source, minutes_per_stage: minutes,
    }] as const;
  }));
  return Object.fromEntries(entries);
}

/** risk_scores row from POST /v1/predict/risk (5 bands stored as-is). */
export function riskRow(out: any) {
  const d = out?.data ?? {};
  const r = Number(d.risk?.r_disp ?? d.risk?.r);
  const band = d.risk?.band;
  if (!Number.isFinite(r) || r < 0 || r > 1 || typeof band !== "string") return null;
  const domains: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(d.domains ?? {})) {
    const s = typeof v === "number" ? v : (v as any)?.s;
    domains[k] = typeof s === "number" ? s : null;
  }
  const overrides = Array.isArray(d.risk?.override_ids) && d.risk.override_ids.length ? d.risk.override_ids.join(",") : null;
  return {
    r,
    band,
    mdtr: d.mdtr?.display ?? null,
    domains: JSON.stringify(domains),
    top_domains: Array.isArray(d.risk?.flag_domains) ? JSON.stringify(d.risk.flag_domains) : null,
    override: overrides,
  };
}
