// client-mobile/components/WatchStreakCard.tsx
import { Flame, TrendingUp, Zap } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HeatmapDay } from '../store/watchStore';
import { useAppTheme } from '../lib/theme';

interface WatchStreakCardProps {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
  recentActivity: HeatmapDay[];
}

// Intensity 0 renders as the inert track; 1-4 render as accentFill at
// increasing opacity, preserving the original 0.25/0.50/0.75/1.0 ramp
// without baking a new rgba literal into the token system.
const MINI_INTENSITY_OPACITY = [1, 0.25, 0.5, 0.75, 1];

export default function WatchStreakCard({
  currentStreak,
  longestStreak,
  totalDays,
  recentActivity,
}: WatchStreakCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  // Show last 30 days as a mini heatmap row
  const recent = recentActivity.slice(-30);

  return (
    <View style={[styles.container, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: c.accentDim }]}>
          <Flame color={c.accentInk} size={18} strokeWidth={1.75} />
        </View>
        <Text style={[styles.title, { color: c.textPrimary }]}>Watch Streak</Text>
      </View>

      <View style={styles.streakRow}>
        <View style={styles.bigStat}>
          <Text style={[styles.bigValue, { color: c.accentInk }]}>{currentStreak}</Text>
          <Text style={[styles.bigLabel, { color: c.textSecondary }]}>Day{currentStreak !== 1 ? 's' : ''} Current</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: c.hairline }]} />
        <View style={styles.smallStats}>
          <View style={styles.smallStat}>
            <TrendingUp color={c.accentInk} size={14} strokeWidth={2} />
            <Text style={[styles.smallValue, { color: c.textPrimary }]}>{longestStreak}</Text>
            <Text style={[styles.smallLabel, { color: c.textTertiary }]}>Best</Text>
          </View>
          <View style={styles.smallStat}>
            <Zap color={c.accentInk} size={14} strokeWidth={2} />
            <Text style={[styles.smallValue, { color: c.textPrimary }]}>{totalDays}</Text>
            <Text style={[styles.smallLabel, { color: c.textTertiary }]}>Total</Text>
          </View>
        </View>
      </View>

      {/* Mini 30-day heatmap row */}
      <View style={styles.miniHeatmap}>
        {recent.map((day) => (
          <View
            key={day.date}
            style={[
              styles.miniCell,
              {
                backgroundColor: day.intensity === 0 ? c.trackRing : c.accentFill,
                opacity: day.intensity === 0 ? 1 : MINI_INTENSITY_OPACITY[day.intensity],
              },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.heatmapLabel, { color: c.textTertiary }]}>Last 30 days</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  bigStat: {
    flex: 1,
    alignItems: 'center',
  },
  bigValue: {
    fontSize: 52,
    fontWeight: '900',
    lineHeight: 56,
    letterSpacing: -2,
  },
  bigLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 60,
  },
  smallStats: {
    flex: 1,
    gap: 12,
  },
  smallStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  smallValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  smallLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  miniHeatmap: {
    flexDirection: 'row',
    gap: 3,
    flexWrap: 'nowrap',
  },
  miniCell: {
    flex: 1,
    height: 10,
    borderRadius: 2,
  },
  heatmapLabel: {
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'right',
    marginTop: -8,
  },
});
