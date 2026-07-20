// client-mobile/components/GenreChart.tsx
// Horizontal bar chart for genre distribution, built with react-native-svg.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { GenreStat } from '../store/watchStore';
import { useAppTheme } from '../lib/theme';

interface GenreChartProps {
  data: GenreStat[];
  maxItems?: number;
}

const BAR_HEIGHT = 8;
const BAR_RADIUS = 4;

export default function GenreChart({ data, maxItems = 8 }: GenreChartProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const items = data.slice(0, maxItems);
  const maxPct = Math.max(...items.map((g) => g.percentage), 1);

  return (
    <View style={[styles.container, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <Text style={[styles.title, { color: c.textPrimary }]}>Top Genres</Text>
      {items.length === 0 ? (
        <Text style={[styles.empty, { color: c.textTertiary }]}>No genre data yet — start watching!</Text>
      ) : (
        items.map((item) => (
          <View key={item.genre} style={styles.row}>
            <Text style={[styles.genre, { color: c.textSecondary }]} numberOfLines={1}>
              {item.genre}
            </Text>
            <View style={[styles.barTrack, { backgroundColor: c.trackRing }]}>
              <View
                style={[
                  styles.barFill,
                  { width: `${(item.percentage / maxPct) * 100}%`, backgroundColor: c.accentFill },
                ]}
              />
            </View>
            <Text style={[styles.pct, { color: c.accentInk }]}>{item.percentage}%</Text>
          </View>
        ))
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
    marginBottom: 2,
  },
  empty: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  genre: {
    fontSize: 12,
    fontWeight: '600',
    width: 90,
  },
  barTrack: {
    flex: 1,
    height: BAR_HEIGHT,
    borderRadius: BAR_RADIUS,
    overflow: 'hidden',
  },
  barFill: {
    height: BAR_HEIGHT,
    borderRadius: BAR_RADIUS,
  },
  pct: {
    fontSize: 11,
    fontWeight: '700',
    width: 36,
    textAlign: 'right',
  },
});
