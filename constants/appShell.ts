/**
 * Visual tokens for app chrome only (tabs, lists, settings, modals).
 * Chat message surfaces keep using `constants/Colors.ts` so conversation UI stays unchanged.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export type ShellScheme = 'light' | 'dark';

export function getShell(scheme: ShellScheme) {
  if (scheme === 'dark') {
    return {
      canvas: '#0C0C0E',
      elevated: '#17171A',
      elevatedMuted: '#121214',
      borderSubtle: 'rgba(255,255,255,0.08)',
      tabBarBg: '#141416',
      scrim: 'rgba(0,0,0,0.48)',
      inactiveTab: '#64748B',
    };
  }
  return {
    /** Warm neutral canvas — calmer than flat gray */
    canvas: '#F3F1EE',
    elevated: '#FFFFFF',
    elevatedMuted: '#FAFAF8',
    borderSubtle: 'rgba(20, 20, 24, 0.08)',
    tabBarBg: '#FCFAF8',
    scrim: 'rgba(15, 15, 22, 0.42)',
    inactiveTab: '#94A3B8',
  };
}

/** Soft elevation for list cards and sheets (shell only). */
export function shellCardShadow(isDark: boolean): ViewStyle {
  return Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.45 : 0.07,
      shadowRadius: 14,
    },
    android: { elevation: 2 },
    default: {},
  });
}

/** Section labels: restrained caps — use with theme text color. */
export function shellSectionLabel(color: string): TextStyle {
  return {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color,
    marginBottom: 12,
  };
}

/** Large list title on tab root screens */
export function shellScreenTitle(color: string): TextStyle {
  return {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
    color,
    marginBottom: 4,
  };
}

export function shellScreenSubtitle(color: string): TextStyle {
  return {
    fontSize: 15,
    lineHeight: 22,
    color,
    opacity: 0.72,
    marginBottom: 20,
  };
}
