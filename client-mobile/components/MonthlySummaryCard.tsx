// client-mobile/components/MonthlySummaryCard.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { MonthlySummaryItem } from '../store/watchStore';
import { useAppTheme } from '../lib/theme';

interface MonthlySummaryCardProps {
  item: MonthlySummaryItem;
}

export default function MonthlySummaryCard({ item }: MonthlySummaryCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const hasActivity = item.episodes_watched > 0;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.glassFill, borderColor: c.hairline },
        !hasActivity && styles.cardInactive,
      ]}
    >
      <View style={styles.monthHeader}>
        <Text style={[styles.monthLabel, { color: hasActivity ? c.textPrimary : c.textTertiary }]}>
          {item.label}
        </Text>
        {hasActivity && (
          <Text style={[styles.hours, { color: c.accentInk }]}>{item.hours_watched}h</Text>
        )}
      </View>

      {hasActivity ? (
        <>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: c.textPrimary }]}>{item.episodes_watched}</Text>
              <Text style={[styles.statLabel, { color: c.textTertiary }]}>Episodes</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: c.textPrimary }]}>{item.shows_finished}</Text>
              <Text style={[styles.statLabel, { color: c.textTertiary }]}>Finished</Text>
            </View>
            {item.top_genre ? (
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: c.textPrimary }]} numberOfLines={1}>{item.top_genre}</Text>
                <Text style={[styles.statLabel, { color: c.textTertiary }]}>Top Genre</Text>
              </View>
            ) : null}
          </View>
          {item.top_show ? (
            <Text style={[styles.topShow, { color: c.textSecondary }]} numberOfLines={1}>
              📺 {item.top_show.title} ({item.top_show.episodes_watched} eps)
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={[styles.noActivity, { color: c.textTertiary }]}>No activity this month</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  cardInactive: {
    opacity: 0.5,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  hours: {
    fontSize: 16,
    fontWeight: '800',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  stat: {
    gap: 2,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  topShow: {
    fontSize: 12,
  },
  noActivity: {
    fontSize: 12,
    fontStyle: 'italic',
  },
});
