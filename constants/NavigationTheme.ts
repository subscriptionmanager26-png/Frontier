import { DarkTheme, DefaultTheme, Theme } from '@react-navigation/native';

import Colors from '@/constants/Colors';

/**
 * React Navigation theme aligned with app Colors so headers, tab bar, and stack
 * screens match light/dark mode (avoids white headers on dark system theme).
 */
export function getNavigationTheme(colorScheme: 'light' | 'dark' | null | undefined): Theme {
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const c = Colors[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: scheme === 'dark',
    colors: {
      ...base.colors,
      primary: c.tint,
      background: c.background,
      card: c.card,
      text: c.text,
      border: c.border,
      notification: c.tint,
    },
  };
}
