// client-mobile/components/ActorChart.tsx
// Top-voted MVP actors horizontal bar chart.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';

interface ActorStat {
  actor_name: string;
  vote_count: number;
}

interface ActorChartProps {
  data: ActorStat[];
  maxItems?: number;
}

export default function ActorChart({ data, maxItems = 8 }: ActorChartProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const items = data.slice(0, maxItems);
  const maxVotes = Math.max(...items.map((a) => a.vote_count), 1);

  return (
    <View style={[styles.container, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <Text style={[styles.title, { color: c.textPrimary }]}>Favourite Characters</Text>
      {items.length === 0 ? (
        <Text style={[styles.empty, { color: c.textTertiary }]}>Vote for MVP characters after watching episodes.</Text>
      ) : (
        items.map((item) => (
          <View key={item.actor_name} style={styles.row}>
            <Text style={[styles.name, { color: c.textSecondary }]} numberOfLines={1}>
              {item.actor_name}
            </Text>
            <View style={[styles.barTrack, { backgroundColor: c.trackRing }]}>
              <View
                style={[
                  styles.barFill,
                  { width: `${(item.vote_count / maxVotes) * 100}%`, backgroundColor: c.accentFill },
                ]}
              />
            </View>
            <Text style={[styles.votes, { color: c.accentInk }]}>{item.vote_count}</Text>
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
  name: {
    fontSize: 12,
    fontWeight: '600',
    width: 110,
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: 8,
    borderRadius: 4,
  },
  votes: {
    fontSize: 11,
    fontWeight: '700',
    width: 28,
    textAlign: 'right',
  },
});
