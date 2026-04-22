import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, DeviceEventEmitter, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useAuth } from '@/contexts/AuthContext';
import { countUnreadAgentInbound, subscribeAgentInboundChanges } from '@/lib/agentInbound';
import { FRONTIER_A2A_UI_REFRESH } from '@/lib/a2aUiRefreshBus';

export function DmRequestsHeaderButton() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user?.id ?? null;
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (authLoading || !userId) {
        if (!cancelled) setUnread(0);
        return;
      }
      void countUnreadAgentInbound().then((n) => {
        if (!cancelled) setUnread(n);
      });
    };
    tick();
    const id = setInterval(tick, 60000);
    const sub = DeviceEventEmitter.addListener(FRONTIER_A2A_UI_REFRESH, tick);
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') tick();
    });
    return () => {
      cancelled = true;
      clearInterval(id);
      sub.remove();
      appSub.remove();
    };
  }, [authLoading, userId]);

  useEffect(() => {
    if (authLoading || !userId) return;
    return subscribeAgentInboundChanges(
      userId,
      () => {
        void countUnreadAgentInbound().then((n) => setUnread(n));
      },
      'header-badge'
    );
  }, [authLoading, userId]);

  return (
    <Pressable
      onPress={() => router.push('/direct/dm-requests')}
      accessibilityRole="button"
      accessibilityLabel="Direct message requests"
      hitSlop={8}
      style={styles.wrap}>
      <View>
        <FontAwesome name="inbox" size={20} color={colors.tint} />
        {unread > 0 ? (
          <View style={[styles.dot, { backgroundColor: colors.tint }]}>
            <Text style={styles.dotText}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  dot: {
    position: 'absolute',
    right: -6,
    top: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  dotText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
