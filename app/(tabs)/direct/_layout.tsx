import { Stack } from 'expo-router';

import { DmRequestsHeaderButton } from '@/components/DmRequestsHeaderButton';
import { UserAvatarMenu } from '@/components/UserAvatarMenu';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell } from '@/constants/appShell';

export default function DirectStackLayout() {
  const scheme = useColorScheme() ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const colors = Colors[s];
  const shell = getShell(s);

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: shell.elevated,
        },
        headerTitleStyle: { fontWeight: '600', fontSize: 17, color: colors.text },
        headerTintColor: colors.tint,
        headerShadowVisible: false,
      }}>
      <Stack.Screen
        name="index"
        options={{
          title: 'Direct',
          headerTitle: () => null,
          headerLeft: () => <UserAvatarMenu menuAlign="left" />,
          headerRight: () => <DmRequestsHeaderButton />,
        }}
      />
      <Stack.Screen name="agent" options={{ title: 'Agent' }} />
      <Stack.Screen name="agent-updates" options={{ title: 'Updates' }} />
      <Stack.Screen name="chat" options={{ title: 'Thread' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="settings-ai-model" options={{ title: 'AI Model' }} />
      <Stack.Screen name="settings-agents" options={{ title: 'Agents' }} />
      <Stack.Screen name="settings-agent-card" options={{ title: 'Agent card' }} />
      <Stack.Screen name="settings-notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="settings-logs" options={{ title: 'Logs' }} />
      <Stack.Screen name="settings-other" options={{ title: 'Other settings' }} />
      <Stack.Screen name="settings-mcp" options={{ title: 'MCP' }} />
      <Stack.Screen name="dm-requests" options={{ title: 'DM requests' }} />
    </Stack>
  );
}
