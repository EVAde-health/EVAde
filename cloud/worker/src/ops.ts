// Flight-surgeon console: crew overview, astronaut records, goals, vital corrections, emergencies and notifications.
// Every /admin/* path is limited to staff roles in index.ts authorize() (403 for astronauts, demo and service keys);
// the handlers below still validate that the target account is an astronaut before reading or writing it.
import { Principal, STAFF_ROLES } from "./auth";
import { levelFromThresholds, type MetricDef } from "./health";
import { HttpError } from "./http";

export interface OpsDb {
  DB: D1Database;
}

type Handler = (req: Request, env: OpsDb, p: Record<string, string>, url: URL, ctx: ExecutionContext, who: Principal) => Promise<Response>;

// ---------- goals ----------
export const GOAL_TYPES = {
  calories: { label: "Calories", noun: "calorie goal", unit: "kcal", target: 2800, min: 800, max: 6000, setting: "kcal_goal" },
  protein: { label: "Protein", noun: "protein goal", unit: "g", target: 110, min: 20, max: 400, setting: "protein_goal_g" },
  carbs: { label: "Carbohydrates", noun: "carbohydrate goal", unit: "g", target: 360, min: 20, max: 900, setting: "carbs_goal_g" },
  fat: { label: "Fat", noun: "fat goal", unit: "g", target: 95, min: 10, max: 300, setting: "fat_goal_g" },
  water_ml: { label: "Water", noun: "water goal", unit: "ml", target: 2500, min: 500, max: 8000, setting: "water_goal_ml" },
  sleep_h: { label: "Sleep", noun: "sleep goal", unit: "h", target: 8, min: 4, max: 12, setting: "sleep_target_h" },
  steps: { label: "Steps", noun: "step goal", unit: "steps", target: 8000, min: 0, max: 50000, setting: null },
} as const;
export type GoalType = keyof typeof GOAL_TYPES;
export const isGoalType = (value: unknown): value is GoalType => typeof value === "string" && value in GOAL_TYPES;

export interface ResolvedGoal {
  goal_type: GoalType;
  label: string;
  unit: string;
  target: number;
  source: "surgeon" | "self" | "settings" | "default";
  note: string | null;
  set_by_name: string | null;
  set_at: string | null;
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));

/**
 * Current goals per astronaut. Precedence: the latest user_goals row (surgeon or self), then the
 * astronaut's user_settings row, then the defaults above. Omit userId to resolve every account at once.
 */
export async function resolveGoals(db: D1Database, userId?: string) {
  const one = userId ?? null;
  const [{ results: rows }, { results: settings }] = await Promise.all([
    db.prepare(
      `SELECT g.user_id, g.goal_type, g.target, g.unit, g.note, g.created_at, s.display_name AS set_by_name, s.role AS set_by_role,
              g.set_by = g.user_id AS self
       FROM user_goals g LEFT JOIN users s ON s.user_id = g.set_by
       WHERE (?1 IS NULL OR g.user_id = ?1)
         AND g.id = (SELECT g2.id FROM user_goals g2 WHERE g2.user_id = g.user_id AND g2.goal_type = g.goal_type
                     ORDER BY g2.created_at DESC, g2.id DESC LIMIT 1)`
    ).bind(one).all<any>(),
    db.prepare("SELECT * FROM user_settings WHERE (?1 IS NULL OR user_id = ?1)").bind(one).all<any>(),
  ]);
  const byUser = new Map<string, Map<string, any>>();
  for (const row of rows) {
    const map = byUser.get(row.user_id) ?? new Map();
    map.set(row.goal_type, row);
    byUser.set(row.user_id, map);
  }
  const settingsOf = new Map(settings.map((row) => [row.user_id, row]));
  return (id: string): ResolvedGoal[] => (Object.keys(GOAL_TYPES) as GoalType[]).map((type) => {
    const def = GOAL_TYPES[type];
    const row = byUser.get(id)?.get(type);
    if (row) {
      return {
        goal_type: type, label: def.label, unit: def.unit, target: row.target, source: row.self ? "self" : "surgeon",
        note: row.note ?? null, set_by_name: row.set_by_name ?? null, set_at: row.created_at,
      };
    }
    const setting = def.setting ? settingsOf.get(id)?.[def.setting] : undefined;
    if (typeof setting === "number") {
      return { goal_type: type, label: def.label, unit: def.unit, target: setting, source: "settings", note: null, set_by_name: null, set_at: null };
    }
    return { goal_type: type, label: def.label, unit: def.unit, target: def.target, source: "default", note: null, set_by_name: null, set_at: null };
  });
}

export async function goalsFor(db: D1Database, userId: string) {
  return (await resolveGoals(db, userId))(userId);
}

/** Records goal changes (one row each, latest wins). Returns the statements so callers can batch them. */
export function goalInserts(db: D1Database, userId: string, changes: { goal_type: GoalType; target: number }[], setBy: string | null, note: string | null, ts: string) {
  return changes.map((change) => db.prepare(
    "INSERT INTO user_goals (user_id, goal_type, target, unit, note, set_by, created_at) VALUES (?,?,?,?,?,?,?)"
  ).bind(userId, change.goal_type, change.target, GOAL_TYPES[change.goal_type].unit, note, setBy, ts));
}

export function notifyStatement(db: D1Database, userId: string, kind: string, title: string, bodyText: string, actorId: string | null, ts: string) {
  return db.prepare("INSERT INTO user_notifications (user_id, kind, title, body, actor_id, created_at) VALUES (?,?,?,?,?,?)")
    .bind(userId, kind, title, bodyText, actorId, ts);
}

// ---------- small validators ----------
function idOf(raw: string, label: string) {
  if (!/^[1-9]\d{0,14}$/.test(raw)) throw new HttpError(422, `Invalid ${label}`);
  return Number(raw);
}

function text(value: unknown, field: string, max: number, required: boolean, min = 1) {
  if (value == null || value === "") {
    if (required) throw new HttpError(422, `${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new HttpError(422, `${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new HttpError(422, `${field} must be ${min}-${max} characters`);
  return trimmed;
}

function daysOf(url: URL, fallback = 14, max = 90) {
  const raw = url.searchParams.get("days");
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new HttpError(422, `days must be an integer from 1 to ${max}`);
  return n;
}

const sinceDay = (days: number) => new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
const utcToday = () => new Date().toISOString().slice(0, 10);
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

function displayName(row: { display_name: string; full_name?: string | null }) {
  return row.full_name || row.display_name;
}

async function astronaut(env: OpsDb, userId: string) {
  // SELECT *: the profile columns (full_name, crew_role, ...) come from a later migration.
  const user = await env.DB.prepare("SELECT * FROM users WHERE user_id=?").bind(userId).first<any>();
  if (!user) throw new HttpError(404, "Unknown astronaut");
  if (user.role !== "astronaut") throw new HttpError(422, "That account is not an astronaut");
  return {
    user_id: user.user_id, display_name: user.display_name, full_name: user.full_name ?? null, crew_id: user.crew_id ?? null,
    crew_role: user.crew_role ?? null, mission_name: user.mission_name, mission_start: user.mission_start,
    mission_length_days: user.mission_length_days ?? null, environment: user.environment, points: user.points,
    streak_days: user.streak_days, last_active: user.last_active,
  };
}

/** How the astronaut sees the acting surgeon, e.g. "Dr. Ortiz". */
async function actorName(env: OpsDb, who: Principal) {
  const row = await env.DB.prepare("SELECT display_name, full_name, role FROM users WHERE user_id=?").bind(who.user_id ?? "").first<any>();
  if (!row) return "Your flight surgeon";
  const name = (row.full_name || row.display_name.replace(/\s*\(.*\)\s*$/, "")).trim();
  if (row.role !== "flight_surgeon" || /^dr\.?\s/i.test(name)) return name;
  return `Dr. ${name.split(/\s+/).at(-1)}`;
}

// ---------- crew overview ----------
const CREW_VITALS = ["heart_rate", "systolic_bp", "diastolic_bp", "spo2", "body_temp", "respiration_rate"];

export async function crewOverview(db: D1Database, surgeonId: string | null) {
  const day = utcToday();
  const from = `${day}T00:00:00.000Z`;
  const to = `${nextDay(day)}T00:00:00.000Z`;
  const [users, vitals, checkins, journals, meals, water, tasks, emergencies, alerts, unread, goals] = await Promise.all([
    db.prepare("SELECT * FROM users WHERE role='astronaut' ORDER BY display_name").all<any>(),
    db.prepare(
      `SELECT user_id, metric, label, value, unit, level, ts FROM v_latest_indicators WHERE metric IN (${CREW_VITALS.map(() => "?").join(",")})`
    ).bind(...CREW_VITALS).all<any>(),
    db.prepare(
      `SELECT s.user_id, s.ts, s.mood, s.stress, s.source, s.checkin_level FROM self_reports s
       WHERE s.id = (SELECT id FROM self_reports s2 WHERE s2.user_id = s.user_id ORDER BY s2.ts DESC, s2.id DESC LIMIT 1)`
    ).all<any>(),
    db.prepare("SELECT user_id, MAX(ts) AS ts FROM journal_entries GROUP BY user_id").all<any>(),
    db.prepare("SELECT user_id, SUM(kcal) AS kcal, SUM(protein) AS protein FROM meals WHERE ts>=? AND ts<? GROUP BY user_id").bind(from, to).all<any>(),
    db.prepare("SELECT user_id, SUM(amount_ml) AS ml FROM hydration WHERE ts>=? AND ts<? GROUP BY user_id").bind(from, to).all<any>(),
    db.prepare(
      "SELECT user_id, COUNT(*) AS total, SUM(completed_at IS NOT NULL) AS done FROM tasks WHERE recurrence='daily' AND day=? GROUP BY user_id"
    ).bind(day).all<any>(),
    db.prepare(
      `SELECT e.id, e.user_id, e.status, e.message, e.created_at, e.acknowledged_at, ack.display_name AS acknowledged_by_name
       FROM emergencies e LEFT JOIN users ack ON ack.user_id = e.acknowledged_by WHERE e.status != 'resolved'`
    ).all<any>(),
    db.prepare("SELECT user_id, COUNT(*) AS open, SUM(level='red') AS red FROM alerts WHERE acknowledged=0 GROUP BY user_id").all<any>(),
    surgeonId
      ? db.prepare(
        `SELECT c.astronaut_id AS user_id, COUNT(*) AS n FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.surgeon_id=? AND m.sender_id != ? AND m.read_at IS NULL GROUP BY c.astronaut_id`
      ).bind(surgeonId, surgeonId).all<any>()
      : Promise.resolve({ results: [] as any[] }),
    resolveGoals(db),
  ]);
  const index = <T extends { user_id: string }>(rows: T[]) => new Map(rows.map((row) => [row.user_id, row]));
  const vitalsOf = new Map<string, Record<string, any>>();
  for (const row of vitals.results) {
    const entry = vitalsOf.get(row.user_id) ?? {};
    entry[row.metric] = { value: row.value, unit: row.unit, level: row.level, ts: row.ts, label: row.label };
    vitalsOf.set(row.user_id, entry);
  }
  const [checkinOf, journalOf, mealOf, waterOf, taskOf, emergencyOf, alertOf, unreadOf] =
    [checkins, journals, meals, water, tasks, emergencies, alerts, unread].map((r) => index(r.results as any[]));
  return users.results.map((user) => {
    const userGoals = goals(user.user_id);
    const target = (type: GoalType) => userGoals.find((goal) => goal.goal_type === type)!.target;
    const task = taskOf.get(user.user_id);
    const progress = {
      calories: { value: Math.round(mealOf.get(user.user_id)?.kcal ?? 0), target: target("calories"), unit: "kcal" },
      protein: { value: Math.round(mealOf.get(user.user_id)?.protein ?? 0), target: target("protein"), unit: "g" },
      water_ml: { value: Math.round(waterOf.get(user.user_id)?.ml ?? 0), target: target("water_ml"), unit: "ml" },
      tasks: { value: task?.done ?? 0, target: task?.total ?? 0, unit: "tasks" },
    };
    const parts = Object.values(progress).filter((item) => item.target > 0).map((item) => Math.min(1, item.value / item.target));
    const latest = vitalsOf.get(user.user_id) ?? {};
    const levels = Object.values(latest).map((v: any) => v.level);
    const emergency = emergencyOf.get(user.user_id) ?? null;
    const alert = alertOf.get(user.user_id);
    const status = emergency?.status === "open" || levels.includes("red") || (alert?.red ?? 0) > 0 ? "critical"
      : emergency || levels.includes("yellow") || (alert?.open ?? 0) > 0 ? "caution" : "nominal";
    const checkin = checkinOf.get(user.user_id) ?? null;
    const journal = journalOf.get(user.user_id)?.ts ?? null;
    return {
      user_id: user.user_id, display_name: user.display_name, full_name: user.full_name ?? null, crew_role: user.crew_role ?? null,
      mission_name: user.mission_name, environment: user.environment, points: user.points, streak_days: user.streak_days,
      last_active: user.last_active, status, emergency, open_alerts: alert?.open ?? 0, red_alerts: alert?.red ?? 0,
      unread_messages: unreadOf.get(user.user_id)?.n ?? 0,
      vitals: latest,
      last_checkin: checkin ? { ts: checkin.ts, mood: checkin.mood, stress: checkin.stress, source: checkin.source, level: checkin.checkin_level } : null,
      last_journal_at: journal,
      progress, goal_progress: parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) : null,
    };
  });
}

// ---------- metric series (vitals charts) ----------
type Metric = MetricDef & { label: string; unit: string; domain: string; ui_group?: string | null };
type SeriesPoint = { metric: string; day: string; value: number; min: number; max: number; n: number };
const GROUPS = new Set(["vitals", "sleep", "mind", "nutrition", "radiation", "bone", "immune", "score"]);

function groupOf(def: Metric) {
  if (def.ui_group) return def.ui_group;
  if (def.metric.startsWith("sleep_")) return "sleep";
  if (def.metric === "blood_glucose" || def.domain === "cardiac" || def.domain === "general") return "vitals";
  if (def.domain === "behavioral" || def.domain === "neuro") return "mind";
  return def.domain;
}

async function seriesFor(env: OpsDb, userId: string, group: string | null, metric: string | null, days: number) {
  const start = sinceDay(days);
  const [{ results: defs }, { results: observations }, { results: latest }] = await Promise.all([
    env.DB.prepare("SELECT * FROM metric_definitions WHERE (? IS NULL OR metric=?) ORDER BY label").bind(metric, metric).all<Metric>(),
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
  const latestOf = new Map(latest.map((row) => [row.metric, row]));
  return filtered.map((def) => ({
    metric: def.metric, label: def.label, unit: def.unit, decimals: (def as any).decimals ?? 0,
    green_min: def.green_min, green_max: def.green_max, latest: latestOf.get(def.metric) ?? null,
    points: observations.filter((p) => p.metric === def.metric).map((p) => ({ ...p, value: Math.round(p.value * 100) / 100 })),
  }));
}

export function registerOps(route: (method: string, path: string, handler: Handler) => void, deps: {
  json: (data: unknown, status?: number) => Response;
  body: <T = any>(req: Request) => Promise<T>;
  now: () => string;
}) {
  const { json, body, now } = deps;

  // ----- crew -----
  route("GET", "/admin/crew", async (_r, env, _p, _u, _c, who) => json(await crewOverview(env.DB, who.user_id ?? null)));

  // Lightweight list for the searchable astronaut pickers.
  route("GET", "/admin/astronauts", async (_r, env) => {
    const { results } = await env.DB.prepare(
      `SELECT u.*, (SELECT status FROM emergencies e WHERE e.user_id=u.user_id AND e.status!='resolved' LIMIT 1) AS emergency_status
       FROM users u WHERE u.role='astronaut' ORDER BY u.display_name`
    ).all<any>();
    return json(results.map((u) => ({
      user_id: u.user_id, display_name: u.display_name, full_name: u.full_name ?? null, crew_role: u.crew_role ?? null,
      mission_name: u.mission_name, emergency_status: u.emergency_status ?? null,
    })));
  });

  route("GET", "/admin/astronauts/:id", async (_r, env, p) => {
    const user = await astronaut(env, p.id);
    const [risk, counts, { results: latest }, checkin] = await Promise.all([
      env.DB.prepare("SELECT r, band, mdtr, ts FROM risk_scores WHERE user_id=? ORDER BY ts DESC LIMIT 1").bind(p.id).first(),
      env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM alerts WHERE user_id=?1 AND acknowledged=0) AS open_alerts,
           (SELECT COUNT(*) FROM alerts WHERE user_id=?1 AND acknowledged=0 AND escalate=1) AS escalated_alerts,
           (SELECT COUNT(*) FROM emergencies WHERE user_id=?1 AND status!='resolved') AS open_emergencies`
      ).bind(p.id).first(),
      env.DB.prepare(
        "SELECT metric, label, domain, value, unit, level, ts FROM v_latest_indicators WHERE user_id=? ORDER BY domain, metric"
      ).bind(p.id).all(),
      env.DB.prepare("SELECT ts, mood, stress, fatigue, source, checkin_level FROM self_reports WHERE user_id=? ORDER BY ts DESC LIMIT 1").bind(p.id).first(),
    ]);
    return json({ user, risk, ...counts, latest, last_checkin: checkin });
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
      goalsFor(env.DB, p.id),
    ]);
    const goal = (type: GoalType) => goals.find((item) => item.goal_type === type)?.target ?? null;
    return json({
      days: daily.results, meals: meals.results,
      goals: { kcal: goal("calories"), protein: goal("protein"), carbs: goal("carbs"), fat: goal("fat"), water_ml: goal("water_ml") },
    });
  });

  route("GET", "/admin/astronauts/:id/sleep", async (_r, env, p, url) => {
    await astronaut(env, p.id);
    const days = daysOf(url, 14);
    const metrics = await seriesFor(env, p.id, "sleep", null, days);
    const nights = new Map<string, Record<string, number | null>>();
    for (const item of metrics) {
      const key = item.metric === "sleep_hours" ? "hours" : item.metric.replace("sleep_", "").replace("_hours", "");
      if (!["hours", "deep", "rem", "light", "awake"].includes(key)) continue;
      for (const point of item.points) {
        const row = nights.get(point.day) ?? { hours: null, deep: null, rem: null, light: null, awake: null };
        row[key] = point.value;
        nights.set(point.day, row);
      }
    }
    const goals = await goalsFor(env.DB, p.id);
    return json({
      target: goals.find((item) => item.goal_type === "sleep_h")?.target ?? 8,
      nights: [...nights.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, row]) => ({ day, ...row })),
    });
  });

  // Journal entries and check-ins (app and voice) for one astronaut.
  route("GET", "/admin/astronauts/:id/journal", async (_r, env, p, url) => {
    await astronaut(env, p.id);
    const start = `${sinceDay(daysOf(url, 35, 365))}T00:00:00.000Z`;
    const [reports, journal] = await Promise.all([
      env.DB.prepare(
        `SELECT id, ts, mood, stress, fatigue, sleep_quality, note, source, sleep_hours, symptoms, checkin_level
         FROM self_reports WHERE user_id=? AND ts>=? ORDER BY ts DESC LIMIT 200`
      ).bind(p.id, start).all<any>(),
      env.DB.prepare(
        `SELECT id, ts, source, mood_label, concern_level, sentiment, ai_summary, substr(content,1,4000) AS content
         FROM journal_entries WHERE user_id=? ORDER BY ts DESC LIMIT 60`
      ).bind(p.id).all(),
    ]);
    const list = (raw: unknown) => { try { const v = JSON.parse(String(raw ?? "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
    return json({ checkins: reports.results.map((r) => ({ ...r, symptoms: list(r.symptoms) })), journal: journal.results });
  });
  // Older console path kept for compatibility.
  route("GET", "/admin/astronauts/:id/mood", async (_r, env, p, url) => {
    await astronaut(env, p.id);
    const start = `${sinceDay(daysOf(url, 35))}T00:00:00.000Z`;
    const [reports, journal] = await Promise.all([
      env.DB.prepare("SELECT id, ts, mood, stress, fatigue, sleep_quality, note FROM self_reports WHERE user_id=? AND ts>=? ORDER BY ts").bind(p.id, start).all(),
      env.DB.prepare(
        `SELECT id, ts, source, mood_label, concern_level, sentiment, ai_summary, substr(content,1,400) AS excerpt
         FROM journal_entries WHERE user_id=? ORDER BY ts DESC LIMIT 20`
      ).bind(p.id).all(),
    ]);
    return json({ reports: reports.results, journal: journal.results });
  });

  // Tasks, XP, streak and tutorials for one astronaut (read-only; the astronaut's own app creates today's list).
  route("GET", "/admin/astronauts/:id/tasks", async (_r, env, p) => {
    const user = await astronaut(env, p.id);
    const day = utcToday();
    const [today, history, tutorials, xp, legacyOpen] = await Promise.all([
      env.DB.prepare(
        `SELECT t.id, t.title, t.detail, t.category, t.metric, t.recurrence, t.day, t.points, t.completed_at, tt.kind, tt.sort_order
         FROM tasks t LEFT JOIN task_templates tt ON tt.task_key = t.task_key
         WHERE t.user_id=? AND t.recurrence='daily' AND t.day=? ORDER BY COALESCE(tt.sort_order, 999), t.id`
      ).bind(p.id, day).all(),
      env.DB.prepare(
        `SELECT day, COUNT(*) AS total, SUM(completed_at IS NOT NULL) AS done, SUM(CASE WHEN completed_at IS NOT NULL THEN points ELSE 0 END) AS points
         FROM tasks WHERE user_id=? AND recurrence='daily' AND day>=? GROUP BY day ORDER BY day`
      ).bind(p.id, sinceDay(14)).all(),
      env.DB.prepare(
        `SELECT tp.tutorial_id, t.title, tp.completed_at, tp.points_awarded FROM tutorial_progress tp
         JOIN tutorials t ON t.id = tp.tutorial_id WHERE tp.user_id=? ORDER BY tp.completed_at DESC`
      ).bind(p.id).all(),
      env.DB.prepare(
        `SELECT ts, action, detail FROM action_log WHERE user_id=? AND action IN
           ('task_points_awarded','meal_logged','water_logged','reading_logged') ORDER BY ts DESC LIMIT 25`
      ).bind(p.id).all(),
      env.DB.prepare(
        "SELECT id, title, category, metric, points, due_at, completed_at FROM tasks WHERE user_id=? AND task_key IS NULL AND completed_at IS NULL ORDER BY due_at DESC LIMIT 20"
      ).bind(p.id).all(),
    ]);
    return json({
      day, points: user.points, streak_days: user.streak_days, today: today.results, history: history.results,
      tutorials: tutorials.results, recent_xp: xp.results, open_legacy_tasks: legacyOpen.results,
    });
  });

  // ----- goals -----
  route("GET", "/users/:id/goals", async (_r, env, p) => {
    await astronaut(env, p.id);
    return json({ goals: await goalsFor(env.DB, p.id) });
  });

  route("GET", "/admin/astronauts/:id/goals", async (_r, env, p) => {
    await astronaut(env, p.id);
    const { results: history } = await env.DB.prepare(
      `SELECT g.id, g.goal_type, g.target, g.unit, g.note, g.created_at, g.set_by, s.display_name AS set_by_name, s.role AS set_by_role
       FROM user_goals g LEFT JOIN users s ON s.user_id = g.set_by
       WHERE g.user_id=? ORDER BY g.created_at DESC, g.id DESC LIMIT 200`
    ).bind(p.id).all();
    return json({ goals: await goalsFor(env.DB, p.id), history, types: GOAL_TYPES });
  });

  // Body: { goal_type, target, note? } or { changes: [{ goal_type, target }], note? }. Unchanged targets are skipped.
  route("POST", "/admin/astronauts/:id/goals", async (req, env, p, _u, _c, who) => {
    await astronaut(env, p.id);
    const input = await body(req);
    const raw: unknown[] = Array.isArray(input?.changes) ? input.changes : [input];
    if (!raw.length || raw.length > 7) throw new HttpError(422, "Send 1-7 goal changes");
    const note = text(input?.note, "note", 300, false);
    const current = await goalsFor(env.DB, p.id);
    const changes: { goal_type: GoalType; target: number }[] = [];
    for (const item of raw as any[]) {
      if (!isGoalType(item?.goal_type)) throw new HttpError(422, `goal_type must be one of ${Object.keys(GOAL_TYPES).join(", ")}`);
      const def = GOAL_TYPES[item.goal_type as GoalType];
      if (typeof item.target !== "number" || !Number.isFinite(item.target) || item.target < def.min || item.target > def.max) {
        throw new HttpError(422, `${def.label} target must be between ${def.min} and ${def.max} ${def.unit}`);
      }
      const target = item.goal_type === "water_ml" || item.goal_type === "steps" || item.goal_type === "calories" ? Math.round(item.target) : Math.round(item.target * 10) / 10;
      if (changes.some((c) => c.goal_type === item.goal_type)) throw new HttpError(422, "Each goal type can appear once");
      if (current.find((g) => g.goal_type === item.goal_type)?.target !== target || current.find((g) => g.goal_type === item.goal_type)?.source !== "surgeon") {
        changes.push({ goal_type: item.goal_type, target });
      }
    }
    if (!changes.length) return json({ goals: current, changed: [] });
    const ts = now();
    const actor = await actorName(env, who);
    const statements = [
      ...goalInserts(env.DB, p.id, changes, who.user_id ?? null, note, ts),
      ...changes.map((c) => {
        const def = GOAL_TYPES[c.goal_type];
        return notifyStatement(env.DB, p.id, "goal_updated", `${def.label} goal updated`,
          `${actor} updated your ${def.noun} to ${fmt(c.target)} ${def.unit}.${note ? ` Note: ${note}` : ""}`, who.user_id ?? null, ts);
      }),
      env.DB.prepare("INSERT INTO action_log (user_id, ts, action, detail) VALUES (?,?, 'goal_set', ?)")
        .bind(p.id, ts, JSON.stringify({ by: who.user_id, changes })),
    ];
    await env.DB.batch(statements);
    return json({ goals: await goalsFor(env.DB, p.id), changed: changes.map((c) => c.goal_type) }, 201);
  });

  // ----- vitals and corrections -----
  route("GET", "/admin/astronauts/:id/observations", async (_r, env, p, url) => {
    await astronaut(env, p.id);
    const metric = url.searchParams.get("metric");
    if (metric && !/^[a-z][a-z0-9_]{0,63}$/.test(metric)) throw new HttpError(422, "Invalid metric");
    const start = `${sinceDay(daysOf(url, 7))}T00:00:00.000Z`;
    const { results } = await env.DB.prepare(
      `SELECT o.id, o.metric, m.label, o.value, o.unit, o.ts, o.level, o.source, m.decimals,
              (SELECT COUNT(*) FROM vital_corrections c WHERE c.observation_id = o.id) AS corrections,
              (SELECT original_value FROM vital_corrections c WHERE c.observation_id = o.id ORDER BY c.id LIMIT 1) AS original_value
       FROM observations o JOIN metric_definitions m ON m.metric = o.metric
       WHERE o.user_id=? AND o.ts>=? AND (? IS NULL OR o.metric=?)
       ORDER BY o.ts DESC LIMIT 300`
    ).bind(p.id, start, metric, metric).all();
    return json(results);
  });

  route("POST", "/admin/observations/:oid/correct", async (req, env, p, _u, _c, who) => {
    const obs = await env.DB.prepare(
      `SELECT o.id, o.user_id, o.metric, o.value, o.level, o.unit, u.role, m.label FROM observations o
       JOIN users u ON u.user_id = o.user_id JOIN metric_definitions m ON m.metric = o.metric WHERE o.id=?`
    ).bind(idOf(p.oid, "observation")).first<any>();
    if (!obs) throw new HttpError(404, "Reading not found");
    if (obs.role !== "astronaut") throw new HttpError(422, "Only astronaut readings can be corrected");
    const input = await body(req);
    if (typeof input?.value !== "number" || !Number.isFinite(input.value)) throw new HttpError(422, "value must be a number");
    const reason = text(input?.reason, "reason", 300, true, 3)!;
    const def = await env.DB.prepare("SELECT * FROM metric_definitions WHERE metric=?").bind(obs.metric).first<MetricDef & { display_max: number | null }>();
    if (input.value < 0 || (def?.display_max != null && input.value > def.display_max * 2)) throw new HttpError(422, "That value is outside the plausible range");
    if (input.value === obs.value) throw new HttpError(422, "The corrected value matches the recorded value");
    const level = def ? levelFromThresholds(input.value, def) : obs.level;
    const ts = now();
    const actor = await actorName(env, who);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO vital_corrections (observation_id, user_id, metric, original_value, corrected_value, original_level, corrected_level, reason, corrected_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(obs.id, obs.user_id, obs.metric, obs.value, input.value, obs.level, level, reason, who.user_id ?? null, ts),
      env.DB.prepare("UPDATE observations SET value=?, level=? WHERE id=?").bind(input.value, level, obs.id),
      notifyStatement(env.DB, obs.user_id, "vital_corrected", `${obs.label} reading corrected`,
        `${actor} corrected a ${obs.label.toLowerCase()} reading from ${obs.value} to ${input.value} ${obs.unit}. Reason: ${reason}`, who.user_id ?? null, ts),
      env.DB.prepare("INSERT INTO action_log (user_id, ts, action, detail) VALUES (?,?, 'vital_corrected', ?)")
        .bind(obs.user_id, ts, JSON.stringify({ observation_id: obs.id, by: who.user_id, from: obs.value, to: input.value })),
    ]);
    const correction = await env.DB.prepare("SELECT * FROM vital_corrections WHERE observation_id=? ORDER BY id DESC LIMIT 1").bind(obs.id).first();
    return json({ correction, observation: { id: obs.id, metric: obs.metric, value: input.value, level } }, 201);
  });

  route("GET", "/admin/astronauts/:id/corrections", async (_r, env, p) => {
    await astronaut(env, p.id);
    const { results } = await env.DB.prepare(
      `SELECT c.*, m.label, o.unit, o.ts AS observed_at, s.display_name AS corrected_by_name
       FROM vital_corrections c JOIN observations o ON o.id = c.observation_id
       JOIN metric_definitions m ON m.metric = c.metric LEFT JOIN users s ON s.user_id = c.corrected_by
       WHERE c.user_id=? ORDER BY c.created_at DESC, c.id DESC LIMIT 100`
    ).bind(p.id).all();
    return json(results);
  });

  // ----- alerts -----
  route("GET", "/admin/astronauts/:id/alerts", async (_r, env, p) => {
    await astronaut(env, p.id);
    const { results } = await env.DB.prepare(
      "SELECT id, ts, level, metric, message, action, escalate, acknowledged, resolved_at FROM alerts WHERE user_id=? ORDER BY ts DESC LIMIT 200"
    ).bind(p.id).all();
    return json(results);
  });

  route("GET", "/admin/alerts", async (_r, env, _p, url) => {
    const raw = Number(url.searchParams.get("limit") ?? 80);
    const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 200) : 80;
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.ts, a.level, a.metric, a.message, a.action, a.escalate, a.acknowledged, a.resolved_at, a.user_id, u.display_name
       FROM alerts a JOIN users u ON u.user_id=a.user_id ORDER BY a.ts DESC LIMIT ?`
    ).bind(limit).all();
    return json(results);
  });

  // ----- emergencies -----
  const EMERGENCY_SELECT = `SELECT e.*, u.display_name, u.full_name, ack.display_name AS acknowledged_by_name, res.display_name AS resolved_by_name
    FROM emergencies e JOIN users u ON u.user_id=e.user_id
    LEFT JOIN users ack ON ack.user_id=e.acknowledged_by
    LEFT JOIN users res ON res.user_id=e.resolved_by`;

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
      ).bind(userId, ts, message ? `Emergency: ${message}` : "The astronaut pressed the emergency button.", userId),
      env.DB.prepare(
        `INSERT INTO emergencies (user_id, message, alert_id, created_at)
         SELECT ?,?, (SELECT id FROM alerts WHERE user_id=? AND ts=? AND metric='emergency' ORDER BY id DESC LIMIT 1),?
         WHERE NOT EXISTS (SELECT 1 FROM emergencies WHERE user_id=? AND status!='resolved')
         RETURNING *`
      ).bind(userId, message, userId, ts, ts, userId),
    ]);
    if (created.results[0]) return json({ emergency: created.results[0], already: false }, 201);
    const existing = await env.DB.prepare(`${EMERGENCY_SELECT} WHERE e.user_id=? ORDER BY e.id DESC LIMIT 1`).bind(userId).first();
    return json({ emergency: existing, already: true });
  });

  route("GET", "/emergencies/mine", async (_r, env, _p, _u, _c, who) => {
    if (!who.user_id) throw new HttpError(403, "Sign in to see your emergencies");
    const { results } = await env.DB.prepare(`${EMERGENCY_SELECT} WHERE e.user_id=? ORDER BY e.created_at DESC LIMIT 20`).bind(who.user_id).all();
    return json({ emergencies: results });
  });

  route("GET", "/admin/emergencies", async (_r, env, _p, url) => {
    const status = url.searchParams.get("status");
    if (status && !["open", "acknowledged", "resolved"].includes(status)) throw new HttpError(422, "Unknown status");
    const { results } = await env.DB.prepare(
      `${EMERGENCY_SELECT} WHERE (? IS NULL OR e.status=?)
       ORDER BY CASE e.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, e.created_at DESC LIMIT 200`
    ).bind(status, status).all();
    return json(results);
  });

  async function emergencyById(env: OpsDb, id: number) {
    const row = await env.DB.prepare(`${EMERGENCY_SELECT} WHERE e.id=?`).bind(id).first<any>();
    if (!row) throw new HttpError(404, "Emergency not found");
    return row;
  }

  // The first surgeon to acknowledge owns it; later clicks return who is already on it.
  route("POST", "/admin/emergencies/:id/acknowledge", async (_r, env, p, _u, _c, who) => {
    const row = await emergencyById(env, idOf(p.id, "emergency"));
    if (row.status === "resolved") throw new HttpError(409, "This emergency is already resolved");
    let claimed = false;
    if (row.status === "open") {
      const ts = now();
      const updated = await env.DB.prepare(
        "UPDATE emergencies SET status='acknowledged', acknowledged_at=?, acknowledged_by=? WHERE id=? AND status='open' RETURNING id"
      ).bind(ts, who.user_id!, row.id).first();
      if (updated) {
        claimed = true;
        const actor = await actorName(env, who);
        await env.DB.batch([
          env.DB.prepare("UPDATE alerts SET acknowledged=1, acknowledged_by=? WHERE id=? AND acknowledged=0").bind(who.user_id!, row.alert_id),
          notifyStatement(env.DB, row.user_id, "emergency_acknowledged", "A flight surgeon is responding",
            `${actor} acknowledged your emergency and is responding now.`, who.user_id ?? null, ts),
        ]);
      }
    }
    return json({ emergency: await emergencyById(env, row.id), claimed });
  });

  route("POST", "/admin/emergencies/:id/resolve", async (req, env, p, _u, _c, who) => {
    const row = await emergencyById(env, idOf(p.id, "emergency"));
    if (row.status === "resolved") return json({ emergency: row, already: true });
    const input = await body(req);
    const note = text(input?.note, "note", 500, false);
    const ts = now();
    const actor = await actorName(env, who);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE emergencies SET status='resolved', resolved_at=?, resolved_by=?, resolution_note=?,
           acknowledged_at=COALESCE(acknowledged_at, ?), acknowledged_by=COALESCE(acknowledged_by, ?)
         WHERE id=? AND status!='resolved'`
      ).bind(ts, who.user_id!, note, ts, who.user_id!, row.id),
      env.DB.prepare("UPDATE alerts SET acknowledged=1, resolved_at=COALESCE(resolved_at, ?) WHERE id=?").bind(ts, row.alert_id),
      notifyStatement(env.DB, row.user_id, "emergency_resolved", "Emergency resolved",
        `${actor} marked your emergency resolved.${note ? ` Note: ${note}` : ""}`, who.user_id ?? null, ts),
    ]);
    return json({ emergency: await emergencyById(env, row.id) });
  });

  // Polled by every surgeon page (~5 s): active emergencies plus this surgeon's unread messages.
  route("GET", "/admin/notifications", async (_r, env, _p, _u, _c, who) => {
    const [{ results: emergencies }, unread] = await Promise.all([
      env.DB.prepare(`${EMERGENCY_SELECT} WHERE e.status!='resolved' ORDER BY e.created_at DESC LIMIT 50`).all<any>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id
         WHERE c.surgeon_id=? AND m.sender_id!=? AND m.read_at IS NULL`
      ).bind(who.user_id ?? "", who.user_id ?? "").first<{ n: number }>(),
    ]);
    return json({
      emergencies,
      open_count: emergencies.filter((row) => row.status === "open").length,
      acknowledged_count: emergencies.filter((row) => row.status === "acknowledged").length,
      unread_messages: unread?.n ?? 0,
      server_time: now(),
    });
  });

  // ----- notes for the signed-in user (goal changes, surgeon responding, corrections) -----
  route("GET", "/me/notifications", async (_r, env, _p, url, _c, who) => {
    if (who.kind !== "user" || !who.user_id) throw new HttpError(403, "Sign in to see your notifications");
    const unreadOnly = url.searchParams.get("unread") === "1";
    const { results } = await env.DB.prepare(
      `SELECT n.id, n.kind, n.title, n.body, n.created_at, n.read_at, a.display_name AS actor_name
       FROM user_notifications n LEFT JOIN users a ON a.user_id = n.actor_id
       WHERE n.user_id=? AND (? = 0 OR n.read_at IS NULL) ORDER BY n.id DESC LIMIT 30`
    ).bind(who.user_id, unreadOnly ? 1 : 0).all<any>();
    const unread = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_notifications WHERE user_id=? AND read_at IS NULL").bind(who.user_id).first<{ n: number }>();
    return json({ notifications: results, unread: unread?.n ?? 0 });
  });

  // Body: { ids?: number[] } (omit to mark everything read).
  route("POST", "/me/notifications/read", async (req, env, _p, _u, _c, who) => {
    if (who.kind !== "user" || !who.user_id) throw new HttpError(403, "Sign in to update your notifications");
    const input = await body(req).catch(() => ({} as any));
    const ids: unknown = input?.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 50 || !ids.every((id) => Number.isSafeInteger(id) && id > 0))) {
      throw new HttpError(422, "ids must be up to 50 notification ids");
    }
    const ts = now();
    if (Array.isArray(ids) && ids.length) {
      await env.DB.prepare(`UPDATE user_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`)
        .bind(ts, who.user_id, ...ids).run();
    } else {
      await env.DB.prepare("UPDATE user_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL").bind(ts, who.user_id).run();
    }
    return new Response(null, { status: 204 });
  });
}

export const isSurgeonRole = (role: string | undefined) => STAFF_ROLES.has(role ?? "");
