// Address of the EVAde website the app opens. Override per build with EXPO_PUBLIC_SITE_URL.
export const SITE_URL: string = process.env.EXPO_PUBLIC_SITE_URL || 'https://evade.health';

// Hosts that stay inside the app: the site itself and Cloudflare Access sign-in pages.
export const IN_APP_HOSTS: string[] = [new URL(SITE_URL).hostname, 'cloudflareaccess.com'];
