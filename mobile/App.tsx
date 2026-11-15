import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { APP_SCHEME, IN_APP_HOSTS, SITE_URL } from './src/config';
import { CHROME_REPORTER, isLight, parseChromeMessage, solidColor } from './src/siteChrome';

const SPACE = '#0B0F1A';
type Source = { uri: string };

const hostMatches = (host: string, allowed: string) => host === allowed || host.endsWith(`.${allowed}`);

// Decides whether a URL opens inside the app or in the system browser or another app.
function isInAppUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'about:' || parsed.protocol === 'blob:' || parsed.protocol === 'data:') return true;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return IN_APP_HOSTS.some((allowed) => hostMatches(parsed.hostname, allowed));
  } catch {
    return false;
  }
}

// evade://journal -> https://evade.health/journal. Ignore legacy authentication callbacks.
function siteUrlForDeepLink(link: string | null | undefined) {
  if (!link || !link.startsWith(`${APP_SCHEME}://`)) return null;
  const rest = link.slice(APP_SCHEME.length + 3).replace(/^\/+/, '');
  if (rest === 'auth' || rest.startsWith('auth?') || rest.startsWith('auth/')) return null;
  return `${SITE_URL}/${rest}`;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView<object> | null>(null);
  const lastUrl = useRef(SITE_URL);
  const [source, setSource] = useState<Source>({ uri: SITE_URL });
  const [webViewKey, setWebViewKey] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chrome, setChrome] = useState({ top: SPACE, bottom: SPACE });

  // Loads a page in a fresh WebView (also clears the error screen).
  const open = useCallback((next: Source) => {
    setLoadError(null);
    setSource(next);
    setWebViewKey((k) => k + 1);
  }, []);

  // Deep links: evade://journal, evade://dashboard, ... (cold start and while running).
  useEffect(() => {
    Linking.getInitialURL().then((link) => {
      const url = siteUrlForDeepLink(link);
      if (url) open({ uri: url });
    }).catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => {
      const target = siteUrlForDeepLink(url);
      if (target) open({ uri: target });
    });
    return () => sub.remove();
  }, [open]);

  // Android back button goes back in the site before leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (loadError || !canGoBack) return false;
      webViewRef.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, [canGoBack, loadError]);

  // Links that leave EVAde (and mailto:, tel:, ...) open in the system browser or the matching app.
  function handleShouldLoad(event: ShouldStartLoadRequest) {
    if (event.isTopFrame === false) return true;
    if (event.url.startsWith(`${APP_SCHEME}://auth`)) return false;
    if (isInAppUrl(event.url)) return true;
    Linking.openURL(event.url).catch(() => undefined);
    return false;
  }

  function handleNavigation(state: WebViewNavigation) {
    setCanGoBack(state.canGoBack);
    if (isInAppUrl(state.url)) lastUrl.current = state.url;
  }

  function handleMessage(event: WebViewMessageEvent) {
    const msg = parseChromeMessage(event.nativeEvent.data);
    if (msg) setChrome({ top: solidColor(msg.top, SPACE), bottom: solidColor(msg.bottom, SPACE) });
  }

  const retry = () => open({ uri: lastUrl.current });

  if (loadError) {
    return (
      <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <StatusBar style="light" />
        <Text style={styles.title}>Can't reach EVAde</Text>
        <Text style={styles.body}>Check your connection, then try again.</Text>
        <Pressable style={styles.button} onPress={retry} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: chrome.bottom }]}>
      <StatusBar style={isLight(chrome.top) ? 'dark' : 'light'} />
      <View style={{ height: insets.top, backgroundColor: chrome.top }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'android' ? 'height' : undefined}>
        <WebView
          key={webViewKey}
          ref={webViewRef}
          source={source}
          style={[styles.flex, { backgroundColor: chrome.bottom }]}
          containerStyle={{ paddingBottom: insets.bottom, backgroundColor: chrome.bottom }}
          startInLoadingState
          renderLoading={() => (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <ActivityIndicator size="large" color="#FFFFFF" />
            </View>
          )}
          onShouldStartLoadWithRequest={handleShouldLoad}
          onNavigationStateChange={handleNavigation}
          onMessage={handleMessage}
          injectedJavaScript={CHROME_REPORTER}
          onError={(event) => setLoadError(event.nativeEvent.description || 'Load failed')}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 500) setLoadError(`HTTP ${event.nativeEvent.statusCode}`);
          }}
          onContentProcessDidTerminate={() => webViewRef.current?.reload()}
          onRenderProcessGone={() => webViewRef.current?.reload()}
          applicationNameForUserAgent="EVAdeApp/1.0"
          // Cookies: the session cookie lives on api.evade.health and the site on evade.health (same site).
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          // Camera (selfie check-in) and microphone (voice journal) through getUserMedia. iOS asks once with the
          // app's permission text; Android's WebView asks for the runtime permission when the page requests it.
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          // The site scrolls an inner panel, not the page, so Android's pull-to-refresh would fire mid-scroll.
          pullToRefreshEnabled={Platform.OS === 'ios'}
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
          webviewDebuggingEnabled={__DEV__}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: SPACE },
  title: { fontSize: 20, fontWeight: '600', color: '#FFFFFF' },
  body: { fontSize: 15, color: '#B8C0D0', textAlign: 'center' },
  button: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, backgroundColor: '#7C5CFF' },
  buttonText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});
