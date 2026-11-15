import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

const teamHost = (env: AccessEnv) => {
  const host = env.ACCESS_TEAM_DOMAIN?.trim().toLowerCase() ?? "";
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(host) ? host : null;
};
export const accessConfigured = (env: AccessEnv) => Boolean(teamHost(env) && env.ACCESS_AUD);
// Team-wide Access logout page; ends the Access session for every app.
export const accessLogoutUrl = (env: AccessEnv) => {
  const host = teamHost(env);
  return host ? `https://${host}/cdn-cgi/access/logout` : null;
};

let keyCache: { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | undefined;
export function _resetAccessKeyCache() {
  keyCache = undefined;
}

export async function verifyAccessJwt(token: string, env: AccessEnv, audience = env.ACCESS_AUD) {
  const host = teamHost(env);
  if (!host || !audience || token.length > 16_384) throw new Error("Access sign-in unavailable");
  const issuer = "https://" + host;
  if (keyCache?.issuer !== issuer) {
    keyCache = { issuer, keys: createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer)) };
  }
  const { payload } = await jwtVerify(token, keyCache.keys, {
    algorithms: ["RS256"],
    issuer,
    audience,
    requiredClaims: ["exp", "sub"],
  });
  if (payload.type !== "app") throw new Error("Expected an Access application token");
  if (typeof payload.sub !== "string" || !payload.sub.trim()) throw new Error("Access token has no subject");
  if (typeof payload.email !== "string" || !payload.email.trim()) throw new Error("Access token has no user email");

  const email = payload.email.trim().toLowerCase();
  return { subject: payload.sub, email, name: email.split("@")[0], expiresAt: payload.exp! };
}

// Trust the assertion from the protected route only after verifying its signature and audience.
export const accessAssertion = (req: Request) => req.headers.get("Cf-Access-Jwt-Assertion");
