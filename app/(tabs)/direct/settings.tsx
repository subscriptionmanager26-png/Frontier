import { type Href, useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { SettingsHubCard } from '@/components/settings/SettingsHubCard';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellScreenSubtitle } from '@/constants/appShell';
import { useAuth } from '@/contexts/AuthContext';

export default function SettingsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);
  const { signOut } = useAuth();

  const cardBg = colors.card;
  const border = shell.borderSubtle;

  const onSignOut = () => {
    Alert.alert('Sign out', 'You will need to sign in again to use cloud features.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <ScrollView
      style={{ backgroundColor: shell.canvas }}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled">
      <Text style={[shellScreenSubtitle(colors.mutedText), { marginBottom: 18 }]}>
        Tap a card to open its settings. Only the title is shown here.
      </Text>

      <SettingsHubCard
        title="AI Model"
        onPress={() => router.push('/direct/settings-ai-model' as Href)}
        isDark={isDark}
        backgroundColor={cardBg}
        borderColor={border}
        textColor={colors.text}
        tintColor={colors.tint}
      />
      <SettingsHubCard
        title="Agents"
        onPress={() => router.push('/direct/settings-agents' as Href)}
        isDark={isDark}
        backgroundColor={cardBg}
        borderColor={border}
        textColor={colors.text}
        tintColor={colors.tint}
      />
      <SettingsHubCard
        title="Agent card"
        onPress={() => router.push('/direct/settings-agent-card' as Href)}
        isDark={isDark}
        backgroundColor={cardBg}
        borderColor={border}
        textColor={colors.text}
        tintColor={colors.tint}
      />
      <SettingsHubCard
        title="Notification Settings"
        onPress={() => router.push('/direct/settings-notifications' as Href)}
        isDark={isDark}
        backgroundColor={cardBg}
        borderColor={border}
        textColor={colors.text}
        tintColor={colors.tint}
      />
      <SettingsHubCard
        title="Logs"
        onPress={() => router.push('/direct/settings-logs' as Href)}
        isDark={isDark}
        backgroundColor={cardBg}
        borderColor={border}
        textColor={colors.text}
        tintColor={colors.tint}
      />
      <SettingsHubCard
        title="Other settings"
        onPress={() => router.push('/direct/settings-other' as Href)}
        isDark={isDark}
        backgroundColor={cardBg}
        borderColor={border}
        textColor={colors.text}
        tintColor={colors.tint}
      />
      <SettingsHubCard
        title="MCP"
        onPress={() => router.push('/direct/settings-mcp' as Href)}
        isDark={isDark}
        backgroundColor={cardBg}
        borderColor={border}
        textColor={colors.text}
        tintColor={colors.tint}
      />
      <SettingsHubCard
        title="Sign out"
        onPress={onSignOut}
        isDark={isDark}
        backgroundColor={cardBg}
        borderColor={border}
        textColor={colors.text}
        tintColor={colors.tint}
        destructive
      />

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 22, paddingBottom: 48 },
});
