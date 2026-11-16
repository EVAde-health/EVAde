// evade-gateway: Michael's gateway Worker + Durable Object that runs ONE container of the EVAde model API.
// Based on backend-models/docs/cloudflare-containers-setup.md (step 3).
// No public container endpoint; the API key never leaves Cloudflare; mock results are handled by evade-api.
import { DurableObject } from "cloudflare:workers";

interface Env {
  EVADE_API: DurableObjectNamespace<EvadeApi>;
  LIMITER: RateLimit;
  EVADE_API_KEY: string;            // secret: the key the API checks (X-EVAde-Key)
  GATEWAY_CALLER_KEY: string;       // secret: what the backend caller sends (X-Gateway-Key)
  ADMIN_KEY: string;                // secret: second key required for the restart route
  CF_ACCOUNT_ID: string; CF_API_TOKEN: string; CF_D1_DATABASE_ID: string;
  CF_R2_BUCKET: string; CF_R2_ACCESS_KEY_ID: string; CF_R2_SECRET_ACCESS_KEY: string;
  CF_R2_MODELS_BUCKET: string; CF_R2_MODELS_ACCESS_KEY_ID: string; CF_R2_MODELS_SECRET_ACCESS_KEY: string;
  CF_R2_ENDPOINT?: string;          // only for EU-jurisdiction buckets
}

const PORT = 8000;
const IDLE_MS = 60 * 60 * 1000;          // sleep after 1 h without requests (max 6 h)
const INSTANCE = "evade-api-2";          // ONE fixed name -> one container. Never derive it from the request.
const MAX_BODY = 1_000_000;              // the API's own cap is 1 MB
const READY_WAIT_MS = 45_000;
const FORWARD_HEADERS = ["content-type", "accept", "idempotency-key"];

// Fail-closed, constant-time key check: unset or short secrets and missing headers always deny.
async function keyOk(got: string | null, want: string | undefined): Promise<boolean> {
  if (!want || want.length < 32 || !got) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(got)),
                                    crypto.subtle.digest("SHA-256", enc.encode(want))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

const err = (status: number, code: string, message: string, extra: Record<string, string> = {}) =>
  Response.json({ error: { code, message } }, { status, headers: extra });

export class EvadeApi extends DurableObject<Env> {
  private readyP?: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // the inactivity timeout is lost when the Durable Object restarts (for example after a deploy): set it again
    ctx.blockConcurrencyWhile(async () => {
      if (ctx.container?.running) await ctx.container.setInactivityTimeout(IDLE_MS);
    });
  }

  private containerEnv(): Record<string, string> {
    const e = this.env;
    const required = ["EVADE_API_KEY", "CF_ACCOUNT_ID", "CF_API_TOKEN", "CF_D1_DATABASE_ID", "CF_R2_BUCKET",
      "CF_R2_ACCESS_KEY_ID", "CF_R2_SECRET_ACCESS_KEY", "CF_R2_MODELS_BUCKET", "CF_R2_MODELS_ACCESS_KEY_ID",
      "CF_R2_MODELS_SECRET_ACCESS_KEY"] as const;
    for (const k of required) if (!e[k]) throw new Error(`missing secret ${k}`);   // names only, never values
    const env: Record<string, string> = { EVADE_STORAGE: "cloudflare", EVADE_ALLOW_DRAFT: "1" };
    for (const k of required) env[k] = e[k];
    if (e.CF_R2_ENDPOINT) env.CF_R2_ENDPOINT = e.CF_R2_ENDPOINT;
    return env;
  }

  private async startAndWait(): Promise<void> {
    const c = this.ctx.container!;
    if (!c.running) {
      c.start({ image: c.images.api, instance: "standard-1", enableInternet: true, env: this.containerEnv() });
      c.monitor().catch(() => {}).finally(() => { this.readyP = undefined; });   // forget readiness when it exits
    }
    await c.setInactivityTimeout(IDLE_MS);
    const deadline = Date.now() + READY_WAIT_MS;
    while (Date.now() < deadline) {
      try {   // an authed route: also proves the key wiring works
        const r = await c.getTcpPort(PORT).fetch("http://container/v1/health",
          { headers: { "X-EVAde-Key": this.env.EVADE_API_KEY }, signal: AbortSignal.timeout(2000) });
        if (r.ok) return;
      } catch { /* not listening yet */ }
      await new Promise((res) => setTimeout(res, 1000));
    }
    throw new Error("not ready");
  }

  async restart(): Promise<void> {        // picks up a newly deployed image on the next request
    this.readyP = undefined;
    if (this.ctx.container?.running) await this.ctx.container.destroy();
  }

  async fetch(request: Request): Promise<Response> {
    try {
      this.readyP ??= this.startAndWait();   // one start and one poll shared by all waiting requests
      await this.readyP;
    } catch (e) {
      this.readyP = undefined;
      console.error("container start failed", (e as Error).message.startsWith("missing secret") ? "config" : "timeout");
      return err(503, "starting", "API is starting, retry shortly", { "Retry-After": "10" });
    }
    const u = new URL(request.url);
    const fwd = new Request("http://container" + u.pathname + u.search, request);   // plain HTTP to uvicorn
    fwd.headers.delete("host");
    return this.ctx.container!.getTcpPort(PORT).fetch(fwd);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return err(403, "https_required", "use HTTPS");

    // backend callers only: fail-closed key check, then a rate limit per caller
    if (!(await keyOk(request.headers.get("X-Gateway-Key"), env.GATEWAY_CALLER_KEY)))
      return err(401, "unauthorized", "missing or wrong key");
    const { success } = await env.LIMITER.limit({ key: "gateway" });
    if (!success) return err(429, "rate_limited", "too many requests", { "Retry-After": "30" });

    const stub = env.EVADE_API.getByName(INSTANCE);

    if (url.pathname === "/__admin/restart") {      // needs BOTH keys; any other method is 404
      if (request.method !== "POST" || !(await keyOk(request.headers.get("X-Admin-Key"), env.ADMIN_KEY)))
        return new Response(null, { status: 404 });
      await stub.restart();
      return Response.json({ restarted: true });
    }

    if (!["GET", "POST", "DELETE"].includes(request.method) || !url.pathname.startsWith("/v1/"))
      return err(404, "not_found", "unknown route");

    // buffer the body (fixed Content-Length for the API, and a retry after a cold start can't lose a stream)
    let body: ArrayBuffer | null = null;
    if (request.method === "POST") {
      const cl = Number(request.headers.get("content-length"));
      if (!Number.isFinite(cl) || cl <= 0) return err(411, "length_required", "Content-Length header required");
      if (cl > MAX_BODY) return err(413, "payload_too_large", "body over 1 MB");
      body = await request.arrayBuffer();
      if (body.byteLength > MAX_BODY) return err(413, "payload_too_large", "body over 1 MB");
    }

    const headers = new Headers();                        // allow-list: nothing else reaches the API
    for (const h of FORWARD_HEADERS) { const v = request.headers.get(h); if (v) headers.set(h, v); }
    headers.set("X-EVAde-Key", env.EVADE_API_KEY);       // the API's key is added here and never leaves Cloudflare
    return stub.fetch(new Request(url.toString(), { method: request.method, headers, body }));
    // never log request bodies, headers or URLs here: they can carry health data and user IDs
  },
};
