// client-mobile/components/MonthlyBarStrip.tsx
// Compact Jan-Dec vertical bar strip — Movie Analytics' "watched per month"
// chart (Phase 85, Batch C). Deliberately its own small component rather
// than a variant of GenreChart: that one is a horizontal, named-category
// list (genres/languages), this is 12 FIXED, ordered columns — different
// enough shape that forcing it through GenreChart's layout would need more
// conditional branching than just writing the dozen lines this is.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { MonthStat } from '../store/watchStore';
import { useAppTheme } from '../lib/theme';

const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const BAR_MAX_HEIGHT = 56;
const BAR_MIN_HEIGHT = 3;

interface MonthlyBarStripProps {
  /** Always expected to be exactly 12 entries, months 1-12 in order — the
   *  backend zero-fills every month, so no gap-filling happens here. */
  data: MonthStat[];
  title?: string;
}

export default function MonthlyBarStrip({ data, title = 'By Month' }: MonthlyBarStripProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const maxCount = Math.max(...data.map((m) => m.count), 1);
  const hasAnyActivity = data.some((m) => m.count > 0);

  return (
    <View style={[styles.container, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <Text style={[styles.title, { color: c.textPrimary }]}>{title}</Text>
      {!hasAnyActivity ? (
        <Text style={[styles.empty, { color: c.textTertiary }]}>Nothing watched this year yet.</Text>
      ) : (
        <View style={styles.row}>
          {data.map((m) => {
            const barHeight = m.count > 0 ? Math.max(BAR_MIN_HEIGHT, (m.count / maxCount) * BAR_MAX_HEIGHT) : BAR_MIN_HEIGHT;
            return (
              <View key={m.month} style={styles.col}>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: barHeight,
                        backgroundColor: m.count > 0 ? c.accentFill : c.trackRing,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.monthLabel, { color: c.textTertiary }]}>{MONTH_LETTERS[m.month - 1]}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  empty: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  col: {
    alignItems: 'center',
    gap: 6,
  },
  barTrack: {
    height: BAR_MAX_HEIGHT,
    width: 12,
    justifyContent: 'flex-end',
  },
  bar: {
    width: 12,
    borderRadius: 4,
  },
  monthLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
});
