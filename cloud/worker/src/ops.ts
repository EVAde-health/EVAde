// Flight-surgeon console, astronaut emergencies, and astronaut-to-staff chat.
// Staff means a signed-in user whose D1 role is flight_surgeon, therapist, or admin (one sign-in for everyone).
// Callers are already authenticated. These handlers still check the role before reading another person.
import { triageUrgent, type AiEnv } from "./ai";
import { Principal, STAFF_ROLES } from "./auth";
import { DEMO_ID_PREFIX, sameCrewSql } from "./demo";
import { HttpError } from "./http";
import { levelFromThresholds, type MetricDef } from "./health";
import { limitMessageSend, recordMessage } from "./messages";

// Physical emergencies in plain speech: symptoms, injuries and calls for help ("call 911", "they thought I was dying").
const EMERGENCY_WORDS = String.raw`chest pain|chest tight\w*|heart attack|stroke|can'?t breathe|cannot breathe|not breathing|trouble breathing|difficulty breathing|short(ness)? of breath|chok(e|ed|ing)|faint(ed|ing)?|passed out|pass(ing)? out|black(ed)? out|unconscious|unresponsive|coma|seizure|convuls\w*|slurred|can'?t (feel|move) my|numb(ness)? (in|on) my|severe (pain|bleeding|headache)|bleeding (heavily|a lot|badly|won'?t stop)|cough(ing)? (up )?blood|vomit(ing)? blood|hit my head|head injury|concussion|allergic reaction|anaphyla\w*|throat (is )?(closing|swelling)|dying(?! to)|going to die|911|ambulance|mayday|medical emergency`;

// Words that make a request to the flight surgeon urgent, whatever priority the caller gave: the voice agent's
// emergency symptoms and the journal safety phrases (self-harm, not wanting to live).
const URGENT_REQUEST = new RegExp(String.raw`\b(${EMERGENCY_WORDS}|confus\w*|emergency|urgent\w*|asap|immediately|suicid\w*|kill (myself|me)|end my life|self[- ]?harm|hurt(ing)? myself|don'?t want to (live|be alive|wake up))\b`, "i");

// Typed journal messages that ask for the flight surgeon ("please tell the flight surgeon …").
export const ASKS_FOR_SURGEON = /\b(contact|tell|message|notify|inform|alert|call|page|ping|get|reach|ask|let|loop in|flag (this|it) (to|for)|forward (this|it) to|forward to|report (this|it) to|talk to|speak (to|with)|send (this|it) to)\b[^.?!]{0,30}\b(flight surgeon|surgeon|doctor|medical team)\b/i;

// Physical emergencies described in a typed journal message. Self-harm language is not here: the journal safety net
// (ai.ts keywordFlag) already raises a red staff alert for it, so it is not escalated twice.
const EMERGENCY_SYMPTOMS = new RegExp(String.raw`\b(${EMERGENCY_WORDS})\b`, "i");
export const describesEmergency = (message: string) => EMERGENCY_SYMPTOMS.test(message);

export interface SurgeonRequest {
  clientId: string;
  message: string;
  priority: "routine" | "urgent";
  source: "voice" | "journal";
}

/**
 * Delivers an assistant's "contact the flight surgeon" for one astronaut: a message in their thread with every flight
 * surgeon, plus a red alert and an open emergency when urgent (or a yellow alert if no surgeon account exists).
 * Urgency is also decided from the words and from a red check-in in the last hour. Idempotent per clientId.
 */
export async function deliverSurgeonRequest(db: D1Database, userId: string, request: SurgeonRequest, triage?: (message: string) => Promise<boolean>) {
  const seen = await db.prepare("SELECT detail FROM action_log WHERE user_id=? AND action='surgeon_request' AND detail LIKE ?")
    .bind(userId, `${request.clientId}|%`).first<{ detail: string }>();
  if (seen) return { ...JSON.parse(seen.detail.slice(request.clientId.length + 1)), duplicate: true };

  const recentRed = await db.prepare("SELECT 1 FROM self_reports WHERE user_id=? AND checkin_level='red' AND ts>=? LIMIT 1")
    .bind(userId, new Date(Date.now() - 3600_000).toISOString()).first();
  // Rules first; the AI triage only reads what the rules call routine (free-form speech the word list misses).
  const urgent = request.priority === "urgent" || URGENT_REQUEST.test(request.message) || !!recentRed || (triage ? await triage(request.message) : false);
  const ts = new Date().toISOString();
  const label = request.source === "voice" ? "Voice assistant" : "Journal assistant";
  const bodyText = `${label} · ${urgent ? "URGENT" : "request"}: ${request.message}`.slice(0, 2000);

  // Demo astronauts reach the demo surgeons only, and real astronauts never reach the (shared) demo surgeons.
  const crew = sameCrewSql("user_id", userId);
  const { results: surgeons } = await db.prepare(`SELECT user_id FROM users WHERE role='flight_surgeon' AND ${crew.sql}`)
    .bind(...crew.params).all<{ user_id: string }>();
  const statements: D1PreparedStatement[] = [];
  for (const s of surgeons) {
    statements.push(
      db.prepare(
        `INSERT INTO conversations (astronaut_id, surgeon_id, created_at, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(astronaut_id, surgeon_id) DO UPDATE SET updated_at=excluded.updated_at`
      ).bind(userId, s.user_id, ts, ts),
      db.prepare(
        `INSERT INTO conversation_messages (conversation_id, sender_id, body, created_at)
         SELECT id, ?, ?, ? FROM conversations WHERE astronaut_id=? AND surgeon_id=?`
      ).bind(userId, bodyText, ts, userId, s.user_id),
    );
  }
  if (urgent || !surgeons.length) {
    statements.push(db.prepare(
      "INSERT INTO alerts (user_id, ts, level, metric, message, action, escalate) VALUES (?,?,?, 'surgeon_request', ?, ?, ?)"
    ).bind(userId, ts, urgent ? "red" : "yellow", `${label}: ${request.message}`.slice(0, 500),
      urgent ? "Contact this astronaut now." : "Reply to the astronaut.", urgent ? 1 : 0));
  }
  if (urgent) {
    // An emergency already open keeps its place but shows the newest issue; otherwise a new one opens.
    statements.push(db.prepare("UPDATE emergencies SET message=? WHERE user_id=? AND status!='resolved'")
      .bind(`${label}: ${request.message}`.slice(0, 500), userId));
    statements.push(db.prepare(
      `INSERT INTO emergencies (user_id, message, alert_id, created_at)
       SELECT ?,?, (SELECT id FROM alerts WHERE user_id=? AND ts=? AND metric='surgeon_request' ORDER BY id DESC LIMIT 1),?
       WHERE NOT EXISTS (SELECT 1 FROM emergencies WHERE user_id=? AND status!='resolved')`
    ).bind(userId, `${label}: ${request.message}`.slice(0, 500), userId, ts, ts, userId));
  }
  if (statements.length) await db.batch(statements);
  const emergency = urgent
    ? await db.prepare("SELECT id FROM emergencies WHERE user_id=? AND status!='resolved' ORDER BY id DESC LIMIT 1").bind(userId).first<{ id: number }>()
    : null;
  const result = {
    delivered_to: surgeons.length,
    urgent,
    emergency_id: emergency?.id ?? null,
    summary: urgent
      ? "The flight surgeon has been alerted as urgent and can see this now."
      : surgeons.length ? "Sent to the flight surgeon's inbox." : "Logged for the medical team.",
  };
  await db.prepare("INSERT INTO action_log (user_id, ts, action, detail) VALUES (?,?, 'surgeon_request', ?)")
    .bind(userId, ts, `${request.clientId}|${JSON.stringify(result)}`).run();
  return { ...result, duplicate: false };
}

export interface OpsDb extends AiEnv {
  DB: D1Database;
  AUTH_RATE_LIMITER: RateLimit;
}

type Handler = (req: Request, env: OpsDb, p: Record<string, string>, url: URL, ctx: ExecutionContext, who: Principal) => Promise<Response>;

const GOAL_TYPES = {
  calories: { metric: "kcal_intake", label: "Calories", noun: "calorie goal", unit: "kcal", target: 2800, min: 800, max: 6000, setting: "kcal_goal" },
  protein: { metric: "protein_intake_g", label: "Protein", noun: "protein goal", unit: "g", target: 110, min: 0, max: 400, setting: "protein_goal_g" },
  carbs: { metric: "carbs_intake_g", label: "Carbohydrates", noun: "carbohydrate goal", unit: "g", target: 360, min: 0, max: 800, setting: "carbs_goal_g" },
  fat: { metric: "fat_intake_g", label: "Fat", noun: "fat goal", unit: "g", target: 95, min: 0, max: 300, setting: "fat_goal_g" },
  water_ml: { metric: "water_intake_ml", label: "Water", noun: "water goal", unit: "ml", target: 2500, min: 250, max: 10000, setting: "water_goal_ml" },
  sleep_h: { metric: "sleep_hours", label: "Sleep", noun: "sleep goal", unit: "h", target: 8, min: 4, max: 12, setting: "sleep_target_h" },
  steps: { metric: null, label: "Steps", noun: "step goal", unit: "steps", target: 8000, min: 0, max: 50000, setting: null },
} as const;
type GoalType = keyof typeof GOAL_TYPES;
const goalTypes = Object.keys(GOAL_TYPES).filter(isGoalType);
function isGoalType(value: unknown): value is GoalType {
  return typeof value === "string" && Object.hasOwn(GOAL_TYPES, value);
}
const goalTypeOf = (metric: string) => goalTypes.find(type => GOAL_TYPES[type].metric === metric);
const GROUPS = new Set(["vitals", "sleep", "mind", "nutrition", "radiation", "bone", "immune", "score"]);
const SLEEP_METRICS = ["sleep_hours", "sleep_deep_hours", "sleep_rem_hours", "sleep_light_hours", "sleep_awake_hours"] as const;
const CREW_VITALS = ["heart_rate", "systolic_bp", "diastolic_bp", "spo2", "body_temp", "respiration_rate"] as const;
const CORRECTABLE = new Set<string>([...CREW_VITALS, "blood_glucose", "hrv_rmssd"]);
type CrewVital = (typeof CREW_VITALS)[number];
type ReadingLevel = "green" | "yellow" | "red" | null;
type VitalReading = { value: number; unit: string; label: string; level: ReadingLevel; ts: string };
type CrewVitals = Record<CrewVital, VitalReading | null>;
type Checkin = { ts: string; mood: number | null; stress: number | null; fatigue: number | null; source: string; checkin_level: ReadingLevel };
type RecordedCorrection = {
  id: number; observation_id: number; metric: string; original_value: number; corrected_value: number;
  original_level: ReadingLevel; corrected_level: ReadingLevel; reason: string; corrected_by_name: string | null; created_at: string;
};
type ActiveEmergency = {
  id: number; user_id: string; status: "open" | "acknowledged"; message: string | null; created_at: string;
  acknowledged_at: string | null; acknowledged_by_name: string | null;
};
type CrewSummary = {
  user_id: string; last_band: string | null; open_alerts: number; red_alerts: number; red_indicators: number;
  red_message?: string | null; red_ts?: string | null;
};

const emptyVitals = (): CrewVitals => ({
  heart_rate: null, systolic_bp: null, diastolic_bp: null, spo2: null, body_temp: null, respiration_rate: null,
});
const byUser = <T extends { user_id: string }>(rows: T[]) => new Map(rows.map(row => [row.user_id, row]));

async function latestVitals(db: D1Database, userId: string | null) {
  const placeholders = CREW_VITALS.map(() => "?").join(",");
  const { results } = await db.prepare(
    `SELECT u.user_id, m.metric, m.label, o.value, o.unit, o.level, o.ts
     FROM users u CROSS JOIN metric_definitions m
     JOIN observations o ON o.id=(SELECT id FROM observations
       WHERE user_id=u.user_id AND metric=m.metric ORDER BY ts DESC, id DESC LIMIT 1)
     WHERE u.role='astronaut' AND m.metric IN (${placeholders}) AND (? IS NULL OR u.user_id=?)`
  ).bind(...CREW_VITALS, userId, userId).all<VitalReading & { user_id: string; metric: CrewVital }>();
  const mapped = new Map<string, CrewVitals>();
  for (const { user_id, metric, ...reading } of results) {
    const vitals = mapped.get(user_id) ?? emptyVitals();
    vitals[metric] = reading;
    mapped.set(user_id, vitals);
  }
  return mapped;
}

function crewStatus(row: CrewSummary, emergency: ActiveEmergency | null, vitals: CrewVitals) {
  const band = row.last_band?.toLowerCase() ?? "";
  if (emergency?.status === "open" || row.red_alerts > 0 || row.red_indicators > 0 || ["high", "critical", "red"].includes(band)) return "critical";
  if (emergency || row.open_alerts > 0 || Object.values(vitals).some(reading => reading?.level === "yellow") ||
      ["guarded", "elevated", "moderate", "caution", "yellow"].includes(band)) return "caution";
  return "nominal";
}

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

function symptomsList(value: string | null) {
  if (!value) return [];
  try {
    const symptoms: unknown = JSON.parse(value);
    return Array.isArray(symptoms) ? symptoms.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
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
  synthetic?: number;
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
    ...displayProfile(user), crew_id: user.crew_id ?? null, synthetic: user.synthetic ?? 0, mission_name: user.mission_name,
    mission_start: user.mission_start, mission_length_days: user.mission_length_days ?? null,
    environment: user.environment, points: user.points, streak_days: user.streak_days, last_active: user.last_active,
  };
}

export async function crewOverview(db: D1Database, staffId: string | null) {
  const today = new Date();
  const day = today.toISOString().slice(0, 10);
  const start = `${day}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 86_400_000).toISOString();
  const [{ results }, vitalsOf, checkins, emergencies, daily] = await Promise.all([
    db.prepare(
      `SELECT c.*, u.mission_start, u.streak_days,
              EXISTS (SELECT 1 FROM observations o WHERE o.user_id=c.user_id AND o.simulation_source='simulated') AS synthetic,
              u.full_name, u.crew_id, u.crew_role,
              (SELECT COUNT(*) FROM emergencies e WHERE e.user_id=c.user_id AND e.status!='resolved') AS open_emergencies,
              (SELECT value FROM v_latest_indicators v WHERE v.user_id=c.user_id AND v.metric='sleep_hours') AS sleep_hours,
              (SELECT value FROM v_latest_indicators v WHERE v.user_id=c.user_id AND v.metric='mood') AS mood,
              (SELECT COUNT(*) FROM alerts a WHERE a.user_id=c.user_id AND a.level='red' AND a.acknowledged=0) AS red_alerts,
              (SELECT a.message FROM alerts a WHERE a.user_id=c.user_id AND a.level='red' AND a.acknowledged=0 ORDER BY a.ts DESC, a.id DESC LIMIT 1) AS red_message,
              (SELECT a.ts FROM alerts a WHERE a.user_id=c.user_id AND a.level='red' AND a.acknowledged=0 ORDER BY a.ts DESC, a.id DESC LIMIT 1) AS red_ts,
              (SELECT MAX(j.ts) FROM journal_entries j WHERE j.user_id=c.user_id) AS last_journal_at,
              (SELECT COUNT(*) FROM conversations t JOIN conversation_messages m ON m.conversation_id=t.id
               WHERE t.astronaut_id=c.user_id AND t.surgeon_id=? AND m.sender_id=t.astronaut_id AND m.read_at IS NULL) AS unread_messages
       FROM v_crew_overview c JOIN users u ON u.user_id=c.user_id
       ORDER BY open_emergencies DESC, c.escalated_alerts DESC, c.display_name`
    ).bind(staffId).all<CrewSummary>(),
    latestVitals(db, null),
    db.prepare(
      `SELECT u.user_id, s.ts, s.mood, s.stress, s.fatigue, COALESCE(s.simulation_source,s.source) AS source, s.checkin_level
       FROM users u JOIN self_reports s ON s.id=(SELECT id FROM self_reports WHERE user_id=u.user_id ORDER BY ts DESC, id DESC LIMIT 1)
       WHERE u.role='astronaut'`
    ).all<Checkin & { user_id: string }>(),
    db.prepare(
      `SELECT e.id, e.user_id, e.status, e.message, e.created_at, e.acknowledged_at, ack.display_name AS acknowledged_by_name
       FROM emergencies e LEFT JOIN users ack ON ack.user_id=e.acknowledged_by
       WHERE e.status IN ('open','acknowledged')`
    ).all<ActiveEmergency>(),
    db.prepare(
      `WITH today(user_id, kcal, protein, water) AS (
         SELECT user_id, SUM(kcal), SUM(protein), 0 FROM meals WHERE ts>=? AND ts<? GROUP BY user_id
         UNION ALL
         SELECT user_id, 0, 0, SUM(amount_ml) FROM hydration WHERE ts>=? AND ts<? GROUP BY user_id
       ), intake AS (SELECT user_id, SUM(kcal) AS kcal, SUM(protein) AS protein, SUM(water) AS water FROM today GROUP BY user_id),
       daily_tasks AS (SELECT user_id, COUNT(*) AS total, SUM(completed_at IS NOT NULL) AS done
                       FROM tasks WHERE recurrence='daily' AND day=? GROUP BY user_id)
       SELECT u.user_id, i.kcal, i.protein, i.water, t.total, t.done,
              COALESCE(cal.target, (SELECT target FROM user_goals WHERE user_id=u.user_id AND goal_type='calories' ORDER BY created_at DESC, id DESC LIMIT 1), s.kcal_goal) AS kcal_target,
              COALESCE(pro.target, (SELECT target FROM user_goals WHERE user_id=u.user_id AND goal_type='protein' ORDER BY created_at DESC, id DESC LIMIT 1), s.protein_goal_g) AS protein_target,
              COALESCE(h2o.target, (SELECT target FROM user_goals WHERE user_id=u.user_id AND goal_type='water_ml' ORDER BY created_at DESC, id DESC LIMIT 1), s.water_goal_ml) AS water_target
       FROM users u LEFT JOIN intake i USING (user_id) LEFT JOIN daily_tasks t USING (user_id)
       LEFT JOIN user_settings s USING (user_id)
       LEFT JOIN daily_goals cal ON cal.user_id=u.user_id AND cal.metric='kcal_intake' AND cal.superseded_at IS NULL
       LEFT JOIN daily_goals pro ON pro.user_id=u.user_id AND pro.metric='protein_intake_g' AND pro.superseded_at IS NULL
       LEFT JOIN daily_goals h2o ON h2o.user_id=u.user_id AND h2o.metric='water_intake_ml' AND h2o.superseded_at IS NULL
       WHERE u.role='astronaut'`
    ).bind(start, end, start, end, day).all<{
      user_id: string; kcal: number | null; protein: number | null; water: number | null; total: number | null; done: number | null;
      kcal_target: number | null; protein_target: number | null; water_target: number | null;
    }>(),
  ]);
  const checkinOf = byUser(checkins.results);
  const emergencyOf = byUser(emergencies.results);
  const dailyOf = byUser(daily.results);
  return results.map((row) => {
    const vitals = vitalsOf.get(row.user_id) ?? emptyVitals();
    const checkin = checkinOf.get(row.user_id);
    const emergency = emergencyOf.get(row.user_id) ?? null;
    const totals = dailyOf.get(row.user_id);
    const progress = {
      calories: { value: Math.round(totals?.kcal ?? 0), target: totals?.kcal_target ?? GOAL_TYPES.calories.target, unit: "kcal" },
      protein: { value: Math.round(totals?.protein ?? 0), target: totals?.protein_target ?? GOAL_TYPES.protein.target, unit: "g" },
      water_ml: { value: Math.max(0, Math.round(totals?.water ?? 0)), target: totals?.water_target ?? GOAL_TYPES.water_ml.target, unit: "ml" },
      tasks: { value: totals?.done ?? 0, target: totals?.total ?? 0, unit: "tasks" },
    };
    const due = Object.values(progress).filter(item => item.target > 0);
    const goalProgress = due.length ? due.reduce((sum, item) => sum + Math.min(1, Math.max(0, item.value / item.target)), 0) / due.length : 0;
    return {
      ...row, heart_rate: vitals.heart_rate?.value ?? null, heart_rate_level: vitals.heart_rate?.level ?? null,
      vitals, emergency, status: crewStatus(row, emergency, vitals),
      // What is wrong, in words: the open emergency, else the newest unacknowledged red alert.
      critical_issue: emergency?.message ? { message: emergency.message, ts: emergency.created_at, kind: "emergency" }
        : row.red_message ? { message: row.red_message, ts: row.red_ts, kind: "alert" } : null,
      progress: { ...progress, goal_progress: goalProgress }, goal_progress: due.length ? Math.round(goalProgress * 100) : null,
      last_checkin: checkin ? { ts: checkin.ts, mood: checkin.mood, stress: checkin.stress, source: checkin.source, level: checkin.checkin_level } : null,
    };
  });
}

type CurrentGoal = {
  metric: string; label: string; unit: string; target: number; source: "set" | "default";
  note: string | null; effective_at: string | null; set_by_name: string | null;
};
async function currentGoals(env: OpsDb, userId: string): Promise<CurrentGoal[]> {
  const [{ results: defs }, { results: set }] = await Promise.all([
    env.DB.prepare("SELECT metric, label, unit FROM metric_definitions").all<{ metric: string; label: string; unit: string }>(),
    env.DB.prepare(
      `SELECT g.metric, g.target, g.unit, g.note, g.effective_at, s.display_name AS set_by_name
       FROM daily_goals g LEFT JOIN users s ON s.user_id=g.set_by
       WHERE g.user_id=? AND g.superseded_at IS NULL`
    ).bind(userId).all<Pick<CurrentGoal, "metric" | "target" | "unit" | "note" | "effective_at" | "set_by_name">>(),
  ]);
  const byMetric = new Map(defs.map((d) => [d.metric, d]));
  const setByMetric = new Map(set.map((row) => [row.metric, row]));
  const seen = new Set<string>();
  const goals: CurrentGoal[] = [];
  for (const item of Object.values(GOAL_TYPES)) {
    if (!item.metric) continue;
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

async function adminGoals(env: OpsDb, userId: string) {
  const [legacy, settings, { results: surgeonGoals }] = await Promise.all([
    currentGoals(env, userId),
      env.DB.prepare("SELECT kcal_goal, protein_goal_g, carbs_goal_g, fat_goal_g, water_goal_ml, sleep_target_h FROM user_settings WHERE user_id=?")
        .bind(userId).first<Record<string, number | null>>(),
    env.DB.prepare(
      `SELECT g.goal_type, g.target, g.note, g.created_at, g.set_by, s.display_name AS set_by_name
       FROM user_goals g LEFT JOIN users s ON s.user_id=g.set_by
       WHERE g.user_id=? AND g.id=(SELECT id FROM user_goals WHERE user_id=g.user_id AND goal_type=g.goal_type ORDER BY created_at DESC, id DESC LIMIT 1)`
    ).bind(userId).all<{ goal_type: GoalType; target: number; note: string | null; created_at: string; set_by: string | null; set_by_name: string | null }>(),
  ]);
  const goals = goalTypes.map((type) => {
    const def = GOAL_TYPES[type];
    const saved = legacy.find(goal => goal.metric === def.metric);
    if (saved?.source === "set") return { ...saved, goal_type: type, set_at: saved.effective_at };
    const surgeon = surgeonGoals.find(goal => goal.goal_type === type);
    const setting = def.setting && settings?.[def.setting];
    return {
      metric: def.metric, label: def.label, unit: def.unit, goal_type: type,
      target: surgeon?.target ?? (typeof setting === "number" ? setting : def.target),
      source: surgeon ? (surgeon.set_by === userId ? "self" : "surgeon") : typeof setting === "number" ? "settings" : "default",
      note: surgeon?.note ?? null, set_by_name: surgeon?.set_by_name ?? null, set_at: surgeon?.created_at ?? null,
      effective_at: surgeon?.created_at ?? null,
    };
  });
  return [...goals, ...legacy.filter(goal => !goalTypeOf(goal.metric))];
}

type Metric = {
  metric: string; label: string; unit: string; domain: string; ui_group?: string | null;
  decimals?: number; green_min: number | null; green_max: number | null;
};
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
      decimals: def.decimals ?? 0, green_min: def.green_min, green_max: def.green_max,
      points: [...points.values()].sort((a, b) => a.day.localeCompare(b.day)),
    };
  });
}

async function threadFor(env: OpsDb, who: Principal, threadId: number) {
  if (who.kind !== "user" || !who.user_id) throw new HttpError(403, "Use your own account to open a conversation");
  const thread = await env.DB.prepare(
    `SELECT t.id, t.astronaut_id, t.surgeon_id AS staff_id, t.created_at, t.updated_at,
            au.display_name AS astronaut_name, su.display_name AS staff_name, su.role AS staff_role
     FROM conversations t
     JOIN users au ON au.user_id=t.astronaut_id
     JOIN users su ON su.user_id=t.surgeon_id
     WHERE t.id=?`
  ).bind(threadId).first<{ id: number; astronaut_id: string; staff_id: string }>();
  if (!thread) throw new HttpError(404, "Conversation not found");
  const mine = staffPerson(who) ? thread.staff_id === who.user_id : thread.astronaut_id === who.user_id;
  if (!mine) throw new HttpError(403, "You can only open your own conversations");
  return thread;
}

export async function raiseEmergency(db: D1Database, userId: string, ts: string, message: string | null) {
  const [, created] = await db.batch([
    db.prepare(
      `INSERT INTO alerts (user_id, ts, level, metric, message, action, escalate)
       SELECT ?,?, 'red', 'emergency', ?, 'Contact this astronaut now.', 1
       WHERE NOT EXISTS (SELECT 1 FROM emergencies WHERE user_id=? AND status!='resolved')`
    ).bind(userId, ts, message ? `Emergency: ${message}` : "The astronaut pressed the emergency control.", userId),
    db.prepare(
      `INSERT INTO emergencies (user_id, message, alert_id, created_at)
       SELECT ?,?, (SELECT id FROM alerts WHERE user_id=? AND ts=? AND metric='emergency' ORDER BY id DESC LIMIT 1),?
       WHERE NOT EXISTS (SELECT 1 FROM emergencies WHERE user_id=? AND status!='resolved')
       RETURNING *`
    ).bind(userId, message, userId, ts, ts, userId),
  ]);
  if (created.results[0]) return { emergency: created.results[0], already: false };
  const existing = await db.prepare("SELECT * FROM emergencies WHERE user_id=? ORDER BY id DESC LIMIT 1").bind(userId).first();
  return { emergency: existing, already: true };
}

export function registerOps(route: (method: string, path: string, handler: Handler) => void, deps: {
  json: (data: unknown, status?: number) => Response;
  body: <T = any>(req: Request) => Promise<T>;
  now: () => string;
}) {
  const { json, body, now } = deps;

  route("GET", "/admin/astronauts", async (_r, env) => {
    const { results } = await env.DB.prepare(
      `SELECT u.user_id, u.display_name, u.full_name, u.crew_role, u.mission_name,
              (SELECT status FROM emergencies e WHERE e.user_id=u.user_id AND e.status!='resolved') AS emergency_status
       FROM users u WHERE u.role='astronaut' ORDER BY u.display_name`
    ).all();
    return json(results);
  });

  route("GET", "/admin/astronauts/:id", async (_r, env, p) => {
    const user = await astronaut(env, p.id);
    const [risk, counts, { results: latest }, checkin] = await Promise.all([
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
      env.DB.prepare("SELECT ts, mood, stress, fatigue, COALESCE(simulation_source,source) AS source, checkin_level FROM self_reports WHERE user_id=? ORDER BY ts DESC, id DESC LIMIT 1")
        .bind(p.id).first<Checkin>(),
    ]);
    return json({ user, risk, ...counts, latest, last_checkin: checkin });
  });

  route("GET", "/users/:id/goals", async (_r, env, p) => {
    await astronaut(env, p.id);
    return json({ goals: await currentGoals(env, p.id) });
  });

  route("GET", "/admin/astronauts/:id/goals", async (_r, env, p) => {
    await astronaut(env, p.id);
    const [{ results: history }, goals] = await Promise.all([
      env.DB.prepare(
      `SELECT g.id, g.metric, m.label, g.target, g.unit, g.note, g.effective_at, g.superseded_at,
              g.effective_at AS created_at, g.set_by, s.display_name AS set_by_name, s.role AS set_by_role
       FROM daily_goals g JOIN metric_definitions m ON m.metric=g.metric
       LEFT JOIN users s ON s.user_id=g.set_by
       WHERE g.user_id=? ORDER BY g.effective_at DESC, g.id DESC LIMIT 200`
      ).bind(p.id).all<{ metric: string }>(),
      adminGoals(env, p.id),
    ]);
    return json({ goals, history: history.map(row => ({ ...row, goal_type: goalTypeOf(row.metric) ?? row.metric })), types: GOAL_TYPES });
  });

  route("POST", "/admin/astronauts/:id/goals", async (req, env, p, _u, _c, who) => {
    await astronaut(env, p.id);
    const input = await body<{ metric?: unknown; target?: unknown; note?: unknown; changes?: unknown }>(req);
    const note = text(input?.note, "note", 300, false);
    const ts = now();
    const writes: D1PreparedStatement[] = [];
    const addGoal = async (metric: string | null, type: GoalType | undefined, target: unknown) => {
      const bounds = type ? GOAL_TYPES[type] : { min: 0, max: 1_000_000 };
      if (typeof target !== "number" || !Number.isFinite(target)) throw new HttpError(422, "target must be a number");
      if (target < bounds.min || target > bounds.max) throw new HttpError(422, `target must be between ${bounds.min} and ${bounds.max}`);
      if (metric !== null) {
        const def = await env.DB.prepare("SELECT unit FROM metric_definitions WHERE metric=?").bind(metric).first<{ unit: string }>();
        if (!def) throw new HttpError(422, "Unknown metric");
        writes.push(
          env.DB.prepare("UPDATE daily_goals SET superseded_at=? WHERE user_id=? AND metric=? AND superseded_at IS NULL").bind(ts, p.id, metric),
          env.DB.prepare("INSERT INTO daily_goals (user_id, metric, target, unit, note, set_by, effective_at) VALUES (?,?,?,?,?,?,?)")
            .bind(p.id, metric, target, def.unit, note, who.user_id ?? null, ts),
        );
      }
      if (type) {
        writes.push(env.DB.prepare("INSERT INTO user_goals (user_id, goal_type, target, unit, note, set_by, created_at) VALUES (?,?,?,?,?,?,?)")
          .bind(p.id, type, target, GOAL_TYPES[type].unit, note, who.user_id ?? null, ts));
      }
      writes.push(env.DB.prepare("INSERT INTO action_log (user_id, ts, action, detail) VALUES (?,?, 'goal_set', ?)")
        .bind(p.id, ts, JSON.stringify({ metric, target })));
    };

    if (input?.changes === undefined) {
      const metric = text(input?.metric, "metric", 64, true);
      if (!metric || !/^[a-z][a-z0-9_]{0,63}$/.test(metric)) throw new HttpError(422, "Invalid metric");
      await addGoal(metric, goalTypeOf(metric), input.target);
      await env.DB.batch(writes);
      return json({ goal: (await currentGoals(env, p.id)).find(item => item.metric === metric) }, 201);
    }

    if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > goalTypes.length) {
      throw new HttpError(422, "changes must contain one entry per updated goal");
    }
    const goals = await adminGoals(env, p.id);
    const seen = new Set<GoalType>();
    const changed: GoalType[] = [];
    for (const change of input.changes) {
      const type: unknown = change?.goal_type;
      if (!isGoalType(type) || seen.has(type)) throw new HttpError(422, "Invalid or duplicate goal type");
      seen.add(type);
      if (goals.find(goal => "goal_type" in goal && goal.goal_type === type)?.target === change.target) continue;
      await addGoal(GOAL_TYPES[type].metric, type, change.target);
      changed.push(type);
    }
    if (writes.length) await env.DB.batch(writes);
    return json({ goals: writes.length ? await adminGoals(env, p.id) : goals, changed }, writes.length ? 201 : 200);
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

  route("GET", "/admin/astronauts/:id/vitals", async (_r, env, p, url) => {
    await astronaut(env, p.id);
    const days = daysOf(url, 30);
    const [metrics, vitals] = await Promise.all([
      seriesFor(env, p.id, "vitals", null, days),
      latestVitals(env.DB, p.id),
    ]);
    return json({ group: "vitals", days, metrics, vitals: vitals.get(p.id) ?? emptyVitals() });
  });

  route("GET", "/admin/astronauts/:id/observations", async (_r, env, p, url) => {
    await astronaut(env, p.id);
    const metric = url.searchParams.get("metric");
    if (metric && !/^[a-z][a-z0-9_]{0,63}$/.test(metric)) throw new HttpError(422, "Invalid metric");
    const start = `${sinceDay(daysOf(url, 7))}T00:00:00.000Z`;
    const { results } = await env.DB.prepare(
      `SELECT o.id, o.metric, m.label, o.value, o.unit, o.ts, o.level, o.source, m.decimals,
              (SELECT COUNT(*) FROM vital_corrections c WHERE c.observation_id=o.id) AS corrections,
              (SELECT original_value FROM vital_corrections c WHERE c.observation_id=o.id ORDER BY c.id LIMIT 1) AS original_value
       FROM observations o JOIN metric_definitions m USING (metric)
       WHERE o.user_id=? AND o.ts>=? AND (? IS NULL OR o.metric=?) ORDER BY o.ts DESC, o.id DESC LIMIT 300`
    ).bind(p.id, start, metric, metric).all();
    return json(results);
  });

  route("GET", "/admin/astronauts/:id/corrections", async (_r, env, p) => {
    await astronaut(env, p.id);
    const { results } = await env.DB.prepare(
      `SELECT c.*, m.label, o.unit, o.ts AS observed_at, s.display_name AS corrected_by_name
       FROM vital_corrections c JOIN observations o ON o.id=c.observation_id
       JOIN metric_definitions m ON m.metric=c.metric LEFT JOIN users s ON s.user_id=c.corrected_by
       WHERE c.user_id=? ORDER BY c.created_at DESC, c.id DESC LIMIT 100`
    ).bind(p.id).all();
    return json(results);
  });

  route("POST", "/admin/observations/:oid/correct", async (req, env, p, _u, _c, who) => {
    if (who.kind !== "user" || who.role !== "flight_surgeon") throw new HttpError(403, "Flight surgeon access required");
    const reading = await env.DB.prepare(
      `SELECT o.id, o.user_id, o.metric, o.value, o.level, o.unit, o.ts, u.role
       FROM observations o JOIN users u USING (user_id) WHERE o.id=?`
    ).bind(idOf(p.oid, "observation")).first<VitalReading & { id: number; user_id: string; metric: string; role: string }>();
    if (!reading) throw new HttpError(404, "Reading not found");
    if (reading.role !== "astronaut" || !CORRECTABLE.has(reading.metric)) throw new HttpError(422, "This reading cannot be corrected");
    const input = await body<{ value?: unknown; reason?: unknown }>(req);
    const value = input?.value;
    const reason = text(input?.reason, "reason", 300, true);
    if (!reason || reason.length < 3) throw new HttpError(422, "reason must be 3-300 characters");
    const def = await env.DB.prepare("SELECT * FROM metric_definitions WHERE metric=?").bind(reading.metric)
      .first<MetricDef & { label: string; display_max: number | null }>();
    if (!def) throw new HttpError(422, "Unknown metric");
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > (def.display_max ?? 1000) * 2) {
      throw new HttpError(422, "That value is outside the supported range");
    }
    if (value === reading.value) throw new HttpError(422, "The corrected value matches the recorded value");
    const level = levelFromThresholds(value, def);
    const ts = now();
    const [audit, updated] = await env.DB.batch<RecordedCorrection>([
      env.DB.prepare(
        `INSERT INTO vital_corrections (observation_id, user_id, metric, original_value, corrected_value, original_level, corrected_level, reason, corrected_by, created_at)
         SELECT id, user_id, metric, value, ?, level, ?, ?, ?, ? FROM observations WHERE id=? AND value=? AND level IS ?
         RETURNING *, (SELECT display_name FROM users WHERE user_id=vital_corrections.corrected_by) AS corrected_by_name`
      ).bind(value, level, reason, who.user_id ?? null, ts, reading.id, reading.value, reading.level),
      env.DB.prepare("UPDATE observations SET value=?, level=?, z=NULL WHERE id=? AND value=? AND level IS ?")
        .bind(value, level, reading.id, reading.value, reading.level),
    ]);
    const correction = audit.results[0];
    if (!updated.meta.changes || !correction) throw new HttpError(409, "This reading changed. Reload it before trying again.");
    return json({ correction: { ...correction, label: def.label, unit: reading.unit, observed_at: reading.ts },
      observation: { id: reading.id, metric: reading.metric, value, level } }, 201);
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
        "SELECT id, ts, name, grams, kcal, protein, carbs, fat, source FROM meals WHERE user_id=? AND ts>=? ORDER BY ts DESC LIMIT 40"
      ).bind(p.id, `${start}T00:00:00.000Z`).all(),
      adminGoals(env, p.id),
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
    const goals = await adminGoals(env, p.id);
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
        "SELECT id, ts, mood, stress, fatigue, sleep_quality, COALESCE(simulation_source,source) AS source FROM self_reports WHERE user_id=? AND ts>=? ORDER BY ts"
      ).bind(p.id, start).all(),
      env.DB.prepare(
        `SELECT id, ts, source, mood_label, concern_level, sentiment, ai_summary
         FROM journal_entries WHERE user_id=? ORDER BY ts DESC LIMIT 20`
      ).bind(p.id).all(),
    ]);
    return json({ reports: reports.results, journal: journal.results });
  });

  route("GET", "/admin/astronauts/:id/journal", async (_r, env, p, url) => {
    await astronaut(env, p.id);
    const start = `${sinceDay(daysOf(url, 35))}T00:00:00.000Z`;
    const [reports, journal] = await Promise.all([
      env.DB.prepare(
        `SELECT id, ts, mood, stress, fatigue, sleep_quality, COALESCE(simulation_source,source) AS source, sleep_hours, symptoms, checkin_level
         FROM self_reports WHERE user_id=? AND ts>=? ORDER BY ts DESC LIMIT 200`
      ).bind(p.id, start).all<{ symptoms: string | null }>(),
      env.DB.prepare(
        `SELECT ts, source, mood_label, concern_level, ai_summary
         FROM journal_entries WHERE user_id=? AND ts>=? ORDER BY ts DESC, id DESC LIMIT 60`
      ).bind(p.id, start).all(),
    ]);
    return json({ checkins: reports.results.map(row => ({ ...row, symptoms: symptomsList(row.symptoms) })), journal: journal.results });
  });

  route("GET", "/admin/astronauts/:id/tasks", async (_r, env, p) => {
    const user = await astronaut(env, p.id);
    const day = sinceDay(1);
    const [today, history, tutorials] = await Promise.all([
      env.DB.prepare(
        `SELECT t.id, t.title, t.detail, t.category, t.points, t.completed_at, tt.kind
         FROM tasks t LEFT JOIN task_templates tt ON tt.task_key=t.task_key
         WHERE t.user_id=? AND t.recurrence='daily' AND t.day=? ORDER BY COALESCE(tt.sort_order,999), t.id`
      ).bind(p.id, day).all(),
      env.DB.prepare(
        `SELECT day, COUNT(*) AS total, SUM(completed_at IS NOT NULL) AS done,
                SUM(CASE WHEN completed_at IS NOT NULL THEN points ELSE 0 END) AS points
         FROM tasks WHERE user_id=? AND recurrence='daily' AND day BETWEEN ? AND ? GROUP BY day ORDER BY day`
      ).bind(p.id, sinceDay(14), day).all(),
      env.DB.prepare(
        `SELECT tp.tutorial_id, t.title, tp.completed_at, tp.points_awarded FROM tutorial_progress tp
         JOIN tutorials t ON t.id=tp.tutorial_id WHERE tp.user_id=? ORDER BY tp.completed_at DESC LIMIT 100`
      ).bind(p.id).all(),
    ]);
    return json({ day, points: user.points, streak_days: user.streak_days, today: today.results, history: history.results, tutorials: tutorials.results });
  });

  route("GET", "/admin/astronauts/:id/alerts", async (_r, env, p) => {
    await astronaut(env, p.id);
    const { results } = await env.DB.prepare(
      "SELECT id, ts, level, metric, message, action, escalate, acknowledged, resolved_at, COALESCE(simulation_source,source) AS source FROM alerts WHERE user_id=? ORDER BY ts DESC LIMIT 200"
    ).bind(p.id).all();
    return json(results);
  });

  route("GET", "/admin/alerts", async (_r, env, _p, url) => {
    const limit = daysOf(new URL(`${url.origin}/?days=${url.searchParams.get("limit") ?? "80"}`), 80);
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.ts, a.level, a.metric, a.message, a.action, a.escalate, a.acknowledged, a.resolved_at,
              a.user_id, u.display_name, COALESCE(a.simulation_source,a.source) AS source
       FROM alerts a JOIN users u ON u.user_id=a.user_id
       ORDER BY a.ts DESC LIMIT ?`
    ).bind(limit).all();
    return json(results);
  });

  route("POST", "/emergencies", async (req, env, _p, _u, _c, who) => {
    if (who.kind !== "user" || who.role !== "astronaut") {
      throw new HttpError(403, "Use your own astronaut account to raise an emergency");
    }
    const input = await body(req);
    const message = text(input?.message, "message", 500, false);
    const result = await raiseEmergency(env.DB, who.user_id!, now(), message);
    return json(result, result.already ? 200 : 201);
  });

  // The voice assistant (or journal) asked to contact the flight surgeon on the astronaut's behalf. The message goes
  // into the astronaut's thread with every flight surgeon (an unread message on their console); urgent requests also
  // open an emergency, which raises the console alert. Urgency is decided here too, never only by the caller.
  // Idempotent per client_id, so a retried request is not delivered twice.
  route("POST", "/surgeon-requests", async (req, env, _p, _u, _c, who) => {
    if (who.kind !== "user" || who.role !== "astronaut") {
      throw new HttpError(403, "Use your own astronaut account to contact the flight surgeon");
    }
    const input = await body(req);
    const result = await deliverSurgeonRequest(env.DB, who.user_id!, {
      clientId: text(input?.client_id, "client_id", 100, true)!,
      message: text(input?.message, "message", 1000, false) ?? "The astronaut asked the voice assistant to contact the flight surgeon.",
      priority: input?.priority === "urgent" ? "urgent" : "routine",
      source: input?.source === "journal" ? "journal" : "voice",
    }, (message) => triageUrgent(env, message));
    return json(result, result.duplicate ? 200 : 201);
  });

  // The signed-in user's notifications (the web app's notice bell). From main's API, kept for the web app on main.
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

  route("GET", "/emergencies/mine", async (_r, env, _p, _u, _c, who) => {
    if (!who.user_id) throw new HttpError(403, "Use your own account to see your emergencies");
    const { results } = await env.DB.prepare(
      "SELECT * FROM emergencies WHERE user_id=? ORDER BY created_at DESC LIMIT 20"
    ).bind(who.user_id).all();
    return json({ emergencies: results });
  });

  route("GET", "/admin/emergencies", async (_r, env, _p, url) => {
    const status = url.searchParams.get("status");
    if (status && !["open", "acknowledged", "resolved"].includes(status)) throw new HttpError(422, "Unknown status");
    const { results } = await env.DB.prepare(
      `SELECT e.*, u.display_name, u.full_name,
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
    const row = await env.DB.prepare(
      `SELECT e.*, u.display_name, u.full_name, ack.display_name AS acknowledged_by_name, res.display_name AS resolved_by_name
       FROM emergencies e JOIN users u USING (user_id)
       LEFT JOIN users ack ON ack.user_id=e.acknowledged_by LEFT JOIN users res ON res.user_id=e.resolved_by WHERE e.id=?`
    ).bind(idOf(raw, "emergency")).first<{ id: number; status: string; alert_id: number | null }>();
    if (!row) throw new HttpError(404, "Emergency not found");
    return row;
  }

  route("POST", "/admin/emergencies/:id/acknowledge", async (_r, env, p, _u, _c, who) => {
    const row = await emergencyById(env, p.id);
    if (row.status === "resolved") throw new HttpError(409, "This emergency is already resolved");
    let claimed = false;
    if (row.status === "open") {
      const ts = now();
      const [acknowledged] = await env.DB.batch([
        env.DB.prepare("UPDATE emergencies SET status='acknowledged', acknowledged_at=?, acknowledged_by=? WHERE id=? AND status='open'")
          .bind(ts, who.user_id!, row.id),
        env.DB.prepare("UPDATE alerts SET acknowledged=1, acknowledged_by=? WHERE id=? AND acknowledged=0")
          .bind(who.user_id!, row.alert_id),
      ]);
      claimed = !!acknowledged.meta.changes;
    }
    return json({ emergency: await emergencyById(env, String(row.id)), claimed });
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
        `SELECT e.*, u.display_name, u.full_name, ack.display_name AS acknowledged_by_name
         FROM emergencies e JOIN users u ON u.user_id=e.user_id
         LEFT JOIN users ack ON ack.user_id=e.acknowledged_by
         WHERE e.status!='resolved' AND (? = 0 OR e.user_id LIKE ?) ORDER BY e.created_at DESC LIMIT 20`
      ).bind(who.demo ? 1 : 0, `${DEMO_ID_PREFIX}%`).all<ActiveEmergency>(),
      who.user_id
        ? env.DB.prepare(
          `SELECT COUNT(*) AS n FROM conversation_messages m JOIN conversations t ON t.id=m.conversation_id
           WHERE t.surgeon_id=? AND m.sender_id=t.astronaut_id AND m.read_at IS NULL`
        ).bind(who.user_id).first<{ n: number }>()
        : Promise.resolve({ n: 0 }),
    ]);
    return json({
      emergencies,
      open_count: emergencies.filter((row) => row.status === "open").length,
      acknowledged_count: emergencies.filter((row) => row.status === "acknowledged").length,
      unread_messages: unread?.n ?? 0,
      server_time: now(),
    });
  });

  route("GET", "/staff", async (_r, env, _p, _u, _c, who) => {
    if (who.kind !== "user") throw new HttpError(403, "Use your own account to see the staff directory");
    // Astronauts and the shared demo see only the staff of their own crew (demo or real).
    const crew = staffPerson(who) && !who.demo ? { sql: "1=1", params: [] as string[] } : sameCrewSql("u.user_id", who.user_id);
    const { results } = await env.DB.prepare(
      `SELECT u.* FROM users u WHERE u.role IN ('flight_surgeon','therapist','admin') AND EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id=u.user_id)
       AND ${crew.sql} ORDER BY u.role, u.display_name`
    ).bind(...crew.params).all<CrewProfile>();
    return json(results.map((row) => ({ ...displayProfile(row), role: row.role })));
  });

  function legacyMessage({ conversation_id: thread_id, ...message }: Awaited<ReturnType<typeof recordMessage>>) {
    return { thread_id, ...message };
  }

  // Keep the original numeric thread API as an alias for the migrated conversations.
  route("GET", "/chat/threads", async (_r, env, _p, _u, _c, who) => {
    if (who.kind !== "user" || !who.user_id) throw new HttpError(403, "Use your own account to see conversations");
    const [column, peer] = staffPerson(who) ? ["t.surgeon_id", "t.astronaut_id"] : ["t.astronaut_id", "t.surgeon_id"];
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.astronaut_id, t.surgeon_id AS staff_id, t.updated_at,
              au.display_name AS astronaut_name, su.display_name AS staff_name, su.role AS staff_role,
              last.body AS last_body, last.created_at AS last_at,
              (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id=t.id AND m.sender_id=${peer} AND m.read_at IS NULL) AS unread
       FROM conversations t
       JOIN users au ON au.user_id=t.astronaut_id
       JOIN users su ON su.user_id=t.surgeon_id
       LEFT JOIN conversation_messages last ON last.id=(SELECT id FROM conversation_messages
         WHERE conversation_id=t.id AND sender_id IN (t.astronaut_id,t.surgeon_id) ORDER BY id DESC LIMIT 1)
       WHERE ${column}=? ORDER BY t.updated_at DESC`
    ).bind(who.user_id).all();
    return json(results);
  });

  route("POST", "/chat/threads", async (req, env, _p, _u, _c, who) => {
    if (who.kind !== "user" || !who.user_id) throw new HttpError(403, "Sign in to start a conversation");
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
      const crew = sameCrewSql("u.user_id", astronautId);
      const staff = await env.DB.prepare(
        `SELECT u.role FROM users u WHERE u.user_id=? AND EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id=u.user_id) AND ${crew.sql}`
      ).bind(staffId, ...crew.params).first<{ role: string }>();
      if (!staff || !STAFF_ROLES.has(staff.role)) throw new HttpError(422, "Choose a flight surgeon, therapist, or admin");
    }
    const ts = now();
    if (first) {
      const message = await recordMessage(env, { astronautId, surgeonId: staffId, senderId: who.user_id, content: first, ts });
      return json({ thread: await threadFor(env, who, message.conversation_id), message: legacyMessage(message) }, 201);
    }
    await limitMessageSend(env, who.user_id);
    await env.DB.prepare(
      "INSERT INTO conversations (astronaut_id, surgeon_id, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(astronaut_id, surgeon_id) DO NOTHING"
    ).bind(astronautId, staffId, ts, ts).run();
    const thread = await env.DB.prepare(
      "SELECT id FROM conversations WHERE astronaut_id=? AND surgeon_id=?"
    ).bind(astronautId, staffId).first<{ id: number }>();
    if (!thread) throw new HttpError(409, "Conversation unavailable");
    return json({ thread: await threadFor(env, who, thread.id), message: null });
  });

  route("GET", "/chat/threads/:id/messages", async (_r, env, p, _u, _c, who) => {
    const thread = await threadFor(env, who, idOf(p.id, "conversation"));
    const { results } = await env.DB.prepare(
      `SELECT m.id, m.sender_id, u.display_name AS sender_name, m.body, m.created_at, m.read_at
       FROM conversation_messages m JOIN users u ON u.user_id=m.sender_id
       WHERE m.conversation_id=? AND m.sender_id IN (?,?) ORDER BY m.id DESC LIMIT 200`
    ).bind(thread.id, thread.astronaut_id, thread.staff_id).all();
    return json({ thread, messages: results.reverse() });
  });

  route("POST", "/chat/threads/:id/read", async (req, env, p, _u, _c, who) => {
    const thread = await threadFor(env, who, idOf(p.id, "conversation"));
    const { through_id: through } = await body(req);
    if (!Number.isSafeInteger(through) || through < 1) throw new HttpError(422, "through_id must be a message ID");
    const sender = staffPerson(who) ? thread.astronaut_id : thread.staff_id;
    await env.DB.prepare("UPDATE conversation_messages SET read_at=? WHERE conversation_id=? AND sender_id=? AND read_at IS NULL AND id<=?")
      .bind(now(), thread.id, sender, through).run();
    return new Response(null, { status: 204 });
  });

  route("POST", "/chat/threads/:id/messages", async (req, env, p, _u, _c, who) => {
    const thread = await threadFor(env, who, idOf(p.id, "conversation"));
    const input = await body(req);
    const content = text(input?.body, "body", 2000, true)!;
    const message = await recordMessage(env, { astronautId: thread.astronaut_id, surgeonId: thread.staff_id, senderId: who.user_id!, content, ts: now() });
    return json({ message: legacyMessage(message) }, 201);
  });
}
