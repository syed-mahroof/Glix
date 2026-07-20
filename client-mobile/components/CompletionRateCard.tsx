// client-mobile/components/CompletionRateCard.tsx
// 2×2 grid of ProgressRings for episode/season/show completion.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ProgressRing } from './ProgressRing';
import { useAppTheme, type ThemeColors } from '../lib/theme';

interface CompletionRateCardProps {
  episodePct: number;
  seasonPct: number;
  showPct: number;
  moviePct?: number;
}

interface RingItemProps {
  pct: number;
  label: string;
  c: ThemeColors;
}

function RingItem({ pct, label, c }: RingItemProps) {
  return (
    <View style={styles.ringItem}>
      <ProgressRing
        percentage={pct}
        size={64}
        strokeWidth={5}
        showLabel={false}
        color={c.accentInk}
        trackColor={c.trackRing}
      />
      <Text style={[styles.ringPct, { color: c.textPrimary }]}>{pct.toFixed(0)}%</Text>
      <Text style={[styles.ringLabel, { color: c.textSecondary }]}>{label}</Text>
    </View>
  );
}

export default function CompletionRateCard({
  episodePct,
  seasonPct,
  showPct,
  moviePct = 0,
}: CompletionRateCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <View style={[styles.container, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <Text style={[styles.title, { color: c.textPrimary }]}>Completion Rates</Text>
      <View style={styles.grid}>
        <RingItem pct={episodePct} label="Episodes" c={c} />
        <RingItem pct={seasonPct} label="Seasons" c={c} />
        <RingItem pct={showPct} label="Shows" c={c} />
        <RingItem pct={moviePct} label="Movies" c={c} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  ringItem: {
    width: '46%',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  ringPct: {
    position: 'absolute',
    top: 22,
    fontSize: 13,
    fontWeight: '700',
  },
  ringLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
});
