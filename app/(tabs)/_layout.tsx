import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs, useSegments } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import Colors from '@/constants/Colors';
import { getShell } from '@/constants/appShell';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={24} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const segments = useSegments();

  const scheme = colorScheme ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const c = Colors[scheme];
  const shell = getShell(s);
  const isDark = scheme === 'dark';

  /** Hide tab bar while in Direct → Settings stack (hub + nested screens). */
  const segs = segments as readonly string[];
  const hideTabBarInSettings =
    segs.includes('direct') && segs.some((seg) => /^settings(?:-|$)/.test(seg));

  const tabBarStyleVisible = {
    backgroundColor: shell.tabBarBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: shell.borderSubtle,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: isDark ? 0.35 : 0.05,
        shadowRadius: 10,
      },
      android: { elevation: 6 },
      default: {},
    }),
  };

  const tabBarStyle = hideTabBarInSettings
    ? { display: 'none' as const, height: 0, overflow: 'hidden' as const }
    : tabBarStyleVisible;

  return (
    <Tabs
      screenOptions={{
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: c.tint,
        tabBarInactiveTintColor: shell.inactiveTab,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.35 },
        tabBarStyle,
        headerStyle: {
          backgroundColor: shell.elevated,
          borderBottomWidth: 0,
          shadowOpacity: 0,
          elevation: 0,
        },
        headerTintColor: c.tint,
        headerTitleStyle: { color: c.text, fontWeight: '600', fontSize: 17 },
        headerShadowVisible: false,
        headerShown: useClientOnlyValue(false, true),
      }}>
      <Tabs.Screen
        name="direct"
        options={{
          title: 'Direct',
          headerShown: false,
          tabBarIcon: ({ color }) => <TabBarIcon name="comments" color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarLabel: 'Search',
          headerTitle: () => null,
          tabBarIcon: ({ color }) => <TabBarIcon name="search" color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarLabel: 'Tasks',
          headerTitle: () => null,
          tabBarIcon: ({ color }) => <TabBarIcon name="tasks" color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Notifications',
          tabBarLabel: 'Notifications',
          headerTitle: () => null,
          tabBarIcon: ({ color }) => <TabBarIcon name="bell" color={color} />,
        }}
      />
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="servers" options={{ href: null }} />
    </Tabs>
  );
}
