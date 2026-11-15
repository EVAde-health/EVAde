// Flight-surgeon console, astronaut emergencies, and astronaut-to-staff chat.
// Staff means a Cloudflare Access staff session whose D1 role is flight_surgeon, therapist, or admin.
// Callers are already authenticated. These handlers still check the role before reading another person.
import { Principal, STAFF_ROLES } from "./auth";
import { HttpError } from "./http";

export interface OpsDb {
  DB: D1Database;
}

type Handler = (req: Request, env: OpsDb, p: Record<string, string>, url: URL, ctx: ExecutionContext, who: Principal) => Promise<Response>;

const GOAL_DEFAULTS: { metric: string; target: number; min: number; max: number }[] = [
  { metric: "kcal_intake", target: 2800, min: 800, max: 6000 },
  { metric: "protein_intake_g", target: 110, min: 0, max: 400 },
  { metric: "carbs_intake_g", target: 360, min: 0, max: 800 },
  { metric: "fat_intake_g", target: 95, min: 0, max: 300 },
  { metric: "water_intake_ml", target: 2500, min: 250, max: 10000 },
  { metric: "sleep_hours", target: 8, min: 4, max: 12 },
];
const GROUPS = new Set(["vitals", "sleep", "mind", "nutrition", "radiation", "bone", "immune", "score"]);
const SLEEP_METRICS = ["sleep_hours", "sleep_deep_hours", "sleep_rem_hours", "sleep_light_hours", "sleep_awake_hours"] as const;

const staffPerson = (who: Principal) => who.kind === "user" && STAFF_ROLES.has(who.role ?? "");

function idOf(raw: string, label: string) {
  if (!/^[1-9]\d{0,14}$/.test(raw)) throw new HttpError(422, `Invalid ${label}`);
  return Number(raw);
}

function text(value: unknown, field: string, max: number, required: boolean) {
  if (value == null || value === "") {
    if (required) throw new HttpError(422, `${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new HttpError(422, `${field} must be text`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new HttpError(422, `${field} must be 1-${max} characters`);
  return trimmed;
}

function daysOf(url: URL, fallback = 14) {
  const raw = url.searchParams.get("days");
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 90) throw new HttpError(422, "days must be an integer from 1 to 90");
  return n;
}

function sinceDay(days: number) {
  return new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
}

interface CrewProfile {
  user_id: string;
  display_name: string;
  full_name?: string;
  crew_id?: string;
  crew_role?: string;
  role: string;
  mission_name: string | null;
  mission_start: string | null;
  mission_length_days?: number;
  environment: string;
  points: number;
  streak_days: number;
  last_active: string | null;
}

function displayProfile(row: Pick<CrewProfile, "user_id" | "display_name" | "full_name" | "crew_role">) {
  return { user_id: row.user_id, display_name: row.display_name, full_name: row.full_name ?? null, crew_role: row.crew_role ?? null };
}

async function astronaut(env: OpsDb, userId: string) {
  // The deployed schema has optional profile columns from a historical migration.
  const user = await env.DB.prepare("SELECT * FROM users WHERE user_id=?").bind(userId).first<CrewProfile>();
  if (!user) throw new HttpError(404, "Unknown astronaut");
  if (user.role !== "astronaut") throw new HttpError(422, "That account is not an astronaut");
  return {
    ...displayProfile(user), crew_id: user.crew_id ?? null, mission_name: user.mission_name,
    mission_start: user.mission_start, mission_length_days: user.mission_length_days ?? null,
    environment: user.environment, points: user.points, streak_days: user.streak_days, last_active: user.last_active,
  };
}

export async function crewOverview(db: D1Database) {
  const [{ results }, { results: profiles }] = await Promise.all([
    db.prepare(
      `SELECT c.*, u.mission_start, u.streak_days,
              (SELECT COUNT(*) FROM emergencies e WHERE e.user_id=c.user_id AND e.status!='resolved') AS open_emergencies,
              (SELECT value FROM v_latest_indicators v WHERE v.user_id=c.user_id AND v.metric='heart_rate') AS heart_rate,
              (SELECT level FROM v_latest_indicators v WHERE v.user_id=c.user_id AND v.metric='heart_rate') AS heart_rate_level,
              (SELECT value FROM v_latest_indicators v WHERE v.user_id=c.user_id AND v.metric='sleep_hours') AS sleep_hours,
              (SELECT value FROM v_latest_indicators v WHERE v.user_id=c.user_id AND v.metric='mood') AS mood
       FROM v_crew_overview c JOIN users u ON u.user_id=c.user_id
       ORDER BY open_emergencies DESC, c.escalated_alerts DESC, c.display_name`
    ).all<{ user_id: string }>(),
    db.prepare("SELECT * FROM users WHERE role='astronaut'").all<CrewProfile>(),
  ]);
  const byId = new Map(profiles.map((user) => [user.user_id, user]));
  return results.map((row) => {
    const user = byId.get(row.user_id);
    return { ...row, full_name: user?.full_name ?? null, crew_id: user?.crew_id ?? null, crew_role: user?.crew_role ?? null };
  });
}

async function currentGoals(env: OpsDb, userId: string) {
  const [{ results: defs }, { results: set }] = await Promise.all([
    env.DB.prepare("SELECT metric, label, unit FROM metric_definitions").all<{ metric: string; label: string; unit: string }>(),
    env.DB.prepare(
      `SELECT g.metric, g.target, g.unit, g.note, g.effective_at, s.display_name AS set_by_name
       FROM daily_goals g LEFT JOIN users s ON s.user_id=g.set_by
       WHERE g.user_id=? AND g.superseded_at IS NULL`
    ).bind(userId).all<any>(),
  ]);
  const byMetric = new Map(defs.map((d) => [d.metric, d]));
  const setByMetric = new Map(set.map((row) => [row.metric, row]));
  const seen = new Set<string>();
  const goals: any[] = [];
  for (const item of GOAL_DEFAULTS) {
    const def = byMetric.get(item.metric);
    if (!def) continue;
    seen.add(item.metric);
    const row = setByMetric.get(item.metric);
    goals.push(row
      ? { metric: item.metric, label: def.label, unit: row.unit || def.unit, target: row.target, source: "set", note: row.note, effective_at: row.effective_at, set_by_name: row.set_by_name }
      : { metric: item.metric, label: def.label, unit: def.unit, target: item.target, source: "default", note: null, effective_at: null, set_by_name: null });
  }
  for (const row of set) {
    if (seen.has(row.metric)) continue;
    const def = byMetric.get(row.metric);
    goals.push({ metric: row.metric, label: def?.label ?? row.metric, unit: row.unit || def?.unit || "", target: row.target, source: "set", note: row.note, effective_at: row.effective_at, set_by_name: row.set_by_name });
  }
  return goals;
}

type Metric = { metric: string; label: string; unit: string; domain: string; ui_group?: string | null };
type SeriesPoint = { metric: string; day: string; value: number; min: number; max: number; n: number };

function groupOf(def: Metric) {
  if (def.ui_group) return def.ui_group;
  if (def.metric.startsWith("sleep_")) return "sleep";
  if (/^(immune_|antibody_)/.test(def.metric)) return "immune";
  if (def.metric === "blood_glucose" || def.domain === "cardiac" || def.domain === "general") return "vitals";
  if (def.domain === "behavioral" || def.domain === "neuro") return "mind";
  return def.domain;
}

async function seriesFor(env: OpsDb, userId: string, group: string | null, metric: string | null, days: number) {
  const start = sinceDay(days);
  const [{ results: defs }, trendView, { results: observations }, { results: latest }] = await Promise.all([
    env.DB.prepare("SELECT * FROM metric_definitions WHERE (? IS NULL OR metric=?) ORDER BY label").bind(metric, metric).all<Metric>(),
    env.DB.prepare("SELECT name FROM sqlite_schema WHERE type='view' AND name='v_daily_trend'").first(),
    env.DB.prepare(
      `SELECT metric, substr(ts,1,10) AS day, AVG(value) AS value, MIN(value) AS min, MAX(value) AS max, COUNT(*) AS n
       FROM observations WHERE user_id=? AND ts>=? AND (? IS NULL OR metric=?)
       GROUP BY metric, day ORDER BY day`
    ).bind(userId, `${start}T00:00:00.000Z`, metric, metric).all<SeriesPoint>(),
    env.DB.prepare("SELECT metric, value, level, ts FROM v_latest_indicators WHERE user_id=?").bind(userId)
      .all<{ metric: string; value: number; level: string; ts: string }>(),
  ]);
  const filtered = defs.filter((def) => !group || groupOf(def) === group);
  if (metric && !filtered.length) throw new HttpError(422, "Unknown metric");
  const rollups = trendView
    ? (await env.DB.prepare("SELECT metric, day, value, min, max, n FROM v_daily_trend WHERE user_id=? AND day>=? ORDER BY day")
      .bind(userId, start).all<SeriesPoint>()).results
    : [];
  const latestOf = new Map(latest.map((row) => [row.metric, row]));
  return filtered.map((def) => {
    const points = new Map(observations.filter((p) => p.metric === def.metric).map((p) => [p.day, { ...p, source: "observation" }]));
    for (const p of rollups) if (p.metric === def.metric) points.set(p.day, { ...p, source: "rollup" });
    return {
      metric: def.metric, label: def.label, unit: def.unit, latest: latestOf.get(def.metric) ?? null,
      points: [...points.values()].sort((a, b) => a.day.localeCompare(b.day)),
    };
  });
}

async function threadFor(env: OpsDb, who: Principal, threadId: number) {
  const thread = await env.DB.prepare(
    `SELECT t.*, au.display_name AS astronaut_name, su.display_name AS staff_name, su.role AS staff_role
     FROM staff_threads t
     JOIN users au ON au.user_id=t.astronaut_id
     JOIN users su ON su.user_id=t.staff_id
     WHERE t.id=?`
  ).bind(threadId).first<any>();
  if (!thread) throw new HttpError(404, "Conversation not found");
  if (who.kind !== "user" || who.demo) throw new HttpError(403, "Use your own account to open a conversation");
  const mine = staffPerson(who) ? thread.staff_id === who.user_id : thread.astronaut_id === who.user_id;
  if (!mine) throw new HttpError(403, "You can only open your own conversations");
  return thread;
}

export function registerOps(route: (method: string, path: string, handler: Handler) => void, deps: {
  json: (data: unknown, status?: number) => Response;
  body: <T = any>(req: Request) => Promise<T>;
  now: () => string;
}) {
  const { json, body, now } = deps;

  route("GET", "/admin/astronauts/:id", async (_r, env, p) => {
    const user = await astronaut(env, p.id);
    const [risk, counts, { results: latest }] = await Promise.all([
      env.DB.prepare("SELECT r, band, mdtr, ts FROM risk_scores WHERE user_id=? ORDER BY ts DESC LIMIT 1").bind(p.id).first(),
      env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM alerts WHERE user_id=? AND acknowledged=0) AS open_alerts,
           (SELECT COUNT(*) FROM alerts WHERE user_id=? AND acknowledged=0 AND escalate=1) AS escalated_alerts,
           (SELECT COUNT(*) FROM emergencies WHERE user_id=? AND status!='resolved') AS open_emergencies`
      ).bind(p.id, p.id, p.id).first(),
      env.DB.prepare(
        `SELECT metric, label, domain, value, unit, level, ts FROM v_latest_indicators WHERE user_id=? ORDER BY domain, metric`
      ).bind(p.id).all(),
    ]);
    return json({ user, risk, ...counts, latest });
  });

  route("GET", "/users/:id/goals", async (_r, env, p) => {
    await astronaut(env, p.id);
    return json({ goals: await currentGoals(env, p.id) });
  });

  route("GET", "/admin/astronauts/:id/goals", async (_r, env, p) => {
    await astronaut(env, p.id);
    const { results: history } = await env.DB.prepare(
      `SELECT g.id, g.metric, m.label, g.target, g.unit, g.note, g.effective_at, g.superseded_at, s.display_name AS set_by_name
       FROM daily_goals g JOIN metric_definitions m ON m.metric=g.metric
       LEFT JOIN users s ON s.user_id=g.set_by
       WHERE g.user_id=? ORDER BY g.effective_at DESC LIMIT 200`
    ).bind(p.id).all();
    return json({ goals: await currentGoals(env, p.id), history });
  });

  route("POST", "/admin/astronauts/:id/goals", async (req, env, p, _u, _c, who) => {
    await astronaut(env, p.id);
    const input = await body(req);
    const metric = text(input?.metric, "metric", 64, true)!;
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(metric)) throw new HttpError(422, "Invalid metric");
    if (typeof input?.target !== "number" || !Number.isFinite(input.target)) throw new HttpError(422, "target must be a number");
    const def = await env.DB.prepare("SELECT label, unit FROM metric_definitions WHERE metric=?").bind(metric).first<{ label: string; unit: string }>();
    if (!def) throw new HttpError(422, "Unknown metric");
    const bounds = GOAL_DEFAULTS.find((item) => item.metric === metric) ?? { min: 0, max: 1_000_000 };
    if (input.target < bounds.min || input.target > bounds.max) throw new HttpError(422, `target must be between ${bounds.min} and ${bounds.max}`);
    const note = text(input?.note, "note", 300, false);
    const ts = now();
    const statements = [
      env.DB.prepare("UPDATE daily_goals SET superseded_at=? WHERE user_id=? AND metric=? AND superseded_at IS NULL").bind(ts, p.id, metric),
      env.DB.prepare(
        "INSERT INTO daily_goals (user_id, metric, target, unit, note, set_by, effective_at) VALUES (?,?,?,?,?,?,?)"
      ).bind(p.id, metric, input.target, def.unit, note, who.user_id ?? null, ts),
      env.DB.prepare("INSERT INTO action_log (user_id, ts, action, detail) VALUES (?,?, 'goal_set', ?)").bind(
        p.id, ts, JSON.stringify({ metric, target: input.target }),
      ),
    ];
    await env.DB.batch(statements);
    const goal = (await currentGoals(env, p.id)).find((item) => item.metric === metric);
    return json({ goal }, 201);
  });

  route("GET", "/admin/astronauts/:id/series", async (_r, env, p, url) => {
    await astronaut(env, p.id);
    const group = url.searchParams.get("group");
    if (group && !GROUPS.has(group)) throw new HttpError(422, "Unknown metric group");
    const metric = url.searchParams.get("metric");
    if (metric && !/^[a-z][a-z0-9_]{0,63}$/.test(metric)) throw new HttpError(422, "Invalid metric");
    const days = daysOf(url, 30);
    return json({ group, days, metrics: await seriesFor(env, p.id, group, metric, days) });
  });

  route("GET", "/admin/astronauts/:id/nutrition", async (_r, env, p, url) => {
    await astronaut(env, p.id);
    const days = daysOf(url, 14);
    const start = sinceDay(days);
    const [daily, meals, goals] = await Promise.all([
      env.DB.prepare(
        "SELECT day, kcal, protein_g, carbs_g, fat_g, meals, water_ml FROM v_daily_intake WHERE user_id=? AND day>=? ORDER BY day"
      ).bind(p.id, start).all(),
      env.DB.prepare(
        "SELECT id, ts, name, grams, kcal, protein, carbs, fat FROM meals WHERE user_id=? AND ts>=? ORDER BY ts DESC LIMIT 40"
      ).bind(p.id, `${start}T00:00:00.000Z`).all(),
      currentGoals(env, p.id),
    ]);
    const goal = (metric: string) => goals.find((item) => item.metric === metric)?.target ?? null;
    return json({
      days: daily.results,
      meals: meals.results,
      goals: {
        kcal: goal("kcal_intake"), protein: goal("protein_intake_g"), carbs: goal("carbs_intake_g"),
        fat: goal("fat_intake_g"), water_ml: goal("water_intake_ml"),
      },
    });
  });

  route("GET", "/admin/astronauts/:id/sleep", async (_r, env, p, url) => {
    await astronaut(env, p.id);
    const days = daysOf(url, 14);
    const metrics = await seriesFor(env, p.id, "sleep", null, days);
    const byName = new Map(metrics.filter((item) => (SLEEP_METRICS as readonly string[]).includes(item.metric)).map((item) => [item.metric, item]));
    const nights = new Map<string, Record<string, number | null>>();
    for (const name of SLEEP_METRICS) {
      for (const point of byName.get(name)?.points ?? []) {
        const row = nights.get(point.day) ?? { hours: null, deep: null, rem: null, light: null, awake: null };
        const key = name === "sleep_hours" ? "hours" : name.replace("sleep_", "").replace("_hours", "");
        row[key] = point.value;
        nights.set(point.day, row);
      }
    }
    const goals = await currentGoals(env, p.id);
    return json({
      target: goals.find((item) => item.metric === "sleep_hours")?.target ?? 8,
      nights: [...nights.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, row]) => ({ day, ...row })),
    });
  });

  route("GET", "/admin/astronauts/:id/mood", async (_r, env, p, url) => {
    await astronaut(env, p.id);
    const start = `${sinceDay(daysOf(url, 35))}T00:00:00.000Z`;
    const [reports, journal] = await Promise.all([
      env.DB.prepare(
        "SELECT id, ts, mood, stress, fatigue, sleep_quality, note FROM self_reports WHERE user_id=? AND ts>=? ORDER BY ts"
      ).bind(p.id, start).all(),
      env.DB.prepare(
        `SELECT id, ts, source, mood_label, concern_level, sentiment, ai_summary, substr(content,1,400) AS excerpt
         FROM journal_entries WHERE user_id=? ORDER BY ts DESC LIMIT 20`
      ).bind(p.id).all(),
    ]);
    return json({ reports: reports.results, journal: journal.results });
  });

  route("GET", "/admin/astronauts/:id/alerts", async (_r, env, p) => {
    await astronaut(env, p.id);
    const { results } = await env.DB.prepare(
      "SELECT id, ts, level, metric, message, action, escalate, acknowledged, resolved_at FROM alerts WHERE user_id=? ORDER BY ts DESC LIMIT 200"
    ).bind(p.id).all();
    return json(results);
  });

  route("GET", "/admin/alerts", async (_r, env, _p, url) => {
    const limit = daysOf(new URL(`${url.origin}/?days=${url.searchParams.get("limit") ?? "80"}`), 80);
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.ts, a.level, a.metric, a.message, a.action, a.escalate, a.acknowledged, a.resolved_at,
              a.user_id, u.display_name
       FROM alerts a JOIN users u ON u.user_id=a.user_id
       ORDER BY a.ts DESC LIMIT ?`
    ).bind(limit).all();
    return json(results);
  });

  route("POST", "/emergencies", async (req, env, _p, _u, _c, who) => {
    if (who.kind !== "user" || who.role !== "astronaut" || who.demo) {
      throw new HttpError(403, "Use your own astronaut account to raise an emergency");
    }
    const input = await body(req);
    const message = text(input?.message, "message", 500, false);
    const ts = now();
    const userId = who.user_id!;
    const [, created] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO alerts (user_id, ts, level, metric, message, action, escalate)
         SELECT ?,?, 'red', 'emergency', ?, 'Contact this astronaut now.', 1
         WHERE NOT EXISTS (SELECT 1 FROM emergencies WHERE user_id=? AND status!='resolved')`
      ).bind(userId, ts, message ? `Emergency: ${message}` : "The astronaut pressed the emergency control.", userId),
      env.DB.prepare(
        `INSERT INTO emergencies (user_id, message, alert_id, created_at)
         SELECT ?,?, (SELECT id FROM alerts WHERE user_id=? AND ts=? AND metric='emergency' ORDER BY id DESC LIMIT 1),?
         WHERE NOT EXISTS (SELECT 1 FROM emergencies WHERE user_id=? AND status!='resolved')
         RETURNING *`
      ).bind(userId, message, userId, ts, ts, userId),
    ]);
    if (created.results[0]) return json({ emergency: created.results[0], already: false }, 201);
    const existing = await env.DB.prepare(
      "SELECT * FROM emergencies WHERE user_id=? ORDER BY id DESC LIMIT 1"
    ).bind(userId).first();
    return json({ emergency: existing, already: true });
  });

  route("GET", "/emergencies/mine", async (_r, env, _p, _u, _c, who) => {
    if (!who.user_id || who.demo) throw new HttpError(403, "Use your own account to see your emergencies");
    const { results } = await env.DB.prepare(
      "SELECT * FROM emergencies WHERE user_id=? ORDER BY created_at DESC LIMIT 20"
    ).bind(who.user_id).all();
    return json({ emergencies: results });
  });

  route("GET", "/admin/emergencies", async (_r, env, _p, url) => {
    const status = url.searchParams.get("status");
    if (status && !["open", "acknowledged", "resolved"].includes(status)) throw new HttpError(422, "Unknown status");
    const { results } = await env.DB.prepare(
      `SELECT e.*, u.display_name,
              ack.display_name AS acknowledged_by_name, res.display_name AS resolved_by_name
       FROM emergencies e JOIN users u ON u.user_id=e.user_id
       LEFT JOIN users ack ON ack.user_id=e.acknowledged_by
       LEFT JOIN users res ON res.user_id=e.resolved_by
       WHERE (? IS NULL OR e.status=?)
       ORDER BY CASE e.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, e.created_at DESC
       LIMIT 100`
    ).bind(status, status).all();
    return json(results);
  });

  async function emergencyById(env: OpsDb, raw: string) {
    const row = await env.DB.prepare("SELECT * FROM emergencies WHERE id=?").bind(idOf(raw, "emergency")).first<any>();
    if (!row) throw new HttpError(404, "Emergency not found");
    return row;
  }

  route("POST", "/admin/emergencies/:id/acknowledge", async (_r, env, p, _u, _c, who) => {
    const row = await emergencyById(env, p.id);
    if (row.status === "resolved") throw new HttpError(409, "This emergency is already resolved");
    if (row.status === "open") {
      const ts = now();
      await env.DB.batch([
        env.DB.prepare("UPDATE emergencies SET status='acknowledged', acknowledged_at=?, acknowledged_by=? WHERE id=? AND status='open'")
          .bind(ts, who.user_id!, row.id),
        env.DB.prepare("UPDATE alerts SET acknowledged=1, acknowledged_by=? WHERE id=? AND acknowledged=0")
          .bind(who.user_id!, row.alert_id),
      ]);
    }
    return json({ emergency: await emergencyById(env, String(row.id)) });
  });

  route("POST", "/admin/emergencies/:id/resolve", async (req, env, p, _u, _c, who) => {
    const row = await emergencyById(env, p.id);
    if (row.status === "resolved") return json({ emergency: row, already: true });
    const input = await body(req);
    const note = text(input?.note, "note", 500, false);
    const ts = now();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE emergencies SET status='resolved', resolved_at=?, resolved_by=?, resolution_note=?,
           acknowledged_at=COALESCE(acknowledged_at, ?), acknowledged_by=COALESCE(acknowledged_by, ?)
         WHERE id=? AND status!='resolved'`
      ).bind(ts, who.user_id!, note, ts, who.user_id!, row.id),
      env.DB.prepare("UPDATE alerts SET acknowledged=1, resolved_at=COALESCE(resolved_at, ?) WHERE id=?").bind(ts, row.alert_id),
    ]);
    return json({ emergency: await emergencyById(env, String(row.id)) });
  });

  route("GET", "/admin/notifications", async (_r, env, _p, _u, _c, who) => {
    const [{ results: emergencies }, unread] = await Promise.all([
      env.DB.prepare(
        `SELECT e.id, e.user_id, e.status, e.message, e.created_at, u.display_name
         FROM emergencies e JOIN users u ON u.user_id=e.user_id
         WHERE e.status!='resolved' ORDER BY e.created_at DESC LIMIT 20`
      ).all<any>(),
      who.user_id
        ? env.DB.prepare(
          `SELECT COUNT(*) AS n FROM staff_messages m JOIN staff_threads t ON t.id=m.thread_id
           WHERE t.staff_id=? AND m.sender_id!=? AND m.read_at IS NULL`
        ).bind(who.user_id, who.user_id).first<{ n: number }>()
        : Promise.resolve({ n: 0 }),
    ]);
    return json({
      emergencies,
      open_count: emergencies.filter((row) => row.status === "open").length,
      acknowledged_count: emergencies.filter((row) => row.status === "acknowledged").length,
      unread_messages: unread?.n ?? 0,
    });
  });

  route("GET", "/staff", async (_r, env, _p, _u, _c, who) => {
    if (who.demo || who.kind !== "user") throw new HttpError(403, "Use your own account to see the staff directory");
    const { results } = await env.DB.prepare(
      "SELECT u.* FROM users u WHERE u.role IN ('flight_surgeon','therapist','admin') AND EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id=u.user_id AND a.provider='cloudflare_access') ORDER BY u.role, u.display_name"
    ).all<CrewProfile>();
    return json(results.map((row) => ({ ...displayProfile(row), role: row.role })));
  });

  async function appendMessage(env: OpsDb, threadId: number, sender: string, content: string, ts: string) {
    const [created] = await env.DB.batch([
      env.DB.prepare("INSERT INTO staff_messages (thread_id, sender_id, body, created_at) VALUES (?,?,?,?) RETURNING *")
        .bind(threadId, sender, content, ts),
      env.DB.prepare("UPDATE staff_threads SET updated_at=? WHERE id=?").bind(ts, threadId),
    ]);
    return created.results[0];
  }

  route("GET", "/chat/threads", async (_r, env, _p, _u, _c, who) => {
    if (!who.user_id || who.demo) throw new HttpError(403, "Use your own account to see conversations");
    const column = staffPerson(who) ? "t.staff_id" : "t.astronaut_id";
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.astronaut_id, t.staff_id, t.updated_at,
              au.display_name AS astronaut_name, su.display_name AS staff_name, su.role AS staff_role,
              (SELECT body FROM staff_messages m WHERE m.thread_id=t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
              (SELECT created_at FROM staff_messages m WHERE m.thread_id=t.id ORDER BY m.id DESC LIMIT 1) AS last_at,
              (SELECT COUNT(*) FROM staff_messages m WHERE m.thread_id=t.id AND m.sender_id!=? AND m.read_at IS NULL) AS unread
       FROM staff_threads t
       JOIN users au ON au.user_id=t.astronaut_id
       JOIN users su ON su.user_id=t.staff_id
       WHERE ${column}=? ORDER BY t.updated_at DESC`
    ).bind(who.user_id, who.user_id).all();
    return json(results);
  });

  route("POST", "/chat/threads", async (req, env, _p, _u, _c, who) => {
    if (who.kind !== "user" || !who.user_id || who.demo) throw new HttpError(403, "Sign in to start a conversation");
    const input = await body(req);
    const first = text(input?.body, "body", 2000, false);
    let astronautId: string;
    let staffId: string;
    if (staffPerson(who)) {
      astronautId = text(input?.astronaut_id, "astronaut_id", 80, true)!;
      staffId = who.user_id;
      await astronaut(env, astronautId);
    } else {
      if (who.role !== "astronaut") throw new HttpError(403, "Only an astronaut can message staff this way");
      staffId = text(input?.staff_id, "staff_id", 80, true)!;
      astronautId = who.user_id;
      const staff = await env.DB.prepare("SELECT u.role FROM users u WHERE u.user_id=? AND EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id=u.user_id AND a.provider='cloudflare_access')").bind(staffId).first<{ role: string }>();
      if (!staff || !STAFF_ROLES.has(staff.role)) throw new HttpError(422, "Choose a flight surgeon, therapist, or admin");
    }
    const ts = now();
    await env.DB.prepare(
      "INSERT INTO staff_threads (astronaut_id, staff_id, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(astronaut_id, staff_id) DO NOTHING"
    ).bind(astronautId, staffId, ts, ts).run();
    const thread = await env.DB.prepare(
      "SELECT * FROM staff_threads WHERE astronaut_id=? AND staff_id=?"
    ).bind(astronautId, staffId).first<any>();
    const message = first ? await appendMessage(env, thread.id, who.user_id, first, ts) : null;
    return json({ thread: await threadFor(env, who, thread.id), message }, message ? 201 : 200);
  });

  route("GET", "/chat/threads/:id/messages", async (_r, env, p, _u, _c, who) => {
    const thread = await threadFor(env, who, idOf(p.id, "conversation"));
    const { results } = await env.DB.prepare(
      `SELECT m.id, m.sender_id, u.display_name AS sender_name, m.body, m.created_at, m.read_at
       FROM staff_messages m JOIN users u ON u.user_id=m.sender_id
       WHERE m.thread_id=? ORDER BY m.id DESC LIMIT 200`
    ).bind(thread.id).all();
    return json({ thread, messages: results.reverse() });
  });

  route("POST", "/chat/threads/:id/read", async (req, env, p, _u, _c, who) => {
    const thread = await threadFor(env, who, idOf(p.id, "conversation"));
    const { through_id: through } = await body(req);
    if (!Number.isSafeInteger(through) || through < 1) throw new HttpError(422, "through_id must be a message ID");
    await env.DB.prepare("UPDATE staff_messages SET read_at=? WHERE thread_id=? AND sender_id!=? AND read_at IS NULL AND id<=?")
      .bind(now(), thread.id, who.user_id!, through).run();
    return new Response(null, { status: 204 });
  });

  route("POST", "/chat/threads/:id/messages", async (req, env, p, _u, _c, who) => {
    const thread = await threadFor(env, who, idOf(p.id, "conversation"));
    const input = await body(req);
    const content = text(input?.body, "body", 2000, true)!;
    const message = await appendMessage(env, thread.id, who.user_id!, content, now());
    return json({ message }, 201);
  });
}
