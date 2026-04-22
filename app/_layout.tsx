import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import * as Notifications from 'expo-notifications';

import { OAuthLoopbackWebViewHost } from '@/components/OAuthLoopbackWebViewHost';
import { useColorScheme } from '@/components/useColorScheme';
import { getNavigationTheme } from '@/constants/NavigationTheme';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { getBackgroundFetchEnabled, getNotificationsEnabled } from '@/lib/appSettings';
import { pushA2aDeviceStateToCloud, restoreA2aDeviceStateFromCloud } from '@/lib/cloudA2aState';
import { registerSubscriptionAutoSync } from '@/lib/subscriptionAutoSync';
import { registerBackgroundFetch } from '@/lib/backgroundTasks';
import '@/lib/notifications';
import { markNotificationOpened, upsertNotificationReceived } from '@/lib/notificationLog';
import { refreshAllActiveSubscriptionFeeds } from '@/lib/subscriptionUpdatesFeed';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...FontAwesome.font,
  });

  const fontsReady = loaded || !!error;

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return null;
  }

  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const pathname = usePathname();
  const { session, loading } = useAuth();

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  useEffect(() => {
    if (loading || !session?.user?.id) return;
    let cancelled = false;
    void (async () => {
      await restoreA2aDeviceStateFromCloud(session.user.id);
      if (cancelled) return;
      await refreshAllActiveSubscriptionFeeds().catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, session?.user?.id]);

  useEffect(() => {
    if (loading || !session) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        void pushA2aDeviceStateToCloud().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [loading, session]);

  useEffect(() => {
    if (loading || !session?.user?.id) return;
    return registerSubscriptionAutoSync();
  }, [loading, session?.user?.id]);

  useEffect(() => {
    if (loading || !session) return;
    /** Push APIs (listeners, cold-start response) are not implemented on web. */
    if (Platform.OS === 'web') return;
    const refreshSubscriptionFeed = () => {
      void refreshAllActiveSubscriptionFeeds().catch(() => {
        // Best-effort refresh; never block notification or lifecycle handlers.
      });
    };
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      upsertNotificationReceived(notification).catch(() => {
        // Ignore logging failure; never block notification delivery.
      });
      // Indicator-only path: push means "there may be updates"; fetch latest via polling.
      refreshSubscriptionFeed();
    });
    const openedSub = Notifications.addNotificationResponseReceivedListener((response) => {
      markNotificationOpened(response).catch(() => {
        // Ignore logging failure; never block notification handling.
      });
      // App may have been sleeping/backgrounded; fetch latest feed on open.
      refreshSubscriptionFeed();
      requestAnimationFrame(() => {
        try {
          router.push('/notifications');
        } catch {
          // Router not ready; user can open Notifications tab manually.
        }
      });
    });
    void (async () => {
      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      if (lastResponse) {
        await markNotificationOpened(lastResponse).catch(() => {
          // Best-effort restore for cold start opens.
        });
        // Cold-start from push open: refresh from source-of-truth task state.
        refreshSubscriptionFeed();
      }
    })();
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refreshSubscriptionFeed();
    });
    return () => {
      receivedSub.remove();
      openedSub.remove();
      appStateSub.remove();
    };
  }, [router, loading, session]);

  useEffect(() => {
    if (loading) return;
    if (session) {
      if (pathname === '/auth') router.replace('/(tabs)/direct');
    } else {
      if (pathname !== '/auth') router.replace('/auth');
    }
  }, [loading, session, router, pathname]);

  useEffect(() => {
    if (loading || !session) return;
    if (Platform.OS === 'web') return;
    void (async () => {
      const [bg, notify] = await Promise.all([
        getBackgroundFetchEnabled(),
        getNotificationsEnabled(),
      ]);
      if (bg && notify) {
        await registerBackgroundFetch();
      }
    })();
  }, [loading, session]);

  const navTheme = getNavigationTheme(colorScheme);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <KeyboardProvider
          preserveEdgeToEdge
          // Android edge-to-edge (Expo app.json): correct keyboard insets — Gifted Chat / keyboard-controller README.
          statusBarTranslucent
          navigationBarTranslucent>
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          <OAuthLoopbackWebViewHost />
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: navTheme.colors.background },
            }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="auth" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
            <Stack.Screen name="add-server" options={{ presentation: 'modal' }} />
            <Stack.Screen name="server/[id]/index" />
            <Stack.Screen name="server/[id]/tools" options={{ title: 'Tools' }} />
          </Stack>
        </KeyboardProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
