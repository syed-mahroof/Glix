// client-mobile/components/FilterPill.tsx
// Shared filter-pill button — was byte-duplicated between the Shows Hub
// and Movies Hub (differing only by 2px of horizontal padding, Phase
// 75.9 sweep), each with its own local FilterPill function + styles.

import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';

interface FilterPillProps {
  label: string;
  active: boolean;
  onPress: () => void;
  /** The two original copies differed only in these two values (Shows
   *  Hub: 14/0.5, Movies Hub: 16/0.6) — kept as props rather than picking
   *  one, so extracting this doesn't change either screen's exact current
   *  look. */
  paddingHorizontal?: number;
  letterSpacing?: number;
}

export default function FilterPill({
  label,
  active,
  onPress,
  paddingHorizontal = 14,
  letterSpacing = 0.5,
}: FilterPillProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <PressableScale
      style={[
        styles.pill,
        { paddingHorizontal, backgroundColor: c.glassFill, borderColor: c.hairline },
        active && { borderColor: c.accentFill, backgroundColor: c.accentFill },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.pillText, { letterSpacing, color: c.textSecondary }, active && { color: c.onAccent }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
