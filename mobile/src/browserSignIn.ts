import * as Crypto from 'expo-crypto';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { API_URL, AUTH_RETURN_URL, SITE_URL } from './config';

// Passkeys don't work inside an in-app WebView: iOS WKWebView and Android WebView only allow WebAuthn for apps that
// own the passkey's domain (here Cloudflare's evade-health.cloudflareaccess.com), and the WebView has its own
// cookie jar, separate from Safari/Chrome. So the app offers a second route: run the Cloudflare Access sign-in in
// the system browser sheet (ASWebAuthenticationSession / Chrome Custom Tabs), where passkeys work, then hand the
// session to the WebView with a one-time code and a PKCE verifier (Worker routes /auth/access?app_challenge=...
// and POST /auth/app-redeem). The emailed one-time code works directly inside the WebView without any of this.

export interface RedeemRequest {
  uri: string;
  method: 'POST';
  body: string;
  headers: Record<string, string>;
}

export type BrowserSignInResult =
  | { type: 'success'; request: RedeemRequest }
  | { type: 'cancel' }
  | { type: 'error'; message: string };

const b64url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * Android Expo Go can't receive evade:// links (it only owns exp://), so the browser could never hand the code back.
 * iOS Expo Go can: ASWebAuthenticationSession catches the evade:// redirect itself. Store and dev builds can on both.
 */
export function browserSignInSupported() {
  return !(Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient);
}

/** True when the Worker has the app sign-in routes (an older deploy doesn't, so the app hides the button). */
export async function browserSignInAvailable(signal?: AbortSignal) {
  if (!browserSignInSupported() || !API_URL.startsWith('https:')) return false;
  try {
    const response = await fetch(`${API_URL}/auth/providers`, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return false;
    const body = (await response.json()) as { app_handoff?: boolean };
    return body.app_handoff === true;
  } catch {
    return false;
  }
}

/** Runs Cloudflare Access in the system browser and returns the WebView request that finishes the sign-in. */
export async function signInWithSystemBrowser(): Promise<BrowserSignInResult> {
  const verifier = b64url(Crypto.getRandomBytes(32));
  const challenge = b64url(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(verifier))));
  const start = `${API_URL}/auth/access?${new URLSearchParams({ redirect: `${SITE_URL}/dashboard`, app_challenge: challenge })}`;

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    // Not ephemeral, so a passkey/Access session already in the browser is reused and the user isn't asked again.
    result = await WebBrowser.openAuthSessionAsync(start, AUTH_RETURN_URL, { preferEphemeralSession: false });
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : 'Could not open the browser.' };
  }
  if (result.type !== 'success') return { type: 'cancel' };

  const code = new URL(result.url).searchParams.get('code');
  if (!code) return { type: 'error', message: 'Sign-in did not finish. Please try again.' };
  return {
    type: 'success',
    request: {
      uri: `${API_URL}/auth/app-redeem`,
      method: 'POST',
      body: new URLSearchParams({ code, verifier }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  };
}
