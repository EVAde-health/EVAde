// Web app routes (Ryan B): tutorials, the daily mission list, settings, radiation history, journal chat,
// server-side food search and selfie deletion. Registered on the same router as index.ts, so every route
// here goes through authorize() first: sessions only reach their own /users/:id, a JSON body's user_id is
// filled in (or rejected) from the session, and cookie writes must come from an allowed origin.
// Points are always read from D1 (task_templates, tutorials), never from the request.

import type { Principal } from "./auth";

export interface WebAppEnv {
  DB: D1Database;
  MEDIA?: R2Bucket;
  USDA_API_KEY?: string; // optional server-side FoodData Central key; Open Food Facts + the pantry work without it
}

type Handler<E> = (req: Request, env: E, p: Record<string, string>, url: URL, ctx: ExecutionContext, who: Principal) => Promise<Response>;

export interface WebAppDeps<E extends WebAppEnv> {
  route: (method: string, path: string, h: Handler<E>) => void;
  json: (data: unknown, status?: number) => Response;
  body: <T = any>(req: Request) => Promise<T>;
  fail: (status: number, message: string) => Error;
  requireUser: (env: E, userId: string | undefined) => Promise<any>;
  isStaff: (who: Principal) => boolean;
  journal: (env: E, ctx: ExecutionContext, id: number, userId: string, content: string) => Promise<{
    summary: string | null; mood_label: string | null; needs_human_review: boolean; model: string | null;
  }>;
}

const DAY_MS = 864e5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d\d-\d\d$/;
const nowIso = () => new Date().toISOString();

/** YYYY-MM-DD for a Date in UTC. */
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Monday of the ISO week that contains `day` (both YYYY-MM-DD). */
export function weekStart(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return utcDay(new Date(d.getTime() - offset * DAY_MS));
}

/** The client's local calendar day. Must be a real date within a day of UTC today (no backfilling). */
export function trackingDay(value: string | null, now = new Date()) {
  if (!value) return utcDay(now);
  if (!ISO_DAY.test(value) || utcDay(new Date(`${value}T00:00:00Z`)) !== value) throw new Error("day must be YYYY-MM-DD");
  const diff = Math.abs(Date.parse(`${value}T00:00:00Z`) - Date.parse(`${utcDay(now)}T00:00:00Z`));
  if (diff > DAY_MS) throw new Error("day must be within one day of today");
  return value;
}

/** Consecutive days with at least one completed daily task, ending today or yesterday. */
export function streakFrom(days: string[], today: string) {
  const done = new Set(days);
  let cursor = Date.parse(`${today}T00:00:00Z`);
  if (!done.has(today)) cursor -= DAY_MS;
  let streak = 0;
  while (done.has(utcDay(new Date(cursor)))) {
    streak++;
    cursor -= DAY_MS;
  }
  return streak;
}

/** Creates today's daily tasks and this week's weekly tasks from the active templates (idempotent). */
export async function materializeTasks(env: WebAppEnv, userId: string, day: string) {
  const week = weekStart(day);
  const weekEnd = utcDay(new Date(Date.parse(`${week}T00:00:00Z`) + 6 * DAY_MS));
  const insert = (recurrence: "daily" | "weekly", key: string, due: string) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO tasks (user_id,title,category,metric,recurrence,due_at,points,task_key,day,detail,tutorial_id,time_window)
       SELECT ?, title, category, metric, recurrence, ?, points, task_key, ?, detail, tutorial_id, time_window
       FROM task_templates WHERE active = 1 AND recurrence = ?`
    ).bind(userId, `${due}T23:59:59.000Z`, key, recurrence);
  await env.DB.batch([insert("daily", day, day), insert("weekly", week, weekEnd)]);
  return week;
}

const SETTINGS_FIELDS: Record<string, [number, number] | "timezone" | "color_mode" | "boolean"> = {
  kcal_goal: [800, 6000],
  protein_goal_g: [20, 400],
  carbs_goal_g: [20, 900],
  fat_goal_g: [10, 300],
  water_goal_ml: [500, 8000],
  water_step_ml: [50, 1000],
  sleep_target_h: [4, 12],
  timezone: "timezone",
  color_mode: "color_mode",
  reduced_motion: "boolean",
};

const SETTINGS_DEFAULTS = {
  kcal_goal: 2800, protein_goal_g: 110, carbs_goal_g: 360, fat_goal_g: 95,
  water_goal_ml: 2500, water_step_ml: 250, sleep_target_h: 8, timezone: "UTC", color_mode: null, reduced_motion: 0,
};

/** Validates a settings patch; returns [column, value] pairs or throws with a readable message. */
export function settingsPatch(input: Record<string, unknown>) {
  const out: [string, string | number | null][] = [];
  for (const [field, value] of Object.entries(input)) {
    if (field === "user_id") continue;
    const rule = SETTINGS_FIELDS[field];
    if (!rule) throw new Error(`Unknown setting ${field}`);
    if (rule === "timezone") {
      if (typeof value !== "string" || value.length > 64) throw new Error("timezone must be an IANA name");
      try { new Intl.DateTimeFormat("en-US", { timeZone: value }); } catch { throw new Error("timezone must be an IANA name"); }
      out.push([field, value]);
    } else if (rule === "color_mode") {
      if (value !== null && value !== "light" && value !== "dark") throw new Error("color_mode must be light, dark or null");
      out.push([field, value]);
    } else if (rule === "boolean") {
      if (typeof value !== "boolean") throw new Error(`${field} must be true or false`);
      out.push([field, value ? 1 : 0]);
    } else {
      if (typeof value !== "number" || !Number.isFinite(value) || value < rule[0] || value > rule[1])
        throw new Error(`${field} must be between ${rule[0]} and ${rule[1]}`);
      out.push([field, field === "water_goal_ml" || field === "water_step_ml" ? Math.round(value) : value]);
    }
  }
  if (!out.length) throw new Error("No settings to update");
  return out;
}

// ---------- food search (keys stay on the Worker) ----------
interface FoodRow {
  id: string; label: string; brand: string | null; source: "space_pantry" | "usda" | "open_food_facts" | "custom";
  kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number;
}

const FOOD_TIMEOUT_MS = 6000;
const finite = (v: unknown) => (typeof v === "number" ? v : Number(v));
const macro = (v: unknown) => {
  const n = finite(v);
  return Number.isFinite(n) && n >= 0 && n < 10000 ? Math.round(n * 10) / 10 : null;
};

async function usdaFoods(key: string, q: string): Promise<FoodRow[]> {
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.search = new URLSearchParams({ query: q, pageSize: "8", dataType: "Foundation,SR Legacy,Branded", api_key: key }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(FOOD_TIMEOUT_MS), redirect: "error" });
  if (!r.ok) return [];
  const { foods = [] } = await r.json<{ foods?: any[] }>();
  return foods.flatMap((f) => {
    const n = (num: string) => macro(f.foodNutrients?.find((x: any) => x.nutrientNumber === num)?.value);
    const [kcal, protein, carbs, fat] = [n("208"), n("203"), n("205"), n("204")];
    if (kcal === null || protein === null || carbs === null || fat === null || !f.fdcId || !f.description) return [];
    return [{ id: `usda-${f.fdcId}`, label: String(f.description).slice(0, 200), brand: f.brandOwner ? String(f.brandOwner).slice(0, 120) : null,
      source: "usda" as const, kcal_100g: kcal, protein_100g: protein, carbs_100g: carbs, fat_100g: fat }];
  });
}

async function openFoodFacts(q: string): Promise<FoodRow[]> {
  const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
  url.search = new URLSearchParams({ search_terms: q, search_simple: "1", json: "1", page_size: "8", fields: "code,product_name,brands,nutriments" }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(FOOD_TIMEOUT_MS), redirect: "error", headers: { "User-Agent": "EVAde/1.0 (hackathon)" } });
  if (!r.ok) return [];
  const { products = [] } = await r.json<{ products?: any[] }>();
  return products.flatMap((p) => {
    const m = p.nutriments ?? {};
    const [kcal, protein, carbs, fat] = [macro(m["energy-kcal_100g"]), macro(m.proteins_100g), macro(m.carbohydrates_100g), macro(m.fat_100g)];
    if (kcal === null || protein === null || carbs === null || fat === null || !p.code || !p.product_name) return [];
    return [{ id: `off-${String(p.code).slice(0, 40)}`, label: String(p.product_name).slice(0, 200), brand: p.brands ? String(p.brands).split(",")[0].slice(0, 120) : null,
      source: "open_food_facts" as const, kcal_100g: kcal, protein_100g: protein, carbs_100g: carbs, fat_100g: fat }];
  });
}

const foodResponse = (f: FoodRow) => ({
  id: f.id, label: f.label, brand: f.brand, source: f.source,
  per100g: { kcal: f.kcal_100g, protein: f.protein_100g, carbs: f.carbs_100g, fat: f.fat_100g },
});

/** Daily XP caps for actions without a task row: logging meals and drinking water. */
export const DAILY_AWARDS = {
  meal_logged: { points: 10, cap: 6 },
  water_logged: { points: 5, cap: 10 },
  reading_logged: { points: 5, cap: 12 },
} as const;

/** Awards points for an action at most `cap` times per UTC day; returns the points granted (0 at the cap). */
export async function awardDaily(env: WebAppEnv, userId: string, action: keyof typeof DAILY_AWARDS, detail: string) {
  const { points, cap } = DAILY_AWARDS[action];
  const ts = nowIso();
  const dayStart = `${ts.slice(0, 10)}T00:00:00.000Z`;
  const logged = await env.DB.prepare(
    `INSERT INTO action_log (user_id, ts, action, detail)
     SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM action_log WHERE user_id=? AND action=? AND ts>=?) < ?
     RETURNING id`
  ).bind(userId, ts, action, detail, userId, action, dayStart, cap).first<{ id: number }>();
  if (!logged) return 0;
  await env.DB.prepare("UPDATE users SET points=points+?, last_active=? WHERE user_id=?").bind(points, ts, userId).run();
  return points;
}

/** Supportive reply shown in the journal chat. Concern scores are never shown to the astronaut. */
export function journalReply(a: { summary: string | null; mood_label: string | null; needs_human_review: boolean } | null) {
  const parts = [a?.summary ? a.summary : "Saved to your journal."];
  if (a?.mood_label) parts.push(`Mood: ${a.mood_label}`);
  if (a?.needs_human_review) parts.push("You don't have to carry this alone. Your crew support team is available to talk with you today.");
  return parts.join("\n\n");
}

export function registerWebAppRoutes<E extends WebAppEnv>(d: WebAppDeps<E>) {
  const { route, json, body, fail, requireUser } = d;
  const userOf = (who: Principal, bodyUser: unknown) => {
    const id = typeof bodyUser === "string" ? bodyUser : who.user_id;
    if (!id) throw fail(400, "user_id is required");
    return id;
  };

  // Tutorial library (D1 `tutorials`). video/poster keys become URLs once videos are uploaded.
  route("GET", "/tutorials", async (_r, env) => {
    const { results } = await env.DB.prepare("SELECT * FROM tutorials ORDER BY sort_order, id").all<any>();
    return json(results.map((t) => ({
      id: t.id, title: t.title, summary: t.summary, category: t.category, minutes: t.minutes, points: t.points, metric: t.metric,
      steps: (() => { try { const s = JSON.parse(t.steps); return Array.isArray(s) ? s.map(String) : []; } catch { return []; } })(),
      video_url: /^https:\/\//.test(t.video_key ?? "") ? t.video_key : null,
      poster_url: /^https:\/\//.test(t.poster_key ?? "") ? t.poster_key : null,
    })));
  });

  route("GET", "/users/:id/tutorials", async (_r, env, p) =>
    json((await env.DB.prepare("SELECT tutorial_id, completed_at, points_awarded FROM tutorial_progress WHERE user_id=? ORDER BY completed_at")
      .bind(p.id).all()).results));

  // Marks a tutorial watched and awards its points once.
  route("POST", "/tutorials/:tid/complete", async (req, env, p, _u, _c, who) => {
    const b = await body(req).catch(() => ({} as any));
    const userId = userOf(who, b?.user_id);
    await requireUser(env, userId);
    const tutorial = await env.DB.prepare("SELECT id, points FROM tutorials WHERE id=?").bind(p.tid).first<{ id: string; points: number }>();
    if (!tutorial) throw fail(404, "tutorial not found");
    const ts = nowIso();
    const [inserted] = await env.DB.batch([
      env.DB.prepare("INSERT INTO tutorial_progress (user_id,tutorial_id,completed_at,points_awarded) VALUES (?,?,?,?) ON CONFLICT DO NOTHING")
        .bind(userId, tutorial.id, ts, tutorial.points),
      env.DB.prepare(`UPDATE users SET points=points+?, last_active=? WHERE user_id=?
        AND EXISTS (SELECT 1 FROM tutorial_progress WHERE user_id=? AND tutorial_id=? AND completed_at=?)`)
        .bind(tutorial.points, ts, userId, userId, tutorial.id, ts),
    ]);
    if (!inserted.meta.changes) return json({ ok: true, already: true, points_awarded: 0 });
    return json({ ok: true, points_awarded: tutorial.points, completed_at: ts }, 201);
  });

  // Today's mission list: materialized from task_templates for the client's local day, plus the streak.
  route("GET", "/users/:id/today", async (_r, env, p, url, _c, who) => {
    const user = await requireUser(env, p.id);
    let day: string;
    try { day = trackingDay(url.searchParams.get("day")); } catch (e) { throw fail(422, (e as Error).message); }
    if (who.demo) {
      const { results: tasks } = await env.DB.prepare(
        "SELECT t.*, CASE WHEN category='advanced' THEN 'protocol' ELSE 'basic' END AS kind FROM tasks t WHERE user_id=? AND id BETWEEN 900001 AND 900004 ORDER BY id"
      ).bind(p.id).all();
      return json({ day, week: weekStart(day), tasks, streak_days: user.streak_days, points: user.points });
    }
    const week = await materializeTasks(env, p.id, day);
    const [tasks, done] = await env.DB.batch<any>([
      env.DB.prepare(
        `SELECT t.id, t.task_key, t.title, t.detail, t.category, t.metric, t.recurrence, t.day, t.due_at, t.points, t.completed_at,
                t.tutorial_id, t.time_window, tt.kind, tt.icon, tt.sort_order
         FROM tasks t JOIN task_templates tt ON tt.task_key = t.task_key
         WHERE t.user_id=? AND ((t.recurrence='daily' AND t.day=?) OR (t.recurrence='weekly' AND t.day=?))
         ORDER BY tt.sort_order`
      ).bind(p.id, day, week),
      env.DB.prepare(
        "SELECT DISTINCT day FROM tasks WHERE user_id=? AND recurrence='daily' AND day IS NOT NULL AND completed_at IS NOT NULL ORDER BY day DESC LIMIT 400"
      ).bind(p.id),
    ]);
    const streak = streakFrom(done.results.map((r: any) => r.day), day);
    if (streak !== user.streak_days) await env.DB.prepare("UPDATE users SET streak_days=? WHERE user_id=?").bind(streak, p.id).run();
    const points = (await env.DB.prepare("SELECT points FROM users WHERE user_id=?").bind(p.id).first<{ points: number }>())?.points ?? 0;
    return json({ day, week, tasks: tasks.results, streak_days: streak, points });
  });

  // Goals and preferences (user_settings). Missing rows read as defaults.
  route("GET", "/users/:id/settings", async (_r, env, p) => {
    await requireUser(env, p.id);
    const row = await env.DB.prepare("SELECT * FROM user_settings WHERE user_id=?").bind(p.id).first<any>();
    const { user_id: _id, updated_at, ...settings } = row ?? { ...SETTINGS_DEFAULTS, updated_at: null };
    return json({ ...SETTINGS_DEFAULTS, ...settings, reduced_motion: Boolean(settings.reduced_motion), updated_at });
  });

  route("PATCH", "/users/:id/settings", async (req, env, p) => {
    await requireUser(env, p.id);
    let pairs: [string, string | number | null][];
    try { pairs = settingsPatch(await body(req)); } catch (e) { throw fail(422, (e as Error).message); }
    const cols = pairs.map(([c]) => c);
    await env.DB.prepare(
      `INSERT INTO user_settings (user_id, ${cols.join(",")}, updated_at) VALUES (?, ${cols.map(() => "?").join(",")}, ?)
       ON CONFLICT(user_id) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(",")}, updated_at=excluded.updated_at`
    ).bind(p.id, ...pairs.map(([, v]) => v), nowIso()).run();
    return json({ ok: true });
  });

  // Dosimeter history for the radiation panel, plus the astronaut's career limit.
  route("GET", "/users/:id/radiation", async (_r, env, p, url) => {
    const user = await requireUser(env, p.id);
    const days = Math.max(1, Math.min(Number(url.searchParams.get("days")) || 180, 1000));
    const { results } = await env.DB.prepare(
      "SELECT ts, daily_dose_msv, cumulative_msv, dose_rate_usv_h, spe_flag, location FROM radiation_doses WHERE user_id=? AND ts>=? ORDER BY ts"
    ).bind(p.id, new Date(Date.now() - days * DAY_MS).toISOString()).all();
    return json({ limit_msv: user.radiation_limit_msv ?? 600, doses: results });
  });

  // Journal chat history (the single running thread).
  route("GET", "/users/:id/journal/messages", async (_r, env, p, url, _c, who) => {
    if (who.kind === "user" && p.id !== who.user_id) throw fail(403, "Only the astronaut can read their journal");
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 200, 500));
    const owner = who.kind === "user" && who.user_id === p.id;
    const { results } = await env.DB.prepare(
      "SELECT m.id, m.sender, m.content, m.ts FROM journal_messages m WHERE m.user_id=? AND m.thread_id IS NULL " +
      "AND (?=1 OR (m.id NOT LIKE 'companion:%' AND NOT EXISTS (SELECT 1 FROM journal_messages reply WHERE reply.user_id=m.user_id AND reply.id='companion:'||m.id))) ORDER BY m.ts DESC LIMIT ?"
    ).bind(p.id, owner ? 1 : 0, limit).all();
    return json(results.reverse());
  });

  // Astronaut message -> journal entry -> AI analysis (safety keywords always alert a human) -> stored reply.
  route("POST", "/journal/messages", async (req, env, _p, _u, ctx, who) => {
    const b = await body(req);
    const userId = userOf(who, b?.user_id);
    if (who.kind === "user" && userId !== who.user_id) throw fail(403, "Only the astronaut can write in their journal");
    await requireUser(env, userId);
    if (typeof b.id !== "string" || !UUID.test(b.id)) throw fail(422, "id must be a UUID");
    const content = typeof b.content === "string" ? b.content.trim() : "";
    if (!content || content.length > 5000) throw fail(422, "content is required (max 5000 characters)");
    const id = b.id.toLowerCase();
    const existing = await env.DB.prepare("SELECT user_id FROM journal_messages WHERE id=?").bind(id).first<{ user_id: string }>();
    if (existing) {
      if (existing.user_id !== userId) throw fail(409, "Message id already used");
      const reply = await env.DB.prepare("SELECT id, sender, content, ts FROM journal_messages WHERE user_id=? AND sender='assistant' AND ts>=(SELECT ts FROM journal_messages WHERE id=?) ORDER BY ts LIMIT 1")
        .bind(userId, id).first();
      return json({ duplicate: true, reply });
    }
    const ts = nowIso();
    const entry = await env.DB.prepare("INSERT INTO journal_entries (client_id,user_id,ts,source,content) VALUES (?,?,?, 'text', ?) ON CONFLICT(client_id) DO NOTHING RETURNING id")
      .bind(`msg:${id}`, userId, ts, content).first<{ id: number }>();
    await env.DB.prepare("INSERT INTO journal_messages (id,user_id,sender,content,ts,entry_id) VALUES (?,?, 'user', ?,?,?)")
      .bind(id, userId, content, ts, entry?.id ?? null).run();
    // A journal entry closes today's journal task (if one is assigned) and pays that task's points once.
    // The mood check-in task is closed by the mood rating itself, never by a journal entry.
    const since = new Date(Date.parse(ts) - 86_400_000).toISOString();
    const journalTask = await env.DB.prepare(`UPDATE tasks SET completed_at=? WHERE id=(SELECT id FROM tasks WHERE user_id=? AND completed_at IS NULL
        AND title LIKE 'Journal%' AND (due_at IS NULL OR due_at >= ?) ORDER BY due_at LIMIT 1) RETURNING points`)
      .bind(ts, userId, since).first<{ points: number | null }>();
    if (journalTask?.points) await env.DB.prepare("UPDATE users SET points=points+? WHERE user_id=?").bind(journalTask.points, userId).run();
    let analysis = null;
    if (entry?.id) {
      try { analysis = await d.journal(env, ctx, entry.id, userId, content); } catch (e) { console.error("journal analysis", e instanceof Error ? e.name : "Error"); }
    }
    const reply = { id: crypto.randomUUID(), sender: "assistant", content: journalReply(analysis), ts: new Date(Date.parse(ts) + 1).toISOString() };
    await env.DB.prepare("INSERT INTO journal_messages (id,user_id,sender,content,ts,entry_id,model) VALUES (?,?,?,?,?,?,?)")
      .bind(reply.id, userId, reply.sender, reply.content, reply.ts, entry?.id ?? null, analysis?.model ?? "rules").run();
    return json({ message: { id, sender: "user", content, ts }, reply }, 201);
  });

  // Food search: the offline pantry and cached foods from D1, then USDA (server key) and Open Food Facts.
  route("GET", "/foods/search", async (_r, env, _p, url, _c, who) => {
    const q = (url.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
    if (q.length < 2 || q.length > 80) throw fail(422, "q must be 2-80 characters");
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const { results: local } = await env.DB.prepare(
      "SELECT * FROM foods WHERE label LIKE ? ESCAPE '\\' ORDER BY source='space_pantry' DESC, length(label) LIMIT 8"
    ).bind(like).all<FoodRow>();
    if (who.demo) return json(local.map(foodResponse));
    const remote = (await Promise.allSettled([env.USDA_API_KEY ? usdaFoods(env.USDA_API_KEY, q) : Promise.resolve([]), openFoodFacts(q)]))
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    if (remote.length) {
      await env.DB.batch(remote.map((f) => env.DB.prepare(
        `INSERT INTO foods (id,label,brand,source,kcal_100g,protein_100g,carbs_100g,fat_100g) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET label=excluded.label, brand=excluded.brand, kcal_100g=excluded.kcal_100g,
         protein_100g=excluded.protein_100g, carbs_100g=excluded.carbs_100g, fat_100g=excluded.fat_100g, fetched_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
      ).bind(f.id, f.label, f.brand, f.source, f.kcal_100g, f.protein_100g, f.carbs_100g, f.fat_100g))).catch(() => {});
    }
    const seen = new Set<string>();
    const merged = [...local, ...remote].filter((f) => !seen.has(f.id) && seen.add(f.id)).slice(0, 16);
    return json(merged.map(foodResponse));
  });

  // Deletes one of your files (selfies) from R2 and D1. Ownership is checked in authorize().
  route("DELETE", "/media/:mid", async (_r, env, p) => {
    const m = await env.DB.prepare("SELECT r2_key FROM media WHERE id=?").bind(p.mid).first<{ r2_key: string }>();
    if (!m) throw fail(404, "file not found");
    if (!env.MEDIA) throw fail(503, "R2 bucket not configured yet");
    await env.MEDIA.delete(m.r2_key);
    await env.DB.prepare("DELETE FROM media WHERE id=?").bind(p.mid).run();
    return new Response(null, { status: 204 });
  });
}
