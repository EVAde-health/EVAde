import { STAFF_ROLES, type AuthEnv, type Principal } from "./auth";
import { sameCrewSql } from "./demo";
import { HttpError } from "./http";

type MessagingEnv = Pick<AuthEnv, "DB" | "AUTH_RATE_LIMITER">;
type Handler = (req: Request, env: MessagingEnv, params: Record<string, string>, url: URL, ctx: ExecutionContext, who: Principal) => Promise<Response>;
type Participant = { id: string; staff: boolean; demo: boolean };
type Contact = { user_id: string; display_name: string; full_name: string | null; role: string; crew_role: string | null };
type Conversation = { id: number; astronaut_id: string; surgeon_id: string; created_at: string; updated_at: string };
type Message = { id: number; conversation_id: number; sender_id: string; body: string; created_at: string; read_at: string | null };

const CONTACT_FIELDS = "u.user_id, u.display_name, u.full_name, u.role, u.crew_role";
// One sign-in for everyone: a staff contact has a staff D1 role and has signed in at least once.
const STAFF_FILTER = `u.role IN (${[...STAFF_ROLES].map(() => "?").join(",")})
  AND EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id=u.user_id)`;

function participant(who: Principal): Participant {
  if (who.kind !== "user" || !who.user_id) throw new HttpError(403, "Use your own account to see conversations");
  const staff = STAFF_ROLES.has(who.role ?? "");
  if (!staff && who.role !== "astronaut") throw new HttpError(403, "Use your own account to see conversations");
  return { id: who.user_id, staff, demo: who.demo === true };
}

// Who a participant may message. Astronauts and the shared demo only reach their own crew (demo or real).
function contactFilter(self: Participant) {
  const base = self.staff ? { sql: "u.role='astronaut'", params: [] as string[] } : { sql: STAFF_FILTER, params: [...STAFF_ROLES] };
  if (self.staff && !self.demo) return base;
  const crew = sameCrewSql("u.user_id", self.id);
  return { sql: `${base.sql} AND ${crew.sql}`, params: [...base.params, ...crew.params] };
}

async function pairWith(db: D1Database, self: Participant, otherId: string) {
  if (!/^[\w-]{1,80}$/.test(otherId) || otherId === self.id) throw new HttpError(422, "Choose an available contact");
  const filter = contactFilter(self);
  const contact = await db.prepare(`SELECT ${CONTACT_FIELDS} FROM users u WHERE u.user_id=? AND ${filter.sql}`)
    .bind(otherId, ...filter.params).first<Contact>();
  if (!contact) throw new HttpError(422, "Choose an available contact");
  return {
    contact,
    astronautId: self.staff ? otherId : self.id,
    surgeonId: self.staff ? self.id : otherId,
  };
}

function findConversation(db: D1Database, astronautId: string, surgeonId: string) {
  return db.prepare("SELECT id, astronaut_id, surgeon_id, created_at, updated_at FROM conversations WHERE astronaut_id=? AND surgeon_id=?")
    .bind(astronautId, surgeonId).first<Conversation>();
}

export async function limitMessageSend(env: Pick<AuthEnv, "AUTH_RATE_LIMITER">, senderId: string) {
  const { success } = await env.AUTH_RATE_LIMITER.limit({ key: `message-send:${senderId}` });
  if (!success) throw new HttpError(429, "Message rate limit reached. Try again in a minute.");
}

export async function recordMessage(env: MessagingEnv, { astronautId, surgeonId, senderId, content, ts }: {
  astronautId: string; surgeonId: string; senderId: string; content: string; ts: string;
}) {
  if (senderId !== astronautId && senderId !== surgeonId) throw new HttpError(403, "You can only send to your own conversations");
  await limitMessageSend(env, senderId);
  const [, inserted] = await env.DB.batch<Message>([
    env.DB.prepare(
      `INSERT INTO conversations (astronaut_id,surgeon_id,created_at,updated_at) VALUES (?,?,?,?)
       ON CONFLICT(astronaut_id,surgeon_id) DO UPDATE SET updated_at=MAX(conversations.updated_at,excluded.updated_at)`
    ).bind(astronautId, surgeonId, ts, ts),
    env.DB.prepare(
      `INSERT INTO conversation_messages (conversation_id,sender_id,body,created_at)
       SELECT id,?,?,? FROM conversations WHERE astronaut_id=? AND surgeon_id=?
       RETURNING id,conversation_id,sender_id,body,created_at,read_at`
    ).bind(senderId, content, ts, astronautId, surgeonId),
  ]);
  const message = inserted.results[0];
  if (!message) throw new HttpError(409, "Conversation unavailable");
  return message;
}

export function registerMessaging(route: (method: string, path: string, handler: Handler) => void, deps: {
  json: (data: unknown, status?: number) => Response;
  body: <T>(req: Request) => Promise<T>;
  now: () => string;
}) {
  const { json, body, now } = deps;

  route("GET", "/messages/contacts", async (_r, env, _p, _u, _c, who) => {
    const self = participant(who);
    const filter = contactFilter(self);
    const [mine, theirs] = self.staff ? ["c.surgeon_id", "c.astronaut_id"] : ["c.astronaut_id", "c.surgeon_id"];
    const { results } = await env.DB.prepare(
      `SELECT ${CONTACT_FIELDS}, c.id AS conversation_id,
              last.body AS last_body, last.created_at AS last_at, last.sender_id AS last_sender_id,
              (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id=c.id AND m.sender_id=u.user_id AND m.read_at IS NULL) AS unread
       FROM users u LEFT JOIN conversations c ON ${theirs}=u.user_id AND ${mine}=?
       LEFT JOIN conversation_messages last ON last.id=(SELECT id FROM conversation_messages
         WHERE conversation_id=c.id AND sender_id IN (c.astronaut_id,c.surgeon_id) ORDER BY id DESC LIMIT 1)
       WHERE ${filter.sql} AND u.user_id!=? ORDER BY unread DESC, last_at DESC, u.display_name`
    ).bind(self.id, ...filter.params, self.id).all<Contact & {
      conversation_id: number | null; last_body: string | null; last_at: string | null; last_sender_id: string | null; unread: number;
    }>();
    return json(results.map(({ last_sender_id, ...row }) => ({ ...row, last_from_me: last_sender_id === self.id })));
  });

  route("GET", "/messages/unread", async (_r, env, _p, _u, _c, who) => {
    const self = participant(who);
    const [mine, theirs] = self.staff ? ["c.surgeon_id", "c.astronaut_id"] : ["c.astronaut_id", "c.surgeon_id"];
    const unread = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id
       WHERE ${mine}=? AND m.sender_id=${theirs} AND m.read_at IS NULL`
    ).bind(self.id).first<{ n: number }>();
    return json({ unread: unread?.n ?? 0 });
  });

  route("GET", "/messages/with/:otherId", async (_r, env, p, url, _c, who) => {
    const self = participant(who);
    const { contact, astronautId, surgeonId } = await pairWith(env.DB, self, p.otherId);
    const conversation = await findConversation(env.DB, astronautId, surgeonId);
    if (!conversation) return json({ contact, conversation: null, messages: [] });
    const after = Number(url.searchParams.get("after") ?? 0);
    const { results } = await env.DB.prepare(
      `SELECT m.id, m.sender_id, u.display_name AS sender_name, m.body, m.created_at, m.read_at
       FROM conversation_messages m JOIN users u ON u.user_id=m.sender_id
       WHERE m.conversation_id=? AND m.sender_id IN (?,?) AND m.id>? ORDER BY m.id DESC LIMIT 300`
    ).bind(conversation.id, astronautId, surgeonId, Number.isSafeInteger(after) && after > 0 ? after : 0).all();
    return json({ contact, conversation, messages: results.reverse() });
  });

  route("POST", "/messages/with/:otherId", async (req, env, p, _u, _c, who) => {
    const self = participant(who);
    const input = await body<{ body?: unknown }>(req);
    const content = typeof input?.body === "string" ? input.body.trim() : "";
    if (content.length < 1 || content.length > 2000) throw new HttpError(422, "Message must be 1-2000 characters");
    const { astronautId, surgeonId } = await pairWith(env.DB, self, p.otherId);
    const message = await recordMessage(env, { astronautId, surgeonId, senderId: self.id, content, ts: now() });
    return json({ conversation_id: message.conversation_id, message }, 201);
  });

  route("POST", "/messages/with/:otherId/read", async (_r, env, p, _u, _c, who) => {
    const self = participant(who);
    const { contact, astronautId, surgeonId } = await pairWith(env.DB, self, p.otherId);
    const result = await env.DB.prepare(
      `UPDATE conversation_messages SET read_at=? WHERE read_at IS NULL AND sender_id=? AND conversation_id=
       (SELECT id FROM conversations WHERE astronaut_id=? AND surgeon_id=?)`
    ).bind(now(), contact.user_id, astronautId, surgeonId).run();
    return json({ marked: result.meta.changes ?? 0 });
  });
}
