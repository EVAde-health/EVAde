// The shared "Try the demo" world: anyone can sign in as the seeded astronaut (Cmdr. Vega, d001) or flight
// surgeon (Dr. Ortiz, d002) and read and write freely, but only inside the demo crew (ids 00000000-…-d0xx).
// Real accounts never leak into a demo session, and POST /demo/reset puts the seeded crew back.

import { deleteUserSql } from "./deleteUser";
import { DEMO_SEED_SQL } from "./demoSeed.generated";
import { HttpError } from "./http";

export const DEMO_ID_PREFIX = "00000000-0000-4000-8000-00000000d";
export const DEMO_ASTRONAUT_ID = `${DEMO_ID_PREFIX}001`;
export const DEMO_SURGEON_ID = `${DEMO_ID_PREFIX}002`;
/** Bumped when the seeded demo crew changes. The first demo sign-in after a bump resets once. */
export const DEMO_GENERATION = "two-users-unchecked-v1";

/** The two "Try the demo" logins, by auth_identities (provider 'demo', subject). Never taken from the request. */
export const DEMO_PERSONAS = {
  astronaut: { subject: "vega", role: "astronaut" },
  surgeon: { subject: "ortiz", role: "flight_surgeon" },
} as const;
export type DemoPersona = keyof typeof DEMO_PERSONAS;

type DemoEnv = { DB: D1Database; MEDIA?: R2Bucket };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERSON_KEYS = ["user_id", "astronaut_id", "staff_id", "surgeon_id"] as const;
// Crew-wide or account-level routes a shared demo session never reaches.
const BLOCKED: [string, RegExp][] = [
  ["*", /^\/leaderboard$/],
  ["*", /^\/live(\/|$)/],
  ["*", /^\/auth\/identities/],
  ["*", /^\/admin\/simulate$/],
  ["*", /^\/model-results$/],
  ["POST", /^\/users$/],
  ["DELETE", /^\/me$/],
];
// Routes that name a row by id: the row must belong to the demo crew.
const OWNED_ROWS: [RegExp, string][] = [
  [/^\/tasks\/([^/]+)\/(?:complete|reopen)$/, "tasks"],
  [/^\/journal\/([^/]+)/, "journal_entries"],
  [/^\/alerts\/([^/]+)\/ack$/, "alerts"],
  [/^\/media\/([^/]+)$/, "media"],
  [/^\/meals\/([^/]+)$/, "meals"],
  [/^\/admin\/observations\/([^/]+)\//, "observations"],
  [/^\/admin\/emergencies\/([^/]+)\//, "emergencies"],
];

// True when a user id belongs to the seeded demo crew.
export function isDemoId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(DEMO_ID_PREFIX);
}

// True for a real (non-demo) user id: a UUID outside the demo range.
function isRealPerson(value: unknown) {
  return typeof value === "string" && UUID.test(value) && !isDemoId(value);
}

// Throws 403 unless a demo-session request stays inside the demo crew.
export async function assertDemoScope(db: D1Database, req: Request, path: string) {
  if (BLOCKED.some(([m, re]) => (m === "*" || m === req.method) && re.test(path))) {
    throw new HttpError(403, "Use a personal account to view crew activity");
  }
  if (path.split("/").some(isRealPerson)) throw new HttpError(403, "The demo only reaches the demo crew");
  for (const [re, table] of OWNED_ROWS) {
    const id = path.match(re)?.[1];
    if (!id) continue;
    const row = await db.prepare(`SELECT user_id FROM ${table} WHERE id=?`).bind(id).first<{ user_id: string }>();
    if (row && !isDemoId(row.user_id)) throw new HttpError(403, "The demo only reaches the demo crew");
  }
  if (req.method !== "GET" && req.headers.get("Content-Type")?.includes("application/json")) {
    const input = await req.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (input && typeof input === "object" && PERSON_KEYS.some((key) => input[key] != null && !isDemoId(input[key]))) {
      throw new HttpError(403, "The demo only reaches the demo crew");
    }
  }
}

// True when a JSON object names a real person in one of its person-id fields.
function namesRealPerson(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return PERSON_KEYS.some((key) => isRealPerson(row[key]));
}

// Recursively drops list entries that belong to real accounts.
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => !namesRealPerson(item)).map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  }
  return value;
}

// Removes real accounts from a JSON response sent to a demo session (lists of crew, alerts, contacts…).
export async function scrubDemoResponse(res: Response) {
  if (!res.ok || !res.headers.get("Content-Type")?.includes("application/json")) return res;
  const data = await res.json();
  const headers = new Headers(res.headers);
  headers.delete("Content-Length");
  return new Response(JSON.stringify(scrub(data)), { status: res.status, statusText: res.statusText, headers });
}

// Wipes every demo-crew row and replays the seed, in one atomic D1 batch.
export async function resetDemo(env: DemoEnv) {
  const pattern = `${DEMO_ID_PREFIX}%`;
  if (env.MEDIA) {
    const { results } = await env.DB.prepare("SELECT r2_key FROM media WHERE user_id LIKE ?").bind(pattern).all<{ r2_key: string }>();
    const keys = results.map((m) => m.r2_key).filter(Boolean);
    for (let i = 0; i < keys.length; i += 1000) await env.MEDIA.delete(keys.slice(i, i + 1000));
  }
  // The per-user delete, widened from "= user" to "every demo id" (and "<> user" to "not a demo id").
  const deletes = (await deleteUserSql(env.DB)).map((sql) =>
    env.DB.prepare(sql.replace(/<> \?1/g, "NOT LIKE ?1").replace(/= \?1/g, "LIKE ?1")).bind(pattern));
  const seed = DEMO_SEED_SQL.map((sql) => env.DB.prepare(sql));
  const logins = env.DB.prepare(
    "INSERT OR IGNORE INTO auth_identities (provider, subject, user_id, email) VALUES ('demo', ?, ?, NULL), ('demo', ?, ?, NULL)"
  ).bind(DEMO_PERSONAS.astronaut.subject, DEMO_ASTRONAUT_ID, DEMO_PERSONAS.surgeon.subject, DEMO_SURGEON_ID);
  const generation = env.DB.prepare(
    "INSERT INTO action_log (user_id, action, detail) VALUES (?, 'demo_generation', ?)"
  ).bind(DEMO_ASTRONAUT_ID, DEMO_GENERATION);
  await env.DB.batch([...deletes, ...seed, logins, generation]);
}

/** Resets the shared demo once per DEMO_GENERATION so judges start from the two-user unchecked seed. */
export async function ensureCurrentDemo(env: DemoEnv) {
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM action_log WHERE action='demo_generation' AND detail=? LIMIT 1"
  ).bind(DEMO_GENERATION).first();
  if (row) return;
  await resetDemo(env);
}

// SQL that keeps `column` in the same crew as `userId`: demo ids with demo ids, real ids with real ids.
export function sameCrewSql(column: string, userId: string | undefined) {
  return { sql: `${column} ${isDemoId(userId) ? "LIKE" : "NOT LIKE"} ?`, params: [`${DEMO_ID_PREFIX}%`] };
}
