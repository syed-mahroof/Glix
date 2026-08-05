// client-mobile/components/TabPill.tsx
// Shared single-select filter pill for the status/sort tab row on My Shows,
// My Movies, and My Anime (Phase 75.3) — previously a byte-identical copy
// living in both app/profile/shows.tsx and app/profile/movies.tsx.
// Distinct from components/FilterPill.tsx (11px uppercase, borderRadius 20,
// used by the tab hubs) — different visual language, do not merge the two.

import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';

export default function TabPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <PressableScale
      style={[
        styles.tabPill,
        { backgroundColor: c.glassFill, borderColor: c.hairline },
        active && { backgroundColor: c.accentFill, borderColor: c.accentFill },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.tabPillText, { color: c.textSecondary }, active && { color: c.onAccent }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tabPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
