import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import {
  LOOPBACK_OAUTH_START,
  emitLoopbackOAuthCancel,
  emitLoopbackOAuthCaptured,
  isLoopbackOAuthRedirect,
  type LoopbackOAuthStartPayload,
} from '@/lib/oauthLoopbackWebView';

/**
 * Global listener: in-app WebView for OAuth when the IdP redirects to http://127.0.0.1/callback.
 * Mount once under the app root (e.g. _layout).
 */
export function OAuthLoopbackWebViewHost() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const [session, setSession] = useState<LoopbackOAuthStartPayload | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      LOOPBACK_OAUTH_START,
      (p: LoopbackOAuthStartPayload) => {
        handledRef.current = false;
        setSession(p);
      }
    );
    return () => sub.remove();
  }, []);

  const close = () => {
    if (session && !handledRef.current) {
      emitLoopbackOAuthCancel(session.id);
    }
    setSession(null);
  };

  const tryCapture = (url: string) => {
    if (!session || handledRef.current) return;
    if (!isLoopbackOAuthRedirect(url)) return;
    handledRef.current = true;
    emitLoopbackOAuthCaptured(session.id, url);
    setSession(null);
  };

  const onNavStateChange = (nav: WebViewNavigation) => {
    if (nav.url) tryCapture(nav.url);
  };

  const onShouldStartLoadWithRequest = (req: { url: string }) => {
    if (session && isLoopbackOAuthRedirect(req.url)) {
      tryCapture(req.url);
      return false;
    }
    return true;
  };

  return (
    <Modal visible={!!session} animationType="slide" onRequestClose={close}>
      <View style={[styles.wrap, { backgroundColor: colors.background }]}>
        <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
          <Pressable onPress={close} style={styles.cancelBtn} hitSlop={12}>
            <Text style={{ color: colors.tint, fontSize: 17, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Sign in</Text>
          <View style={styles.toolbarSpacer} />
        </View>
        {session ? (
          <WebView
            source={{ uri: session.authUrl }}
            style={styles.web}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator size="large" color={colors.tint} />
              </View>
            )}
            onNavigationStateChange={onNavStateChange}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 8, minWidth: 72 },
  title: { fontSize: 17, fontWeight: '600' },
  toolbarSpacer: { minWidth: 72 },
  web: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
