import FontAwesome from '@expo/vector-icons/FontAwesome';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { shellCardShadow } from '@/constants/appShell';

type Props = {
  title: string;
  onPress: () => void;
  isDark: boolean;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  tintColor: string;
  destructive?: boolean;
  rightAccessory?: ReactNode;
};

export function SettingsHubCard({
  title,
  onPress,
  isDark,
  backgroundColor,
  borderColor,
  textColor,
  tintColor,
  destructive,
  rightAccessory,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor,
          borderColor,
          opacity: pressed ? 0.92 : 1,
        },
        shellCardShadow(isDark),
      ]}>
      <View style={styles.row}>
        <Text style={[styles.title, { color: destructive ? '#DC2626' : textColor }]} numberOfLines={1}>
          {title}
        </Text>
        {rightAccessory ?? <FontAwesome name="chevron-right" size={14} color={destructive ? '#DC2626' : tintColor} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
    flex: 1,
  },
});
