import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewNavigation } from 'react-native-webview';
import { IN_APP_HOSTS, SITE_URL } from './src/config';

// Decides whether a URL opens inside the app or in the system browser or another app.
function isInAppUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'about:' || parsed.protocol === 'blob:' || parsed.protocol === 'data:') return true;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname;
    return IN_APP_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

// Root: a full-screen WebView showing the EVAde website.
export default function App() {
  const webViewRef = useRef<WebView<object> | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Android back button goes back in the site before leaving the app.
  useEffect(() => {
    const onBack = () => {
      if (!canGoBack) return false;
      webViewRef.current?.goBack();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => subscription.remove();
  }, [canGoBack]);

  // Opens links that leave the app in the system browser; the site stays in the WebView.
  function handleShouldLoad(event: { url: string; isTopFrame?: boolean }) {
    if (event.isTopFrame === false) return true;
    if (isInAppUrl(event.url)) return true;
    Linking.openURL(event.url).catch(() => undefined);
    return false;
  }

  function retry() {
    setLoadError(null);
    webViewRef.current?.reload();
  }

  if (loadError) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
          <StatusBar style="auto" />
          <Text style={styles.title}>Can't reach EVAde</Text>
          <Text style={styles.body}>Check your connection, then try again.</Text>
          <Pressable style={styles.button} onPress={retry} accessibilityRole="button">
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <StatusBar style="auto" />
        <WebView
          ref={webViewRef}
          source={{ uri: SITE_URL }}
          style={styles.webview}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.center}>
              <ActivityIndicator size="large" />
            </View>
          )}
          onShouldStartLoadWithRequest={handleShouldLoad}
          onNavigationStateChange={(state: WebViewNavigation) => setCanGoBack(state.canGoBack)}
          onError={(event) => setLoadError(event.nativeEvent.description)}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 500) setLoadError(`HTTP ${event.nativeEvent.statusCode}`);
          }}
          onRenderProcessGone={() => webViewRef.current?.reload()}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          pullToRefreshEnabled
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0F1A' },
  webview: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: '#0B0F1A' },
  title: { fontSize: 20, fontWeight: '600', color: '#FFFFFF' },
  body: { fontSize: 15, color: '#B8C0D0', textAlign: 'center' },
  button: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, backgroundColor: '#7C5CFF' },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
