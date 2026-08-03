// client-mobile/components/HubHeadingSwitch.tsx
// Shows Hub header: two large words side by side replacing the static
// "Shows" title, so switching to Anime is a one-tap heading change rather
// than a filter buried in a sheet — Anime is a first-class section, not a
// tag on Shows. Matches styles.headerTitle's type size/weight exactly so
// the header's footprint doesn't shift when this replaces it.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';

export type HubKind = 'shows' | 'anime';

export default function HubHeadingSwitch({
  value,
  onChange,
}: {
  value: HubKind;
  onChange: (kind: HubKind) => void;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <View style={styles.row}>
      <PressableScale
        onPress={() => onChange('shows')}
        accessibilityRole="button"
        accessibilityState={{ selected: value === 'shows' }}
      >
        <Text style={[styles.heading, { color: value === 'shows' ? c.textPrimary : c.textTertiary }]}>
          Shows
        </Text>
      </PressableScale>
      <PressableScale
        onPress={() => onChange('anime')}
        accessibilityRole="button"
        accessibilityState={{ selected: value === 'anime' }}
      >
        <Text style={[styles.heading, { color: value === 'anime' ? c.textPrimary : c.textTertiary }]}>
          Anime
        </Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 14,
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
});
