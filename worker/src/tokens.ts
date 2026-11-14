/**
 * One-time tokens in D1 (table stream_tokens: token PK, call_sid, expires_at epoch ms).
 * Replaces the in-memory dict in api/voice.py so a token issued by one isolate can be
 * consumed by another (or by the VoiceSession Durable Object). Consumption is a single
 * DELETE ... RETURNING, so a token can never be used twice.
 */
import { randomToken } from "./config";

export const STREAM_TOKEN_TTL_S = 120;
export const WS_TICKET_PREFIX = "ws.";

export async function issueToken(db: D1Database, opts: { callSid?: string | null; prefix?: string; ttlS?: number; now?: number } = {}): Promise<string> {
  const now = opts.now ?? Date.now();
  const token = (opts.prefix ?? "") + randomToken(24);
  await db.batch([
    db.prepare("DELETE FROM stream_tokens WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO stream_tokens (token, call_sid, expires_at) VALUES (?, ?, ?)")
      .bind(token, opts.callSid ?? null, now + (opts.ttlS ?? STREAM_TOKEN_TTL_S) * 1000),
  ]);
  return token;
}

/** Atomically remove the token; true only if it existed and had not expired. */
export async function consumeToken(db: D1Database, token: string | null | undefined, opts: { prefix?: string; now?: number } = {}): Promise<boolean> {
  if (!token || typeof token !== "string") return false;
  const prefix = opts.prefix ?? "";
  // Stream tokens and WS tickets are not interchangeable.
  if (prefix ? !token.startsWith(prefix) : token.startsWith(WS_TICKET_PREFIX)) return false;
  const row = await db.prepare("DELETE FROM stream_tokens WHERE token = ? RETURNING expires_at")
    .bind(token).first<{ expires_at: number | null }>();
  return row !== null && row.expires_at !== null && row.expires_at >= (opts.now ?? Date.now());
}

export const issueStreamToken = (db: D1Database, callSid?: string | null) => issueToken(db, { callSid });
export const consumeStreamToken = (db: D1Database, token: string | null | undefined) => consumeToken(db, token);
