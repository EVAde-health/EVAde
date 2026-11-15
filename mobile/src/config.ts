// Where the app points. Production by default; override per run or build with EXPO_PUBLIC_* variables, e.g.
//   EXPO_PUBLIC_SITE_URL=http://192.168.1.20:5180 EXPO_PUBLIC_API_URL=http://192.168.1.20:8787 npx expo start
// (see README: the local web server must listen on the LAN with `--host`).

/** The EVAde website the app opens. */
export const SITE_URL: string = trimSlash(process.env.EXPO_PUBLIC_SITE_URL || 'https://evade.health');

/** The evade-api Worker the site signs in through (Cloudflare Access guards its /auth/access path). */
export const API_URL: string = trimSlash(process.env.EXPO_PUBLIC_API_URL || defaultApiUrl(SITE_URL));

/** The app's URL scheme. For example, evade://journal opens the journal. */
export const APP_SCHEME = 'evade';

/**
 * Hosts that stay inside the app (subdomains included): the site, the API (sign-in redirects and logout go through
 * it) and the Cloudflare Access sign-in page (evade-health.cloudflareaccess.com). Anything else opens in the
 * system browser or the matching app (mail, phone, maps).
 */
export const IN_APP_HOSTS: string[] = unique([hostOf(SITE_URL), hostOf(API_URL), 'cloudflareaccess.com']);

function defaultApiUrl(site: string) {
  const url = new URL(site);
  // Production: evade.health -> api.evade.health. Local dev: the Worker runs on port 8787 of the same machine.
  if (url.protocol === 'https:') return `https://api.${url.hostname.replace(/^www\./, '')}`;
  return `${url.protocol}//${url.hostname}:8787`;
}

function hostOf(url: string) {
  return new URL(url).hostname;
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, '');
}

function unique(values: string[]) {
  return [...new Set(values)];
}
