import { Platform, type ViewStyle } from 'react-native';

/** Subtle card elevation — guidelines: soft shadow on white cards over gray canvas. */
export function cardShadow(isDark: boolean): ViewStyle {
  return Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.35 : 0.08,
      shadowRadius: 8,
    },
    android: { elevation: 3 },
    default: {},
  });
}

/** Tab bar / composer strip separation */
export function topBarShadow(isDark: boolean): ViewStyle {
  return Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: -1 },
      shadowOpacity: isDark ? 0.25 : 0.06,
      shadowRadius: 4,
    },
    android: { elevation: 8 },
    default: {},
  });
}
