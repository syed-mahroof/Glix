// client-mobile/components/TrendChip.tsx
// A small trend verdict next to a raw stat (Phase 12 polish, Aura-inspired
// "0.7× slower" tags) — turns a bare number into a verdict using only the
// two permitted hues: accent for positive, error red only for a genuinely
// broken streak. Flat/neutral gets a muted dash, no hue at all.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';

export type TrendDirection = 'up' | 'down' | 'flat';

interface TrendChipProps {
  direction: TrendDirection;
  label: string;
  /** Only 'down' can be flagged broken — an accent-colored dip is still
   *  "down" but not alarming; a broken streak should read as an error. */
  broken?: boolean;
}

export default function TrendChip({ direction, label, broken = false }: TrendChipProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  const glyph = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—';
  const color = direction === 'flat' ? c.textTertiary : broken && direction === 'down' ? c.negative : c.accentInk;
  const bg = direction === 'flat' ? 'transparent' : broken && direction === 'down' ? c.negativeDim : c.accentDim;

  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color }]}>
        {glyph} {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9,
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
