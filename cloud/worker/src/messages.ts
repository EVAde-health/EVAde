// 1:1 messaging between an astronaut and a flight surgeon (no group threads).
// A conversation is identified by the (astronaut_id, surgeon_id) pair; both sides address it by the
// other person's user id, so neither side can open a thread they are not part of. Messages persist in
// D1 (conversations / conversation_messages) and carry read receipts for unread badges.
import { Principal, STAFF_ROLES } from "./auth";
import { HttpError } from "./http";

type Handler = (req: Request, env: { DB: D1Database }, p: Record<string, string>, url: URL, ctx: ExecutionContext, who: Principal) => Promise<Response>;

const MAX_BODY = 2000;
const isSurgeon = (role: string | undefined) => STAFF_ROLES.has(role ?? "");

function me(who: Principal) {
  if (who.kind !== "user" || !who.user_id) throw new HttpError(403, "Sign in with your own account to use messages");
  return { id: who.user_id, surgeon: isSurgeon(who.role) };
}

/** Validates the counterpart and returns the (astronaut, surgeon) pair for this conversation. */
async function pairWith(db: D1Database, who: Principal, otherId: string) {
  const self = me(who);
  if (!/^[\w-]{1,80}$/.test(otherId) || otherId === self.id) throw new HttpError(422, "Choose someone to message");
  const other = await db.prepare("SELECT * FROM users WHERE user_id=?").bind(otherId).first<any>();
  if (!other) throw new HttpError(404, "That person was not found");
  if (self.surgeon && other.role !== "astronaut") throw new HttpError(422, "Flight surgeons message astronauts");
  if (!self.surgeon && (who.role !== "astronaut" || !isSurgeon(other.role))) throw new HttpError(422, "Astronauts message flight surgeons");
  const contact = {
    user_id: other.user_id, display_name: other.display_name, full_name: other.full_name ?? null,
    role: other.role, crew_role: other.crew_role ?? null,
  };
  return self.surgeon
    ? { self, contact, astronaut_id: other.user_id as string, surgeon_id: self.id }
    : { self, contact, astronaut_id: self.id, surgeon_id: other.user_id as string };
}

export function registerMessaging(route: (method: string, path: string, handler: Handler) => void, deps: {
  json: (data: unknown, status?: number) => Response;
  body: <T = any>(req: Request) => Promise<T>;
  now: () => string;
}) {
  const { json, body, now } = deps;

  // Everyone this user can message: astronauts for a surgeon, flight surgeons for an astronaut.
  route("GET", "/messages/contacts", async (_r, env, _p, _u, _c, who) => {
    const self = me(who);
    const [mine, theirs, roleFilter] = self.surgeon
      ? ["c.surgeon_id", "c.astronaut_id", "u.role = 'astronaut'"]
      : ["c.astronaut_id", "c.surgeon_id", `u.role IN (${[...STAFF_ROLES].map((r) => `'${r}'`).join(",")})`];
    const { results } = await env.DB.prepare(
      `SELECT u.*, c.id AS conversation_id, c.updated_at,
              (SELECT body FROM conversation_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
              (SELECT created_at FROM conversation_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_at,
              (SELECT sender_id FROM conversation_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender_id,
              (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id AND m.sender_id != ?1 AND m.read_at IS NULL) AS unread
       FROM users u LEFT JOIN conversations c ON ${theirs} = u.user_id AND ${mine} = ?1
       WHERE ${roleFilter} AND u.user_id != ?1
       ORDER BY unread DESC, last_at IS NULL, last_at DESC, u.display_name`
    ).bind(self.id).all<any>();
    return json(results.map((u) => ({
      user_id: u.user_id, display_name: u.display_name, full_name: u.full_name ?? null, role: u.role, crew_role: u.crew_role ?? null,
      conversation_id: u.conversation_id ?? null, last_body: u.last_body ?? null, last_at: u.last_at ?? null,
      last_from_me: u.last_sender_id === self.id, unread: u.unread ?? 0,
    })));
  });

  // Total unread for the nav badge (polled every few seconds).
  route("GET", "/messages/unread", async (_r, env, _p, _u, _c, who) => {
    const self = me(who);
    const column = self.surgeon ? "c.surgeon_id" : "c.astronaut_id";
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE ${column} = ?1 AND m.sender_id != ?1 AND m.read_at IS NULL`
    ).bind(self.id).first<{ n: number }>();
    return json({ unread: row?.n ?? 0 });
  });

  // The thread with one person (empty until the first message). ?after=<id> returns only newer messages.
  route("GET", "/messages/with/:otherId", async (_r, env, p, url, _c, who) => {
    const pair = await pairWith(env.DB, who, p.otherId);
    const conversation = await env.DB.prepare("SELECT * FROM conversations WHERE astronaut_id=? AND surgeon_id=?")
      .bind(pair.astronaut_id, pair.surgeon_id).first<any>();
    if (!conversation) return json({ contact: pair.contact, conversation: null, messages: [] });
    const after = Number(url.searchParams.get("after") ?? 0);
    const { results } = await env.DB.prepare(
      `SELECT m.id, m.sender_id, u.display_name AS sender_name, m.body, m.created_at, m.read_at
       FROM conversation_messages m JOIN users u ON u.user_id = m.sender_id
       WHERE m.conversation_id=? AND m.id > ? ORDER BY m.id DESC LIMIT 300`
    ).bind(conversation.id, Number.isSafeInteger(after) && after > 0 ? after : 0).all();
    return json({ contact: pair.contact, conversation, messages: results.reverse() });
  });

  route("POST", "/messages/with/:otherId", async (req, env, p, _u, _c, who) => {
    const pair = await pairWith(env.DB, who, p.otherId);
    const input = await body(req);
    const content = typeof input?.body === "string" ? input.body.trim() : "";
    if (!content || content.length > MAX_BODY) throw new HttpError(422, `Message must be 1-${MAX_BODY} characters`);
    const ts = now();
    await env.DB.prepare(
      `INSERT INTO conversations (astronaut_id, surgeon_id, created_at, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(astronaut_id, surgeon_id) DO UPDATE SET updated_at=excluded.updated_at`
    ).bind(pair.astronaut_id, pair.surgeon_id, ts, ts).run();
    const conversation = await env.DB.prepare("SELECT id FROM conversations WHERE astronaut_id=? AND surgeon_id=?")
      .bind(pair.astronaut_id, pair.surgeon_id).first<{ id: number }>();
    const message = await env.DB.prepare(
      "INSERT INTO conversation_messages (conversation_id, sender_id, body, created_at) VALUES (?,?,?,?) RETURNING id, sender_id, body, created_at, read_at"
    ).bind(conversation!.id, pair.self.id, content, ts).first<any>();
    return json({ conversation_id: conversation!.id, message }, 201);
  });

  // Marks everything the other person sent as read (called when the thread is open).
  route("POST", "/messages/with/:otherId/read", async (_r, env, p, _u, _c, who) => {
    const pair = await pairWith(env.DB, who, p.otherId);
    const result = await env.DB.prepare(
      `UPDATE conversation_messages SET read_at=? WHERE read_at IS NULL AND sender_id != ? AND conversation_id =
         (SELECT id FROM conversations WHERE astronaut_id=? AND surgeon_id=?)`
    ).bind(now(), pair.self.id, pair.astronaut_id, pair.surgeon_id).run();
    return json({ marked: result.meta.changes ?? 0 });
  });
}
