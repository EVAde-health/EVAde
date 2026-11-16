import { logAbuse } from "../../../shared/abuse";

const origin = "https://challenges.cloudflare.com";
export type DemoTurnstileEnv = { TURNSTILE_SITE_KEY?: string; TURNSTILE_SECRET_KEY?: string };
let warned = false;

export function demoTurnstileSiteKey(env: DemoTurnstileEnv) {
  return env.TURNSTILE_SECRET_KEY?.trim() ? env.TURNSTILE_SITE_KEY?.trim() || null : null;
}

export async function verifyDemoTurnstile(env: DemoTurnstileEnv, token: unknown, action: string, hostname: string, ip: string | null) {
  if (!env.TURNSTILE_SECRET_KEY?.trim()) {
    if (!warned) { logAbuse("turnstile_disabled", "demo"); warned = true; }
    return true;
  }
  if (typeof token === "string" && token && token.length <= 2048 && demoTurnstileSiteKey(env)) {
    try {
      const response = await fetch(origin + "/turnstile/v0/siteverify", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, ...(ip ? { remoteip: ip } : {}) }),
      });
      if (response.ok) {
        const result = await response.json<{ success?: boolean; action?: string; hostname?: string }>();
        if (result.success === true && result.action === action && result.hostname === hostname) return true;
      }
    } catch { /* Fail closed when validation is configured. */ }
  }
  logAbuse("turnstile_rejected", action);
  return false;
}
