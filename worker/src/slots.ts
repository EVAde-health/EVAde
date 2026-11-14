/**
 * Global concurrency cap for browser/app voice sessions (not Twilio phone calls).
 * Live sessions are rows in D1 `sessions` whose heartbeat is within the last 2 minutes.
 */
import { envInt, randomToken, type EnvLike } from "./config";

export const SESSION_HEARTBEAT_WINDOW_MS = 2 * 60 * 1000;
export const PHONE_MAX_SESSION_SECONDS = 600;
export const IDLE_AUDIO_SECONDS = 60;
export const TOO_MANY_TALKING = "too many people talking";
export const SESSION_LIMIT_REACHED = "session limit reached";
export const TIME_UP = "time-up";

export function maxConcurrentSessions(env: EnvLike): number {
  return envInt(env, "MAX_CONCURRENT_SESSIONS", 5);
}

export function maxSessionSeconds(env: EnvLike, mode: "phone" | "browser"): number {
  if (mode === "phone") return PHONE_MAX_SESSION_SECONDS;
  return envInt(env, "MAX_SESSION_SECONDS", 300);
}

export async function countBrowserSlots(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = now - SESSION_HEARTBEAT_WINDOW_MS;
  const row = await db.prepare(
    "SELECT COUNT(*) AS n FROM sessions WHERE mode = 'browser' AND heartbeat >= ?",
  ).bind(cutoff).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** Reserve a browser/app slot. Returns the slot id, or null when the cap is full. */
export async function acquireBrowserSlot(db: D1Database, cap: number, now = Date.now()): Promise<string | null> {
  const cutoff = now - SESSION_HEARTBEAT_WINDOW_MS;
  const id = randomToken();
  await db.prepare("DELETE FROM sessions WHERE heartbeat < ?").bind(cutoff).run();
  await db.prepare(
    "INSERT INTO sessions (id, started_at, heartbeat, mode) VALUES (?, ?, ?, 'browser')",
  ).bind(id, now, now).run();
  if ((await countBrowserSlots(db, now)) > cap) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }
  return id;
}

export async function heartbeatSlot(db: D1Database, id: string, now = Date.now()): Promise<void> {
  await db.prepare("UPDATE sessions SET heartbeat = ? WHERE id = ?").bind(now, id).run();
}

export async function releaseSlot(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
}
