import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function OAuthCallbackScreen() {
  const router = useRouter();
  const colors = Colors[useColorScheme() ?? 'light'];

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace('/(tabs)');
    }, 600);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <>
      <Stack.Screen options={{ title: 'Completing sign-in' }} />
      <View style={[styles.wrap, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={styles.text}>Completing sign-in...</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  text: { fontSize: 15, opacity: 0.8 },
});

