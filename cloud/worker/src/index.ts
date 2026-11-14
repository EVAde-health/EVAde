// EVAde API Worker: Cloudflare edge layer between the frontend, D1, and Michael's FastAPI models.
import {
  computeRisk,
  evaStatus,
  levelFromBaseline,
  levelFromThresholds,
  MetricDef,
  robustBaseline,
  stormLevel,
  worst,
  xrayClass,
  Level,
} from "./health";
import { AuthEnv, getSessionPrincipal, handleAuth, linkIdentity, Principal, STAFF_ROLES } from "./auth";
import { analyzeJournal, dailyBriefing, transcribe, TEXT_MODEL } from "./ai";
import type { LiveEvent } from "./live";
export { CrewFeed } from "./live";

export interface Env extends AuthEnv {
  DB: D1Database;
  AI?: Ai; // Workers AI
  AI_GATEWAY?: string; // optional AI Gateway id
  MEDIA?: R2Bucket; // R2 bucket evade-media
  LIVE?: DurableObjectNamespace; // CrewFeed Durable Object
  API_KEY?: string;
  FASTAPI_URL?: string;
  FASTAPI_KEY?: string;
  ALLOWED_ORIGINS?: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-EVAde-Key,Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowed.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Credentials"] = "true"; // frontend sends the session cookie with credentials: "include"
  }
  return h;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

async function body<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

async function requireUser(env: Env, userId: string | undefined) {
  if (!userId) throw new HttpError(400, "user_id is required");
  const u = await env.DB.prepare("SELECT * FROM users WHERE user_id = ?").bind(userId).first();
  if (!u) throw new HttpError(404, `Unknown user_id ${userId}`);
  return u as any;
}

let defsCache: Map<string, MetricDef> | null = null;
async function metricDefs(env: Env) {
  if (!defsCache) {
    const { results } = await env.DB.prepare("SELECT * FROM metric_definitions").all<MetricDef>();
    defsCache = new Map(results.map((d) => [d.metric, d]));
  }
  return defsCache;
}

// ---------- Observations ----------
interface ObsIn {
  metric: string;
  value: number;
  unit?: string;
  ts?: string;
  source?: string;
  device?: string;
  quality?: number;
  context_tags?: string[];
  client_id?: string;
}

async function ingestObservations(env: Env, userId: string, items: ObsIn[]) {
  const defs = await metricDefs(env);
  const out: any[] = [];
  const stmts: D1PreparedStatement[] = [];
  let points = 0;

  for (const o of items) {
    const d = defs.get(o.metric);
    if (!d) throw new HttpError(422, `Unknown metric '${o.metric}'. GET /metrics for the list.`);
    if (typeof o.value !== "number" || !Number.isFinite(o.value)) throw new HttpError(422, `value for ${o.metric} must be a number`);
    const ts = o.ts ?? now();
    if (Date.parse(ts) > Date.now() + 5 * 60_000) throw new HttpError(422, "ts is in the future");

    let level: Level = levelFromThresholds(o.value, d);
    let z: number | null = null;
    const bl = await env.DB.prepare(
      "SELECT center, spread FROM baselines WHERE user_id=? AND metric=? AND status != 'archived' ORDER BY created_at DESC LIMIT 1"
    ).bind(userId, o.metric).first<{ center: number; spread: number }>();
    if (bl) {
      const b = levelFromBaseline(o.value, bl.center, bl.spread, d.bad_direction);
      z = +b.z.toFixed(2);
      level = worst(level, b.level);
    }
    const lowQuality = o.quality !== undefined && o.quality < 0.5;

    stmts.push(
      env.DB.prepare(
        `INSERT INTO observations (client_id,user_id,metric,value,unit,ts,source,device,quality,context_tags,level,z)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id) DO NOTHING`
      ).bind(
        o.client_id ?? null, userId, o.metric, o.value, o.unit ?? d.unit, ts, o.source ?? "manual",
        o.device ?? null, o.quality ?? null, o.context_tags ? JSON.stringify(o.context_tags) : null, level, z
      )
    );

    // Alert only on recent readings: backfilled history (old offline syncs, demo seeding) should not flood the alert list.
    const recent = Date.now() - Date.parse(ts) < 48 * 3600_000;
    if (level !== "green" && !lowQuality && recent) {
      const red = level === "red";
      stmts.push(
        env.DB.prepare(
          "INSERT INTO alerts (user_id,ts,level,metric,message,action,escalate) VALUES (?,?,?,?,?,?,?)"
        ).bind(
          userId, ts, level, o.metric,
          `${d.label} is ${o.value} ${d.unit} (${level}).`,
          red ? `${d.what_to_do} Contact the flight surgeon if: ${d.escalate_when}` : d.what_to_do,
          red ? 1 : 0
        )
      );
    }

    // Gamification: completing a measurement closes the matching open task for today.
    if ((o.source ?? "manual") === "manual") {
      points += 5;
      stmts.push(
        env.DB.prepare(
          `UPDATE tasks SET completed_at=? WHERE id = (SELECT id FROM tasks WHERE user_id=? AND metric=? AND completed_at IS NULL
           ORDER BY due_at LIMIT 1)`
        ).bind(ts, userId, o.metric)
      );
    }
    out.push({ metric: o.metric, value: o.value, unit: o.unit ?? d.unit, level, z, low_quality: lowQuality, ts });
  }
  if (points) stmts.push(env.DB.prepare("UPDATE users SET points = points + ?, last_active=? WHERE user_id=?").bind(points, now(), userId));
  if (stmts.length) await env.DB.batch(stmts);
  return out;
}

// ---------- Default tasks (the in-app "mission routine") ----------
const DEFAULT_TASKS: [string, string, string | null, number][] = [
  ["Morning check-in: rate mood and stress", "basic", "mood", 10],
  ["Log last night's sleep", "basic", "sleep_hours", 10],
  ["Resting heart rate", "basic", "heart_rate", 10],
  ["Blood pressure (2 readings)", "basic", "systolic_bp", 15],
  ["Body temperature", "basic", "body_temp", 10],
  ["Blood oxygen (SpO2)", "basic", "spo2", 10],
  ["Fasting blood sugar", "advanced", "blood_glucose", 20],
  ["5-minute ECG / HRV session", "advanced", "hrv_rmssd", 25],
  ["Read dosimeter", "basic", "daily_radiation_msv", 10],
  ["Journal entry (text or voice)", "basic", null, 15],
];

async function seedTasks(env: Env, userId: string, day = new Date()) {
  const due = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59)).toISOString();
  await env.DB.batch(
    DEFAULT_TASKS.map(([title, cat, metric, pts]) =>
      env.DB.prepare("INSERT INTO tasks (user_id,title,category,metric,recurrence,due_at,points) VALUES (?,?,?,?, 'daily', ?, ?)")
        .bind(userId, title, cat, metric, due, pts)
    )
  );
}

// ---------- Risk ----------
async function riskFor(env: Env, userId: string, store: boolean) {
  const { results: latestRows } = await env.DB.prepare(
    `SELECT metric, value FROM observations o WHERE user_id=? AND ts = (
       SELECT MAX(ts) FROM observations WHERE user_id=o.user_id AND metric=o.metric)`
  ).bind(userId).all<{ metric: string; value: number }>();
  const latest: Record<string, number> = {};
  for (const r of latestRows) latest[r.metric] = r.value;

  const hr = await env.DB.prepare(
    "SELECT z FROM observations WHERE user_id=? AND metric='heart_rate' AND z IS NOT NULL ORDER BY ts DESC LIMIT 1"
  ).bind(userId).first<{ z: number }>();
  const sleep = await env.DB.prepare(
    "SELECT AVG(value) v FROM observations WHERE user_id=? AND metric='sleep_hours' AND ts >= ?"
  ).bind(userId, new Date(Date.now() - 7 * 864e5).toISOString()).first<{ v: number | null }>();
  const inst = async (name: string) =>
    env.DB.prepare("SELECT score, answers FROM instruments WHERE user_id=? AND instrument=? AND ts >= ? ORDER BY ts DESC LIMIT 1")
      .bind(userId, name, new Date(Date.now() - 14 * 864e5).toISOString()).first<{ score: number; answers: string | null }>();
  const phq = await inst("PHQ9");
  const gad = await inst("GAD7");
  let item9: number | undefined;
  try {
    const a = phq?.answers ? JSON.parse(phq.answers) : null;
    if (Array.isArray(a) && a.length >= 9) item9 = Number(a[8]);
  } catch {}
  const rad = await env.DB.prepare(
    "SELECT cumulative_msv, spe_flag, daily_dose_msv FROM radiation_doses WHERE user_id=? ORDER BY ts DESC LIMIT 1"
  ).bind(userId).first<any>();
  const radMed = await env.DB.prepare(
    "SELECT AVG(dose_rate_usv_h) m FROM radiation_doses WHERE user_id=? AND ts >= ?"
  ).bind(userId, new Date(Date.now() - 7 * 864e5).toISOString()).first<{ m: number | null }>();
  const radNow = await env.DB.prepare(
    "SELECT dose_rate_usv_h r FROM radiation_doses WHERE user_id=? AND dose_rate_usv_h IS NOT NULL ORDER BY ts DESC LIMIT 1"
  ).bind(userId).first<{ r: number }>();

  const risk = computeRisk({
    latest,
    hrZ: hr?.z,
    sleep7d: sleep?.v ?? undefined,
    phq9: phq?.score,
    gad7: gad?.score,
    phq9Item9: item9,
    cumulativeMsv: rad?.cumulative_msv ?? undefined,
    speMsv: rad?.spe_flag ? rad.daily_dose_msv ?? 0 : undefined,
    doseRateRatio: radNow?.r && radMed?.m ? radNow.r / radMed.m : undefined,
  });

  if (store) {
    await env.DB.prepare(
      "INSERT INTO risk_scores (user_id,ts,r,band,mdtr,domains,top_domains,override) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(userId, now(), risk.r, risk.band, risk.mdtr, JSON.stringify(risk.domains), JSON.stringify(risk.top_domains),
      risk.overrides.length ? JSON.stringify(risk.overrides) : null).run();
  }
  return risk;
}

// ---------- NOAA space weather (cron + manual refresh) ----------
async function pullSpaceWeather(env: Env) {
  const get = async (url: string) => {
    const r = await fetch(url, { headers: { "User-Agent": "EVAde-hackathon/1.0" } });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return r.json<any>();
  };
  const last = <T>(a: T[]) => (a.length ? a[a.length - 1] : undefined);

  let kp: number | null = null;
  try {
    const k = await get("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json");
    const row: any = last(k);
    kp = Array.isArray(row) ? Number(row[1]) : Number(row?.Kp ?? row?.kp_index ?? row?.estimated_kp);
    if (!Number.isFinite(kp)) kp = null;
  } catch (e) { console.log("kp", String(e)); }

  let pfu: number | null = null;
  try {
    const p = await get("https://services.swpc.noaa.gov/json/goes/primary/integral-protons-6-hour.json");
    const r: any = last(p.filter((x: any) => String(x.energy).replace(/\s/g, "") === ">=10MeV"));
    pfu = r ? Number(r.flux) : null;
  } catch (e) { console.log("protons", String(e)); }

  let xr: number | null = null;
  try {
    const x = await get("https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json");
    const r: any = last(x.filter((v: any) => String(v.energy).includes("0.1-0.8")));
    xr = r ? Number(r.flux) : null;
  } catch (e) { console.log("xray", String(e)); }

  const row = {
    ts: now().slice(0, 16) + ":00Z",
    kp_index: kp,
    proton_flux_10mev: pfu,
    xray_flux: xr,
    xray_class: xrayClass(xr),
    storm_level: stormLevel(pfu),
    eva_status: evaStatus(pfu, kp),
  };
  if (kp === null && pfu === null && xr === null) return { ...row, stored: false, error: "NOAA feeds unreachable" };
  await env.DB.prepare(
    `INSERT INTO space_weather (ts,kp_index,proton_flux_10mev,xray_flux,xray_class,storm_level,eva_status,source)
     VALUES (?,?,?,?,?,?,?, 'NOAA SWPC') ON CONFLICT(ts) DO NOTHING`
  ).bind(row.ts, row.kp_index, row.proton_flux_10mev, row.xray_flux, row.xray_class, row.storm_level, row.eva_status).run();
  return row;
}

// ---------- Router ----------
type Handler = (req: Request, env: Env, p: Record<string, string>, url: URL, ctx: ExecutionContext, who: Principal) => Promise<Response>;

// ---------- Live feed publishing (Durable Object) ----------
function publish(env: Env, ctx: ExecutionContext, ev: LiveEvent & { staff_only?: boolean }) {
  if (!env.LIVE) return;
  const stub = env.LIVE.get(env.LIVE.idFromName("crew"));
  ctx.waitUntil(
    stub.fetch("https://live/publish", { method: "POST", body: JSON.stringify(ev) }).then(() => {}, (e) => console.log("publish", String(e)))
  );
}
const isStaff = (who: Principal) => who.kind === "service" || STAFF_ROLES.has(who.role ?? "");

// ---------- Journal analysis (Workers AI) ----------
async function processJournal(env: Env, ctx: ExecutionContext, id: number, userId: string, content: string) {
  const a = await analyzeJournal(env, content);
  const ts = now();
  const stmts = [
    env.DB.prepare(
      `UPDATE journal_entries SET ai_summary=COALESCE(?,ai_summary), sentiment=COALESCE(?,sentiment), mood_label=?, concern_level=?,
       flags=?, analyzed_at=?, analysis_model=? WHERE id=?`
    ).bind(a.summary, a.sentiment, a.mood_label, a.concern_level,
      JSON.stringify({ themes: a.themes, needs_human_review: a.needs_human_review, keyword_flag: a.keyword_flag }), ts, a.model, id),
  ];
  if (a.needs_human_review) {
    const high = a.concern_level === "high";
    stmts.push(
      env.DB.prepare("INSERT INTO alerts (user_id,ts,level,metric,message,action,escalate) VALUES (?,?,?,?,?,?,?)").bind(
        userId, ts, high ? "red" : "yellow", "journal",
        high ? "A journal entry needs a same-day check-in from the crew psychologist / flight surgeon." : "A journal entry suggests the astronaut may want support.",
        high ? "Contact the astronaut privately within 1 hour." : "Offer a private conference with the psychologist.",
        high ? 1 : 0
      )
    );
  }
  await env.DB.batch(stmts);
  // Staff see the analysis live; the astronaut is not shown concern scores about themselves.
  publish(env, ctx, { type: "journal", user_id: userId, staff_only: true,
    data: { id, summary: a.summary, mood_label: a.mood_label, sentiment: a.sentiment, concern_level: a.concern_level, needs_human_review: a.needs_human_review } });
  if (a.needs_human_review) publish(env, ctx, { type: "alert", user_id: userId, staff_only: true, data: { metric: "journal", level: a.concern_level === "high" ? "red" : "yellow" } });
  return a;
}

// ---------- R2 media ----------
const MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
  "audio/webm": "webm", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/ogg": "ogg",
  "application/pdf": "pdf",
};
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

function targetUser(who: Principal, url: URL): string {
  const q = url.searchParams.get("user_id");
  if (isStaff(who)) {
    if (!q) throw new HttpError(400, "user_id query parameter is required");
    return q;
  }
  if (q && q !== who.user_id) throw new HttpError(403, "You can only upload your own files");
  return who.user_id!;
}

async function storeMedia(env: Env, req: Request, userId: string, kind: string, metric: string | null, note: string | null) {
  if (!env.MEDIA) throw new HttpError(503, "R2 bucket not configured yet");
  const ct = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = MEDIA_TYPES[ct];
  if (!ext) throw new HttpError(415, `Unsupported type ${ct || "(none)"}. Allowed: ${Object.keys(MEDIA_TYPES).join(", ")}`);
  const len = Number(req.headers.get("Content-Length") ?? "0");
  if (len > MAX_MEDIA_BYTES) throw new HttpError(413, "Max 25 MB per file");
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(422, "Empty file");
  if (buf.byteLength > MAX_MEDIA_BYTES) throw new HttpError(413, "Max 25 MB per file");
  const id = uuid();
  const key = `users/${userId}/${kind}/${id}.${ext}`;
  const ts = now();
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: ct }, customMetadata: { user_id: userId, kind } });
  await env.DB.prepare("INSERT INTO media (id,user_id,r2_key,kind,content_type,bytes,metric,note,ts) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, userId, key, kind, ct, buf.byteLength, metric, note, ts).run();
  return { media: { id, kind, content_type: ct, bytes: buf.byteLength, metric, note, ts, url: `/media/${id}` }, buf };
}
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "/?$"), h]);

route("GET", "/health", async (_r, env) => {
  const t = await env.DB.prepare("SELECT COUNT(*) n FROM users").first<{ n: number }>();
  return json({ ok: true, service: "evade-api", users: t?.n ?? 0, fastapi: !!env.FASTAPI_URL, time: now() });
});

// Health indicator catalogue: thresholds for color coding + tutorial text
route("GET", "/metrics", async (_r, env) => {
  const { results } = await env.DB.prepare("SELECT * FROM metric_definitions ORDER BY domain, metric").all();
  return json(results);
});

// Users / crew
route("POST", "/users", async (req, env) => {
  const b = await body(req);
  if (!b.display_name) throw new HttpError(422, "display_name is required");
  const id = uuid();
  await env.DB.prepare(
    "INSERT INTO users (user_id,display_name,role,environment,mission_name,mission_start) VALUES (?,?,?,?,?,?)"
  ).bind(id, b.display_name, b.role ?? "astronaut", b.environment ?? "station", b.mission_name ?? null, b.mission_start ?? now()).run();
  if ((b.role ?? "astronaut") === "astronaut") await seedTasks(env, id);
  return json(await requireUser(env, id), 201);
});
route("GET", "/users", async (_r, env) => {
  const { results } = await env.DB.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM alerts a WHERE a.user_id=u.user_id AND a.acknowledged=0) open_alerts,
            (SELECT r FROM risk_scores rs WHERE rs.user_id=u.user_id ORDER BY ts DESC LIMIT 1) last_r,
            (SELECT band FROM risk_scores rs WHERE rs.user_id=u.user_id ORDER BY ts DESC LIMIT 1) last_band
     FROM users u ORDER BY display_name`
  ).all();
  return json(results);
});
route("GET", "/users/:id", async (_r, env, p) => json(await requireUser(env, p.id)));

// Auth link (called server-side by Ryan B's auth / edge functions with the API key).
// Login once -> POST /auth/identities; afterwards GET /auth/identities/:provider/:subject returns the user.
route("POST", "/auth/identities", async (req, env) => {
  const b = await body(req);
  if (!b.provider || !b.subject) throw new HttpError(422, "provider and subject are required");
  if (b.user_id) await requireUser(env, b.user_id);
  return json(await linkIdentity(env, b, (id) => seedTasks(env, id)), 201);
});
route("GET", "/auth/identities/:provider/:subject", async (_r, env, p) => {
  const row = await env.DB.prepare(
    "SELECT u.* FROM auth_identities a JOIN users u USING(user_id) WHERE a.provider=? AND a.subject=?"
  ).bind(decodeURIComponent(p.provider), decodeURIComponent(p.subject)).first();
  if (!row) throw new HttpError(404, "No user linked to this login");
  return json(row);
});

// Admin panel (doctors / therapists)
route("GET", "/admin/crew", async (_r, env) => json((await env.DB.prepare("SELECT * FROM v_crew_overview ORDER BY escalated_alerts DESC, last_r DESC").all()).results));
route("GET", "/admin/escalations", async (_r, env) => json((await env.DB.prepare("SELECT * FROM v_escalations ORDER BY ts DESC").all()).results));
route("GET", "/admin/therapist-feed", async (_r, env, _p, url) => {
  const uid = url.searchParams.get("user_id");
  const q = uid
    ? env.DB.prepare("SELECT * FROM v_therapist_feed WHERE user_id=? ORDER BY ts DESC LIMIT 100").bind(uid)
    : env.DB.prepare("SELECT * FROM v_therapist_feed ORDER BY ts DESC LIMIT 100");
  return json((await q.all()).results);
});

// Observations
route("POST", "/observations", async (req, env, _p, _u, ctx) => {
  const b = await body(req);
  await requireUser(env, b.user_id);
  const items: ObsIn[] = Array.isArray(b.observations) ? b.observations : [b];
  if (items.length > 500) throw new HttpError(413, "Max 500 observations per call");
  const stored = await ingestObservations(env, b.user_id, items);
  const fresh = stored.filter((o) => Date.now() - Date.parse(o.ts) < 48 * 3600_000);
  if (fresh.length) {
    publish(env, ctx, { type: "observation", user_id: b.user_id, data: fresh });
    const flagged = fresh.filter((o) => o.level !== "green");
    if (flagged.length) publish(env, ctx, { type: "alert", user_id: b.user_id, data: flagged });
  }
  return json({ stored }, 201);
});
route("GET", "/users/:id/observations", async (_r, env, p, url) => {
  await requireUser(env, p.id);
  const days = Math.min(Number(url.searchParams.get("days") ?? 7), 365);
  const metric = url.searchParams.get("metric");
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const q = metric
    ? env.DB.prepare("SELECT metric,value,unit,ts,level,z,source FROM observations WHERE user_id=? AND metric=? AND ts>=? ORDER BY ts").bind(p.id, metric, since)
    : env.DB.prepare("SELECT metric,value,unit,ts,level,z,source FROM observations WHERE user_id=? AND ts>=? ORDER BY ts").bind(p.id, since);
  return json((await q.all()).results);
});

// Personal baseline (robust median/MAD over the last N green or unflagged readings)
route("POST", "/users/:id/baseline/:metric", async (req, env, p) => {
  await requireUser(env, p.id);
  const b = await body(req).catch(() => ({} as any));
  const days = b.days ?? 14;
  const { results } = await env.DB.prepare(
    `SELECT value, ts FROM observations WHERE user_id=? AND metric=? AND ts>=? AND (context_tags IS NULL OR context_tags='[]')
     AND (quality IS NULL OR quality >= 0.5) ORDER BY ts`
  ).bind(p.id, p.metric, new Date(Date.now() - days * 864e5).toISOString()).all<{ value: number; ts: string }>();
  if (results.length < 5) throw new HttpError(422, `Need at least 5 clean readings for a baseline, have ${results.length}`);
  const bl = robustBaseline(results.map((r) => r.value));
  const status = results.length >= 20 ? "locked" : b.demo ? "demo" : "provisional";
  const id = uuid();
  await env.DB.batch([
    env.DB.prepare("UPDATE baselines SET status='archived' WHERE user_id=? AND metric=? AND status!='archived'").bind(p.id, p.metric),
    env.DB.prepare(
      "INSERT INTO baselines (baseline_id,user_id,metric,center,spread,n,status,phase,window_start,window_end) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(id, p.id, p.metric, bl.center, bl.spread, bl.n, status, b.phase ?? "steady_state", results[0].ts, results[results.length - 1].ts),
  ]);
  return json({ baseline_id: id, metric: p.metric, ...bl, status }, 201);
});
route("GET", "/users/:id/baselines", async (_r, env, p) =>
  json((await env.DB.prepare("SELECT * FROM baselines WHERE user_id=? AND status!='archived'").bind(p.id).all()).results));

// Self-report / mood check-in (also stored as observations so they chart + color like the rest)
route("POST", "/self-reports", async (req, env) => {
  const b = await body(req);
  await requireUser(env, b.user_id);
  const ts = b.ts ?? now();
  await env.DB.prepare(
    "INSERT INTO self_reports (client_id,user_id,ts,mood,stress,fatigue,sleep_quality,note) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(client_id) DO NOTHING"
  ).bind(b.client_id ?? null, b.user_id, ts, b.mood ?? null, b.stress ?? null, b.fatigue ?? null, b.sleep_quality ?? null, b.note ?? null).run();
  const obs: ObsIn[] = [];
  const source = b.source === "synthetic" ? "synthetic" : "manual";
  if (b.mood) obs.push({ metric: "mood", value: b.mood, ts, source, client_id: b.client_id ? b.client_id + ":mood" : undefined });
  if (b.stress) obs.push({ metric: "stress", value: b.stress, ts, source, client_id: b.client_id ? b.client_id + ":stress" : undefined });
  return json({ ok: true, levels: obs.length ? await ingestObservations(env, b.user_id, obs) : [] }, 201);
});

// Questionnaires (PHQ-9, GAD-7, PVT). PHQ-9 item 9 > 0 escalates to a human immediately.
route("POST", "/instruments", async (req, env) => {
  const b = await body(req);
  await requireUser(env, b.user_id);
  if (!["PHQ9", "GAD7", "PVT"].includes(b.instrument)) throw new HttpError(422, "instrument must be PHQ9, GAD7 or PVT");
  const answers: number[] | undefined = b.answers;
  const score = b.score ?? (answers ? answers.reduce((a, x) => a + Number(x), 0) : null);
  if (score === null) throw new HttpError(422, "score or answers required");
  const escalate = b.instrument === "PHQ9" && answers && Number(answers[8]) > 0 ? 1 : 0;
  const ts = b.ts ?? now();
  const stmts = [
    env.DB.prepare("INSERT INTO instruments (client_id,user_id,instrument,score,answers,escalate,ts) VALUES (?,?,?,?,?,?,?) ON CONFLICT(client_id) DO NOTHING")
      .bind(b.client_id ?? null, b.user_id, b.instrument, score, answers ? JSON.stringify(answers) : null, escalate, ts),
  ];
  if (escalate)
    stmts.push(env.DB.prepare("INSERT INTO alerts (user_id,ts,level,metric,message,action,escalate) VALUES (?,?,'red','PHQ9',?,?,1)")
      .bind(b.user_id, ts, "Check-in answer needs a conversation with the flight surgeon / psychologist.", "Contact the flight surgeon within 1 hour."));
  await env.DB.batch(stmts);
  return json({ instrument: b.instrument, score, escalate: !!escalate }, 201);
});

// Journal (text or transcribed voice). Ryan B's LLM step PATCHes ai_summary / sentiment.
route("POST", "/journal", async (req, env, _p, url, ctx) => {
  const b = await body(req);
  await requireUser(env, b.user_id);
  if (!b.content || String(b.content).length > 20000) throw new HttpError(422, "content required (max 20k chars)");
  const r = await env.DB.prepare(
    "INSERT INTO journal_entries (client_id,user_id,ts,source,content) VALUES (?,?,?,?,?) ON CONFLICT(client_id) DO NOTHING RETURNING id"
  ).bind(b.client_id ?? null, b.user_id, b.ts ?? now(), b.source ?? "text", b.content).first<{ id: number }>();
  await env.DB.prepare(
    `UPDATE tasks SET completed_at=? WHERE id=(SELECT id FROM tasks WHERE user_id=? AND title LIKE 'Journal%' AND completed_at IS NULL ORDER BY due_at LIMIT 1)`
  ).bind(now(), b.user_id).run();
  if (!r?.id) return json({ id: null, duplicate: true }, 200);
  // Workers AI analysis runs after the response; ?analyze=sync waits for it (handy for demos)
  if (url.searchParams.get("analyze") === "sync") {
    const a = await processJournal(env, ctx, r.id, b.user_id, String(b.content));
    return json({ id: r.id, analysis: { summary: a.summary, mood_label: a.mood_label, sentiment: a.sentiment, themes: a.themes, model: a.model } }, 201);
  }
  ctx.waitUntil(processJournal(env, ctx, r.id, b.user_id, String(b.content)).then(() => {}, (e) => console.error("journal analysis", e)));
  return json({ id: r.id, analysis: "queued" }, 201);
});

// Voice journal: audio -> R2 (if enabled) -> Whisper transcript -> journal entry -> AI analysis
route("POST", "/journal/voice", async (req, env, _p, url, ctx, who) => {
  const userId = targetUser(who, url);
  await requireUser(env, userId);
  if (!env.AI) throw new HttpError(503, "Workers AI not configured");
  let audio: ArrayBuffer;
  let mediaId: string | null = null;
  if (env.MEDIA) {
    const { media, buf } = await storeMedia(env, req, userId, "audio", null, "voice journal");
    mediaId = media.id;
    audio = buf;
  } else {
    audio = await req.arrayBuffer();
    if (!audio.byteLength || audio.byteLength > MAX_MEDIA_BYTES) throw new HttpError(422, "Audio required, max 25 MB");
  }
  let text: string;
  try {
    ({ text } = await transcribe(env, audio));
  } catch (e) {
    console.error("transcribe", e);
    throw new HttpError(502, mediaId ? `Transcription failed; the recording was saved as media ${mediaId}` : "Transcription failed, try again");
  }
  if (!text) throw new HttpError(422, "No speech recognised in the recording");
  const r = await env.DB.prepare("INSERT INTO journal_entries (user_id,ts,source,content,media_id) VALUES (?,?, 'voice', ?, ?) RETURNING id")
    .bind(userId, now(), text, mediaId).first<{ id: number }>();
  ctx.waitUntil(processJournal(env, ctx, r!.id, userId, text).then(() => {}, (e) => console.error("journal analysis", e)));
  return json({ id: r!.id, transcript: text, media_id: mediaId, analysis: "queued" }, 201);
});

// Re-run the AI analysis on an entry (staff / service)
route("POST", "/journal/:jid/analyze", async (_r, env, p, _u, ctx) => {
  const j = await env.DB.prepare("SELECT user_id, content FROM journal_entries WHERE id=?").bind(p.jid).first<{ user_id: string; content: string }>();
  if (!j) throw new HttpError(404, "journal entry not found");
  return json(await processJournal(env, ctx, Number(p.jid), j.user_id, j.content));
});
route("GET", "/users/:id/journal", async (_r, env, p) =>
  json((await env.DB.prepare("SELECT * FROM journal_entries WHERE user_id=? ORDER BY ts DESC LIMIT 100").bind(p.id).all()).results));
route("PATCH", "/journal/:jid", async (req, env, p) => {
  const b = await body(req);
  await env.DB.prepare("UPDATE journal_entries SET ai_summary=COALESCE(?,ai_summary), sentiment=COALESCE(?,sentiment), flags=COALESCE(?,flags) WHERE id=?")
    .bind(b.ai_summary ?? null, b.sentiment ?? null, b.flags ? JSON.stringify(b.flags) : null, p.jid).run();
  return json({ ok: true });
});

// Radiation dosimetry
route("POST", "/radiation", async (req, env) => {
  const b = await body(req);
  await requireUser(env, b.user_id);
  const ts = b.ts ?? now();
  await env.DB.prepare(
    `INSERT INTO radiation_doses (client_id,user_id,ts,dose_rate_usv_h,daily_dose_msv,cumulative_msv,spe_flag,location,source)
     VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id) DO NOTHING`
  ).bind(b.client_id ?? null, b.user_id, ts, b.dose_rate_usv_h ?? null, b.daily_dose_msv ?? null, b.cumulative_msv ?? null,
    b.spe_flag ? 1 : 0, b.location ?? null, b.source ?? "dosimeter").run();
  const levels = b.daily_dose_msv !== undefined
    ? await ingestObservations(env, b.user_id, [{ metric: "daily_radiation_msv", value: b.daily_dose_msv, ts, source: b.source === "synthetic" ? "synthetic" : "device" }])
    : [];
  return json({ ok: true, levels }, 201);
});

// Space weather
route("GET", "/space-weather/latest", async (_r, env) =>
  json(await env.DB.prepare("SELECT * FROM space_weather ORDER BY ts DESC LIMIT 1").first()));
route("GET", "/space-weather/history", async (_r, env, _p, url) => {
  const hours = Math.min(Number(url.searchParams.get("hours") ?? 72), 24 * 30);
  return json((await env.DB.prepare("SELECT * FROM space_weather WHERE ts>=? ORDER BY ts")
    .bind(new Date(Date.now() - hours * 36e5).toISOString()).all()).results);
});
route("POST", "/space-weather/refresh", async (_r, env, _p, _u, ctx) => {
  const row = await pullSpaceWeather(env);
  if (!(row as any).error) publish(env, ctx, { type: "space_weather", data: row });
  return json(row);
});
route("POST", "/space-weather", async (req, env) => {
  // Written by the Python module (evade_space.client.push_space_weather), e.g. with forecast-derived EVA windows
  const rows: any[] = (await body(req)).rows ?? [];
  await env.DB.batch(rows.map((r) =>
    env.DB.prepare(`INSERT INTO space_weather (ts,kp_index,proton_flux_10mev,xray_flux,xray_class,storm_level,eva_status,source)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ts) DO UPDATE SET kp_index=excluded.kp_index, proton_flux_10mev=excluded.proton_flux_10mev,
      xray_flux=excluded.xray_flux, xray_class=excluded.xray_class, storm_level=excluded.storm_level, eva_status=excluded.eva_status, source=excluded.source`)
      .bind(r.ts, r.kp_index ?? null, r.proton_flux_10mev ?? null, r.xray_flux ?? null, r.xray_class ?? null, r.storm_level ?? null,
        r.eva_status ?? evaStatus(r.proton_flux_10mev ?? null, r.kp_index ?? null), r.source ?? "python")));
  return json({ stored: rows.length }, 201);
});

// Risk score + maximum days to return
route("GET", "/users/:id/risk", async (_r, env, p, url, ctx) => {
  await requireUser(env, p.id);
  const store = url.searchParams.get("store") !== "false";
  const risk = await riskFor(env, p.id, store);
  if (store) publish(env, ctx, { type: "risk", user_id: p.id, data: { r: risk.r, band: risk.band, mdtr: risk.mdtr, top_domains: risk.top_domains } });
  return json(risk);
});

// Plain-language daily briefing (Workers AI), cached in KV for 30 minutes
route("GET", "/users/:id/briefing", async (_r, env, p, url) => {
  const user = await requireUser(env, p.id);
  const cacheKey = `brief:${p.id}`;
  if (url.searchParams.get("refresh") !== "1") {
    const cached = await env.SESSIONS?.get(cacheKey, "json");
    if (cached) return json({ ...(cached as object), cached: true });
  }
  const risk = await riskFor(env, p.id, false);
  const defs = await metricDefs(env);
  const { results: latest } = await env.DB.prepare(
    `SELECT metric,value,unit,level FROM observations o WHERE user_id=? AND ts=(SELECT MAX(ts) FROM observations WHERE user_id=o.user_id AND metric=o.metric)`
  ).bind(p.id).all<any>();
  const sw = await env.DB.prepare("SELECT kp_index, storm_level, eva_status FROM space_weather ORDER BY ts DESC LIMIT 1").first();
  const facts = {
    name: user.display_name, environment: user.environment,
    overall: { band: risk.band, action: risk.action, max_days_to_return: risk.mdtr },
    readings: latest.map((l) => ({ label: defs.get(l.metric)?.label, value: l.value, unit: l.unit, level: l.level,
      action: l.level !== "green" ? defs.get(l.metric)?.what_to_do : undefined })),
    overrides: risk.overrides, space_weather: sw,
  };
  const text = await dailyBriefing(env, facts);
  const flagged = facts.readings.filter((r) => r.level !== "green");
  const fallback = [`Overall status: ${risk.band}. ${risk.action}`,
    ...flagged.map((r) => `${r.label} is ${r.value} ${r.unit} (${r.level}). ${r.action ?? ""}`.trim()),
    flagged.some((r) => r.level === "red") ? "A reading is red: contact the flight surgeon." : ""].filter(Boolean).join(" ");
  const out = { briefing: text ?? fallback, generated_by: text ? TEXT_MODEL : "rules", generated_at: now(),
    note: "Generated from your readings for information only; it is not a diagnosis." };
  if (text) await env.SESSIONS?.put(cacheKey, JSON.stringify(out), { expirationTtl: 1800 });
  return json(out);
});
route("GET", "/users/:id/risk/history", async (_r, env, p) =>
  json((await env.DB.prepare("SELECT ts,r,band,mdtr,domains FROM risk_scores WHERE user_id=? ORDER BY ts DESC LIMIT 200").bind(p.id).all()).results));

// Dashboard: one call for the frontend home screen
route("GET", "/users/:id/dashboard", async (_r, env, p) => {
  const user = await requireUser(env, p.id);
  const defs = await metricDefs(env);
  const { results: latest } = await env.DB.prepare(
    `SELECT metric,value,unit,ts,level,z FROM observations o WHERE user_id=? AND ts=(SELECT MAX(ts) FROM observations WHERE user_id=o.user_id AND metric=o.metric)`
  ).bind(p.id).all<any>();
  const [alerts, tasks, sw] = await Promise.all([
    env.DB.prepare("SELECT * FROM alerts WHERE user_id=? AND acknowledged=0 ORDER BY ts DESC LIMIT 20").bind(p.id).all(),
    env.DB.prepare("SELECT * FROM tasks WHERE user_id=? AND (completed_at IS NULL OR completed_at >= ?) ORDER BY completed_at IS NOT NULL, due_at")
      .bind(p.id, new Date(Date.now() - 864e5).toISOString()).all(),
    env.DB.prepare("SELECT * FROM space_weather ORDER BY ts DESC LIMIT 1").first(),
  ]);
  const risk = await riskFor(env, p.id, false);
  return json({
    user,
    risk,
    indicators: latest.map((l) => ({ ...l, label: defs.get(l.metric)?.label, domain: defs.get(l.metric)?.domain })),
    alerts: alerts.results,
    tasks: tasks.results,
    space_weather: sw,
  });
});

// Tasks / gamification
route("GET", "/users/:id/tasks", async (_r, env, p) =>
  json((await env.DB.prepare("SELECT * FROM tasks WHERE user_id=? ORDER BY completed_at IS NOT NULL, due_at").bind(p.id).all()).results));
route("POST", "/tasks", async (req, env) => {
  const b = await body(req);
  await requireUser(env, b.user_id);
  const r = await env.DB.prepare("INSERT INTO tasks (user_id,title,category,metric,recurrence,due_at,points) VALUES (?,?,?,?,?,?,?) RETURNING *")
    .bind(b.user_id, b.title, b.category ?? "basic", b.metric ?? null, b.recurrence ?? null, b.due_at ?? null, b.points ?? 10).first();
  return json(r, 201);
});
route("POST", "/tasks/:tid/complete", async (_r, env, p, _u, ctx) => {
  const t = await env.DB.prepare("SELECT * FROM tasks WHERE id=?").bind(p.tid).first<any>();
  if (!t) throw new HttpError(404, "task not found");
  if (t.completed_at) return json({ ok: true, already: true });
  await env.DB.batch([
    env.DB.prepare("UPDATE tasks SET completed_at=? WHERE id=?").bind(now(), p.tid),
    env.DB.prepare("UPDATE users SET points=points+?, last_active=? WHERE user_id=?").bind(t.points, now(), t.user_id),
  ]);
  publish(env, ctx, { type: "task", user_id: t.user_id, data: { id: t.id, title: t.title, points_awarded: t.points } });
  return json({ ok: true, points_awarded: t.points });
});
route("POST", "/users/:id/tasks/new-day", async (_r, env, p) => {
  await requireUser(env, p.id);
  await seedTasks(env, p.id);
  return json({ ok: true }, 201);
});
route("GET", "/leaderboard", async (_r, env) =>
  json((await env.DB.prepare("SELECT display_name, points, streak_days FROM users WHERE role='astronaut' ORDER BY points DESC").all()).results));

// Alerts
route("GET", "/users/:id/alerts", async (_r, env, p) =>
  json((await env.DB.prepare("SELECT * FROM alerts WHERE user_id=? ORDER BY ts DESC LIMIT 100").bind(p.id).all()).results));
route("GET", "/alerts/escalated", async (_r, env) =>
  json((await env.DB.prepare(
    "SELECT a.*, u.display_name FROM alerts a JOIN users u USING(user_id) WHERE a.escalate=1 AND a.acknowledged=0 ORDER BY a.ts DESC").all()).results));
route("POST", "/alerts/:aid/ack", async (_r, env, p) => {
  await env.DB.prepare("UPDATE alerts SET acknowledged=1, resolved_at=? WHERE id=?").bind(now(), p.aid).run();
  return json({ ok: true });
});

// R2 media: photos, ultrasound images, audio, PDFs. Raw body upload with the file's Content-Type.
// POST /media?kind=photo&metric=body_temp&note=... (staff/service add &user_id=)
route("POST", "/media", async (req, env, _p, url, ctx, who) => {
  const userId = targetUser(who, url);
  await requireUser(env, userId);
  const kind = url.searchParams.get("kind") ?? "photo";
  if (!["photo", "ultrasound", "audio", "document", "other"].includes(kind)) throw new HttpError(422, "kind must be photo, ultrasound, audio, document or other");
  const metric = url.searchParams.get("metric");
  const note = url.searchParams.get("note")?.slice(0, 500) ?? null;
  const { media } = await storeMedia(env, req, userId, kind, metric, note);
  publish(env, ctx, { type: "media", user_id: userId, data: media });
  return json(media, 201);
});
route("GET", "/users/:id/media", async (_r, env, p) =>
  json((await env.DB.prepare("SELECT id,kind,content_type,bytes,metric,note,ts FROM media WHERE user_id=? ORDER BY ts DESC LIMIT 200")
    .bind(p.id).all()).results.map((m: any) => ({ ...m, url: `/media/${m.id}` }))));
route("GET", "/media/:mid", async (_r, env, p) => {
  if (!env.MEDIA) throw new HttpError(503, "R2 bucket not configured yet");
  const m = await env.DB.prepare("SELECT r2_key, content_type FROM media WHERE id=?").bind(p.mid).first<{ r2_key: string; content_type: string }>();
  if (!m) throw new HttpError(404, "file not found");
  const obj = await env.MEDIA.get(m.r2_key);
  if (!obj) throw new HttpError(404, "file missing from storage");
  return new Response(obj.body, { headers: { "Content-Type": m.content_type, "Cache-Control": "private, max-age=300", ETag: obj.httpEtag } });
});

// Live crew feed (Durable Object WebSocket). Browser: new WebSocket("wss://api.evade.health/live") with the login cookie.
route("GET", "/live", async (req, env, _p, _u, _c, who) => {
  if (!env.LIVE) throw new HttpError(503, "Live feed not configured");
  if (req.headers.get("Upgrade") !== "websocket") throw new HttpError(426, "Expected a WebSocket upgrade");
  const headers = new Headers(req.headers);
  headers.set("X-Live-Principal", JSON.stringify({ staff: isStaff(who), user_id: who.user_id ?? null }));
  return env.LIVE.get(env.LIVE.idFromName("crew")).fetch(new Request(req, { headers }));
});
route("GET", "/live/stats", async (_r, env) => {
  if (!env.LIVE) throw new HttpError(503, "Live feed not configured");
  return env.LIVE.get(env.LIVE.idFromName("crew")).fetch("https://live/stats");
});

// Model results from Michael's FastAPI (push) ...
route("POST", "/model-results", async (req, env) => {
  const b = await body(req);
  await requireUser(env, b.user_id);
  await env.DB.prepare("INSERT INTO model_results (user_id,endpoint,model_id,ts,output,flag,confidence) VALUES (?,?,?,?,?,?,?)")
    .bind(b.user_id, b.endpoint, b.model_id ?? null, b.ts ?? now(), JSON.stringify(b.output ?? {}), b.flag ?? null, b.confidence ?? null).run();
  return json({ ok: true }, 201);
});
route("GET", "/users/:id/model-results", async (_r, env, p) =>
  json((await env.DB.prepare("SELECT * FROM model_results WHERE user_id=? ORDER BY ts DESC LIMIT 100").bind(p.id).all()).results));

// ... or proxy: frontend -> Worker -> FastAPI /predict/<kind>, result stored in D1
route("POST", "/predict/:kind", async (req, env, p) => {
  if (!env.FASTAPI_URL) throw new HttpError(503, "FASTAPI_URL not configured yet");
  if (!["ecg", "eeg", "radiation-risk", "risk"].includes(p.kind)) throw new HttpError(404, "unknown model endpoint");
  const payload = await body(req);
  await requireUser(env, payload.user_id);
  const r = await fetch(`${env.FASTAPI_URL.replace(/\/$/, "")}/predict/${p.kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(env.FASTAPI_KEY ? { "X-EVAde-Key": env.FASTAPI_KEY } : {}) },
    body: JSON.stringify(payload),
  });
  const out = await r.json<any>().catch(() => ({ error: "non-JSON response from model service" }));
  if (r.ok) {
    await env.DB.prepare("INSERT INTO model_results (user_id,endpoint,model_id,ts,output,flag,confidence) VALUES (?,?,?,?,?,?,?)")
      .bind(payload.user_id, `/predict/${p.kind}`, out.model_id ?? null, now(), JSON.stringify(out), out.flag ?? null, out.confidence ?? null).run();
  }
  return json(out, r.status);
});

// Offline-first sync: the frontend queues records in IndexedDB and flushes them here when a link is up.
route("POST", "/sync", async (req, env) => {
  const b = await body(req);
  await requireUser(env, b.user_id);
  const res: any = {};
  if (b.observations?.length) res.observations = (await ingestObservations(env, b.user_id, b.observations)).length;
  for (const sr of b.self_reports ?? []) {
    await env.DB.prepare("INSERT INTO self_reports (client_id,user_id,ts,mood,stress,fatigue,sleep_quality,note) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(client_id) DO NOTHING")
      .bind(sr.client_id ?? null, b.user_id, sr.ts ?? now(), sr.mood ?? null, sr.stress ?? null, sr.fatigue ?? null, sr.sleep_quality ?? null, sr.note ?? null).run();
  }
  for (const j of b.journal ?? []) {
    await env.DB.prepare("INSERT INTO journal_entries (client_id,user_id,ts,source,content) VALUES (?,?,?,?,?) ON CONFLICT(client_id) DO NOTHING")
      .bind(j.client_id ?? null, b.user_id, j.ts ?? now(), j.source ?? "text", j.content).run();
  }
  return json({ ok: true, ...res, synced_at: now() });
});

// ---------- Access control ----------
// service  = X-EVAde-Key (Python seeding, Michael's FastAPI, Ryan B's edge functions): full access
// staff    = session with role flight_surgeon / therapist / admin: every astronaut + admin routes
// user     = astronaut session: only their own user_id; missing user_id in a body is filled in for them
const STAFF_ONLY: [string, RegExp][] = [
  ["*", /^\/admin\//],
  ["GET", /^\/users\/?$/],
  ["POST", /^\/users\/?$/],
  ["GET", /^\/alerts\/escalated\/?$/],
  ["POST", /^\/model-results\/?$/],
  ["POST", /^\/space-weather(\/refresh)?\/?$/],
  ["*", /^\/auth\/identities/],
  ["POST", /^\/journal\/\d+\/analyze$/],
  ["GET", /^\/live\/stats$/],
];
const OWNED_BY_ID: [RegExp, string][] = [
  [/^\/tasks\/(\d+)\/complete$/, "tasks"],
  [/^\/journal\/(\d+)$/, "journal_entries"],
  [/^\/alerts\/(\d+)\/ack$/, "alerts"],
  [/^\/media\/([0-9a-f-]{36})$/, "media"],
];

async function authorize(req: Request, env: Env, url: URL): Promise<{ req: Request; principal: Principal }> {
  const key = req.headers.get("X-EVAde-Key");
  if (env.API_KEY && key === env.API_KEY) return { req, principal: { kind: "service" } };
  const session = await getSessionPrincipal(req, env);
  if (!session) {
    if (!env.API_KEY) return { req, principal: { kind: "service" } }; // local dev with no key configured
    throw new HttpError(401, "Sign in at /login, or send X-EVAde-Key");
  }
  // Cookie-authenticated writes must come from our own frontend (CSRF guard on top of SameSite=Lax)
  if (req.method !== "GET") {
    const origin = req.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
    if (origin && origin !== url.origin && !allowed.includes(origin)) throw new HttpError(403, "Cross-origin request blocked");
  }
  const staff = STAFF_ROLES.has(session.role ?? "");
  if (STAFF_ONLY.some(([m, re]) => (m === "*" || m === req.method) && re.test(url.pathname)) && !staff)
    throw new HttpError(403, "Flight surgeon / admin access only");
  if (staff) return { req, principal: session };

  const own = session.user_id!;
  const pathUser = url.pathname.match(/^\/users\/([^/]+)/)?.[1];
  if (pathUser && pathUser !== own) throw new HttpError(403, "You can only access your own data");
  for (const [re, table] of OWNED_BY_ID) {
    const m = url.pathname.match(re);
    if (m) {
      const row = await env.DB.prepare(`SELECT user_id FROM ${table} WHERE id=?`).bind(m[1]).first<{ user_id: string }>();
      if (row && row.user_id !== own) throw new HttpError(403, "You can only access your own data");
    }
  }
  if ((req.method === "POST" || req.method === "PATCH") && (req.headers.get("Content-Type") ?? "").includes("application/json")) {
    let b: any;
    try { b = await req.clone().json(); } catch { b = null; }
    if (b && typeof b === "object" && !Array.isArray(b)) {
      if (b.user_id && b.user_id !== own) throw new HttpError(403, "You can only write your own data");
      if (!b.user_id) {
        b.user_id = own;
        req = new Request(req, { body: JSON.stringify(b) });
      }
    }
  }
  return { req, principal: session };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const h = cors(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(request.url);
    const withCors = (res: Response) => {
      const r = new Response(res.body, res);
      for (const [k, v] of Object.entries(h)) r.headers.set(k, v);
      return r;
    };
    try {
      if (url.pathname === "/") return withCors(json({ service: "EVAde API", login: "/login", health: "/health" }));
      if (url.pathname === "/health" || url.pathname === "/metrics") {
        // public: no auth
      } else {
        const authRes = await handleAuth(request, env, url, (id) => seedTasks(env, id));
        if (authRes) return withCors(authRes);
      }
      let req = request;
      let who: Principal = { kind: "service" };
      if (url.pathname !== "/health" && url.pathname !== "/metrics") ({ req, principal: who } = await authorize(request, env, url));
      for (const [m, re, handler] of routes) {
        const match = url.pathname.match(re);
        if (match && m === req.method) {
          const res = await handler(req, env, (match.groups ?? {}) as Record<string, string>, url, ctx, who);
          return res.status === 101 ? res : withCors(res); // WebSocket upgrades must be returned untouched
        }
      }
      throw new HttpError(404, `No route ${req.method} ${url.pathname}`);
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ error: status === 500 ? "Internal error" : e.message }, status, h);
    }
  },

  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext) {
    const row = await pullSpaceWeather(env);
    if (!(row as any).error) publish(env, ctx, { type: "space_weather", data: row });
  },
} satisfies ExportedHandler<Env>;
