import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';

type Props = {
  /** Where the dropdown menu anchors (profile is always the trigger). */
  menuAlign?: 'left' | 'right';
};

export function UserAvatarMenu({ menuAlign = 'right' }: Props) {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        style={[styles.avatar, { backgroundColor: colors.tint }, menuAlign === 'left' ? styles.avatarLeft : styles.avatarRight]}>
        <FontAwesome name="user" size={17} color="#fff" />
      </Pressable>
      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: shell.scrim }, menuAlign === 'left' ? styles.backdropLeft : styles.backdropRight]}
          onPress={() => setOpen(false)}>
          <View
            style={[
              styles.menu,
              {
                backgroundColor: shell.elevated,
                borderColor: shell.borderSubtle,
                marginTop: Math.max(insets.top, 8) + 44,
                ...(menuAlign === 'left' ? { marginLeft: 16 } : { marginRight: 16 }),
              },
              shellCardShadow(isDark),
            ]}>
            <Pressable
              style={styles.menuRow}
              onPress={() => {
                setOpen(false);
                router.push('/direct/settings');
              }}>
              <FontAwesome name="cog" size={18} color={colors.tint} style={styles.menuIcon} />
              <Text style={[styles.menuLabel, { color: colors.text }]}>Settings</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLeft: { marginLeft: 4 },
  avatarRight: { marginRight: 4 },
  backdrop: {
    flex: 1,
  },
  backdropLeft: { alignItems: 'flex-start' },
  backdropRight: { alignItems: 'flex-end' },
  menu: {
    minWidth: 216,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  menuIcon: { width: 24, marginRight: 10 },
  menuLabel: { fontSize: 16, fontWeight: '600' },
});
