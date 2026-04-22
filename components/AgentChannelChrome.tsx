import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import type { ActiveSubscriptionRecord } from '@/lib/subscriptionPushBridge';

type Colors = {
  text: string;
  mutedText: string;
  tint: string;
  border: string;
  background: string;
  card: string;
};

type Props = {
  colors: Colors;
  remoteState: string;
  connectRemote: () => void;
  activeSubscriptions: ActiveSubscriptionRecord[];
  unsubscribe: (id: string) => void;
  /** When set, replaces Remote/Connect with an Updates row + Check button (Direct agent hub). */
  onOpenSubscriptionUpdates?: () => void;
};

export function AgentChannelChrome({
  colors,
  remoteState,
  connectRemote,
  activeSubscriptions,
  unsubscribe,
  onOpenSubscriptionUpdates,
}: Props) {
  return (
    <>
      {onOpenSubscriptionUpdates ? (
        <View style={[styles.stateBar, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.updatesBarTitle, { color: colors.text }]}>Updates</Text>
          <Pressable
            onPress={onOpenSubscriptionUpdates}
            style={[styles.barBtn, { borderColor: colors.tint }]}
            accessibilityRole="button"
            accessibilityLabel="Check subscription updates">
            <Text style={{ color: colors.tint, fontWeight: '600', fontSize: 13 }}>Check</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.stateBar, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.remoteLabel, { color: colors.text }]} numberOfLines={1}>
            Remote: {remoteState}
          </Text>
          <Pressable onPress={connectRemote} style={[styles.barBtn, { borderColor: colors.tint }]}>
            <Text style={{ color: colors.tint, fontWeight: '600', fontSize: 12 }}>Connect</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  stateBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  remoteLabel: { fontSize: 13, flex: 1, minWidth: 0, marginRight: 8 },
  updatesBarTitle: { fontSize: 16, fontWeight: '600', flex: 1 },
  barBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
});
